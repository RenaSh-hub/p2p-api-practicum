import { expect, test } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const ACTIVE_VENDOR = 'vnd-001';

const defaultLine = { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 };

const apiExampleCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
};

function poSnapshot(body: Record<string, unknown>) {
  return {
    id: body.id,
    vendor_id: body.vendor_id,
    status: body.status,
    line_items: body.line_items,
    ordered_value: body.ordered_value,
    received_value: body.received_value,
    fully_received: body.fully_received,
  };
}

test.describe('POST /purchase-orders', () => {
  test('PO-POST-01 creates draft PO matching API.md example totals', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', { data: apiExampleCreate });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('draft');
    expect(body.vendor_id).toBe(ACTIVE_VENDOR);
    expect(body.id).toMatch(/^po-/);
    expect(body.ordered_value).toBe(95.1);
    expect(body.received_value).toBe(0);
    expect(body.fully_received).toBe(false);

    const lines = body.line_items as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      sku: 'LUM-2X4-8',
      description: '2x4 stud, 8 ft',
      quantity: 10,
      unit_price: 4.75,
      received_quantity: 0,
    });
    expect(lines[1]).toMatchObject({
      sku: 'CEM-30KG',
      description: '',
      quantity: 4,
      unit_price: 11.9,
      received_quantity: 0,
    });
  });

  test('PO-POST-02 creates PO with omitted line description defaulting to empty', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'SCR-DECK-1LB', quantity: 1, unit_price: 9.99 }],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('draft');
    expect(body.ordered_value).toBe(9.99);
    expect(body.line_items[0].description).toBe('');
  });

  test('PO-POST-03 creates PO with explicit line description', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [
          { sku: 'SCR-DECK-1LB', quantity: 1, unit_price: 9.99, description: 'Deck screws, 1 lb box' },
        ],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.line_items[0].description).toBe('Deck screws, 1 lb box');
  });

  test('PO-POST-04 accepts minimum quantity 1 and unit_price 0', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 0 }],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.line_items[0].quantity).toBe(1);
    expect(body.line_items[0].unit_price).toBe(0);
    expect(body.ordered_value).toBe(0);
  });

  test('PO-POST-05 accepts maximum quantity 10000', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 4.75 }],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.line_items[0].quantity).toBe(10000);
    expect(body.ordered_value).toBe(47500);
  });

  test('PO-POST-06 accepts maximum unit_price 100000', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 100000 }],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.line_items[0].unit_price).toBe(100000);
    expect(body.ordered_value).toBe(1000000);
  });

  test('PO-POST-07 GET returns the same PO as create', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'SCR-DECK-1LB', quantity: 1, unit_price: 9.99 }],
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    await expectSchema(request, createdBody, 'PurchaseOrder');

    const res = await request.get(`/purchase-orders/${createdBody.id}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(poSnapshot(body)).toEqual(poSnapshot(createdBody));
  });

  test('PO-POST-08 successful create body matches OpenAPI PurchaseOrder', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
  });

  test('PO-POST-N01 rejects inactive vendor vnd-002', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: 'vnd-002', line_items: [defaultLine] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('inactive_vendor_gate');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });

  test('PO-POST-N02 rejects unknown vendor with 404', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: 'vnd-does-not-exist', line_items: [defaultLine] },
    });
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('PO-POST-N03 rejects quantity 0', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ ...defaultLine, quantity: 0 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N04 rejects negative quantity', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ ...defaultLine, quantity: -1 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N05 rejects quantity 10001', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ ...defaultLine, quantity: 10001 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N06 rejects negative unit_price', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ ...defaultLine, unit_price: -0.01 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N07 rejects unit_price 100001', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ ...defaultLine, unit_price: 100001 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N08 rejects duplicate SKU on one PO', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [
          { sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 },
          { sku: 'LUM-2X4-8', quantity: 2, unit_price: 4.75 },
        ],
      },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });

  test('PO-POST-N09 rejects empty line_items array', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', { data: { vendor_id: ACTIVE_VENDOR, line_items: [] } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N10 rejects empty body', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', { data: {} });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N11 rejects missing line_items', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', { data: { vendor_id: ACTIVE_VENDOR } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N12 rejects line missing sku', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ quantity: 10, unit_price: 4.75 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N13 rejects line missing quantity', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ sku: 'LUM-2X4-8', unit_price: 4.75 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N14 rejects line missing unit_price', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N15 rejects empty vendor_id', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: '', line_items: [defaultLine] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N16 rejects empty sku', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [{ sku: '', quantity: 10, unit_price: 4.75 }] },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N17 rejects string quantity', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'LUM-2X4-8', quantity: '10', unit_price: 4.75 }],
      },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N18 rejects string unit_price', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: '4.75' }],
      },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N19 rejects line_items that is not an array', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 } },
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-N20 rejects body that is not JSON', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not valid json',
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('PO-POST-E01 unknown path POST /purchase-orders/not-a-route returns 404', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/purchase-orders/not-a-route', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('GET /purchase-orders/{poId}', () => {
  test('PO-GET-01 GET matches created PO', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: {
        vendor_id: ACTIVE_VENDOR,
        line_items: [{ sku: 'SCR-DECK-1LB', quantity: 1, unit_price: 9.99 }],
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    await expectSchema(request, createdBody, 'PurchaseOrder');

    const res = await request.get(`/purchase-orders/${createdBody.id}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(poSnapshot(body)).toEqual(poSnapshot(createdBody));
  });

  test('PO-GET-02 GET body matches OpenAPI PurchaseOrder after API example create', { tag: '@e2e' }, async ({
    request,
  }) => {
    const created = await request.post('/purchase-orders', { data: apiExampleCreate });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();

    const res = await request.get(`/purchase-orders/${createdBody.id}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
  });

  test('PO-GET-03 GET draft shows zero receipt fields', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    const res = await request.get(`/purchase-orders/${id}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('draft');
    expect(body.received_value).toBe(0);
    expect(body.fully_received).toBe(false);
    for (const line of body.line_items as Array<Record<string, unknown>>) {
      expect(line.received_quantity).toBe(0);
    }
  });

  test('PO-GET-E01 unknown poId returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/purchase-orders/po-does-not-exist');
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('PO-GET-E02 unknown path GET /purchase-orders/po-001/extra returns 404', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.get('/purchase-orders/po-001/extra');
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('POST /purchase-orders/{poId}/submit', () => {
  test('PO-SUB-01 submit moves draft to submitted', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();

    const res = await request.post(`/purchase-orders/${createdBody.id}/submit`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.id).toBe(createdBody.id);
    expect(body.vendor_id).toBe(createdBody.vendor_id);
    expect(body.status).toBe('submitted');
    expect(body.line_items).toEqual(createdBody.line_items);
  });

  test('PO-SUB-02 submit response matches OpenAPI PurchaseOrder', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    const res = await request.post(`/purchase-orders/${id}/submit`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
  });

  test('PO-SUB-03 GET after submit shows submitted status', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    const submitted = await request.post(`/purchase-orders/${id}/submit`);
    expect(submitted.status()).toBe(200);

    const res = await request.get(`/purchase-orders/${id}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.status).toBe('submitted');
  });

  test('PO-SUB-N01 submit unknown poId returns 404', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/purchase-orders/po-does-not-exist/submit');
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('PO-SUB-N02 second submit on submitted PO returns workflow_gate', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    const first = await request.post(`/purchase-orders/${id}/submit`);
    expect(first.status()).toBe(200);

    const res = await request.post(`/purchase-orders/${id}/submit`);
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('workflow_gate');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });

  test('PO-SUB-N03 submit on closed PO returns workflow_gate', { tag: '@e2e' }, async ({ request }) => {
    const created = await request.post('/purchase-orders', {
      data: { vendor_id: ACTIVE_VENDOR, line_items: [defaultLine] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    const submitted = await request.post(`/purchase-orders/${id}/submit`);
    expect(submitted.status()).toBe(200);

    const received = await request.post(`/purchase-orders/${id}/receive`, {
      data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
    });
    expect(received.status()).toBe(200);
    const closedBody = await received.json();
    expect(closedBody.status).toBe('closed');

    const res = await request.post(`/purchase-orders/${id}/submit`);
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('workflow_gate');
  });

  test('PO-SUB-E01 unknown path POST /purchase-orders/po-001/submit/extra returns 404', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/purchase-orders/po-001/submit/extra');
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});
