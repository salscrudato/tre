import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  looksLikeUrl,
  normalizeUrl,
  planPurchase,
  resolveProduct,
  type PlanOption,
  type PlanVerdict,
  type ResolveResult,
} from '../services/plan'
import { useHouseModel } from '../hooks/useHouseModel'
import { futureValueOneTime, monthsUntil } from '../lib/money'
import {
  compactScale,
  formatCompactScaled,
  formatCurrency,
  formatDate,
  groupAmount,
  parseAmount,
  titleCase,
} from '../lib/format'
import { cn } from '../lib/cn'
import { DEFAULTS } from '../config/app'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Money } from '../components/Money'
import { Spinner } from '../components/Spinner'
import { Link } from 'react-router-dom'
import { TagIcon } from '../components/icons/nav'
import { AlertIcon, CheckIcon, ChevronLeftIcon, ExternalLinkIcon } from '../components/icons/ui'

// The research wait, narrated plainly. Text swap on an interval, no animation, so
// reduced motion needs no special case.
const STAGES = ['Checking current prices', 'Comparing quality alternatives', 'Weighing the verdict']

function PlanProgress() {
  const [stage, setStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    // Advance through the stages once and hold the last. The search runs 30s to a couple of
    // minutes, so a looping narrator would replay the first stage and read as stuck.
    const stageId = window.setInterval(
      () => setStage((current) => Math.min(current + 1, STAGES.length - 1)),
      4000,
    )
    const tickId = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => {
      window.clearInterval(stageId)
      window.clearInterval(tickId)
    }
  }, [])
  return (
    <span className="text-callout">
      {STAGES[stage]}
      {elapsed >= 15 && <span className="text-muted"> (still working, {elapsed}s)</span>}
    </span>
  )
}

const VERDICT_COPY: Record<PlanVerdict, { label: string; tone: string }> = {
  buy: { label: 'Worth buying', tone: 'text-positive-strong' },
  wait: { label: 'Wait for a better price', tone: 'text-warning-strong' },
  skip: { label: 'Skip it', tone: 'text-danger' },
}

