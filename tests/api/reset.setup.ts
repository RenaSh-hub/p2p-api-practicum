import { expect, test as setup } from '@playwright/test';

setup('reset seed data', async ({ request }) => {
  const response = await request.post('/admin/reset');
  expect(response.status()).toBe(200);
});
