# CLAUDE.md

Master context for Claude Code. Read this file, then `docs/ARCHITECTURE.md` and `docs/DESIGN_SYSTEM.md`, at the start of every session. Follow them exactly. When a build prompt conflicts with these files, ask before deviating.

## What we are building

**Nest** is a private household finance PWA for a couple. Each household has its own private data; a new user creates a household through the guided first run and can invite one partner. The single purpose: see the real-time and future-cost impact of spending so the couple can maximize savings toward a house down payment by September 2027, targeting a monthly mortgage payment (PITI) of 5,000 to 6,000.

The home screen is the product's center of gravity: it opens directly into a frictionless Quick Add (pick a category or Other, type an amount, log it), with the dashboard one tap away. Everything the couple's situation depends on (categories, income, fixed amounts, goals, and the projection assumptions) is configurable in settings.

The signature feature: when you log any expense, the app shows what that money would have become if invested instead, at 1, 10, and 30 years. A 25 dollar monthly subscription is not 25 dollars. It is roughly 30,000 dollars over 30 years. The app makes that visceral on every entry.

Rename: the app name lives in `src/config/app.ts` as `APP_NAME`. Renaming is one constant change.

## Stack (do not substitute without asking)

- Vite + React 19 + TypeScript (strict mode on)
- Tailwind CSS v4 (CSS-first config via `@theme` in `src/index.css`; tokens come from `docs/DESIGN_SYSTEM.md`)
- React Router v6 for routing
- Firebase: Auth (email/password), Firestore (data), Hosting (the PWA), Cloud Functions (the AI advice proxy, gen 2, Node 20)
- `vite-plugin-pwa` for the installable home-screen app
- `firebase` web SDK v10+ on the client; `firebase-admin` only in functions and the seed script
- State: React Context for auth and household; TanStack Query (`@tanstack/react-query`) for Firestore reads/writes wrapped in a thin service layer. No Redux.
- Charts: lightweight, hand-built SVG components. Do not add a heavy charting dependency. Progress bars and the projection sparkline are custom SVG.
- Icons: `lucide-react`.
- Money math: `decimal.js` for any multi-step money calculation to avoid float drift. Store amounts as numbers (dollars) in Firestore; never store floats you derived without rounding to cents.

## Commands

```bash
npm run dev          # local dev server
npm run build        # typecheck + production build
npm run preview      # preview the production build
npm run lint         # eslint
npm run seed         # one-time Firestore seed from seed/seed-data.json (uses firebase-admin)
firebase emulators:start   # local Firestore + Auth + Functions emulators
firebase deploy --only hosting,firestore:rules,functions
```

## Repository structure (target)

```
nest/
  CLAUDE.md
  docs/ARCHITECTURE.md
  docs/DESIGN_SYSTEM.md
  docs/FIREBASE_SETUP.md        # human-only console steps, mirror of the build plan
  seed/seed-data.json
  scripts/seed.ts               # admin-SDK importer
  functions/                    # Cloud Functions (gen 2, Node 20)
    src/index.ts                # getAdvice callable, and scanReceipt callable (optional)
  src/
    config/app.ts               # APP_NAME, assumptions defaults
    config/firebase.ts          # client SDK init
    lib/money.ts                # projection + PITI + annuity math (SINGLE source of truth)
    lib/format.ts               # currency, percent, date formatting
    services/                   # firestore.ts, transactions.ts, fixed.ts, goals.ts, categories.ts, advice.ts, receipt.ts
    hooks/                      # useHousehold, useTransactions, useFixed, useBudget, useGoals
    context/                    # AuthContext, HouseholdContext
    components/                 # design-system primitives + feature components (QuickAdd, ImpactReveal, ...)
    routes/                     # Home (Quick Add + glance), Dashboard, Recurring, Optimize, Settings, Login
    App.tsx, main.tsx, index.css
  index.html
  firestore.rules
  firebase.json
  .firebaserc
  vite.config.ts
```

## The financial engine (correctness is non-negotiable)

All formulas live in `src/lib/money.ts` and are unit tested. Definitions and exact formulas are in `docs/ARCHITECTURE.md`. Summary:

