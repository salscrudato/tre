# ARCHITECTURE.md

The data model, security rules, financial engine, and AI service for Nest. This is the contract. Build prompts reference it by section.

## 1. Firestore data model

One shared household. Both members read and write the same household subtree. The household id is fixed and stored in `src/config/app.ts` as `HOUSEHOLD_ID` after the seed creates it (or use a known constant like `primary`).

```
households/{householdId}
  name: string
  members: string[]            // [salUid, lisaUid]
  createdAt: Timestamp
  settings: {
    currency: "USD"
    assumedAnnualReturn: number       // default 0.07
    compoundingPerYear: number        // 12
    housePurchaseTargetDate: string   // ISO date
    targetPitiMin: number             // 5000
    targetPitiMax: number             // 6000
    mortgageRateAssumption: number    // 0.065
    loanTermYears: number             // 30
    propertyTaxRateAssumption: number // 0.023 effective
    annualHomeInsuranceAssumption: number // 2400
    downPaymentTarget: number         // 250000, the down payment goal everywhere
    targetHomePrice?: number          // optional target town price marker, off by default
    receiptScanProvider: "off" | "anthropic" | "grok"  // optional photo-to-expense, default "off"
  }

households/{hid}/categories/{categoryId}
  name: string
  type: "fixed" | "variable" | "savings"
  color: string                // hex from the category palette
  icon: string                 // lucide icon key
  order: number

households/{hid}/incomes/{incomeId}
  name: string
  owner: "Sal" | "Lisa"
  netPerPaycheck: number
  frequency: "semimonthly" | "biweekly" | "monthly"
  payDays: number[]            // e.g. [15, 30]
  note?: string

households/{hid}/fixedExpenses/{fixedId}
  name: string
  amount: number
  categoryId: string
  dueDay: number               // 1 to 31
  owner: "Sal" | "Lisa"
  active: boolean
  endDate?: string             // ISO date, for finite obligations (mattress)
  goalId?: string              // if this fixed line funds a goal (House, Summer)
  note?: string
  lever?: "housing" | "necessity" | "discretionary" | "savings"   // see 3.7
  alternativeAmount?: number   // optional cheaper option for a necessity or
                               // discretionary line; the saving is the difference

households/{hid}/budget/{monthKey}        // monthKey = "YYYY-MM", or a single doc "template"
  byCategoryId: { [categoryId: string]: number }   // monthly planned amount per category
  // The app uses "template" as the default monthly plan, and may override per month.

households/{hid}/transactions/{txId}
  amount: number               // positive dollars spent
  categoryId: string
  date: string                 // ISO date of the spend
  note?: string
  createdBy: "Sal" | "Lisa"
  createdAt: Timestamp
  // projection is computed on the fly, never stored

households/{hid}/goals/{goalId}
  name: string
  target: number
  current: number
  targetDate: string           // ISO date
  color: string
  priority: number
  note?: string

households/{hid}/accounts/{accountId}     // balances, and which count toward the house
  name: string
  type: "cash" | "taxable" | "retirement"
  balance: number
  countsTowardHouse?: boolean   // when true, this balance sums into the House goal progress
  allocation?: string
  note?: string
```

### Database and indexing
- The Firestore database already exists: the `(default)` database in Native mode, multi-region `nam5`. Its location is immutable, so do not recreate or relocate it; use it as is. Cloud Functions still pin to `us-east1` independently.
- `transactions` queried by `date` range and by `categoryId`. Add a composite index on `(categoryId asc, date desc)` and a single-field index on `date desc`. Let the Firebase CLI generate `firestore.indexes.json` from the emulator errors during development, then deploy.

## 2. Security rules

Two trusted users. Lock everything to household members. Put in `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isMember(hid) {
      return request.auth != null
        && request.auth.uid in get(/databases/$(database)/documents/households/$(hid)).data.members;
    }

    match /households/{hid} {
      allow read: if request.auth != null
        && request.auth.uid in resource.data.members;
      allow update: if isMember(hid);
      allow create, delete: if false;     // created once by the seed via admin SDK

      match /{sub=**} {
        allow read, write: if isMember(hid);
      }
    }
  }
}
```

Optionally also restrict Auth at the project level to the two known emails (Authentication settings, or a `beforeCreate` blocking function). For two users, the rules above are sufficient.

