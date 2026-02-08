# Paycheck Plan (App Wrapper)

This project is now set up to run as a mobile app using Capacitor (Path 1 wrapper).

## Structure
- `web/` — static site assets used by the app
- `capacitor.config.json` — Capacitor configuration
- `package.json` — scripts for Capacitor commands

## Quick start (manual steps)
1. Install dependencies:
   - `npm install`
2. Create native projects:
   - `npm run cap:add:ios`
   - `npm run cap:add:android`
3. Sync web assets:
   - `npm run cap:sync`
4. Open native projects:
   - `npm run cap:open:ios`
   - `npm run cap:open:android`

## Notes
- The app uses the files in `web/`. Update `web/index.html` or `web/strategy.html` for changes.
- The original `index.html` and `strategy.html` remain at the repo root for web preview.

## Vercel (Web MVP)
This repo is ready to deploy as a static site on Vercel.

1. Push to GitHub.
2. In Vercel, import the repo and deploy.
3. Update `sitemap.xml` with your real domain.

Routes:
- `/` → `index.html`
- `/strategy` → `strategy.html`

## Auth + Paid Accounts (Supabase + Stripe)
This repo stays **static**. Auth + subscriptions are powered by Supabase (client) and Supabase Edge Functions (server).

### 1) Supabase database
Run these migrations in your Supabase project SQL editor:
- `supabase/migrations/20260205_profiles.sql`
- `supabase/migrations/20260206_profiles_stripe_uniques.sql`

This creates:
- `profiles` table
- RLS policies (users can read/update their own profile only)
- A trigger to auto-create a profile row on signup

### 2) Configure Supabase + Stripe keys
Set these secrets in your Supabase project (Edge Functions → Secrets):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_MONTHLY`
- `STRIPE_PRICE_ID_YEARLY`
- `APP_URL` (required; your public site URL, e.g. `https://budgetdad.com`)
- `ALLOWED_ORIGINS` (optional; comma-separated allowlist for CORS)

### 3) Deploy Supabase Edge Functions
From the repo root:
1. Install the Supabase CLI.
2. Run:
   - `supabase functions deploy create-checkout-session`
   - `supabase functions deploy create-portal-session`
   - `supabase functions deploy stripe-webhook`

### 4) Create Stripe prices
Create a Stripe product + prices (monthly + yearly). Store the price IDs in Supabase Function secrets:
- `STRIPE_PRICE_ID_MONTHLY`
- `STRIPE_PRICE_ID_YEARLY`

### 5) Stripe webhook
Create a webhook endpoint in Stripe:
- URL: `https://<PROJECT>.supabase.co/functions/v1/stripe-webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

### 6) Update client config
Edit both `assets/app-config.js` and `web/assets/app-config.js` with:
- Supabase URL + anon key
- App URL

Security note:
- The Supabase browser SDK is vendored locally at `assets/vendor/supabase-2.45.0.min.js` and `web/assets/vendor/supabase-2.45.0.min.js` to avoid runtime CDN dependency.
- When upgrading SDK versions, replace both files with the same version and verify checksums match.

### 7) Test flow
- Visit `/signup` → create account
- `/login` → sign in
- `/reset-password` → verify password recovery flow
- `/pricing` → start subscription
- `/account` → verify plan + manage billing
