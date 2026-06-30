# DESIGN_SYSTEM.md

The visual contract for Nest. Apple-grade restraint, Tesla-grade confidence. Light by default with a true dark mode. One brand accent: green. Heavy negative space. One primary action per view. Every color and size below is a token. Components pull tokens, never raw hex.

Calibration note: do not build the generic "near-black page with one acid-green accent" look. Nest is light-first, soft, and premium. Green is rich forest-emerald, used with restraint, never neon.

## 1. Color tokens

Define in `src/index.css` using Tailwind v4 `@theme`. Names map one to one to CSS variables.

### Brand green (the only accent)
```
--green-50:  #EAFBF0
--green-100: #D2F4DE
--green-200: #A8E9C0
--green-300: #6FD89A
--green-400: #37C871
--green-500: #1FA85A   /* primary action */
--green-600: #178A49
--green-700: #147A45   /* text on light, deep accents */
--green-800: #0F5530
--green-900: #0A3B22
```

### Semantic
```
--accent:        var(--green-500)
--accent-strong: var(--green-700)
--positive:      var(--green-500)   /* under budget, growth */
--warning:       #FF9F0A            /* 80 to 100 percent of budget, attention */
--danger:        #FF3B30            /* over budget overflow, destructive */
--info:          #0A84FF            /* used sparingly, links only if needed */
```

### Neutrals (light)
```
--bg:        #F5F5F7   /* app background, Apple off-white */
--surface:   #FFFFFF   /* cards */
--surface-2: #FBFBFD   /* nested surfaces */
--ink:       #1C1C1E   /* primary text */
--ink-2:     #3A3A3C   /* secondary text */
--muted:     #8E8E93   /* tertiary text, captions */
--line:      #E5E5EA   /* hairlines, borders */
--line-2:    #EFEFF4
```

### Neutrals (dark)  -> applied under `:root[data-theme="dark"]`
```
--bg:        #000000
--surface:   #1C1C1E
--surface-2: #2C2C2E
--ink:       #F5F5F7
--ink-2:     #D1D1D6
--muted:     #8E8E93
--line:      #38383A
--line-2:    #2C2C2E
```
In dark mode, lift the brand to `--green-400` for primary actions so it stays vivid on black.

### Category palette (for chips and the dashboard only, not chrome)
Housing #1FA85A, Childcare #30B0C7, Transportation #5E5CE6, Debt #64748B, Utilities #5AC8FA, Insurance #FF9F0A, Subscriptions #BF5AF2, Groceries #34C759, Dining #FF9500, Personal Care #FF2D55, Health #30D158, Other #8E8E93, Savings #147A45. Each chip uses the color at 12 percent opacity for fill and full strength for text and icon.

## 2. Typography

Display and UI face: Inter (variable). Load `Inter` via the `@fontsource-variable/inter` package or self-host. Set `font-feature-settings: "cv01","cv03","ss01"` for the more geometric Inter. Numerals use `font-variant-numeric: tabular-nums` everywhere money appears.

Type scale (clamped, mobile to desktop). Negative letter-spacing on display sizes.
```
--text-display:  clamp(34px, 8vw, 52px); weight 700; letter-spacing -0.022em; line-height 1.04
--text-title:    28px; weight 700; letter-spacing -0.02em
--text-h2:       22px; weight 650; letter-spacing -0.015em
--text-h3:       17px; weight 600; letter-spacing -0.01em
--text-body:     16px; weight 450; letter-spacing -0.006em; line-height 1.45
--text-callout:  15px; weight 500
--text-caption:  13px; weight 500; color var(--muted)
--text-mono-num: 17px; tabular-nums; weight 600   /* money figures */
```
Money figures (balances, projections) use tabular numerals and the deep ink color. Large projection figures may use `--text-display` size with tabular-nums.

## 3. Spacing, radius, shadow, motion

Spacing scale (px): 2, 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Generous. Cards breathe.

Radius: `--r-sm: 8px`, `--r-md: 12px`, `--r-lg: 16px`, `--r-xl: 24px`, `--r-pill: 999px`. Cards use `--r-lg` or `--r-xl`. Buttons use `--r-pill` or `--r-md`.