## 3. The financial engine (`src/lib/money.ts`)

Use `decimal.js` internally. Export pure functions. Unit test each with the worked examples below.

### 3.1 One-time future value
```
futureValueOneTime(principal, years, annualReturn = 0.07, n = 12):
  return principal * (1 + annualReturn / n) ^ (n * years)
```
Worked example: 240 at 7%, monthly compounding.
- 1 year:  240 * (1 + 0.07/12)^12   = 257.36
- 10 years: 240 * (1.0058333)^120   = 482.97
- 30 years: 240 * (1.0058333)^360   = 1955.78

### 3.2 Recurring (annuity) future value
A monthly contribution `M` invested at the start-agnostic ordinary-annuity convention:
```
futureValueRecurring(monthly, years, annualReturn = 0.07):
  i = annualReturn / 12
  months = 12 * years
  if i == 0: return monthly * months
  return monthly * ((1 + i)^months - 1) / i
```
Worked example: 25 per month at 7%.
- 1 year:  25 * ((1.0058333)^12 - 1)/0.0058333  = 309.91
- 10 years: 25 * ((1.0058333)^120 - 1)/0.0058333 = 4324.40
- 30 years: 25 * ((1.0058333)^360 - 1)/0.0058333 = 30396.00

This is why the impact reveal shows BOTH numbers when a category is marked recurring: the one-time cost and the lifetime-if-recurring cost.

### 3.3 Mortgage principal and interest
```
monthlyPI(loanAmount, annualRate, termYears):
  c = annualRate / 12
  N = termYears * 12
  if c == 0: return loanAmount / N
  return loanAmount * (c * (1 + c)^N) / ((1 + c)^N - 1)
```
Worked example: 500,000 at 6.5%, 30 years => 3160.34 per month.

### 3.4 PITI
```
piti(homePrice, downPayment, annualRate, termYears, propertyTaxRate, annualInsurance):
  loan = homePrice - downPayment
  pi = monthlyPI(loan, annualRate, termYears)
  tax = (homePrice * propertyTaxRate) / 12
  ins = annualInsurance / 12
  return { pi, tax, ins, total: pi + tax + ins, loan }
```

### 3.5 House price solver (bisection)
Given a target PITI, solve for the home price whose PITI equals the target. Tax scales with price, so search numerically.
```
maxHomePriceForPiti(targetPiti, downPayment, annualRate, termYears, propertyTaxRate, annualInsurance):
  lo = downPayment
  hi = downPayment + 5_000_000
  for 60 iterations:
    mid = (lo + hi) / 2
    p = piti(mid, downPayment, annualRate, termYears, propertyTaxRate, annualInsurance).total
    if p > targetPiti: hi = mid else lo = mid
  return (lo + hi) / 2
```
Sanity check with the seed assumptions (rate 6.5%, tax 2.3%, insurance 2400, down 250,000): a 5,500 target solves to roughly an 840,000 home; a 6,000 target solves to roughly an 890,000 home. Display these on the Dashboard house-runway card.

### 3.6 House runway projection
Given current down-payment savings, monthly contribution, and the target date, project the down payment at the target date using `futureValueRecurring` plus growth on the existing balance via `futureValueOneTime` (use a conservative return for the down-payment bucket, default 0.03, because it should be de-risked). Then feed that projected down payment into `maxHomePriceForPiti` to show the home price the couple is on track to afford. Recompute live as they change the monthly savings input.

The horizon (months from today to the target date) is clamped to at least one month in `houseImpactOfMonthly` and `houseRunway` so a same-day or past target never collapses a projection to zero. The UI gates the display separately with `horizonIsValid` (true only when the date is strictly in the future): when false, every house surface shows a plain "pick a future date" note instead of a degenerate number. The target purchase date is configurable in Settings and drives every house number live.

### 3.7 Realistic recurring house impact
The home impact of a recurring bill is not its full amount redirected. `lib/recurring.ts` classifies each bill (the `lever`: housing, savings, necessity, or discretionary, derived from the category and name unless overridden) and computes an honest monthly saving, then projects only that saving into buying power via `houseImpactOfMonthly`. The rules:
- **Housing** (rent, mortgage): our home. No saving, no cut, no home impact line.
- **Savings into the house bucket** (a bill whose `goalId` is the House goal): this builds the home. Framed as "builds about X toward our home", never as a cut.
- **Savings into another goal** (Emergency, Summer): a tradeoff between our own goals, not a saving. Shown neutrally, no home framing.
- **Necessity** (groceries, utilities, internet, phone, insurance, childcare, debt): never eliminated. The lever is a cheaper alternative (`alternativeAmount`); the saving is the difference and the home impact is computed from that difference only. With no alternative set, the row quietly invites one ("find a cheaper option").
- **Discretionary** (subscriptions, dining, entertainment): a full cut is fair, and a downgrade by the difference is offered when an alternative is set.

