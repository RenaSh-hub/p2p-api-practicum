import { expect, test } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

function uniqueName(base: string): string {
  return `${base} ${Date.now()}`;
}

test('V-POST-01 creates a vendor with default active true', { tag: '@api' }, async ({ request }) => {
  const name = uniqueName('Cedar Point Hardware');
  const res = await request.post('/vendors', { data: { name } });
  expect(res.status()).toBe(201);

  const body = await res.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id).toMatch(/^vnd-/);
  expect(body.name).toBe(name);
  expect(body.active).toBe(true);
});

test('V-POST-02 creates a vendor with active false', { tag: '@api' }, async ({ request }) => {
  const name = uniqueName('Inactive Vendor');
  const res = await request.post('/vendors', { data: { name, active: false } });
  expect(res.status()).toBe(201);

  const body = await res.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id).toMatch(/^vnd-/);
  expect(body.name).toBe(name);
  expect(body.active).toBe(false);
});

test('V-POST-03 creates a vendor with active true', { tag: '@api' }, async ({ request }) => {
  const name = uniqueName('Explicit Active Vendor');
  const res = await request.post('/vendors', { data: { name, active: true } });
  expect(res.status()).toBe(201);

  const body = await res.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id).toMatch(/^vnd-/);
  expect(body.name).toBe(name);
  expect(body.active).toBe(true);
});

test('V-POST-04 accepts a single-character name', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', { data: { name: 'A' } });
  expect(res.status()).toBe(201);

  const body = await res.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('A');
  expect(body.id).toMatch(/^vnd-/);
  expect(body.active).toBe(true);
});

test('V-POST-05 trims leading and trailing whitespace from name', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', { data: { name: '  Maple Ridge  ' } });
  expect(res.status()).toBe(201);

  const body = await res.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('Maple Ridge');
});

test('V-POST-06 rejects empty name', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', { data: { name: '' } });
  expect(res.status()).toBe(400);

  const body = await res.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
  expect(String(body.detail).toLowerCase()).toContain('empty');
});

test('V-POST-07 rejects missing name', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', { data: {} });
  expect(res.status()).toBe(400);

  const body = await res.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-POST-08 rejects whitespace-only name', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', { data: { name: '   ' } });
  expect(res.status()).toBe(400);

  const body = await res.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-POST-09 rejects non-string name', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', { data: { name: 123 } });
  expect(res.status()).toBe(400);

  const body = await res.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-POST-10 rejects non-boolean active', { tag: '@api' }, async ({ request }) => {
  const name = uniqueName('Bad Active Type');
  const res = await request.post('/vendors', { data: { name, active: 'yes' } });
  expect(res.status()).toBe(400);

  const body = await res.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-POST-11 rejects invalid JSON body', { tag: '@api' }, async ({ request }) => {
  const res = await request.post('/vendors', {
    headers: { 'Content-Type': 'application/json' },
    data: '{ not valid json',
  });
  expect(res.status()).toBe(400);

  const body = await res.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-POST-12 allows duplicate vendor names with distinct ids', { tag: '@api' }, async ({ request }) => {
  const name = uniqueName('Duplicate Name Vendor');
  const first = await request.post('/vendors', { data: { name } });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  await expectSchema(request, firstBody, 'Vendor');

  const second = await request.post('/vendors', { data: { name } });
  expect(second.status()).toBe(201);
  const secondBody = await second.json();
  await expectSchema(request, secondBody, 'Vendor');

  expect(secondBody.id).not.toBe(firstBody.id);
  expect(secondBody.name).toBe(name);
  expect(firstBody.name).toBe(name);
});
