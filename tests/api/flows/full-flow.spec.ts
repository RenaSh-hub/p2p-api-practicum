import { expect, test } from '@playwright/test';
import { expectSchema } from '../helpers/schema.js';

const lumber = { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 };
const cement = { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 };
const orderedTotal = 95.1;

test.describe('full purchase-to-pay flow', () => {
  test.describe.configure({ mode: 'serial' });

  const runId = Date.now();
  let vendorId = '';
  let poId = '';
  let invoiceId = '';
  let invoiceTotal = 0;

  test('creates a vendor for this flow', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: `Full flow ${runId}` } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Vendor');
    expect(body.name).toBe(`Full flow ${runId}`);
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
    expect(body.line_items).toHaveLength(2);
    expect(body.line_items[0]).toMatchObject({ ...lumber, received_quantity: 0 });
    expect(body.line_items[1]).toMatchObject({
      sku: cement.sku,
      description: '',
      quantity: cement.quantity,
      unit_price: cement.unit_price,
      received_quantity: 0,
    });
    poId = body.id;
  });

  test('submits the purchase order', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/purchase-orders/${poId}/submit`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.id).toBe(poId);
    expect(body.vendor_id).toBe(vendorId);
    expect(body.status).toBe('submitted');
    expect(body.fully_received).toBe(false);
    expect(body.ordered_value).toBe(orderedTotal);
  });

  test('receives everything ordered', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/purchase-orders/${poId}/receive`, {
      data: {
        items: [
          { sku: lumber.sku, quantity: lumber.quantity },
          { sku: cement.sku, quantity: cement.quantity },
        ],
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'PurchaseOrder');
    expect(body.id).toBe(poId);
    expect(body.status).toBe('closed');
    expect(body.fully_received).toBe(true);
    expect(body.ordered_value).toBe(orderedTotal);
    expect(body.received_value).toBe(orderedTotal);
    expect(body.line_items[0]).toMatchObject({ sku: lumber.sku, received_quantity: lumber.quantity });
    expect(body.line_items[1]).toMatchObject({ sku: cement.sku, received_quantity: cement.quantity });
  });

  test('invoices everything received', { tag: '@e2e' }, async ({ request }) => {
    const invoiceNumber = `INV-FULL-${runId}`;
    const res = await request.post('/invoices', {
      data: {
        po_id: poId,
        invoice_number: invoiceNumber,
        line_items: [
          { sku: lumber.sku, quantity: lumber.quantity, unit_price: lumber.unit_price },
          { sku: cement.sku, quantity: cement.quantity, unit_price: cement.unit_price },
        ],
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(body.po_id).toBe(poId);
    expect(body.vendor_id).toBe(vendorId);
    expect(body.invoice_number).toBe(invoiceNumber);
    expect(body.status).toBe('received');
    expect(body.matched).toBe(false);
    expect(body.partial_receipt).toBeNull();
    expect(body.id).toMatch(/^inv-/);
    expect(body.total_amount).toBe(orderedTotal);
    expect(body.line_items).toHaveLength(2);
    invoiceId = body.id;
    invoiceTotal = body.total_amount;
  });

  test('matches with partial_receipt false', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/invoices/${invoiceId}/match`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'MatchResult');
    expect(body.invoice_id).toBe(invoiceId);
    expect(body.po_id).toBe(poId);
    expect(body.status).toBe('matched');
    expect(body.matched).toBe(true);
    expect(body.partial_receipt).toBe(false);
    expect(body.ordered_value).toBe(orderedTotal);
    expect(body.received_value).toBe(orderedTotal);
    expect(body.invoice_total).toBe(invoiceTotal);
    expect(body.message).toBe('3-way match passed.');
  });

  test('approves a balanced ledger entry equal to the invoice total', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.post(`/invoices/${invoiceId}/approve`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'ApproveResult');
    expect(body.invoice_id).toBe(invoiceId);
    expect(body.status).toBe('approved');
    expect(body.vendor_exposure).toBe(invoiceTotal);

    const gl = body.gl_entry as Record<string, unknown>;
    expect(gl.balanced).toBe(true);
    expect(gl.debits).toEqual([{ account: '5000 Materials Expense', amount: invoiceTotal }]);
    expect(gl.credits).toEqual([{ account: '2000 Accounts Payable', amount: invoiceTotal }]);
  });

  test('exposure equals the invoice total and lists the invoice', { tag: '@e2e' }, async ({ request }) => {
    const res = await request.get(`/vendors/${vendorId}/exposure`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    await expectSchema(request, body, 'VendorExposure');
    expect(body.vendor_id).toBe(vendorId);
    expect(body.open_ap_liability).toBe(invoiceTotal);
    expect(body.approved_invoices).toEqual([invoiceId]);
  });
});
