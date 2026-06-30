import { useState } from 'react'
import { CheckIcon } from '../icons/ui'
import { useSettings } from '../../hooks/useSettings'
import { useHouseModel } from '../../hooks/useHouseModel'
import { useToday } from '../../hooks/useToday'
import { formatCurrency, formatDate } from '../../lib/format'
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
  // The computed monthly surplus, shown as the default when no contribution is set.
  const { plan } = useHouseModel()
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
          error={update.isError}
          onSave={(patch) => update.mutate(patch)}
        />
      )}
    </Card>
  )
}

function AssumptionsForm({
  settings,
  surplusDefault,
  saving,
  error,
  onSave,
}: {
  settings: HouseholdSettings
  surplusDefault: number | null
  saving: boolean
  error: boolean
  onSave: (patch: Partial<HouseholdSettings>) => void
}) {
  const [houseContribution, setHouseContribution] = useState(
    settings.houseContributionMonthly != null ? String(settings.houseContributionMonthly) : '',
  )
  const [annualReturn, setAnnualReturn] = useState(decimalToPercentString(settings.assumedAnnualReturn))
  const [mortgageRate, setMortgageRate] = useState(decimalToPercentString(settings.mortgageRateAssumption))
  const [propertyTax, setPropertyTax] = useState(decimalToPercentString(settings.propertyTaxRateAssumption))
  const [downReturn, setDownReturn] = useState(decimalToPercentString(settings.downPaymentReturnAssumption))
  const [insurance, setInsurance] = useState(String(settings.annualHomeInsuranceAssumption))
  const [term, setTerm] = useState(String(settings.loanTermYears))
  const [pitiMin, setPitiMin] = useState(String(settings.targetPitiMin))
  const [pitiMax, setPitiMax] = useState(String(settings.targetPitiMax))
  const [targetPiti, setTargetPiti] = useState(String(settings.targetPiti ?? DEFAULTS.targetPiti))
  const [downPayment, setDownPayment] = useState(String(settings.downPaymentTarget))
  const [targetDate, setTargetDate] = useState(settings.housePurchaseTargetDate)
  const [showTargetHome, setShowTargetHome] = useState(settings.targetHomePrice != null)
  const [targetHomePrice, setTargetHomePrice] = useState(
    settings.targetHomePrice != null ? String(settings.targetHomePrice) : '',
  )
  const [saved, setSaved] = useState(false)
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
  const ins = Number.parseFloat(insurance)
  const tm = Number.parseInt(term, 10)
  const pMin = Number.parseFloat(pitiMin)
  const pMax = Number.parseFloat(pitiMax)
  const pTarget = Number.parseFloat(targetPiti)
  const dp = Number.parseFloat(downPayment)
  const homePrice = Number.parseFloat(targetHomePrice)
  const hc = Number.parseFloat(houseContribution)
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

  function handleSave() {
    if (!valid) return
    onSave({
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
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
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
          setSaved(false)
        }}
        hint="Drives the invest-instead projections."
      />
      <Field
        label="Target monthly home payment"
        inputMode="decimal"
        numeric
        value={targetPiti}
        onChange={(e) => {
          setTargetPiti(onlyNumber(e.target.value))
          setSaved(false)
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
            setSaved(false)
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
            setTargetHomePrice(onlyNumber(e.target.value))
            setSaved(false)
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
            setSaved(false)
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
          setDownPayment(onlyNumber(e.target.value))
          setSaved(false)
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
          setHouseContribution(onlyNumber(e.target.value))
          setSaved(false)
        }}
        hint={
          surplusDefault != null && surplusDefault > 0 ? (
            <>
              Leave blank to use the full money left over each month,{' '}
              <span className="tnum">{formatCurrency(surplusDefault, { cents: false })}</span>. This sets how fast we
              reach the home.
            </>
          ) : (
            'Leave blank to use the full money left over each month. This sets how fast we reach the home.'
          )
        }
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
              setSaved(false)
            }}
          />
          <Field
            label="Property tax rate (percent)"
            inputMode="decimal"
            numeric
            value={propertyTax}
            onChange={(e) => {
              setPropertyTax(onlyNumber(e.target.value))
              setSaved(false)
            }}
          />
          <Field
            label="Down payment return (percent)"
            inputMode="decimal"
            numeric
            value={downReturn}
            onChange={(e) => {
              setDownReturn(onlyNumber(e.target.value))
              setSaved(false)
            }}
            hint="The de-risked return on savings set aside for the down payment."
          />
          <Field
            label="Home insurance per year"
            inputMode="decimal"
            numeric
            value={insurance}
            onChange={(e) => {
              setInsurance(onlyNumber(e.target.value))
              setSaved(false)
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
              setSaved(false)
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Minimum monthly payment"
              inputMode="decimal"
              numeric
              value={pitiMin}
              onChange={(e) => {
                setPitiMin(onlyNumber(e.target.value))
                setSaved(false)
              }}
            />
            <Field
              label="Maximum monthly payment"
              inputMode="decimal"
              numeric
              value={pitiMax}
              onChange={(e) => {
                setPitiMax(onlyNumber(e.target.value))
                setSaved(false)
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