Nothing is hardcoded: every figure comes from the live bill amounts and the live house context (target date, PITI, rates), recomputed in `lib/money.ts`.

## 4. The impact reveal component

`components/ImpactReveal.tsx`. Input: an amount and whether the category is recurring. Output: a calm, animated panel with three figures (1 yr, 10 yr, 30 yr). For recurring lines, show a toggle between "this once" and "every month". Animate the numbers counting up over 200 to 400 ms with a spring ease, and respect reduced motion (jump straight to final values). Use the projection sparkline (custom SVG) to show the growth curve. This panel appears the instant an amount is entered in the Quick Add on the home screen, before the expense is even saved. It is the emotional core of the app. Keep it elegant and quiet, not loud.

## 5. Dashboard

Spent counts only logged transactions, never the fixed bills (the spend math lives in `lib/budget.ts`, `buildBudgetView`). Fixed bills are shown separately as our committed monthly total (money already spoken for). Month to date and year to date reflect only what we log, so a fresh month starts at zero. Categories are grouped by type and never mixed.

- **House goal card (the hero)**: the down payment goal. How much we have toward the $250,000 (the combined balance of the accounts flagged `countsTowardHouse`), the one configurable target purchase date (the plan), and, separately and clearly labeled, the date our current saving pace actually reaches the target (`paceReconciliation` in `lib/money.ts`). When the pace runs past the target it states how much more per month would close the gap. Never two competing plans.
- **Where we are**: this month and this year, logged spent leading and a budget bar, plus the savings rate and the committed monthly total.
- **Discretionary group**: one row per variable category with a custom SVG progress bar (green under 80 percent of budget, amber 80 to 100, red over 100), monthly and an annualized (times twelve) view, spent year to date, and the group totals. A zero-budget category renders a calm empty bar, never a divide by zero. Always show the number; color is never the only signal.
- **Fixed costs group**: the committed bills grouped by category, each with its due day, and the committed monthly total (and annualized). No spent or progress: these are known costs, not logged spending.
- **Savings group**: the committed monthly contributions and a ring per goal. The House goal reads the combined flagged-account balance.
- **House power (secondary)**: an estimate of the home price our savings could support, with a slider for extra savings. The target town price marker shows only when the optional `targetHomePrice` is set.
- **Transaction history**: a chronological list for the selected month with a month switcher and a category filter, each row editable and deletable. This is the full ledger; Home only shows the last five.

The Dashboard is reached from the tab bar and from the compact glance on Home, so the couple is always one tap from the full picture, and it reads in five seconds: where we are this month, this year, and how the house goal is tracking.

## 6. AI services (Cloud Functions)

Two callable Cloud Functions (gen 2, Node 20, region us-east1), both authenticated. The client never sees any API key. The advice function is core. The receipt function is optional and only active when the household enables it in settings.

### 6.1 Optimization advice (`getAdvice`)

A single Cloud Function `getAdvice`, callable, authenticated. The client never sees the API key.

Request payload (built client-side from live Firestore data, no secrets):
```
{
  question?: string,            // optional free-text from the user
  snapshot: {
    incomeMonthlyNet: number,
    fixedExpenses: { name, amount, categoryId, dueDay }[],
    budgetByCategory: { categoryName, planned, actualMTD }[],
    goals: { name, target, current, targetDate }[],
    assumptions: { annualReturn, mortgageRate, propertyTaxRate, targetPitiMin, targetPitiMax },
    surplusMonthly: number      // net minus spend minus savings
  }
}
```

