import { expect, test } from '@playwright/test';

const paidAuthScript = `
(function () {
  var user = { id: 'paid-user', email: 'paid@example.com' };
  window.BudgetDadAuth = {
    getUser: function () { return user; },
    getProfile: function () { return { email: user.email, plan: 'paid' }; },
    isPaid: function () { return true; },
    isReady: function () { return true; },
    waitUntilReady: async function () {},
    ensureProfileReady: async function () {},
    refreshProfile: async function () { return { plan: 'paid' }; },
    requireAuth: function () { return true; },
    requirePaid: function () { return true; },
    startCheckout: async function () {},
    openBillingPortal: async function () {},
    updateProfile: async function () { return { error: null }; },
    applyPaidGate: function () {},
    getPlannerSnapshot: async function () { return { data: null, error: null }; },
    savePlannerSnapshot: async function () { return { error: null }; },
    clearPlannerSnapshot: async function () { return { error: null }; },
    createSupportTicket: async function () { return { data: { ticketId: 't_123', emailSent: true }, error: null }; }
  };
})();
`;

async function mockPaidAuth(page: import('@playwright/test').Page) {
  await page.route('**/assets/auth.js', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: paidAuthScript
    });
  });
}

test('full plan page shows paycheck-by-paycheck targets and updates debt balance after payment', async ({ page }) => {
  await mockPaidAuth(page);

  await page.addInitScript(payload => {
    Object.entries(payload).forEach(([key, value]) => {
      window.localStorage.setItem(key, String(value));
    });
  }, {
    rememberData: 'yes',
    incomeData: JSON.stringify({
      payType: 'salary',
      frequency: 'biweekly',
      startDate: '2026-02-01',
      startingBalance: 0,
      buffer: 100,
      spending: 100,
      payAmountForThisCheck: 1000,
      debtStrategy: 'snowball',
      breakdown: {
        mode: 'salary',
        takeHome: 1000,
        extraPay: 0,
        net: 1000
      }
    }),
    billsData: JSON.stringify([
      { name: 'Rent', amount: 700, dueDay: 3 }
    ]),
    debtsData: JSON.stringify([
      { name: 'Card A', balance: 1000, minimum: 100, rate: 19.99, dueDay: 5 }
    ]),
    savingsGoalsData: JSON.stringify([
      { type: 'Emergency Fund', name: 'Emergency Fund', target: 500, deadline: '2026-12-31', priority: 'medium' }
    ]),
    debtStrategy: 'snowball',
    focusMode: 'debt'
  });

  await page.goto('/plan');

  await expect(page.locator('.cycle-card').first()).toContainText('Paycheck 1');
  await expect(page.locator('.cycle-card').first()).toContainText('Debt balances by end of this paycheck');
  await expect(page.locator('#debt-progress-list .progress-row').first()).toContainText('$1000.00 left');
  await expect(page.locator('.cycle-card').first()).toContainText('Total target left $900.00');
  await expect(page.locator('.cycle-card').first()).toContainText('actual left $1000.00');

  await page.locator('.cycle-card').first().locator('.task-row:has-text("Debt minimum: Card A") button').click();

  await expect(page.locator('#debt-progress-list .progress-row').first()).toContainText('$900.00 left');
  await expect(page.locator('.cycle-card').first()).toContainText('actual left $900.00');
});

test('plan page redirects to login when unauthenticated', async ({ page }) => {
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/login\?redirect=/);
});
