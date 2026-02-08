import { expect, test } from '@playwright/test';

test('planner redirects to login when unauthenticated', async ({ page }) => {
  await page.goto('/planner');
  await expect(page).toHaveURL(/\/login\?redirect=/);
});