- **One-time future value**: `FV = principal * (1 + r/n)^(n*years)` with `r = assumedAnnualReturn` (default 0.07), `n = 12`.
- **Recurring future value (annuity)**: a monthly amount `M` invested for `years` becomes `FV = M * (((1 + i)^(n*years) - 1) / i)` where `i = r/12`. Use this for subscriptions and any recurring line.
- **Mortgage payment (P&I)**: `M = L * (c * (1+c)^N) / ((1+c)^N - 1)` where `L = loan`, `c = monthlyRate`, `N = months`.
- **PITI**: `P&I + (annualPropertyTax / 12) + (annualInsurance / 12)`. Property tax = `homePrice * propertyTaxRate`.
- **House solver**: given a target PITI, down payment, rate, tax rate, and insurance, solve for the max home price. Use a bounded numeric search (bisection), not algebra, because tax depends on home price.

Round only at display time. Never chain rounded intermediates.

## Conventions

1. **TypeScript strict.** No `any`. Model Firestore docs as explicit interfaces in `src/types.ts`.
2. **Copy rules (hard).** No em dashes and no en dashes anywhere in UI copy, comments, or code. Use commas, colons, parentheses, or rewrite. No emoji in the UI. Sentence case for labels and buttons. Active voice. A button names exactly what happens ("Log expense", not "Submit").
3. **One primary action per screen.** Everything else is secondary or tertiary.
4. **Design tokens only.** No raw hex in components. Pull from the CSS variables defined in `docs/DESIGN_SYSTEM.md`. The single brand accent is green. Amber is reserved for warning and over-budget states. Red is reserved for over-budget overflow and destructive actions.
5. **No browser storage in app logic beyond Firebase Auth persistence.** Source of truth is Firestore. Do not hand-roll localStorage caches.
6. **Money as cents discipline.** Format with `src/lib/format.ts`. Inputs accept dollars; validate and clamp to two decimals.
7. **Optimistic UI** on transaction add via TanStack Query, with rollback on error.
8. **Accessibility floor.** Visible keyboard focus, labelled inputs, `prefers-reduced-motion` respected, color is never the only signal (pair color with a number or icon).
9. **Mobile first.** Primary target is an installed PWA on iPhone. Design at 390px width first, then scale up. Safe-area insets respected.
10. **Secrets.** The Anthropic API key lives only in a Cloud Functions secret (`ANTHROPIC_API_KEY`). Never in client code, never in the repo, never in Firestore.

## Definition of done, per feature

A feature is done when: it typechecks and lints clean, it reads and writes the correct Firestore shapes from `docs/ARCHITECTURE.md`, it uses only design tokens, it works at 390px and on desktop, it handles loading and empty and error states with real copy, and it respects reduced motion. No `TODO`, no placeholder text, no dead links, no lorem ipsum.

## Scope guardrails (read before adding anything)

