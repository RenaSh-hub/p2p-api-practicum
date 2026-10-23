import { expect, test } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

function uniqueName(base: string): string {
  return `${base} ${Date.now()}`;
}

test.describe('GET /vendors', () => {
  test('VND-GET-01 lists seed vendors Maple Ridge Supply and Old Quarry Materials', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.get('/vendors');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const vendors = body as Array<Record<string, unknown>>;
    expect(vendors.length).toBeGreaterThanOrEqual(2);

    for (const vendor of vendors) {
      await expectSchema(request, vendor, 'Vendor');
    }

    const maple = vendors.find((vendor) => vendor.id === 'vnd-001');
    expect(maple).toBeDefined();
    expect(maple?.name).toBe('Maple Ridge Supply');
    expect(maple?.active).toBe(true);

    const quarry = vendors.find((vendor) => vendor.id === 'vnd-002');
    expect(quarry).toBeDefined();
    expect(quarry?.name).toBe('Old Quarry Materials');
    expect(quarry?.active).toBe(false);
  });

  test('VND-GET-02 every listed vendor matches OpenAPI schema Vendor', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/vendors');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const vendors = body as unknown[];
    expect(vendors.length).toBeGreaterThan(0);

    for (const vendor of vendors) {
      await expectSchema(request, vendor, 'Vendor');
    }
  });

  test('VND-GET-03 created vendor appears in GET /vendors with a vnd- id', { tag: '@e2e' }, async ({ request }) => {
    const name = uniqueName('List After Create');
    const created = await request.post('/vendors', { data: { name } });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    await expectSchema(request, createdBody, 'Vendor');

    const res = await request.get('/vendors');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const vendors = body as Array<Record<string, unknown>>;
    for (const vendor of vendors) {
      await expectSchema(request, vendor, 'Vendor');
    }

    const found = vendors.find((vendor) => vendor.name === name);
    expect(found).toBeDefined();
    expect(String(found?.id)).toMatch(/^vnd-/);
  });

  test('VND-GET-E01 unknown path GET /vendors/not-a-route returns 404 without rule', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.get('/vendors/not-a-route');
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('POST /vendors', () => {
  test('VND-POST-01 creates a vendor with default active true', { tag: '@api' }, async ({ request }) => {
    const name = uniqueName('Cedar Point Hardware');
    const res = await request.post('/vendors', { data: { name } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Vendor');
    expect(body.name).toBe(name);
    expect(body.active).toBe(true);
    expect(body.id).toMatch(/^vnd-/);
  });

  test('VND-POST-02 creates a vendor with active false', { tag: '@api' }, async ({ request }) => {
    const name = uniqueName('Inactive Quarry Yard');
    const res = await request.post('/vendors', { data: { name, active: false } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Vendor');
    expect(body.name).toBe(name);
    expect(body.active).toBe(false);
    expect(body.id).toMatch(/^vnd-/);
  });

  test('VND-POST-03 creates a vendor with explicit active true', { tag: '@api' }, async ({ request }) => {
    const name = uniqueName('Explicit Active Mill');
    const res = await request.post('/vendors', { data: { name, active: true } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Vendor');
    expect(body.name).toBe(name);
    expect(body.active).toBe(true);
    expect(body.id).toMatch(/^vnd-/);
  });

  test('VND-POST-04 created vendor appears in GET /vendors with the same id and name', { tag: '@e2e' }, async ({
    request,
  }) => {
    const name = uniqueName('Create Then List');
    const created = await request.post('/vendors', { data: { name } });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    await expectSchema(request, createdBody, 'Vendor');
    expect(createdBody.name).toBe(name);
    expect(createdBody.id).toMatch(/^vnd-/);

    const res = await request.get('/vendors');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const vendors = body as Array<Record<string, unknown>>;
    for (const vendor of vendors) {
      await expectSchema(request, vendor, 'Vendor');
    }

    const found = vendors.find((vendor) => vendor.id === createdBody.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(createdBody.id);
    expect(found?.name).toBe(name);
  });

  test('VND-POST-05 accepts a single-character name', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: 'A' } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    await expectSchema(request, body, 'Vendor');
    expect(body.name).toBe('A');
    expect(body.id).toMatch(/^vnd-/);
    expect(body.active).toBe(true);
  });

  test('VND-POST-N01 rejects an empty body', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: {} });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  });

  test('VND-POST-N02 rejects an empty name', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: '' } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('VND-POST-N03 rejects a non-string name', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: 12345 } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('VND-POST-N04 rejects a non-boolean active', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: 'Valid Name', active: 'yes' } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('VND-POST-N05 rejects a null name', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', { data: { name: null } });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('VND-POST-N06 rejects a body that is not JSON', { tag: '@api' }, async ({ request }) => {
    const res = await request.post('/vendors', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not valid json',
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(body.rule).toBe('validation_error');
  });

  test('VND-POST-E01 unknown path POST /vendors/extra returns 404 without rule', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.post('/vendors/extra', { data: { name: uniqueName('Unknown Route') } });
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});

test.describe('GET /skus', () => {
  const seedSkus = [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', unit_price: 4.75 },
    { sku: 'PLY-12-4X8', description: 'Plywood sheet, 1/2 in, 4x8 ft', unit_price: 22.4 },
    { sku: 'CEM-30KG', description: 'Cement bag, 30 kg', unit_price: 11.9 },
    { sku: 'REB-10MM-6', description: 'Rebar, 10 mm, 6 m', unit_price: 18.25 },
    { sku: 'SCR-DECK-1LB', description: 'Deck screws, 1 lb box', unit_price: 9.99 },
  ];

  test('SKU-GET-01 lists five catalog SKUs', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/skus');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const skus = body as unknown[];
    expect(skus.length).toBe(5);

    for (const sku of skus) {
      await expectSchema(request, sku, 'Sku');
    }
  });

  test('SKU-GET-02 lists every seed SKU with exact description and unit_price', { tag: '@api' }, async ({
    request,
  }) => {
    const res = await request.get('/skus');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const skus = body as Array<Record<string, unknown>>;

    for (const sku of skus) {
      await expectSchema(request, sku, 'Sku');
    }

    for (const seed of seedSkus) {
      const found = skus.find((item) => item.sku === seed.sku);
      expect(found, `missing seed SKU ${seed.sku}`).toBeDefined();
      expect(found?.description).toBe(seed.description);
      expect(found?.unit_price).toBe(seed.unit_price);
    }
  });

  test('SKU-GET-03 every listed SKU matches OpenAPI schema Sku', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/skus');
    expect(res.status()).toBe(200);

    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const skus = body as unknown[];
    expect(skus.length).toBeGreaterThan(0);

    for (const sku of skus) {
      await expectSchema(request, sku, 'Sku');
    }
  });

  test('SKU-GET-E01 unknown path GET /skus/extra returns 404 without rule', { tag: '@api' }, async ({ request }) => {
    const res = await request.get('/skus/extra');
    expect(res.status()).toBe(404);

    const body = await res.json();
    await expectSchema(request, body, 'Error');
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('rule');
  });
});
