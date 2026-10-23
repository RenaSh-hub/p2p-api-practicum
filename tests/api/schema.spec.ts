import { expect, test } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

test('GET /skus matches Sku', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/skus');
  expect(response.status()).toBe(200);

  const body: unknown = await response.json();
  expect(Array.isArray(body)).toBe(true);
  if (!Array.isArray(body)) {
    return;
  }

  expect(body.length).toBe(5);
  for (const sku of body) {
    await expectSchema(request, sku, 'Sku');
  }
});

test('GET /vendors matches Vendor', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);

  const body: unknown = await response.json();
  expect(Array.isArray(body)).toBe(true);
  if (!Array.isArray(body)) {
    return;
  }

  expect(body.length).toBeGreaterThan(0);
  for (const vendor of body) {
    await expectSchema(request, vendor, 'Vendor');
  }
});

test('a vendor without active fails Vendor', { tag: '@api' }, async ({ request }) => {
  await expect(
    expectSchema(request, { id: 'vnd-001', name: 'Maple Ridge Supply' }, 'Vendor'),
  ).rejects.toThrow();
});

test('an unknown schema name fails', { tag: '@api' }, async ({ request }) => {
  await expect(expectSchema(request, {}, 'NoSuchSchema')).rejects.toThrow();
});
