import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const ACTIVE_VENDOR = 'vnd-001';

const po1LCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
};

const po2LCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
};

const poMaxCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 4.75 }],
};

function lineBySku(body: Record<string, unknown>, sku: string): Record<string, unknown> {
  const lines = body.line_items as Array<Record<string, unknown>>;
  const line = lines.find((candidate) => candidate.sku === sku);
  if (!line) {
    throw new Error(`SKU ${sku} not found on PO`);
  }
  return line;
}

async function createPo(request: APIRequestContext, createBody: object): Promise<string> {
  const res = await request.post('/purchase-orders', { data: createBody });
  expect(res.status()).toBe(201);
  const body = await res.json();
  await expectSchema(request, body, 'PurchaseOrder');
  return body.id as string;
}

async function submitPo(request: APIRequestContext, poId: string): Promise<void> {
  const res = await request.post(`/purchase-orders/${poId}/submit`);
  expect(res.status()).toBe(200);
}

async function createSubmittedPo(request: APIRequestContext, createBody: object): Promise<string> {
  const id = await createPo(request, createBody);
  await submitPo(request, id);
  return id;
}

function receiveSnapshot(body: Record<string, unknown>) {
  return {
    status: body.status,
    received_value: body.received_value,
    fully_received: body.fully_received,
    line_items: body.line_items,
  };
}

test.describe('POST /purchase-orders/{poId}/receive', () => {
  test('RCV-01 full receive closes single-line PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('closed');
    expect(body.fully_received).toBe(true);
    expect(body.ordered_value).toBe(47.5);
    expect(body.received_value).toBe(47.5);
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
  });

  test('RCV-02 full receive closes two-line PO in one delivery', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po2LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: {
        items: [
          { sku: 'LUM-2X4-8', quantity: 10 },
          { sku: 'CEM-30KG', quantity: 4 },
        ],
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('closed');
    expect(body.fully_received).toBe(true);
    expect(body.received_value).toBe(95.1);
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
    expect(lineBySku(body, 'CEM-30KG').received_quantity).toBe(4);
  });

  test('RCV-03 partial receive keeps PO submitted', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 4 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('submitted');
    expect(body.fully_received).toBe(false);
    expect(body.received_value).toBe(19);
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(4);
  });

  test('RCV-04 two partial receives complete the line and close PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const first = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 4 }] },
    });
    expect(first.status()).toBe(200);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('closed');
    expect(body.fully_received).toBe(true);
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
    expect(body.received_value).toBe(47.5);
  });

  test('RCV-05 partial receive completes one line on a two-line PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po2LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('submitted');
    expect(body.fully_received).toBe(false);
    expect(body.received_value).toBe(47.5);
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
    expect(lineBySku(body, 'CEM-30KG').received_quantity).toBe(0);
  });

  test('RCV-06 receive quantity 1 closes single-unit PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, {
      vendor_id: ACTIVE_VENDOR,
      line_items: [{ sku: 'SCR-DECK-1LB', quantity: 1, unit_price: 9.99 }],
    });

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'SCR-DECK-1LB', quantity: 1 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('closed');
    expect(lineBySku(body, 'SCR-DECK-1LB').received_quantity).toBe(1);
    expect(body.received_value).toBe(9.99);
  });

  test('RCV-07 last unit receive closes PO at ordered quantity', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const first = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 9 }] },
    });
    expect(first.status()).toBe(200);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('closed');
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
  });

  test('RCV-08 full receive response matches OpenAPI PurchaseOrder', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
  });

  test('RCV-09 GET after partial receive matches receive response', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const received = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 4 }] },
    });
    expect(received.status()).toBe(200);
    const receivedBody = await received.json();
    await expectSchema(request, receivedBody, 'PurchaseOrder');

    const res = await request.get(`/purchase-orders/${poId}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(receiveSnapshot(body)).toEqual(receiveSnapshot(receivedBody));
  });

  test('RCV-10 receive maximum quantity 10000 closes PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, poMaxCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10000 }] },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('closed');
    expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10000);
    expect(body.received_value).toBe(47500);
  });

  test('RCV-N01 receive on draft PO returns workflow_gate', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('workflow_gate');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });

  test('RCV-N02 receive on closed PO returns workflow_gate', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const closed = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
    });
    expect(closed.status()).toBe(200);
    expect((await closed.json()).status).toBe('closed');

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('workflow_gate');
  });

  test('RCV-N03 receive over ordered quantity in one shipment returns receive_quantity_limit', { tag: '@e2e' }, async ({
    request,
  }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 11 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('receive_quantity_limit');
  });

  test('RCV-N04 cumulative over-receipt returns receive_quantity_limit', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const first = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
    });
    expect(first.status()).toBe(200);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('receive_quantity_limit');
  });

  test('RCV-N05 one unit over cumulative limit returns receive_quantity_limit', { tag: '@e2e' }, async ({
    request,
  }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const first = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 5 }] },
    });
    expect(first.status()).toBe(200);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('receive_quantity_limit');
  });

  test('RCV-N06 SKU not on PO returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'SKU-NOT-ON-PO', quantity: 1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });

  test('RCV-N07 empty items array returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, { data: { items: [] } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N08 missing items returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, { data: {} });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N09 item missing sku returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ quantity: 1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N10 quantity 0 returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 0 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N11 negative quantity returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: -1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N12 quantity 10001 returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10001 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N13 empty sku returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: '', quantity: 1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N14 string quantity returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: '1' }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-N15 body that is not JSON returns validation_error', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);

    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not valid json',
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('RCV-E01 receive on unknown poId returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders/po-does-not-exist/receive', {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
    });
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('RCV-E02 unknown path POST /purchase-orders/po-001/receive/extra returns 404', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/purchase-orders/po-001/receive/extra', {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
    });
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});
