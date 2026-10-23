import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';
import {
  ACTIVE_VENDOR,
  createPo,
  createSubmittedPo,
  invoiceExampleTwoLine,
  invoiceSnapshot,
  po1LCreate,
  po2LCreate,
  receivePo,
  setupPo1LFull,
  setupPo2LFull,
  setupPo2LPart,
  setupPoMaxFull,
} from './helpers/po.js';

async function postInvoice(
  request: APIRequestContext,
  body: object,
): Promise<{ res: Awaited<ReturnType<APIRequestContext['post']>>; body: Record<string, unknown> }> {
  const res = await request.post('/invoices', { data: body });
  const parsed = await res.json();
  return { res, body: parsed };
}

test.describe('POST /invoices', () => {
  test('INV-POST-01 creates two-line invoice on fully received PO', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo2LFull(request);
    const invoiceNumber = 'INV-1001-POST-01';

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: invoiceNumber,
      line_items: invoiceExampleTwoLine,
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect(body.status).toBe('received');
    expect(body.matched).toBe(false);
    expect(body.partial_receipt).toBeNull();
    expect(body.po_id).toBe(poId);
    expect(body.vendor_id).toBe(ACTIVE_VENDOR);
    expect(body.id).toMatch(/^inv-/);
    expect(body.invoice_number).toBe(invoiceNumber);
    expect(body.total_amount).toBe(95.1);
    const lines = body.line_items as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 });
    expect(lines[1]).toMatchObject({ sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 });
  });

  test('INV-POST-02 creates single-line invoice on fully received PO', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-SINGLE-POST-02',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect(body.line_items).toHaveLength(1);
    expect(body.total_amount).toBe(47.5);
    expect(body.status).toBe('received');
  });

  test('INV-POST-03 creates invoice on submitted PO after partial receive', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);
    await receivePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-SUB-POST-03',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect(body.total_amount).toBe(4.75);
    expect(body.status).toBe('received');
  });

  test('INV-POST-04 accepts minimum quantity 1', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-QTY1-POST-04',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect((body.line_items as Array<Record<string, unknown>>)[0].quantity).toBe(1);
    expect(body.total_amount).toBe(4.75);
  });

  test('INV-POST-05 accepts maximum quantity 10000', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPoMaxFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAXQTY-POST-05',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect((body.line_items as Array<Record<string, unknown>>)[0].quantity).toBe(10000);
    expect(body.total_amount).toBe(47500);
  });

  test('INV-POST-06 accepts unit_price 0', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-ZERO-POST-06',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 0 }],
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect((body.line_items as Array<Record<string, unknown>>)[0].unit_price).toBe(0);
    expect(body.total_amount).toBe(0);
  });

  test('INV-POST-07 creates invoice for received subset of two-line PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo2LPart(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-PARTSKU-POST-07',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
    expect(body.total_amount).toBe(47.5);
  });

  test('INV-POST-08 allows split billing across two invoices on same PO', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const first = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-SPLIT-A-POST-08',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 4, unit_price: 4.75 }],
    });
    expect(first.res.status()).toBe(201);
    await expectSchema(request, first.body, 'Invoice');

    const second = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-SPLIT-B-POST-08',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 6, unit_price: 4.75 }],
    });
    expect(second.res.status()).toBe(201);
    await expectSchema(request, second.body, 'Invoice');
  });

  test('INV-POST-09 GET returns same invoice as create', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-GETCHK-POST-09',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    });
    expect(created.res.status()).toBe(201);
    await expectSchema(request, created.body, 'Invoice');

    const res = await request.get(`/invoices/${created.body.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(invoiceSnapshot(body)).toEqual(invoiceSnapshot(created.body));
  });

  test('INV-POST-10 successful create matches OpenAPI Invoice schema', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo2LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-SCHEMA-POST-10',
      line_items: invoiceExampleTwoLine,
    });
    expect(res.status()).toBe(201);
    await expectSchema(request, body, 'Invoice');
  });

  test('INV-POST-N01 rejects invoice on draft PO with workflow_gate', { tag: '@api' }, async ({ request }) => {
    const poId = await createPo(request, po1LCreate);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-DRAFT-N01',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('workflow_gate');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
  });

  test('INV-POST-N02 unknown po_id returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const { res, body } = await postInvoice(request, {
      po_id: 'po-does-not-exist',
      invoice_number: 'INV-UNKPO-N02',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(404);
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('INV-POST-N03 rejects duplicate invoice_number for same vendor', { tag: '@api' }, async ({ request }) => {
    const poId1 = await setupPo1LFull(request);
    const poId2 = await setupPo1LFull(request);

    const first = await postInvoice(request, {
      po_id: poId1,
      invoice_number: 'INV-DUP',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(first.res.status()).toBe(201);

    const second = await postInvoice(request, {
      po_id: poId2,
      invoice_number: 'INV-DUP',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(second.res.status()).toBe(400);
    await expectSchema(request, second.body, 'Error');
    expect(second.body.rule).toBe('duplicate_invoice_detection');
  });

  test('INV-POST-N04 rejects case-variant duplicate invoice_number', { tag: '@api' }, async ({ request }) => {
    const poId1 = await setupPo1LFull(request);
    const poId2 = await setupPo1LFull(request);

    const first = await postInvoice(request, {
      po_id: poId1,
      invoice_number: 'INV-7',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(first.res.status()).toBe(201);

    const second = await postInvoice(request, {
      po_id: poId2,
      invoice_number: 'inv-7',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(second.res.status()).toBe(400);
    await expectSchema(request, second.body, 'Error');
    expect(second.body.rule).toBe('duplicate_invoice_detection');
  });

  test('INV-POST-N05 rejects padded duplicate invoice_number', { tag: '@api' }, async ({ request }) => {
    const poId1 = await setupPo1LFull(request);
    const poId2 = await setupPo1LFull(request);

    const first = await postInvoice(request, {
      po_id: poId1,
      invoice_number: 'INV-7-PAD',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(first.res.status()).toBe(201);

    const second = await postInvoice(request, {
      po_id: poId2,
      invoice_number: ' INV-7-PAD ',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(second.res.status()).toBe(400);
    await expectSchema(request, second.body, 'Error');
    expect(second.body.rule).toBe('duplicate_invoice_detection');
  });

  test('INV-POST-N06 rejects SKU not on PO', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-BADSKU-N06',
      line_items: [{ sku: 'SKU-NOT-ON-PO', quantity: 1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('invoice_line_validation');
  });

  test('INV-POST-N07 rejects duplicate SKU on invoice', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-DUPSKU-N07',
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 },
        { sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 },
      ],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('invoice_line_validation');
  });

  test('INV-POST-N08 rejects quantity one over received on line', { tag: '@e2e' }, async ({ request }) => {
    const poId = await createSubmittedPo(request, po1LCreate);
    await receivePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 4 }]);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-OVERQTY-N08',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('overpayment_protection');
  });

  test('INV-POST-N09 rejects cumulative quantity over received across invoices', { tag: '@e2e' }, async ({
    request,
  }) => {
    const poId = await setupPo1LFull(request);

    const first = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-CUM-A-N09',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 6, unit_price: 4.75 }],
    });
    expect(first.res.status()).toBe(201);

    const second = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-CUM-B-N09',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 6, unit_price: 4.75 }],
    });
    expect(second.res.status()).toBe(400);
    await expectSchema(request, second.body, 'Error');
    expect(second.body.rule).toBe('overpayment_protection');
  });

  test('INV-POST-N10 rejects total value over received with higher unit_price', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-OVERVAL-N10',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.76 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('overpayment_protection');
  });

  test('INV-POST-N11 rejects quantity 0', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-QTY0-N11',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 0, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N12 rejects negative quantity', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-NEGQTY-N12',
      line_items: [{ sku: 'LUM-2X4-8', quantity: -1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N13 rejects quantity 10001', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-QTYMAX-N13',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10001, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N14 rejects negative unit_price', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-NEGPRICE-N14',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: -0.01 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N15 rejects unit_price 100001', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-PRICEMAX-N15',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 100001 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N16 rejects empty line_items array', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-EMPTY-N16',
      line_items: [],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N17 rejects empty body', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/invoices', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N18 rejects missing line_items', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-NOLINES-N18',
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N19 line missing required field returns validation_error', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);
    const cases = [
      { invoice_number: 'INV-NOSKU-N19', line_items: [{ quantity: 1, unit_price: 4.75 }] },
      { invoice_number: 'INV-NOQTY-N19', line_items: [{ sku: 'LUM-2X4-8', unit_price: 4.75 }] },
      { invoice_number: 'INV-NOPRICE-N19', line_items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
    ];

    for (const invoiceBody of cases) {
      const { res, body } = await postInvoice(request, { po_id: poId, ...invoiceBody });
      expect(res.status()).toBe(400);
      await expectSchema(request, body, 'Error');
      expect(body.rule).toBe('validation_error');
    }
  });

  test('INV-POST-N20 empty po_id or invoice_number returns validation_error', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);
    const line = [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }];

    const emptyPo = await postInvoice(request, {
      po_id: '',
      invoice_number: 'INV-EMPTYPo-N20',
      line_items: line,
    });
    expect(emptyPo.res.status()).toBe(400);
    await expectSchema(request, emptyPo.body, 'Error');
    expect(emptyPo.body.rule).toBe('validation_error');

    const emptyNumber = await postInvoice(request, {
      po_id: poId,
      invoice_number: '',
      line_items: line,
    });
    expect(emptyNumber.res.status()).toBe(400);
    await expectSchema(request, emptyNumber.body, 'Error');
    expect(emptyNumber.body.rule).toBe('validation_error');
  });

  test('INV-POST-N21 empty sku returns validation_error', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const { res, body } = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-EMPTYSKU-N21',
      line_items: [{ sku: '', quantity: 1, unit_price: 4.75 }],
    });
    expect(res.status()).toBe(400);
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('INV-POST-N22 string quantity or unit_price returns validation_error', { tag: '@api' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const stringQty = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-STRQTY-N22',
      line_items: [{ sku: 'LUM-2X4-8', quantity: '1', unit_price: 4.75 }],
    });
    expect(stringQty.res.status()).toBe(400);
    await expectSchema(request, stringQty.body, 'Error');
    expect(stringQty.body.rule).toBe('validation_error');

    const stringPrice = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-STRPRICE-N22',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: '4.75' }],
    });
    expect(stringPrice.res.status()).toBe(400);
    await expectSchema(request, stringPrice.body, 'Error');
    expect(stringPrice.body.rule).toBe('validation_error');
  });

  test('INV-POST-N23 malformed body or missing Content-Type returns validation_error', { tag: '@api' }, async ({
    request,
  }) => {
    const notJson = await request.post('/invoices', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not valid json',
    });
    expect(notJson.status()).toBe(400);
    const notJsonBody = await notJson.json();
    await expectSchema(request, notJsonBody, 'Error');
    expect(notJsonBody.rule).toBe('validation_error');

    const poId = await setupPo1LFull(request);
    const payload = JSON.stringify({
      po_id: poId,
      invoice_number: 'INV-NOCT-N23',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });

    const noContentType = await request.post('/invoices', {
      headers: {},
      data: payload,
    });
    expect(noContentType.status()).toBe(400);
    const noCtBody = await noContentType.json();
    await expectSchema(request, noCtBody, 'Error');
    expect(noCtBody.rule).toBe('validation_error');
  });

  test('INV-POST-E01 unknown route POST /invoices/not-a-route returns 404', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/invoices/not-a-route', {
      data: {
        po_id: 'po-001',
        invoice_number: 'INV-ROUTE-E01',
        line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
      },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('GET /invoices/{invoiceId}', () => {
  test('INV-GET-01 GET matches created invoice', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-GET-01',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    });
    expect(created.res.status()).toBe(201);

    const res = await request.get(`/invoices/${created.body.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(invoiceSnapshot(body)).toEqual(invoiceSnapshot(created.body));
  });

  test('INV-GET-02 GET body matches OpenAPI Invoice after two-line create', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo2LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-GET-02',
      line_items: invoiceExampleTwoLine,
    });
    expect(created.res.status()).toBe(201);

    const res = await request.get(`/invoices/${created.body.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
  });

  test('INV-GET-03 GET fresh invoice shows pre-match fields', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-GET-03',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    });
    expect(created.res.status()).toBe(201);

    const res = await request.get(`/invoices/${created.body.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(body.status).toBe('received');
    expect(body.matched).toBe(false);
    expect(body.partial_receipt).toBeNull();
  });

  test('INV-GET-04 GET after match shows matched status and partial_receipt flag', { tag: '@e2e' }, async ({
    request,
  }) => {
    const poId = await setupPo2LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-GET-04',
      line_items: invoiceExampleTwoLine,
    });
    expect(created.res.status()).toBe(201);

    const matched = await request.post(`/invoices/${created.body.id}/match`);
    expect(matched.status()).toBe(200);
    const matchBody = await matched.json();
    await expectSchema(request, matchBody, 'MatchResult');

    const res = await request.get(`/invoices/${created.body.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(body.status).toBe('matched');
    expect(body.matched).toBe(true);
    expect(typeof body.partial_receipt).toBe('boolean');
    expect(body.partial_receipt).toBe(matchBody.partial_receipt);
  });

  test('INV-GET-E01 GET unknown invoiceId returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/invoices/inv-does-not-exist');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('INV-GET-E02 unknown path GET /invoices/inv-001/extra returns 404', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/invoices/inv-001/extra');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('POST /invoices/{invoiceId}/match', () => {
  test('INV-MAT-01 full receipt 3-way match passes', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo2LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAT-01',
      line_items: invoiceExampleTwoLine,
    });
    expect(created.res.status()).toBe(201);

    const res = await request.post(`/invoices/${created.body.id}/match`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'MatchResult');
    expect(body.status).toBe('matched');
    expect(body.matched).toBe(true);
    expect(body.partial_receipt).toBe(false);
    expect(body.ordered_value).toBe(95.1);
    expect(body.received_value).toBe(95.1);
    expect(body.invoice_total).toBe(95.1);
    expect(body.message).toBe('3-way match passed.');
  });

  test('INV-MAT-02 partial PO receipt sets partial_receipt true', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo2LPart(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAT-02',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    });
    expect(created.res.status()).toBe(201);

    const res = await request.post(`/invoices/${created.body.id}/match`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'MatchResult');
    expect(body.partial_receipt).toBe(true);
    expect(typeof body.message).toBe('string');
    expect((body.message as string).length).toBeGreaterThan(0);
    expect((body.message as string).toLowerCase()).toContain('partial');
  });

  test('INV-MAT-03 match response matches OpenAPI MatchResult schema', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo2LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAT-03',
      line_items: invoiceExampleTwoLine,
    });
    expect(created.res.status()).toBe(201);

    const res = await request.post(`/invoices/${created.body.id}/match`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'MatchResult');
  });

  test('INV-MAT-04 GET after match reflects matched invoice', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo2LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAT-04',
      line_items: invoiceExampleTwoLine,
    });
    expect(created.res.status()).toBe(201);

    const matched = await request.post(`/invoices/${created.body.id}/match`);
    expect(matched.status()).toBe(200);
    const matchBody = await matched.json();
    await expectSchema(request, matchBody, 'MatchResult');

    const res = await request.get(`/invoices/${created.body.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(body.status).toBe('matched');
    expect(body.matched).toBe(true);
    expect(body.partial_receipt).toBe(false);
    expect(body.total_amount).toBe(matchBody.invoice_total);
  });

  test('INV-MAT-05 partial invoice on fully received PO keeps partial_receipt false', { tag: '@e2e' }, async ({
    request,
  }) => {
    const poId = await setupPo1LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAT-05',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 4, unit_price: 4.75 }],
    });
    expect(created.res.status()).toBe(201);

    const res = await request.post(`/invoices/${created.body.id}/match`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'MatchResult');
    expect(body.partial_receipt).toBe(false);
  });

  test('INV-MAT-N01 match after approve returns workflow_gate', { tag: '@e2e' }, async ({ request }) => {
    const poId = await setupPo1LFull(request);

    const created = await postInvoice(request, {
      po_id: poId,
      invoice_number: 'INV-MAT-N01',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    });
    expect(created.res.status()).toBe(201);

    const matched = await request.post(`/invoices/${created.body.id}/match`);
    expect(matched.status()).toBe(200);

    const approved = await request.post(`/invoices/${created.body.id}/approve`);
    expect(approved.status()).toBe(200);

    const res = await request.post(`/invoices/${created.body.id}/match`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('workflow_gate');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
  });

  test('INV-MAT-E01 match on unknown invoiceId returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/invoices/inv-does-not-exist/match');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('INV-MAT-E02 unknown path POST /invoices/inv-001/match/extra returns 404', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/invoices/inv-001/match/extra');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});