// The purchase planner: name a product, or paste a product link and the page's own
// name and price fill in automatically (structured page data, cached, sub-second on
// most retailers). Prices come from the page, the live web search, or what you type,
// never from a model's memory; the invest-instead line is computed here from our own
// return assumption.
export default function Plan() {
  const { settings, today, plan: householdPlan } = useHouseModel()
  // Our fixed monthly house saving: the yardstick every price is read against, and
  // context passed to the research so the verdict knows the goal.
  const houseMonthly = householdPlan?.houseContributionMonthly ?? 0
  const annualReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn
  const downReturn = settings?.downPaymentReturnAssumption ?? DEFAULTS.downPaymentReturnAssumption
  const targetDate = settings?.housePurchaseTargetDate ?? ''
  // Years until the house purchase, for the "toward the home" framing on savings.
  // When the date is past or unset, the framing falls back to a ten year horizon.
  const houseYears = useMemo(() => {
    const months = targetDate ? monthsUntil(targetDate, today) : 0
    return months > 0 ? months / 12 : null
  }, [targetDate, today])

  const [input, setInput] = useState('')
  const [budget, setBudget] = useState('')
  const [asked, setAsked] = useState('')
  // The grounded price snapshotted when the research fired, so a later edit to the
  // link or price fields can never mutate an already-returned verdict's numbers.
  const [askedPrice, setAskedPrice] = useState<number | null>(null)
  // A resolved link, editable before researching: the page's name and price prefill,
  // and the user can correct either. Null until a link resolves.
  const [resolvedName, setResolvedName] = useState('')
  const [resolvedPrice, setResolvedPrice] = useState('')
  const [resolvedFrom, setResolvedFrom] = useState<{ retailer: string; url: string } | null>(null)
  const [resolveNote, setResolveNote] = useState<string | null>(null)

  const resolve = useMutation({
    mutationFn: (url: string) => resolveProduct(url),
    meta: { suppressErrorToast: true },
    onSuccess: (result: ResolveResult, url: string) => {
      if (result.ok) {
        // A price in another currency is not a confirmed dollar figure; ask for it.
        const usdPrice = result.price != null && (result.currency == null || result.currency === 'USD')
        setResolvedName(result.name)
        setResolvedPrice(usdPrice ? groupAmount(String(result.price)) : '')
        setResolvedFrom({ retailer: result.retailer, url })
        setResolveNote(
          usdPrice
            ? null
            : result.price != null
              ? `The page lists ${result.price} ${result.currency ?? ''}. Enter the dollar price below so the research is grounded.`
              : 'Could not confirm the price on that page. Enter it below so the research is grounded.',
        )
      } else {
        setResolvedName('')
        setResolvedPrice('')
        setResolvedFrom(null)
        setResolveNote(`${result.reason}`)
      }
    },
  })

  const research = useMutation({
    mutationFn: planPurchase,
    // The page renders its own error card; the global save toast would mislead.
    meta: { suppressErrorToast: true },
  })

  const inputIsUrl = looksLikeUrl(input)
  const resolving = resolve.isPending

  function handleResolve() {
    if (!inputIsUrl || resolving || research.isPending) return
    setResolveNote(null)
    resolve.mutate(normalizeUrl(input))
  }

  // Paste a link and it resolves immediately, no extra tap.
  function handlePaste(text: string) {
    if (looksLikeUrl(text) && !resolving && !research.isPending) {
      setResolveNote(null)
      resolve.mutate(normalizeUrl(text))
    }
  }

  function handleResearch() {
    if (research.isPending || resolving) return
    const name = (inputIsUrl ? resolvedName : input).trim()
    if (name.length < 2) return
    const budgetValue = parseAmount(budget)
    const priceValue = parseAmount(resolvedPrice)
    const knownPrice = inputIsUrl && Number.isFinite(priceValue) && priceValue > 0 ? priceValue : undefined
    setAsked(name)
    setAskedPrice(knownPrice ?? null)
    research.mutate({
      product: name,
      ...(Number.isFinite(budgetValue) && budgetValue > 0 ? { budget: budgetValue } : {}),
      ...(knownPrice != null ? { knownPrice } : {}),
      ...(inputIsUrl && resolvedFrom ? { sourceUrl: resolvedFrom.url } : {}),
      ...(houseMonthly > 0 ? { houseMonthly } : {}),
    })
  }

  const canResearch = (inputIsUrl ? resolvedName : input).trim().length >= 2 && !research.isPending && !resolving

  const plan = research.data ?? null
  // The price the verdict hangs on: the page price the research was grounded in
  // (snapshotted at research time), else the LOWEST exact price found, else the
  // typical price. Live field edits after the fact never move a returned verdict.
  const anchorPrice = useMemo(() => {
    if (!plan) return null
    if (askedPrice != null) return askedPrice
    const exact = plan.options.filter((o) => o.kind === 'exact' && o.price != null).map((o) => o.price as number)
    return exact.length > 0 ? Math.min(...exact) : plan.typicalPrice
  }, [plan, askedPrice])

  // Alternatives sorted by what they save against the planned purchase, biggest
  // saving first. Rows without a price sink to the bottom.
  const alternatives = useMemo(() => {
    if (!plan) return []
    return plan.options
      .filter((o) => o.kind === 'alternative')
      .map((option) => ({
        option,
        saving:
          option.price != null && anchorPrice != null && option.price < anchorPrice
            ? anchorPrice - option.price
            : null,
      }))
      .sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1))
  }, [plan, anchorPrice])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Plan a purchase</h1>

      <Link
        to="/spending"
        aria-label="Back to Spending"
        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-callout text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ChevronLeftIcon size={18} strokeWidth={2} aria-hidden="true" />
        Spending
      </Link>

      <Card>
        <div className="flex items-center gap-2 text-accent-strong">
          <TagIcon size={18} />
          <span className="text-caption font-semibold uppercase tracking-wide">Plan a purchase</span>
        </div>
        <p className="mt-2 text-body text-ink-2">
          Name it, or paste a product link and we read the name and price straight off the page. Then we check
          current prices, compare quality alternatives, and say whether to buy, wait, or skip.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Field
            label="Product name or link"
            placeholder="Dyson V15, or paste an Amazon or store link..."
            value={input}
            onChange={(event) => {
              // Any edit invalidates the resolution: a changed link must be re-read,
              // and a plain name must never carry a previous link's price.
              setInput(event.target.value)
              setResolvedName('')
              setResolvedPrice('')
              setResolvedFrom(null)
              setResolveNote(null)
            }}
            onPaste={(event) => handlePaste(event.clipboardData.getData('text'))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              if (inputIsUrl && !resolvedFrom) handleResolve()
              else handleResearch()
            }}
          />

          {resolving && (
            <p role="status" className="flex items-center gap-2 text-caption text-muted">
              <Spinner size={14} /> Reading the product page
            </p>
          )}

          {inputIsUrl && !resolving && !resolvedFrom && !resolveNote && (
            <Button variant="secondary" onClick={handleResolve}>
              Read the link
            </Button>
          )}

          {resolveNote && !resolving && (
            <p className="text-caption text-warning-strong">{resolveNote}</p>
          )}

          {/* The resolved product, editable before researching: the page's own name
              and price, corrected by hand if the page was wrong or hid its price. */}
          {inputIsUrl && (resolvedFrom || resolveNote) && !resolving && (
            <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
              {resolvedFrom && (
                <p className="text-caption text-muted">
                  From {resolvedFrom.retailer}
                  {resolvedPrice && ', price read from the page'}
                </p>
              )}
              <Field
                label="Product"
                placeholder="Product name"
                value={resolvedName}
                onChange={(event) => setResolvedName(event.target.value)}
              />
              <Field
                label={resolvedPrice ? 'Price on the page' : 'Price (confirm it)'}
                inputMode="decimal"
                numeric
                placeholder="0.00"
                value={resolvedPrice}
                onChange={(event) => setResolvedPrice(groupAmount(event.target.value))}
              />
            </div>
          )}

          <Field
            label="Budget (optional)"
            inputMode="decimal"
            numeric
            placeholder="0"
            value={budget}
            onChange={(event) => setBudget(groupAmount(event.target.value))}
          />
          <Button disabled={!canResearch} onClick={handleResearch}>
            Check the price
          </Button>
        </div>
      </Card>

      {research.isPending && (
        <Card>
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner size={20} />
            <PlanProgress />
          </div>
        </Card>
      )}

      {research.isError && (
        <Card>
          <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertIcon size={28} strokeWidth={1.8} className="text-danger" aria-hidden="true" />
            <p className="max-w-[34ch] text-callout text-danger">
              Could not research that right now. Try again.
            </p>
          </div>
        </Card>
      )}

      {plan && !research.isPending && (
        <>
          <Card>
            <p className="text-caption text-muted">{asked}</p>
            <p className={cn('mt-1 flex items-center gap-2 text-h2', VERDICT_COPY[plan.verdict].tone)}>
              {plan.verdict === 'buy' ? (
                <CheckIcon size={22} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <AlertIcon size={22} strokeWidth={2} aria-hidden="true" />
              )}
              {VERDICT_COPY[plan.verdict].label}
            </p>
            <p className="mt-3 text-body text-ink-2">{plan.summary}</p>
            {plan.verdict === 'wait' && plan.waitUntil && (
              <p className="mt-2 text-callout font-medium text-warning-strong">
                Check back: {plan.waitUntil}
              </p>
            )}
            {plan.typicalPrice != null && anchorPrice != null && anchorPrice < plan.typicalPrice && (
              <p className="mt-2 text-caption text-muted">
                Typically <span className="tnum">{formatCurrency(plan.typicalPrice, { cents: false })}</span>; this
                price <span className="tnum">{formatCurrency(anchorPrice, { cents: false })}</span>.
              </p>
            )}
            {/* The price in our own currency: how long our automatic house saving
                takes to earn it back. Computed here, never by the model. */}
            {anchorPrice != null && houseSavingTime(anchorPrice, houseMonthly) && (
              <p className="mt-2 text-caption text-muted">
                That price is {houseSavingTime(anchorPrice, houseMonthly)} of our automatic house saving.
              </p>
            )}
            {plan.tip && (
              <p className="mt-3 rounded-lg bg-surface-2 px-3.5 py-2.5 text-caption text-ink-2">
                <span className="font-semibold text-ink">One way to pay less:</span> {plan.tip}
              </p>
            )}
          </Card>

          {plan.options.some((o) => o.kind === 'exact') && (
            <Card title="Best price found">
              <ul className="flex flex-col gap-4">
                {plan.options
                  .filter((o) => o.kind === 'exact')
                  .map((option, index) => (
                    <OptionRow key={index} option={option} />
                  ))}
              </ul>
            </Card>
          )}

          {alternatives.length > 0 && (
            <Card title="Quality picks for less">
              <ul className="flex flex-col divide-y divide-line/70">
                {alternatives.map(({ option, saving }, index) => (
                  <AlternativeRow
                    key={index}
                    option={option}
                    saving={saving}
                    houseYears={houseYears}
                    downReturn={downReturn}
                    annualReturn={annualReturn}
                    targetDate={targetDate}
                  />
                ))}
              </ul>
            </Card>
          )}

          {anchorPrice != null && anchorPrice > 0 && (
            <Card>
              <span className="text-caption font-semibold uppercase tracking-wide text-wealth">
                Or invested instead
              </span>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {/* The product's signature horizons: 1, 10, and 30 years, matching the log-time reveal. */}
                {[1, 10, 30].map((years) => (
                  <div key={years} className="flex flex-col items-center gap-0.5">
                    <span className="tnum text-h3 text-wealth">
                      {formatCompactScaled(
                        futureValueOneTime(anchorPrice, years, annualReturn),
                        compactScale(futureValueOneTime(anchorPrice, years, annualReturn)),
                      )}
                    </span>
                    <span className="text-caption text-muted">{years} yr</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-caption text-muted">
                What <span className="tnum">{formatCurrency(anchorPrice, { cents: false })}</span> becomes at{' '}
                <span className="tnum">{Math.round(annualReturn * 1000) / 10}</span> percent a year. Not a reason to
                never buy anything, just the honest tradeoff.
              </p>
            </Card>
          )}

          <p className="px-1 text-caption text-muted">
            Prices come from the product page and a live web search just now. Tap through and confirm before buying.
          </p>
        </>
      )}

      {!plan && !research.isPending && !research.isError && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <TagIcon size={28} strokeWidth={1.6} className="text-muted" aria-hidden="true" />
            <p className="max-w-[34ch] text-callout text-muted">
              Thinking about a purchase? Check it here before it checks out our house fund.
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}

// A price expressed in our own currency: the time our automatic monthly house
// saving takes to cover it. Days when short, months when long, null when there is
// no saving pace to measure against.
function houseSavingTime(price: number, monthly: number): string | null {
  if (!(price > 0) || !(monthly > 0)) return null
  const days = price / (monthly / 30.44)
  if (days < 1) return 'less than a day'
  if (days < 10) return `about ${Math.round(days * 10) / 10} days`
  if (days < 60) return `about ${Math.round(days)} days`
  const months = days / 30.44
  return `about ${Math.round(months * 10) / 10} months`
}

function OptionRow({ option }: { option: PlanOption }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-callout font-medium text-ink">
          <span className="truncate">{option.name}</span>
          {option.url && <ExternalLinkIcon size={13} className="shrink-0 text-muted" aria-hidden="true" />}
        </span>
        <span className="text-caption text-muted">{option.why}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {option.price != null ? (
          <Money amount={option.price} cents={option.price % 1 !== 0} />
        ) : (
          <span className="text-caption text-muted">See listing</span>
        )}
        {option.retailer && <span className="text-caption text-muted">{option.retailer}</span>}
      </span>
    </>
  )
  return (
    <li>
      {option.url ? (
        <a
          href={option.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start justify-between gap-3 rounded-lg p-1 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {body}
        </a>
      ) : (
        <div className="flex items-start justify-between gap-3 p-1">{body}</div>
      )}
    </li>
  )
}

// One scannable alternative row: name and retailer on the left, its price and the
// saving against the planned purchase on the right, then one quiet line on what
// that saving does toward the home. Sorted upstream by saving, biggest first.
function AlternativeRow({
  option,
  saving,
  houseYears,
  downReturn,
  annualReturn,
  targetDate,
}: {
  option: PlanOption
  saving: number | null
  houseYears: number | null
  downReturn: number
  annualReturn: number
  targetDate: string
}) {
  // The saving grows at the de-risked rate until the house date; without a valid
  // date it shows the ten year invest-instead figure at the general return.
  const homeValue =
    saving != null && saving > 0
      ? houseYears != null
        ? futureValueOneTime(saving, houseYears, downReturn)
        : futureValueOneTime(saving, 10, annualReturn)
      : null
  const homeLabel =
    houseYears != null && targetDate
      ? `toward the home by ${formatDate(targetDate, 'month')}`
      : 'if invested for ten years'
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-callout font-medium text-ink">
            <span className="truncate">{titleCase(option.name)}</span>
            {option.url && <ExternalLinkIcon size={13} className="shrink-0 text-muted" aria-hidden="true" />}
          </span>
          {option.retailer && <span className="text-caption text-muted">{option.retailer}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {option.price != null ? (
            <Money amount={option.price} cents={option.price % 1 !== 0} />
          ) : (
            <span className="text-caption text-muted">See listing</span>
          )}
          {saving != null && saving > 0.5 && (
            <span className="tnum text-caption font-semibold text-positive-strong">
              Save {formatCurrency(saving, { cents: false })}
            </span>
          )}
        </span>
      </span>
      {homeValue != null && homeValue > 0 && (
        <span className="mt-1 block text-caption text-muted">
          That saving is worth <span className="tnum">{formatCurrency(homeValue, { cents: false })}</span> {homeLabel}.
        </span>
      )}
      <span className="mt-0.5 block text-caption text-muted">{option.why}</span>
    </>
  )
  return (
    <li>
      {option.url ? (
        <a
          href={option.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg p-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {body}
        </a>
      ) : (
        <div className="block p-2">{body}</div>
      )}
    </li>
  )
}
