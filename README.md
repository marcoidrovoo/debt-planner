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