Shadow (soft, never heavy):
```
--shadow-sm: 0 1px 2px rgba(16,24,40,0.05)
--shadow-md: 0 6px 20px rgba(16,24,40,0.08)
--shadow-lg: 0 18px 48px rgba(16,24,40,0.12)
```
Glassmorphism: subtle. `background: color-mix(in srgb, var(--surface) 72%, transparent); backdrop-filter: blur(18px) saturate(140%);` for the tab bar and sticky headers only. Not on content cards.

Motion: spring-like ease, 200 to 400 ms.
```
--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)
--dur-fast: 180ms
--dur: 280ms
--dur-slow: 420ms
```
Always wrap motion in `@media (prefers-reduced-motion: reduce)` to disable transforms and counting animations.

## 4. Core components

Build these primitives first in `src/components`.

- **Button**: variants primary (green fill, white text, `--r-pill`), secondary (surface fill, hairline border, ink text), ghost (text only), destructive (danger text, no fill until hover). Sizes md and lg. Press state scales to 0.98 over `--dur-fast`. One primary per view.
- **Card**: surface, `--r-xl`, `--shadow-sm`, 20 to 24 px padding. Optional header row with title and one trailing action.
- **Field**: labelled input with a large numeric variant for the amount. Money input is big, centered, tabular-nums, with a leading green dollar glyph. Inline validation copy in danger color, plain language.
- **Money**: renders a number as currency with tabular-nums; props for size and tone (default ink, positive green, negative danger).
- **ProgressBar**: custom SVG. Track in `--line`, fill in green under 80 percent, amber 80 to 100, red over 100 with a distinct darker-red overflow segment past the cap. Animated width on mount via `--ease-spring`. Always renders a numeric label beside it (for example "1,240 of 1,000, 124 percent"). Color is never the only signal.
- **GoalRing**: circular SVG progress with the goal color, a center figure (current over target), and a small projected-date caption.
- **Stat**: a label, a big tabular-num value, and an optional delta chip.
- **Sheet**: bottom sheet on mobile (slides up, spring), centered modal on desktop. Used for add and edit flows.
- **TabBar**: fixed bottom, glass background, four destinations (Home, Dashboard, Recurring, Optimize), each an icon with a small label, the active one in brand green. Safe-area aware. There is no center add button, because logging lives on the Home screen itself.
- **CategoryChip**: a pill showing a category's icon and name, fill in the category color at 12 percent opacity, icon and text at full strength. The selected state lifts the fill and adds a 1.5 px ring in the category color, and is never signalled by color alone (the selected chip also shows a check). Used in the Quick Add chip row and on transaction rows.
- **QuickAdd**: the home logging surface and the most important flow in the app. A large autofocus amount field (tabular-nums, leading green dollar glyph, numeric keypad on mobile), a horizontal scrolling row of CategoryChips including the always-present Other, an optional camera button shown only when receipt scanning is enabled, and one primary "Log expense" button. The ImpactReveal renders live beneath the amount as soon as a number is entered. After logging, it shows a brief confirmation and resets for the next entry. It must feel instant: autofocus on open, no modal, no required fields beyond amount and category.
- **ImpactReveal**: see ARCHITECTURE section 4. Three figures with a count-up animation and a small SVG growth sparkline. Calm, not loud. The single most important component to get right.

## 5. Logos and marks (production SVG, paste as files)

### 5.1 App icon, maskable, full color
Use for PWA icons (export to 192 and 512 PNG via the build, and a maskable 512). Save the source as `src/assets/app-icon.svg`.
```svg
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Nest">
  <defs>
    <linearGradient id="nestGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#37C871"/>
      <stop offset="1" stop-color="#147A45"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#nestGrad)"/>
  <path d="M132 298 C 184 364, 328 364, 380 298" fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round"/>
  <path d="M158 320 C 198 360, 314 360, 354 320" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="20" stroke-linecap="round"/>
  <path d="M256 150 C 302 150, 332 190, 322 244 C 278 248, 246 216, 256 150 Z" fill="#FFFFFF"/>
  <path d="M256 158 C 256 198, 272 226, 298 238" fill="none" stroke="#147A45" stroke-width="8" stroke-linecap="round" opacity="0.45"/>
</svg>
```

