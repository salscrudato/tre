// App-wide constants and projection defaults for Tre.
// Renaming the app is a one-line change here (see CLAUDE.md).
//
// DEFAULTS mirror the household settings in seed/seed-data.json and feed every
// projection until a live household document overrides them at runtime. Keep the
// two in sync. Money values are whole dollars; rates are decimals (0.07 = 7 percent).

export const APP_NAME = 'Tre'

// The fixed household id. The seed creates this document and the app reads it.
export const HOUSEHOLD_ID = 'primary'

// A complete settings fallback (keys match HouseholdSettings exactly), so any
// projection is robust if a setting is ever absent.
export const DEFAULTS = {
  currency: 'USD',
  assumedAnnualReturn: 0.07,
  compoundingPerYear: 12,
  housePurchaseTargetDate: '2028-01-31',
  targetPitiMin: 5000,
  // The band's upper bound stays at or above the single target below, so the primary
  // target never sits outside its own advanced min/max band.
  targetPitiMax: 7000,
  // The single house affordability target: the monthly PITI the couple is solving
  // their max home price against. Drives the house meter and runway everywhere.
  targetPiti: 6000,
  mortgageRateAssumption: 0.065,
  loanTermYears: 30,
  propertyTaxRateAssumption: 0.023,
  annualHomeInsuranceAssumption: 2400,
  downPaymentTarget: 250000,
  downPaymentReturnAssumption: 0.03,
  discretionaryMonthlyBudget: 2500,
  // targetHomePrice is intentionally absent: the plan is the down payment goal, not a
  // home price. It is an optional setting the couple can turn on themselves.
} as const satisfies {
  currency: string
  assumedAnnualReturn: number
  compoundingPerYear: number
  housePurchaseTargetDate: string
  targetPitiMin: number
  targetPitiMax: number
  targetPiti: number
  mortgageRateAssumption: number
  loanTermYears: number
  propertyTaxRateAssumption: number
  annualHomeInsuranceAssumption: number
  downPaymentTarget: number
  downPaymentReturnAssumption: number
  discretionaryMonthlyBudget: number
  targetHomePrice?: number
}