- **In scope v1**: a home screen built around a frictionless Quick Add (pick a category or Other, enter an amount, log it in two taps) with the 1/10/30 year impact reveal firing live; recurring/fixed costs page; a clean dashboard reachable from home (MTD and YTD planned vs actual with progress bars, category breakdown, goal and house-runway tracking, transaction history); an AI optimization page grounded in the household's real data; a settings page where everything is configurable (categories, income, fixed amounts, goals, assumptions); install-as-PWA.
- **Optional (build only after the core is solid, gated off by default)**: receipt scanning. A camera or photo upload on the Quick Add that sends the image to a Cloud Function which calls a vision model (the user's Anthropic or Grok key, chosen in settings, held as a server secret) to extract the amount and a suggested category, then pre-fills the Quick Add for one-tap confirm. It never auto-logs, and the Quick Add must work fully without it. Default `settings.receiptScanProvider` is "off".
- **Deferred (do not build in v1 unless asked)**: live bank linking. Plaid production is not free and adds OAuth, webhook, and security burden that is not justified for two users. There is no CSV import in v1. Manual Quick Add (optionally assisted by receipt scan) is the entry path.
- **Out of scope**: multi-household, public sharing, ads, anything beyond the two members.

## Phase plan (0 to 12)

Build in this order, never jumping ahead. Each phase ends with `npm run build` passing.

0. Groundwork and setup: confirm the environment, attach to the existing project sallisascru, set the package name to nest.
1. Scaffold: Vite + React 19 + TS strict, Tailwind v4 CSS-first, the folder skeleton, src/config/app.ts.
2. Wire up the existing Firebase backend: firebase use sallisascru (do not create), register the web app and write config to .env.local, init Functions and Hosting only (reuse the existing nam5 Firestore), initial auth-only rules. Human enables Email/Password and disables Anonymous.
3. Design system and logo: the green token system, primitives (Button, Card, Field, Money, ProgressBar, GoalRing, Stat, Sheet, TabBar, CategoryChip, QuickAdd shell), the SVG icon and wordmark, light and dark.
4. Auth, users, and the app shell: create the two Auth users via the Admin SDK (projectId sallisascru) and report UIDs, AuthContext and Login, ProtectedRoute, HouseholdContext, the shell with the four-tab bar and a settings gear.
5. Data layer, rules, and seed: typed interfaces, the service layer and TanStack Query hooks, lock the rules to the two UIDs, write the captured UIDs into the seed and rules, run the seed.
6. Home and the frictionless Quick Add: lib/money.ts (unit tested) plus the Home Quick Add, the live 1/10/30 year ImpactReveal, the compact glance, and Recent.
7. Recurring fixed costs: the fixed-bill manager with the if-invested figure per line.
8. The dashboard: MTD/YTD, category bars, goal rings, the house-runway hero card, the full transaction ledger.
9. Settings: configure categories, income, fixed amounts, goals, assumptions, and the receipt-scan provider.
10. AI optimization page: the getAdvice Cloud Function (ANTHROPIC_API_KEY secret, already set in Secret Manager) and the grounded recommendation cards.
11. Receipt scan (optional, off by default): the scanReceipt function (Anthropic or Grok) and the camera capture on the Quick Add.
12. Optimize, make it installable, and ship: PWA manifest and icons, iOS support, install button, Firestore offline persistence, route code-splitting, Lighthouse, deploy.

## Working style for the agent

- Build in the phase order given by the human (phases 0 to 12). Do not jump ahead.
- After each phase, run `npm run build` and report pass/fail before moving on.
- Prefer small, composable components. Extract shared primitives early (Button, Card, Field, Money, ProgressBar, Sheet, Stat).
- When you finish a phase, summarize what changed in two or three lines and name the next manual step the human must take, if any.

## Build execution and environment

This build runs from the human's MacBook with Claude Code driving the terminal. The human has authenticated the firebase, gcloud, and gh CLIs, so do as much as possible yourself from the CLI and only ask the human for the few steps a browser truly requires.

- Set the `package.json` name to `nest`. Do not derive it from the folder name, since npm rejects names with spaces, capitals, or a leading digit. Quote any path that contains a space.
- The Firebase project `sallisascru` already exists (Blaze, Firestore in nam5, Storage enabled). Attach to it with `firebase use sallisascru`. Do not create the project and do not recreate the database.
- Provision the backend yourself: create the project, register the web app and fetch its config into `.env.local`, init Firestore/Functions/Hosting, and deploy. Application default credentials are set, so your admin scripts can run.
- Create the two Firebase Auth users yourself via the Admin SDK from credentials the human provides, report both UIDs, and write them into `seed/seed-data.json` and the security rules. The human should not touch the console for user creation or copy UIDs by hand.
- Two steps genuinely require the human in a browser: upgrading the project to the Blaze plan (a card, one time) and enabling the Email and password sign-in provider. Pause and ask for these, then continue.
- API keys are server secrets only. Run `firebase functions:secrets:set` yourself and prompt the human to paste the key value. Never put a key in client code or the repo.
- Ship it as an installable, optimized PWA: complete manifest and icon set (including maskable and apple-touch), iOS meta tags, an in-app install button via `beforeinstallprompt`, Firestore offline persistence, route-level code splitting, and a clean Lighthouse pass before deploy.
