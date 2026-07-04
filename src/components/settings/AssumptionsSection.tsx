import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from '../icons/ui'
import { useSettings } from '../../hooks/useSettings'
import { useGoals } from '../../hooks/useGoals'
import { useHouseModel } from '../../hooks/useHouseModel'
import { useToday } from '../../hooks/useToday'
import { formatCurrency, formatDate, groupAmount, parseAmount } from '../../lib/format'
import { monthsUntil } from '../../lib/money'
import { DEFAULTS } from '../../config/app'
import { Card } from '../Card'
import { Button } from '../Button'
import { Field } from '../Field'
import { Segmented } from '../Segmented'
import { Spinner } from '../Spinner'
import type { HouseholdSettings } from '../../types'

// 0.065 becomes "6.5"; "6.5" becomes 0.065. Keeps full precision (no float noise)
// so a finer stored rate like 0.06875 round-trips without silently rounding.
const decimalToPercentString = (decimal: number) => String(Math.round(decimal * 1e7) / 1e5)
const percentStringToDecimal = (value: string) => Number.parseFloat(value) / 100
const onlyNumber = (value: string) => value.replace(/[^0-9.]/g, '')

// A fingerprint of the settings fields this form seeds from. Used as the form key so a
// change saved from another device (or a Plaid-driven update) re-seeds the inputs instead
// of leaving them on the values captured at mount.
function settingsFingerprint(s: HouseholdSettings): string {
  return [
    s.assumedAnnualReturn,
    s.mortgageRateAssumption,
    s.propertyTaxRateAssumption,
    s.downPaymentReturnAssumption,
    s.annualHomeInsuranceAssumption,
    s.loanTermYears,
    s.targetPitiMin,
    s.targetPitiMax,
    s.targetPiti,
    s.downPaymentTarget,
    s.housePurchaseTargetDate,
    s.targetHomePrice ?? '',
    s.houseContributionMonthly ?? '',
  ].join('|')
}

export function AssumptionsSection() {
  const { settings, error, update } = useSettings()
  // The Saved check lives here, above the form: a successful save changes the
  // settings fingerprint and remounts the form, which would wipe a child-held flag
  // before it ever showed.
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (savedTimer.current != null) window.clearTimeout(savedTimer.current)
  }, [])
  function showSaved() {
    setSaved(true)
    if (savedTimer.current != null) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaved(false), 1600)
  }
  // The computed monthly surplus, shown as the default when no contribution is set,
  // plus the goals so a new down payment target also updates the House goal: the two
  // are the same number everywhere in the app.
  const { plan, goals, houseGoalId } = useHouseModel()
  const { update: updateGoal } = useGoals()
  const houseGoal = goals.find((g) => g.id === houseGoalId) ?? null
  return (
    <Card title="Budget and projections">
      {error ? (
        <p role="alert" className="py-4 text-callout text-danger">
          Could not load settings. Check your connection.
        </p>
      ) : !settings ? (
        <div role="status" className="flex items-center gap-2 py-4 text-muted">
          <Spinner size={16} />
          <span className="text-callout">Loading</span>
        </div>
      ) : (
        <AssumptionsForm
          key={settingsFingerprint(settings)}
          settings={settings}
          surplusDefault={plan?.availableForHouseMonthly ?? null}
          saving={update.isPending}
          saved={saved}
          onDirty={() => setSaved(false)}
          error={update.isError}
          onSave={async (patch) => {
            // Await the settings write so the confirmation only shows after it lands;
            // a failure rejects and the mutation's error copy shows instead.
            await update.mutateAsync(patch)
            showSaved()
            // The House goal mirrors the down payment target and purchase date, so a
            // save here keeps the goal doc in step (and the grids sync the reverse).
            if (houseGoal) {
              const goalPatch: { target?: number; targetDate?: string } = {}
              if (typeof patch.downPaymentTarget === 'number' && patch.downPaymentTarget !== houseGoal.target) {
                goalPatch.target = patch.downPaymentTarget
              }
              if (
                typeof patch.housePurchaseTargetDate === 'string' &&
                patch.housePurchaseTargetDate !== houseGoal.targetDate
              ) {
                goalPatch.targetDate = patch.housePurchaseTargetDate
              }
              if (Object.keys(goalPatch).length > 0) updateGoal.mutate({ id: houseGoal.id, patch: goalPatch })
            }
          }}
        />
      )}
    </Card>
  )
}

