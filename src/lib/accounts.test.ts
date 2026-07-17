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

// A generic set exercising every counting rule: two accounts count in full, one
// counts only its allocated slice, one is not flagged at all. The flagged amounts
// sum exactly to a 100,000 goal: 10,000 + 50,000 + 5,000 + 35,000.
const accounts: Account[] = [
  acct({ id: 'acct_cash', name: 'Cash reserve', type: 'cash', balance: 10000, countsTowardHouse: true }),
  acct({ id: 'acct_house', name: 'House fund', type: 'taxable', balance: 50000, countsTowardHouse: true }),
  acct({ id: 'acct_partner', name: 'Partner savings', type: 'cash', balance: 5000, countsTowardHouse: true }),
  acct({
    id: 'acct_build',
    name: 'Brokerage',
    type: 'taxable',
    balance: 80000,
    countsTowardHouse: true,
    houseAllocation: 35000,
  }),
  acct({ id: 'acct_self', name: 'Stock picks', type: 'taxable', balance: 7500, countsTowardHouse: false }),
]

describe('accountHouseAmount', () => {
  it('counts the full balance when flagged with no allocation', () => {
    expect(accountHouseAmount(accounts[0])).toBe(10000)
    expect(accountHouseAmount(accounts[1])).toBe(50000)
  })

  it('counts only the configured allocation when set', () => {
    expect(accountHouseAmount(accounts[3])).toBeCloseTo(35000, 2)
  })

  it('counts zero when not flagged', () => {
    expect(accountHouseAmount(accounts[4])).toBe(0)
  })

  it('never counts more than the balance', () => {
    expect(accountHouseAmount(acct({ balance: 100, countsTowardHouse: true, houseAllocation: 500 }))).toBe(100)
  })
})

describe('houseSavingsFromAccounts', () => {
  it('sums the flagged set to exactly the 100,000 down payment goal', () => {
    expect(houseSavingsFromAccounts(accounts)).toBeCloseTo(100000, 2)
  })

  it('splits the house money into stable cash and at-risk invested', () => {
    // Cash 10,000 plus partner savings 5,000 is stable; the 50,000 house fund plus the
    // 35,000 brokerage slice is invested. Together they are the full 100,000.
    expect(houseSavingsCashFromAccounts(accounts)).toBeCloseTo(15000, 2)
    expect(houseSavingsInvestedFromAccounts(accounts)).toBeCloseTo(85000, 2)
    expect(
      houseSavingsCashFromAccounts(accounts) + houseSavingsInvestedFromAccounts(accounts),
    ).toBeCloseTo(100000, 2)
  })
})

describe('primaryHouseAccountId', () => {
  it('prefers a fully counted account over a partially allocated one', () => {
    // Cash is first by the list, fully counted; it (not the allocated brokerage) takes a deposit.
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
