import { describe, it, expect } from 'vitest'
import {
  accountHouseAmount,
  houseSavingsCashFromAccounts,
  houseSavingsFromAccounts,
  houseSavingsInvestedFromAccounts,
  primaryHouseAccountId,
} from './accounts'
import type { Account } from '../types'

const acct = (over: Partial<Account>): Account => ({
  id: 'a',
  name: 'Account',
  type: 'taxable',
  balance: 0,
  ...over,
})

// The real Betterment set, as corrected: House and Cash and Lisa count in full, Build
// Wealth counts only its allocated slice, Self Directed does not count at all.
const accounts: Account[] = [
  acct({ id: 'acct_cash', name: 'Joint Cash Reserve', type: 'cash', balance: 16000, countsTowardHouse: true }),
  acct({ id: 'acct_house', name: 'House (Betterment)', type: 'taxable', balance: 132449.28, countsTowardHouse: true }),
  acct({ id: 'acct_lisa', name: "Lisa's Savings", type: 'cash', balance: 6000, countsTowardHouse: true }),
  acct({
    id: 'acct_build',
    name: 'Build Wealth (Betterment)',
    type: 'taxable',
    balance: 154001.73,
    countsTowardHouse: true,
    houseAllocation: 95550.72,
  }),
  acct({ id: 'acct_self', name: 'Self Directed Investing', type: 'taxable', balance: 11608.35, countsTowardHouse: false }),
]

describe('accountHouseAmount', () => {
  it('counts the full balance when flagged with no allocation', () => {
    expect(accountHouseAmount(accounts[0])).toBe(16000)
    expect(accountHouseAmount(accounts[1])).toBe(132449.28)
  })

  it('counts only the configured allocation when set', () => {
    expect(accountHouseAmount(accounts[3])).toBeCloseTo(95550.72, 2)
  })

  it('counts zero when not flagged', () => {
    expect(accountHouseAmount(accounts[4])).toBe(0)
  })

  it('never counts more than the balance', () => {
    expect(accountHouseAmount(acct({ balance: 100, countsTowardHouse: true, houseAllocation: 500 }))).toBe(100)
  })
})

describe('houseSavingsFromAccounts', () => {
  it('sums the corrected set to exactly the 250,000 down payment goal', () => {
    expect(houseSavingsFromAccounts(accounts)).toBeCloseTo(250000, 2)
  })

  it('splits the house money into stable cash and at-risk invested', () => {
    // Cash 16,000 plus Lisa 6,000 is stable; House 132,449.28 plus the 95,550.72 Build
    // Wealth slice is invested. Together they are the full 250,000.
    expect(houseSavingsCashFromAccounts(accounts)).toBeCloseTo(22000, 2)
    expect(houseSavingsInvestedFromAccounts(accounts)).toBeCloseTo(228000, 2)
    expect(
      houseSavingsCashFromAccounts(accounts) + houseSavingsInvestedFromAccounts(accounts),
    ).toBeCloseTo(250000, 2)
  })
})

describe('primaryHouseAccountId', () => {
  it('prefers a fully counted account over a partially allocated one', () => {
    // Cash is first by our list, fully counted; it (not the allocated Build Wealth) takes a deposit.
    expect(primaryHouseAccountId(accounts)).toBe('acct_cash')
  })

  it('falls back to a flagged account when only partial ones exist', () => {
    const onlyPartial = [accounts[3]]
    expect(primaryHouseAccountId(onlyPartial)).toBe('acct_build')
  })

  it('is null when nothing is flagged', () => {
    expect(primaryHouseAccountId([accounts[4]])).toBeNull()
  })
})