function AssumptionsForm({
  settings,
  surplusDefault,
  saving,
  saved,
  onDirty,
  error,
  onSave,
}: {
  settings: HouseholdSettings
  surplusDefault: number | null
  saving: boolean
  saved: boolean
  onDirty: () => void
  error: boolean
  onSave: (patch: Partial<HouseholdSettings>) => Promise<void>
}) {
  const [houseContribution, setHouseContribution] = useState(
    settings.houseContributionMonthly != null ? groupAmount(String(settings.houseContributionMonthly)) : '',
  )
  const [annualReturn, setAnnualReturn] = useState(decimalToPercentString(settings.assumedAnnualReturn))
  const [mortgageRate, setMortgageRate] = useState(decimalToPercentString(settings.mortgageRateAssumption))
  const [propertyTax, setPropertyTax] = useState(decimalToPercentString(settings.propertyTaxRateAssumption))
  const [downReturn, setDownReturn] = useState(decimalToPercentString(settings.downPaymentReturnAssumption))
  const [insurance, setInsurance] = useState(groupAmount(String(settings.annualHomeInsuranceAssumption)))
  const [term, setTerm] = useState(String(settings.loanTermYears))
  const [pitiMin, setPitiMin] = useState(groupAmount(String(settings.targetPitiMin)))
  const [pitiMax, setPitiMax] = useState(groupAmount(String(settings.targetPitiMax)))
  const [targetPiti, setTargetPiti] = useState(groupAmount(String(settings.targetPiti ?? DEFAULTS.targetPiti)))
  const [downPayment, setDownPayment] = useState(groupAmount(String(settings.downPaymentTarget)))
  const [targetDate, setTargetDate] = useState(settings.housePurchaseTargetDate)
  const [showTargetHome, setShowTargetHome] = useState(settings.targetHomePrice != null)
  const [targetHomePrice, setTargetHomePrice] = useState(
    settings.targetHomePrice != null ? groupAmount(String(settings.targetHomePrice)) : '',
  )
  const [showAdvanced, setShowAdvanced] = useState(false)
  const today = useToday()

  // Live horizon for the target purchase date: how many months it gives a monthly
  // saving to compound into the down payment. Drives every house number, so we show
  // it here and flag a date that is today or already past.
  const horizonMonths = targetDate.length > 0 ? monthsUntil(targetDate, today) : 0
  const horizonPast = targetDate.length > 0 && horizonMonths <= 0
  const horizonRounded = Math.max(1, Math.round(horizonMonths))

  const ar = percentStringToDecimal(annualReturn)
  const mr = percentStringToDecimal(mortgageRate)
  const pt = percentStringToDecimal(propertyTax)
  const dr = percentStringToDecimal(downReturn)
  const ins = parseAmount(insurance)
  const tm = Number.parseInt(term, 10)
  const pMin = parseAmount(pitiMin)
  const pMax = parseAmount(pitiMax)
  const pTarget = parseAmount(targetPiti)
  const dp = parseAmount(downPayment)
  const homePrice = parseAmount(targetHomePrice)
  const hc = parseAmount(houseContribution)
  const houseContributionOk = houseContribution.trim() === '' || (Number.isFinite(hc) && hc >= 0)

  const rateOk = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1
  const valid =
    houseContributionOk &&
    rateOk(ar) &&
    rateOk(mr) &&
    rateOk(pt) &&
    rateOk(dr) &&
    Number.isFinite(ins) &&
    ins >= 0 &&
    Number.isInteger(tm) &&
    tm >= 1 &&
    tm <= 50 &&
    Number.isFinite(pMin) &&
    pMin > 0 &&
    Number.isFinite(pMax) &&
    pMax >= pMin &&
    Number.isFinite(pTarget) &&
    pTarget > 0 &&
    pTarget >= pMin &&
    pTarget <= pMax &&
    Number.isFinite(dp) &&
    dp > 0 &&
    (!showTargetHome || (Number.isFinite(homePrice) && homePrice > 0)) &&
    targetDate.length > 0

  async function handleSave() {
    if (!valid) return
    try {
      await onSave({
        assumedAnnualReturn: ar,
        mortgageRateAssumption: mr,
        propertyTaxRateAssumption: pt,
        downPaymentReturnAssumption: dr,
        annualHomeInsuranceAssumption: Math.round(ins * 100) / 100,
        loanTermYears: tm,
        targetPiti: Math.round(pTarget * 100) / 100,
        targetPitiMin: Math.round(pMin * 100) / 100,
        targetPitiMax: Math.round(pMax * 100) / 100,
        downPaymentTarget: Math.round(dp * 100) / 100,
        // Optional: when off, undefined removes the field so the dashboard hides the
        // target home price marker. The plan is the down payment goal, not a price.
        targetHomePrice: showTargetHome ? Math.round(homePrice * 100) / 100 : undefined,
        // Optional: blank uses the computed monthly surplus as the house contribution.
        houseContributionMonthly: houseContribution.trim() === '' ? undefined : Math.round(hc * 100) / 100,
        housePurchaseTargetDate: targetDate,
      })
    } catch {
      // The mutation's error flag renders "Could not save. Try again." below; never
      // show Saved for a write that did not land.
      return
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Assumed annual return (percent)"
        inputMode="decimal"
        numeric
        value={annualReturn}
        onChange={(e) => {
          setAnnualReturn(onlyNumber(e.target.value))
          onDirty()
        }}
        hint="Drives the invest-instead projections."
      />
      <Field
        label="Target monthly home payment"
        inputMode="decimal"
        numeric
        value={targetPiti}
        onChange={(e) => {
          setTargetPiti(groupAmount(e.target.value))
          onDirty()
        }}
        error={
          Number.isFinite(pTarget) && Number.isFinite(pMin) && Number.isFinite(pMax) && (pTarget < pMin || pTarget > pMax)
            ? 'Keep the payment between the minimum and maximum.'
            : undefined
        }
        hint={
          Number.isFinite(pTarget) && pTarget > 0 ? (
            <>
              The full monthly payment (loan, taxes, and insurance) we plan for. We use{' '}
              <span className="tnum">{formatCurrency(pTarget, { cents: false })}</span> a month to set the home price
              we can afford.
            </>
          ) : (
            'The full monthly payment (loan, taxes, and insurance) we plan for. It sets the home price we can afford.'
          )
        }
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-2">Show a target home price</span>
        <Segmented
          value={showTargetHome ? 'on' : 'off'}
          onChange={(next) => {
            setShowTargetHome(next === 'on')
            onDirty()
          }}
          ariaLabel="Show a target home price"
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
        <p className="text-caption text-muted">
          Optional. Adds a target home price marker on the house meter. The plan stays the down payment goal.
        </p>
      </div>
      {showTargetHome && (
        <Field
          label="Target home price"
          inputMode="decimal"
          numeric
          value={targetHomePrice}
          onChange={(e) => {
            setTargetHomePrice(groupAmount(e.target.value))
            onDirty()
          }}
          hint="The marker on the home affordability gauge."
        />
      )}
      <div className="flex flex-col gap-1.5">
        <Field
          label="House purchase target date"
          type="date"
          value={targetDate}
          onChange={(e) => {
            setTargetDate(e.target.value)
            onDirty()
          }}
          hint="Drives every house number: the down payment we build by then, and the home price that supports."
        />
        {horizonPast ? (
          <p className="text-caption text-danger">
            This date is today or in the past. Pick a future date so the home numbers are real.
          </p>
        ) : (
          targetDate.length > 0 && (
            <p className="text-caption text-muted">
              About <span className="tnum">{horizonRounded}</span> {horizonRounded === 1 ? 'month' : 'months'} from
              now, {formatDate(targetDate, 'month')}.
            </p>
          )
        )}
      </div>

      <Field
        label="Down payment goal"
        inputMode="decimal"
        numeric
        value={downPayment}
        onChange={(e) => {
          setDownPayment(groupAmount(e.target.value))
          onDirty()
        }}
        hint="The total we are saving for the down payment. Sets the house progress and the pace to our date."
      />

      <Field
        label="Monthly house contribution"
        inputMode="decimal"
        numeric
        placeholder={surplusDefault != null ? String(Math.round(surplusDefault)) : '0'}
        value={houseContribution}
        onChange={(e) => {
          setHouseContribution(groupAmount(e.target.value))
          onDirty()
        }}
        hint="Leave blank to use our default: our House Savings transfers if we have set any, otherwise the money left over each month. A value here overrides both. This sets how fast we reach the home."
      />

      <button
        type="button"
        aria-expanded={showAdvanced}
        aria-controls="advanced-assumptions"
        onClick={() => setShowAdvanced((v) => !v)}
        className="self-start rounded-md text-callout font-medium text-accent-strong transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {showAdvanced ? 'Hide advanced assumptions' : 'Show advanced assumptions'}
      </button>

      {showAdvanced && (
        <div id="advanced-assumptions" className="flex flex-col gap-4">
          <Field
            label="Mortgage rate (percent)"
            inputMode="decimal"
            numeric
            value={mortgageRate}
            onChange={(e) => {
              setMortgageRate(onlyNumber(e.target.value))
              onDirty()
            }}
          />
          <Field
            label="Property tax rate (percent)"
            inputMode="decimal"
            numeric
            value={propertyTax}
            onChange={(e) => {
              setPropertyTax(onlyNumber(e.target.value))
              onDirty()
            }}
          />
          <Field
            label="Down payment return (percent)"
            inputMode="decimal"
            numeric
            value={downReturn}
            onChange={(e) => {
              setDownReturn(onlyNumber(e.target.value))
              onDirty()
            }}
            hint="The de-risked return on savings set aside for the down payment."
          />
          <Field
            label="Home insurance per year"
            inputMode="decimal"
            numeric
            value={insurance}
            onChange={(e) => {
              setInsurance(groupAmount(e.target.value))
              onDirty()
            }}
          />
          <Field
            label="Loan term (years)"
            type="number"
            inputMode="numeric"
            numeric
            min={1}
            max={50}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value)
              onDirty()
            }}
          />
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <Field
              label="Minimum monthly payment"
              inputMode="decimal"
              numeric
              value={pitiMin}
              onChange={(e) => {
                setPitiMin(groupAmount(e.target.value))
                onDirty()
              }}
            />
            <Field
              label="Maximum monthly payment"
              inputMode="decimal"
              numeric
              value={pitiMax}
              onChange={(e) => {
                setPitiMax(groupAmount(e.target.value))
                onDirty()
              }}
              error={Number.isFinite(pMax) && Number.isFinite(pMin) && pMax < pMin ? 'Maximum must be at least the minimum.' : undefined}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button disabled={!valid || saving} onClick={handleSave}>
          {saving ? 'Saving' : 'Save assumptions'}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-callout text-positive-strong">
            <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
            Saved
          </span>
        )}
        {error && (
          <span role="alert" className="text-callout text-danger">
            Could not save. Try again.
          </span>
        )}
      </div>
    </div>
  )
}
