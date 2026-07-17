# Tre

A private household finance PWA for a couple. It makes the future cost of spending
visceral (the 1, 10, and 30 year if-invested impact of every expense) so a household can
maximize savings toward a house down payment. Each household is private to its members:
a new user creates one through the guided first run and can invite one partner. Runs on
Firebase project `sallisascru`.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md` and `docs/DESIGN_SYSTEM.md`, before changing
anything.

## Stack

Vite + React 19 + TypeScript (strict), Tailwind v4, React Router v6, Firebase (Auth,
Firestore, Hosting, Cloud Functions gen 2 / Node 20), `vite-plugin-pwa`. Money math in
`decimal.js`, all in `src/lib/money.ts` (unit tested). Custom SVG icons and charts, no
heavy chart or icon library.

## Commands

```bash
npm run dev      # local dev server
npm run build    # typecheck + production build
npm run test     # vitest (money and budget unit tests)
npm run lint     # eslint
firebase deploy --only hosting,firestore:rules,functions   # ship
```

## Betterment sync (Plaid, read only)

Optional. The household can connect Betterment in Settings to pull read-only balances; it
never sees a login or password, and entering balances by hand always works as the free
fallback. Manual accounts (no `plaidAccountId`) are never overwritten by a sync.

Cloud Functions (`functions/src/plaid.ts`), each requiring an authenticated household
member:

- `createPlaidLinkToken` opens Plaid Link (products transactions and investments).
- `exchangePlaidPublicToken` exchanges the public token for the long-lived access token and
  stores it server side only.
- `syncPlaidBalances` reads `/accounts/balance/get` plus `/investments/holdings/get` and
  writes balances onto the mapped accounts.
- `setPlaidAccountMapping` records which synced account is which of ours, then re-syncs.
- `scheduledPlaidSync` refreshes once a day.

After connecting, the user maps each synced account to ours (House, Cash, Build Wealth,
Self Directed) by balance, since Plaid shows only the last four digits.

### Security

- The Plaid access token is stored only at `plaidItems/{householdId}` in Firestore, which
  the security rules deny to every client (read and write false). Only the Cloud Functions
  reach it, through the Admin SDK, which bypasses rules. The browser never receives it.
- The Plaid client id and secret are Google Secret Manager secrets (`PLAID_CLIENT_ID`,
  `PLAID_SECRET`), read in the functions via `defineSecret`. They are never in client code,
  the repo, or git history.
- `functions/.env` holds only non-secret config (`PLAID_ENV`, `PLAID_REDIRECT_URI`) and is
  gitignored.
- Synced balances live under `households/{householdId}/accounts`, which members may read.
- Read only, refreshed about once a day.

### Going from sandbox to production (the flip)

Betterment is an OAuth institution, so a real connection needs Plaid Production (via a
Trial plan). To flip from sandbox to production: set `PLAID_ENV=production` and
`PLAID_REDIRECT_URI=https://sallisascru.web.app` in `functions/.env`, whitelist that exact
redirect URI in the Plaid dashboard, replace the `PLAID_SECRET` value in Secret Manager
with the production secret (`firebase functions:secrets:set PLAID_SECRET`), then redeploy
functions (`firebase deploy --only functions`). Nothing else changes.

### Rotating a key

Paste the new value into a temporary file (kept out of git by `.gitignore`), run
`firebase functions:secrets:set <NAME> --data-file <file>`, redeploy functions, then delete
the file. Never commit a real key.

## App store readiness (later, separate step; nothing here is published)

The app ships today as an installable PWA (full manifest, maskable icon, offline shell,
install affordance in Settings, privacy page at `/privacy.html`). Publishing to the app
stores is a deliberate later step; when it happens:

1. **Wrap natively with Capacitor.** `npm i @capacitor/core @capacitor/ios && npx cap init`
   pointing `webDir` at `dist`, then `npx cap add ios` and open the Xcode project. The PWA
   runs unchanged inside the shell; revisit Google sign in inside a WKWebView (use the
   Capacitor Firebase Auth plugin or the redirect flow) before submitting.
2. **Store listing essentials.** An App Store icon at 1024x1024 with no alpha (export from
   `src/components/AppIcon.tsx`), the privacy policy URL (`/privacy.html` on the live
   domain), the App Privacy questionnaire (financial info, identifiers; no tracking), a
   short description in the app's plain voice, and the finance category.
3. **Screenshots (not taken yet).** Apple requires 6.7 inch iPhone shots at 1290x2796 and,
   if iPad is enabled, 13 inch iPad shots at 2064x2752. Capture Home (Quick Add), Spending,
   Budget, and House in light mode at minimum; dark variants optional.
4. **Android later, if wanted.** Play accepts a Trusted Web Activity around the same PWA
   (Bubblewrap), needing a 512 icon and a 1024x500 feature graphic.

The iOS splash on cold start is intentionally the sprout-on-empty-root fallback; a full
`apple-touch-startup-image` set can be generated in this pass if the native wrap wants it.
The Android install splash is light by design (the manifest is light-first; the in-page
theme-color syncs to dark after boot).
