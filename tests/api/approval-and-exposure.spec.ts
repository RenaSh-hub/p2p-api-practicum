import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';
import {
  ACTIVE_VENDOR,
  createSubmittedPo,
  invoiceExampleTwoLine,
  receivePo,
  setupPo1LFull,
  setupPo2LFull,
} from './helpers/po.js';

async function postInvoice(
  request: APIRequestContext,
  body: object,
): Promise<{ res: Awaited<ReturnType<APIRequestContext['post']>>; body: Record<string, unknown> }> {
  const res = await request.post('/invoices', { data: body });
  const parsed = await res.json();
  return { res, body: parsed };
}

async function matchInvoice(request: APIRequestContext, invoiceId: string): Promise<Record<string, unknown>> {
  const res = await request.post(`/invoices/${invoiceId}/match`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  await expectSchema(request, body, 'MatchResult');
  return body;
}

async function setupInvMatched2L(request: APIRequestContext, invoiceNumber: string): Promise<string> {
  const poId = await setupPo2LFull(request);
  const created = await postInvoice(request, {
    po_id: poId,
    invoice_number: invoiceNumber,
    line_items: invoiceExampleTwoLine,
  });
  expect(created.res.status()).toBe(201);
  await matchInvoice(request, created.body.id as string);
  return created.body.id as string;
}

async function setupInvMatched1L(request: APIRequestContext, invoiceNumber: string): Promise<string> {
  const poId = await setupPo1LFull(request);
  const created = await postInvoice(request, {
    po_id: poId,
    invoice_number: invoiceNumber,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  expect(created.res.status()).toBe(201);
  await matchInvoice(request, created.body.id as string);
  return created.body.id as string;
}

async function setupInvReceived(request: APIRequestContext, invoiceNumber: string): Promise<string> {
  const poId = await setupPo1LFull(request);
  const created = await postInvoice(request, {
    po_id: poId,
    invoice_number: invoiceNumber,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  expect(created.res.status()).toBe(201);
  return created.body.id as string;
}

async function setupInvMatchedZero(request: APIRequestContext, invoiceNumber: string): Promise<string> {
  const poId = await setupPo1LFull(request);
  const created = await postInvoice(request, {
    po_id: poId,
    invoice_number: invoiceNumber,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 0 }],
  });
  expect(created.res.status()).toBe(201);
  await matchInvoice(request, created.body.id as string);
  return created.body.id as string;
}

async function setupTwoMatchedSameVendor(
  request: APIRequestContext,
  suffix: string,
): Promise<{ firstId: string; secondId: string; firstTotal: number; secondTotal: number }> {
  const poId1 = await setupPo1LFull(request);
  const first = await postInvoice(request, {
    po_id: poId1,
    invoice_number: `INV-TWO-A-${suffix}`,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  expect(first.res.status()).toBe(201);
  await matchInvoice(request, first.body.id as string);

  const poId2 = await createSubmittedPo(request, {
    vendor_id: ACTIVE_VENDOR,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await receivePo(request, poId2, [{ sku: 'LUM-2X4-8', quantity: 1 }]);
  const second = await postInvoice(request, {
    po_id: poId2,
    invoice_number: `INV-TWO-B-${suffix}`,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  expect(second.res.status()).toBe(201);
  await matchInvoice(request, second.body.id as string);

  return {
    firstId: first.body.id as string,
    secondId: second.body.id as string,
    firstTotal: 47.5,
    secondTotal: 4.75,
  };
}

async function getVendorExposure(
  request: APIRequestContext,
  vendorId: string = ACTIVE_VENDOR,
): Promise<Record<string, unknown>> {
  const res = await request.get(`/vendors/${vendorId}/exposure`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  await expectSchema(request, body, 'VendorExposure');
  return body;
}

test('EXP-01 seed vendor exposure is zero with no approved invoices', { tag: '@api' }, async ({ request }) => {
  const body = await getVendorExposure(request);
  expect(body.vendor_id).toBe(ACTIVE_VENDOR);
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test.describe('POST /invoices/{invoiceId}/approve', () => {
  test('APV-01 matched two-line invoice approves with balanced GL and exposure', { tag: '@e2e' }, async ({
    request,
  }) => {
    const before = await getVendorExposure(request);
    const invoiceId = await setupInvMatched2L(request, `INV-APV-01-${Date.now()}`);

    const res = await request.post(`/invoices/${invoiceId}/approve`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'ApproveResult');

    expect(body.invoice_id).toBe(invoiceId);
    expect(body.status).toBe('approved');
    expect(body.vendor_exposure).toBe((before.open_ap_liability as number) + 95.1);

    const gl = body.gl_entry as Record<string, unknown>;
    expect(gl.balanced).toBe(true);
    expect(gl.debits).toEqual([{ account: '5000 Materials Expense', amount: 95.1 }]);
    expect(gl.credits).toEqual([{ account: '2000 Accounts Payable', amount: 95.1 }]);
  });

  test('APV-02 approve response matches OpenAPI ApproveResult schema', { tag: '@e2e' }, async ({ request }) => {
    const invoiceId = await setupInvMatched2L(request, `INV-APV-02-${Date.now()}`);

    const res = await request.post(`/invoices/${invoiceId}/approve`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'ApproveResult');
  });

  test('APV-03 GET invoice after approve shows approved matched status', { tag: '@e2e' }, async ({ request }) => {
    const invoiceId = await setupInvMatched2L(request, `INV-APV-03-${Date.now()}`);

    const approved = await request.post(`/invoices/${invoiceId}/approve`);
    expect(approved.status()).toBe(200);
    await expectSchema(request, await approved.json(), 'ApproveResult');

    const res = await request.get(`/invoices/${invoiceId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'Invoice');
    expect(body.status).toBe('approved');
    expect(body.matched).toBe(true);
  });

  test('APV-04 vendor exposure after approve matches approve vendor_exposure', { tag: '@e2e' }, async ({ request }) => {
    const before = await getVendorExposure(request);
    const invoiceId = await setupInvMatched2L(request, `INV-APV-04-${Date.now()}`);

    const approved = await request.post(`/invoices/${invoiceId}/approve`);
    expect(approved.status()).toBe(200);
    const approveBody = await approved.json();
    await expectSchema(request, approveBody, 'ApproveResult');

    const body = await getVendorExposure(request);
    expect(body.open_ap_liability).toBe((before.open_ap_liability as number) + 95.1);
    expect(body.approved_invoices).toContain(invoiceId);
    expect(approveBody.vendor_exposure).toBe(body.open_ap_liability);
  });

  test('APV-05 zero-dollar matched invoice approves with zero GL and exposure', { tag: '@e2e' }, async ({
    request,
  }) => {
    const before = await getVendorExposure(request);
    const invoiceId = await setupInvMatchedZero(request, `INV-APV-05-${Date.now()}`);

    const res = await request.post(`/invoices/${invoiceId}/approve`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'ApproveResult');

    const gl = body.gl_entry as Record<string, unknown>;
    expect(gl.balanced).toBe(true);
    expect(gl.debits).toEqual([{ account: '5000 Materials Expense', amount: 0 }]);
    expect(gl.credits).toEqual([{ account: '2000 Accounts Payable', amount: 0 }]);
    expect(body.vendor_exposure).toBe(before.open_ap_liability);
  });

  test('APV-06 vendor_exposure reflects only the approved invoice when two matched', { tag: '@e2e' }, async ({
    request,
  }) => {
    const before = await getVendorExposure(request);
    const suffix = String(Date.now());
    const { firstId, firstTotal, secondTotal } = await setupTwoMatchedSameVendor(request, suffix);

    const res = await request.post(`/invoices/${firstId}/approve`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'ApproveResult');
    expect(body.vendor_exposure).toBe((before.open_ap_liability as number) + firstTotal);
    expect(body.vendor_exposure).not.toBe((before.open_ap_liability as number) + firstTotal + secondTotal);
  });

  test('APV-N01 approve before match returns three_way_match_gate', { tag: '@e2e' }, async ({ request }) => {
    const invoiceId = await setupInvReceived(request, `INV-APV-N01-${Date.now()}`);

    const res = await request.post(`/invoices/${invoiceId}/approve`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('three_way_match_gate');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
  });

  test('APV-N02 second approve on same invoice returns duplicate_approval', { tag: '@e2e' }, async ({ request }) => {
    const invoiceId = await setupInvMatched1L(request, `INV-APV-N02-${Date.now()}`);

    const first = await request.post(`/invoices/${invoiceId}/approve`);
    expect(first.status()).toBe(200);
    await expectSchema(request, await first.json(), 'ApproveResult');

    const second = await request.post(`/invoices/${invoiceId}/approve`);
    expect(second.status()).toBe(400);
    const body = await second.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('duplicate_approval');
  });

  test('APV-N03 approve unknown invoiceId returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/invoices/inv-does-not-exist/approve');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('APV-E01 unknown path POST /invoices/inv-001/approve/extra returns 404', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/invoices/inv-001/approve/extra');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('GET /vendors/{vendorId}/exposure', () => {
  test('EXP-02 exposure after single approval shows liability and invoice id', { tag: '@e2e' }, async ({ request }) => {
    const before = await getVendorExposure(request);
    const invoiceId = await setupInvMatched2L(request, `INV-EXP-02-${Date.now()}`);

    const approved = await request.post(`/invoices/${invoiceId}/approve`);
    expect(approved.status()).toBe(200);
    await expectSchema(request, await approved.json(), 'ApproveResult');

    const body = await getVendorExposure(request);
    expect(body.open_ap_liability).toBe((before.open_ap_liability as number) + 95.1);
    expect(body.approved_invoices).toHaveLength((before.approved_invoices as string[]).length + 1);
    expect(body.approved_invoices).toContain(invoiceId);
  });

  test('EXP-03 exposure sums both approved invoices on same vendor', { tag: '@e2e' }, async ({ request }) => {
    const before = await getVendorExposure(request);
    const suffix = String(Date.now());
    const { firstId, secondId, firstTotal, secondTotal } = await setupTwoMatchedSameVendor(request, suffix);

    const approveFirst = await request.post(`/invoices/${firstId}/approve`);
    expect(approveFirst.status()).toBe(200);
    await expectSchema(request, await approveFirst.json(), 'ApproveResult');

    const approveSecond = await request.post(`/invoices/${secondId}/approve`);
    expect(approveSecond.status()).toBe(200);
    await expectSchema(request, await approveSecond.json(), 'ApproveResult');

    const body = await getVendorExposure(request);
    expect(body.open_ap_liability).toBe((before.open_ap_liability as number) + firstTotal + secondTotal);
    expect(body.approved_invoices).toHaveLength((before.approved_invoices as string[]).length + 2);
    expect(body.approved_invoices).toContain(firstId);
    expect(body.approved_invoices).toContain(secondId);
  });

  test('EXP-04 exposure response matches OpenAPI VendorExposure schema', { tag: '@api' }, async ({ request }) => {
    const res = await request.get(`/vendors/${ACTIVE_VENDOR}/exposure`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'VendorExposure');
  });

  test('EXP-05 matched but unapproved invoice excluded from exposure', { tag: '@e2e' }, async ({ request }) => {
    const before = await getVendorExposure(request);
    await setupInvMatched1L(request, `INV-EXP-05-${Date.now()}`);

    const body = await getVendorExposure(request);
    expect(body.open_ap_liability).toBe(before.open_ap_liability);
    expect(body.approved_invoices).toEqual(before.approved_invoices);
  });

  test('EXP-06 received unmatched invoice excluded from exposure', { tag: '@e2e' }, async ({ request }) => {
    const before = await getVendorExposure(request);
    await setupInvReceived(request, `INV-EXP-06-${Date.now()}`);

    const body = await getVendorExposure(request);
    expect(body.open_ap_liability).toBe(before.open_ap_liability);
    expect(body.approved_invoices).toEqual(before.approved_invoices);
  });

  test('EXP-07 new vendor exposure is zero while another vendor has approvals', { tag: '@e2e' }, async ({ request }) => {
    const invoiceId = await setupInvMatched1L(request, `INV-EXP-07-${Date.now()}`);

    const approved = await request.post(`/invoices/${invoiceId}/approve`);
    expect(approved.status()).toBe(200);
    await expectSchema(request, await approved.json(), 'ApproveResult');

    const vendorRes = await request.post('/vendors', { data: { name: `QA EXP-07 ${Date.now()}` } });
    expect(vendorRes.status()).toBe(201);
    const vendorBody = await vendorRes.json();
    await expectSchema(request, vendorBody, 'Vendor');
    const newVendorId = vendorBody.id as string;

    const res = await request.get(`/vendors/${newVendorId}/exposure`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'VendorExposure');
    expect(body.open_ap_liability).toBe(0);
    expect(body.approved_invoices).toEqual([]);
  });

  test('EXP-08 inactive seed vendor vnd-002 exposure is zero', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/vendors/vnd-002/exposure');
    expect(res.status()).toBe(200);
    const body = await res.json();
    await expectSchema(request, body, 'VendorExposure');
    expect(body.vendor_id).toBe('vnd-002');
    expect(body.open_ap_liability).toBe(0);
    expect(body.approved_invoices).toEqual([]);
  });

  test('EXP-N01 exposure for unknown vendor returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/vendors/vnd-does-not-exist/exposure');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });

  test('EXP-E01 unknown path GET /vendors/vnd-001/exposure/extra returns 404', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/vendors/vnd-001/exposure/extra');
    expect(res.status()).toBe(404);
    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect((body.detail as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});
