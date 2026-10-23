import { expect, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './schema.js';

export const ACTIVE_VENDOR = 'vnd-001';

export const po1LCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
};

export const po2LCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
};

export const poMaxCreate = {
  vendor_id: ACTIVE_VENDOR,
  line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 4.75 }],
};

export const invoiceExampleTwoLine = [
  { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
  { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
];

export async function createPo(request: APIRequestContext, createBody: object): Promise<string> {
  const res = await request.post('/purchase-orders', { data: createBody });
  expect(res.status()).toBe(201);
  const body = await res.json();
  await expectSchema(request, body, 'PurchaseOrder');
  return body.id as string;
}

export async function submitPo(request: APIRequestContext, poId: string): Promise<void> {
  const res = await request.post(`/purchase-orders/${poId}/submit`);
  expect(res.status()).toBe(200);
}

export async function createSubmittedPo(request: APIRequestContext, createBody: object): Promise<string> {
  const id = await createPo(request, createBody);
  await submitPo(request, id);
  return id;
}

export async function receivePo(
  request: APIRequestContext,
  poId: string,
  items: Array<{ sku: string; quantity: number }>,
): Promise<Record<string, unknown>> {
  const res = await request.post(`/purchase-orders/${poId}/receive`, { data: { items } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  await expectSchema(request, body, 'PurchaseOrder');
  return body;
}

export async function setupPo1LFull(request: APIRequestContext): Promise<string> {
  const poId = await createSubmittedPo(request, po1LCreate);
  await receivePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10 }]);
  return poId;
}

export async function setupPo2LFull(request: APIRequestContext): Promise<string> {
  const poId = await createSubmittedPo(request, po2LCreate);
  await receivePo(request, poId, [
    { sku: 'LUM-2X4-8', quantity: 10 },
    { sku: 'CEM-30KG', quantity: 4 },
  ]);
  return poId;
}

export async function setupPo2LPart(request: APIRequestContext): Promise<string> {
  const poId = await createSubmittedPo(request, po2LCreate);
  await receivePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10 }]);
  return poId;
}

export async function setupPoMaxFull(request: APIRequestContext): Promise<string> {
  const poId = await createSubmittedPo(request, poMaxCreate);
  await receivePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10000 }]);
  return poId;
}

export function invoiceSnapshot(body: Record<string, unknown>) {
  return {
    id: body.id,
    po_id: body.po_id,
    vendor_id: body.vendor_id,
    invoice_number: body.invoice_number,
    status: body.status,
    line_items: body.line_items,
    total_amount: body.total_amount,
    matched: body.matched,
    partial_receipt: body.partial_receipt,
  };
}
