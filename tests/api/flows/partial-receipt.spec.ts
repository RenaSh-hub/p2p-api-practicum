import { expect, test } from '@playwright/test';
import { expectSchema } from '../helpers/schema.js';

const lumber = { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 };
const cement = { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 };
const cementReceived = 2;
const orderedTotal = 95.1;
const receivedTotal = 71.3;

test.describe('partial receipt flow', () => {
  test.describe.configure({ mode: 'serial' });

  const runId = Date.now();
  let vendorId = '';
  let poId = '';
  let invoiceId = '';
  let invoiceTotal = 0;
  let orderedValue = 0;
  let receivedValue = 0;

  test('creates a vendor for this flow', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: `Partial receipt ${runId}` } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Vendor');
    expect(body.name).toBe(`Partial receipt ${runId}`);
    expect(body.active).toBe(true);
    expect(body.id).toMatch(/^vnd-/);
    vendorId = body.id;
  });

  test('creates a purchase order with two lines', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post('/purchase-orders', {
      data: { vendor_id: vendorId, line_items: [lumber, cement] },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.vendor_id).toBe(vendorId);
    expect(body.status).toBe('draft');
    expect(body.id).toMatch(/^po-/);
    expect(body.ordered_value).toBe(orderedTotal);
    expect(body.received_value).toBe(0);
    expect(body.fully_received).toBe(false);
    expect(body.line_items[0]).toMatchObject({ sku: lumber.sku, quantity: lumber.quantity });
    expect(body.line_items[1]).toMatchObject({ sku: cement.sku, quantity: cement.quantity });
    poId = body.id;
  });

  test('submits the purchase order', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/purchase-orders/${poId}/submit`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.id).toBe(poId);
    expect(body.status).toBe('submitted');
    expect(body.fully_received).toBe(false);
  });

  test('receives the first line in full and part of the second', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: {
        items: [
          { sku: lumber.sku, quantity: lumber.quantity },
          { sku: cement.sku, quantity: cementReceived },
        ],
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.id).toBe(poId);
    expect(body.status).toBe('submitted');
    expect(body.fully_received).toBe(false);
    expect(body.ordered_value).toBe(orderedTotal);
    expect(body.received_value).toBe(receivedTotal);
    expect(body.line_items[0]).toMatchObject({
      sku: lumber.sku,
      quantity: lumber.quantity,
      received_quantity: lumber.quantity,
    });
    expect(body.line_items[1]).toMatchObject({
      sku: cement.sku,
      quantity: cement.quantity,
      received_quantity: cementReceived,
    });
    orderedValue = body.ordered_value;
    receivedValue = body.received_value;
  });

  test('invoices only what was received', { tag: '@e2e' }, async ({ request }) => {
    const invoiceNumber = `INV-PART-${runId}`;
    const res = await request.post('/invoices', {
      data: {
        po_id: poId,
        invoice_number: invoiceNumber,
        line_items: [
          { sku: lumber.sku, quantity: lumber.quantity, unit_price: lumber.unit_price },
          { sku: cement.sku, quantity: cementReceived, unit_price: cement.unit_price },
        ],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(body.po_id).toBe(poId);
    expect(body.vendor_id).toBe(vendorId);
    expect(body.status).toBe('received');
    expect(body.matched).toBe(false);
    expect(body.partial_receipt).toBeNull();
    expect(body.total_amount).toBe(receivedValue);
    expect(body.line_items).toEqual([
      { sku: lumber.sku, quantity: lumber.quantity, unit_price: lumber.unit_price },
      { sku: cement.sku, quantity: cementReceived, unit_price: cement.unit_price },
    ]);
    invoiceId = body.id;
    invoiceTotal = body.total_amount;
  });

  test('matches with partial_receipt true', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/invoices/${invoiceId}/match`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'MatchResult');
    expect(body.invoice_id).toBe(invoiceId);
    expect(body.po_id).toBe(poId);
    expect(body.status).toBe('matched');
    expect(body.matched).toBe(true);
    expect(body.partial_receipt).toBe(true);
    expect(body.ordered_value).toBe(orderedValue);
    expect(body.received_value).toBe(receivedValue);
    expect(body.invoice_total).toBe(invoiceTotal);
    expect(typeof body.message).toBe('string');
    expect((body.message as string).length).toBeGreaterThan(0);
  });

  test('approves the matched invoice', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/invoices/${invoiceId}/approve`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'ApproveResult');
    expect(body.invoice_id).toBe(invoiceId);
    expect(body.status).toBe('approved');
    expect(body.vendor_exposure).toBe(receivedValue);

    const gl = body.gl_entry as Record<string, unknown>;
    expect(gl.balanced).toBe(true);
    expect(gl.debits).toEqual([{ account: '5000 Materials Expense', amount: invoiceTotal }]);
    expect(gl.credits).toEqual([{ account: '2000 Accounts Payable', amount: invoiceTotal }]);
  });

  test('exposure equals the received value, not the ordered value', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.get(`/vendors/${vendorId}/exposure`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'VendorExposure');
    expect(body.vendor_id).toBe(vendorId);
    expect(orderedValue).toBe(orderedTotal);
    expect(receivedValue).toBe(receivedTotal);
    expect(receivedValue).not.toBe(orderedValue);
    expect(body.open_ap_liability).toBe(receivedValue);
    expect(body.open_ap_liability).not.toBe(orderedValue);
    expect(body.approved_invoices).toEqual([invoiceId]);
  });
});
