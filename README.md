# Tre

A private, two-person household finance PWA for one married couple. It makes the future
cost of spending visceral (the 1, 10, and 30 year if-invested impact of every expense) so
the couple can maximize savings toward a house down payment. Not a product for sale: two
users, one shared household, on Firebase project `sallisascru`.

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
fallback. Manual accounts (no `plaidAccountId`, such as Lisa's savings) are never
overwritten by a sync.

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