Function behavior:
- Read the secret with `defineSecret('ANTHROPIC_API_KEY')`.
- Call the Anthropic Messages API, model `claude-sonnet-4-6`, `max_tokens` ~1200.
- System prompt: a grounded household CFO. Rules in the system prompt: use only the numbers provided; each fixed expense carries its `lever` (housing, necessity, discretionary, savings) and the model optimizes by that lever; for a necessity it proposes a specific named cheaper alternative with a real price and keeps the need met (the saving is the difference, never the whole bill); for a discretionary line a full cut or a named cheaper alternative is fair; it never suggests cutting housing, childcare, healthcare, or insurance coverage, only shopping for a better rate at the same coverage; no em dashes, no en dashes, no emoji, plain sentences.
- Ask the model to return strict JSON: `{ "summary": string, "actions": [{ "title": string, "detail": string, "currentMonthly": number, "proposedMonthly": number }] }`, where `currentMonthly` is what they pay now and `proposedMonthly` is the alternative's cost (0 for a full cut). Parse defensively (strip code fences). On parse failure, fall back to rendering the raw text.
- Render results as cards on the Optimize page. The saving is computed client-side as `max(0, currentMonthly - proposedMonthly)`; the 30-year invested figure and the home impact are recomputed from that saving via `money.ts` (never trust the model's arithmetic). The home figure shows only when the purchase-date horizon is valid.

Reference call shape (server side):
```ts
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": ANTHROPIC_API_KEY.value(),
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  }),
});
```

### 6.2 Receipt scan (`scanReceipt`, optional)

An optional convenience: photograph a receipt and let a vision model read the amount so logging is one tap. It is off by default. It activates only when `settings.receiptScanProvider` is `anthropic` or `grok`. Build the function and the wiring, but the home Quick Add must work fully without it.

Callable function `scanReceipt`. Request payload is the image only, sent as base64 plus its media type, and the chosen provider:
```
{ imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp", provider: "anthropic" | "grok" }
```

Function behavior:
- Read whichever secret the provider needs: `defineSecret('ANTHROPIC_API_KEY')` for anthropic, `defineSecret('XAI_API_KEY')` for grok. If the required secret is missing, return a clean error the client can show ("Receipt scanning is not configured. Add a key in settings.").
- Anthropic path: POST to `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`, with a content array holding an `image` block (`source.type: "base64"`) and a text instruction. Grok path: POST to `https://api.x.ai/v1/chat/completions`, model `grok-4` (a vision-capable xAI model), with an `image_url` content part carrying a `data:` URL built from the base64. Same instruction, OpenAI-style message shape.
- Instruction to the model: read this receipt and return STRICT JSON only, no prose, no code fences: `{ "amount": number, "merchant": string, "date": string, "suggestedCategory": string }`. `amount` is the final total paid. `suggestedCategory` must be one of the category names passed in the prompt, or "Other".
- Pass the household's category names into the instruction so the suggestion maps to a real category. Parse defensively; on failure return `{ amount: null }` so the client falls back to manual entry.
- The function never writes to Firestore. It only returns the parsed fields. The client pre-fills the Quick Add (amount and the matched category) and the user confirms with one tap. Never auto-log. The user always sees and approves the number before it is saved, because a misread receipt must never silently become a transaction.

Reference call shapes (server side):
```ts
// Anthropic
body: JSON.stringify({
  model: "claude-sonnet-4-6", max_tokens: 400,
  messages: [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
    { type: "text", text: INSTRUCTION }
  ]}]
})
// Grok (xAI, OpenAI-compatible)
headers: { "content-type": "application/json", "authorization": `Bearer ${XAI_API_KEY.value()}` }
body: JSON.stringify({
  model: "grok-4", max_tokens: 400,
  messages: [{ role: "user", content: [
    { type: "text", text: INSTRUCTION },
    { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } }
  ]}]
})
```

## 7. Routing, home, and configuration

### 7.1 Routes and shell
React Router v6. Routes: `/login`, `/` (Home, the landing screen and the hero), `/dashboard` (the full analysis view), `/recurring` (fixed costs), `/optimize` (AI advice), `/settings` (configuration). Auth-guarded layout. Bottom tab bar on mobile with four slots: Home, Dashboard, Recurring, Optimize. Settings is reached by a gear affordance in the sticky header, not a tab, because it is configuration rather than daily use. Desktop uses a 72 px icon side rail with the same destinations. There is no separate Add route and no separate Log route: logging happens in the Quick Add on Home, and transaction history lives on the Dashboard.

### 7.2 Home and the Quick Add (the frictionless core)
Home opens straight into logging. The goal is the fewest possible taps from launch to logged.
- **Quick Add** sits at the top, above the fold. A large centered amount field (tabular-nums, leading green dollar glyph, numeric keypad on mobile, autofocus), a horizontal scroll of category chips from the categories collection including the always-present "Other" chip, and a single primary action "Log expense". Default date is today, editable but tucked away. No required fields beyond amount and category.
- The **ImpactReveal** (section 4) renders live beneath the amount the moment a number is entered, so the 1, 10, and 30 year cost is visible before the user even logs. On log, write optimistically and show a brief confirmation, then reset the field for the next entry.
- If `settings.receiptScanProvider` is not "off", show a camera or upload button beside the amount field that calls `scanReceipt` (section 6.2) and pre-fills amount and category for one-tap confirm. If it is "off", this control is hidden entirely.
- Below the Quick Add, a **compact glance**: month-to-date spent vs planned (one ProgressBar), the current savings rate, and a small house-runway line ("On track for about 870k by Sept 2027"). Each links into the full Dashboard.
- Below that, **Recent**: the last five transactions with category chip and amount, each tappable to edit or delete, so a mistaken entry is fixed immediately.
- One primary action on the screen (Log expense). Everything else is secondary.

### 7.3 Settings (everything is configurable)
`/settings` is where the household shapes the app. All of the following are editable, with create, edit, delete, and sensible validation, written through the same hooks and rules:
- **Expense categories**: add, rename, recolor (from the category palette), reassign icon, set type (fixed, variable, savings), reorder. Deleting a category that has transactions reassigns them to "Other" rather than orphaning them.
- **Income**: add or edit each earner's net per paycheck, frequency, and pay days.
- **Fixed amounts**: the recurring bills, editable here and on `/recurring` (same data, same hooks).
- **Goals**: edit targets, current balances, and target dates for House, Emergency, Summer, and any new goal.
- **Assumptions**: assumed annual return, mortgage rate, property tax rate, insurance, loan term, target PITI band, and the house purchase target date. These drive every projection, so changing them updates the impact reveal and the house-runway card everywhere.
- **Receipt scanning**: a selector for Off, Anthropic, or Grok, with a one-line note that the matching API key must be set as a server secret (it is never entered in the app). Writes `settings.receiptScanProvider`.
Use the Field, Sheet, and Button primitives throughout. One primary action per sheet.

## 8. PWA, installability, and performance

`vite-plugin-pwa` with `registerType: 'autoUpdate'`. The app must be installable on desktop Chrome (an install icon in the address bar), Android, and iOS Safari (Add to Home Screen), and must launch standalone with no browser chrome.

Manifest: `name` and `short_name` "Nest", a `description`, `start_url` "/", `scope` "/", `display: standalone`, `theme_color` the brand green, `background_color` the app background, and a stable `id`. Icons generated from the app icon SVG: 192, 512, a maskable 512 (`purpose: "maskable"`), and a 180x180 apple-touch-icon.

iOS: include in `index.html` the `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and `apple-mobile-web-app-title` meta tags plus the `apple-touch-icon` link, so the installed app looks native.

Install affordance: capture the `beforeinstallprompt` event and surface an in-app Install button on desktop and Android. iOS does not fire that event, so show a one-line hint to use Share then Add to Home Screen. Hide the button when running in `display-mode: standalone`.

Offline: enable Firestore offline persistence (persistent local cache) so previously loaded data is readable without a connection, and precache the app shell in the service worker. Writes queue and sync when the connection returns.

Performance: code-split every route with `React.lazy` and Suspense; lazy-load the Optimize (AI) and receipt-scan code so they stay out of the initial bundle; import lucide icons individually to keep them tree-shaken; self-host only the Inter weights actually used; add `preconnect` hints for the Firebase endpoints. Target a clean Lighthouse pass on installable PWA, performance, and accessibility before deploy.

## 9. Seed script (`scripts/seed.ts`)

Node script using `firebase-admin`. Reads `seed/seed-data.json`, resolves `__SAL_UID__` and `__LISA_UID__` from env vars (`SAL_UID`, `LISA_UID`) which you set after creating the two Auth users, then writes the household, categories, incomes, fixedExpenses, budget template, goals, accounts, and the sample transactions. Idempotent: use deterministic doc ids from the JSON `id` fields and `set` with merge. Run once with `npm run seed`.