### 5.2 Inline wordmark mark (monochrome, uses currentColor)
Pair with the text "Nest" in Inter 650, letter-spacing -0.02em. Save as `src/components/Logo.tsx` rendering this mark plus the word.
```svg
<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M5 17 C 8 21, 20 21, 23 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M14 5 C 17 5, 19 8, 18 12 C 15 12.5, 12.5 10, 14 5 Z" fill="currentColor"/>
</svg>
```

### 5.3 Share glyph
For the "share this app" action and any link affordance. Save as `src/components/icons/Share.tsx`.
```svg
<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="6" cy="11" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <circle cx="16" cy="5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <circle cx="16" cy="17" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path d="M8.1 9.9 13.9 6.1 M8.1 12.1 13.9 15.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>
```

### 5.4 Growth sparkline (used in ImpactReveal)
Render programmatically from the projection points so it matches the real numbers. Stroke `--green-500`, 2.5 px, with a soft area fill at 10 percent opacity below the line, and a single end dot. No axes, no gridlines. It is a gesture, not a chart.

### 5.5 Scan glyph (optional receipt capture)
Shown on the Quick Add only when receipt scanning is enabled. Save as `src/components/icons/Scan.tsx`. Uses `currentColor` so it inherits the action tint.
```svg
<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M3 8 V5.5 A2.5 2.5 0 0 1 5.5 3 H8 M14 3 H16.5 A2.5 2.5 0 0 1 19 5.5 V8 M19 14 V16.5 A2.5 2.5 0 0 1 16.5 19 H14 M8 19 H5.5 A2.5 2.5 0 0 1 3 16.5 V14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="11" cy="11" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
</svg>
```

## 6. Iconography
One in-house custom SVG family, no icon library. Every glyph composes the shared frame in `src/components/icons/base.tsx`: a 24px grid, a 1.8 stroke, round caps and joins, sized 20 to 24, tinting to the single green accent through `currentColor`. The family lives in `src/components/icons/` (nav chrome in `nav.tsx`, category glyphs in `categories.tsx`, common UI glyphs in `ui.tsx`, the receipt scan glyph in `Scan.tsx`). The multi-color Google brand mark in `Google.tsx` is the one deliberate exception, since a brand mark must keep its brand colors.

All category icons resolve through one map in `src/config/icons.ts` keyed by the icon strings the seed uses, so every seeded category renders. The keys map to these custom components: home to HousingIcon, stroller to ChildcareIcon, car to TransportationIcon, receipt to ReceiptIcon, bolt to UtilitiesIcon, shield to InsuranceIcon, repeat to SubscriptionsIcon, cart to GroceriesIcon, fork to DiningIcon, sparkles to PersonalIcon, heart to HealthIcon, dots to DotsIcon, leaf to LeafIcon. Unknown keys fall back to DotsIcon so the UI never crashes on a missing icon.

Chrome icons (not category keys): HomeIcon for Home, DashboardIcon for Spending, HouseKeyIcon for House, SettingsIcon for the header gear, MenuIcon for the hamburger, CloseIcon for dismiss, PlusIcon for the floating Log action and add buttons, the chevrons, CheckIcon, SparkleIcon, CalendarIcon, plus SunIcon/MoonIcon for the theme toggle and AlertIcon for errors, all from the same family.

## 7. Layout patterns
- Mobile: single column, 16 px gutters, content max width 430 px centered on larger phones. Sticky glass header with the month and a settings affordance. Bottom tab bar.
- Desktop: a 72 px side rail of icons, content centered at 720 px, optional right context column at 320 px on the Dashboard.
- The Dashboard hero is the house-runway card, not a generic balance number. Lead with the future, since the future is the product.

## 8. Accessibility floor
Visible focus rings in `--green-500` at 2 px offset. All inputs labelled. Hit targets at least 44 px. Contrast at least 4.5 to 1 for body text. Respect `prefers-reduced-motion`. Never encode meaning in color alone; pair with a number, label, or icon.

## 9. Copy voice
Plain, warm, exact. Sentence case. Active voice. No em dashes, no en dashes, no emoji. Buttons name the outcome. Empty states invite an action ("No expenses yet this month. Log your first one."). Errors say what happened and how to fix it, in the app's voice, never apologizing.
