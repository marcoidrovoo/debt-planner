import { expect, test } from '@playwright/test';

const mockAuthScript = `
(function () {
  var state = {
    paid: false,
    calls: 0,
    mode: 'free',
    user: { id: 'test-user', email: 'test@example.com' }
  };
  if (window.location.search.indexOf('checkout=success') !== -1) {
    state.mode = 'checkout';
  }
  window.__setMockPaidMode = function (mode) {
    state.mode = mode;
    state.paid = mode === 'paid';
    state.calls = 0;
  };
  window.BudgetDadAuth = {
    getUser: function () { return state.user; },
    getProfile: function () { return { email: state.user.email, plan: state.paid ? 'paid' : 'free' }; },
    isPaid: function () { return state.paid; },
    isReady: function () { return true; },
    waitUntilReady: async function () {},
    ensureProfileReady: async function () {},
    refreshProfile: async function () {
      state.calls += 1;
      if (state.mode === 'checkout' && state.calls >= 2) {
        state.paid = true;
      }
      return { plan: state.paid ? 'paid' : 'free' };
    },
    requireAuth: function () { return true; },
    requirePaid: function () { return state.paid; },
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

async function mockAuth(page: import('@playwright/test').Page) {
  await page.route('**/assets/auth.js', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: mockAuthScript
    });
  });
}

test('free users still see paywall after calculate', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/planner');

  await page.selectOption('#pay-frequency', 'biweekly');
  await page.check('#pay-type-salary');
  await page.fill('#salary-takehome', '2000');
  await page.fill('#start-date', '2026-02-08');
  await page.click('#next-button');
  await page.click('#calc-button');

  await expect(page.locator('#paywall-modal')).toHaveClass(/active/);
  await expect(page.locator('#plan-box')).toContainText('Unlock Pro');
});

test('checkout success page unlocks full planner when profile sync turns paid', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/planner?checkout=success');

  await expect(page.locator('#planner-status-message')).toContainText('Payment confirmed');
});
