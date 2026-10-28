import { describe, expect, it } from 'vitest'
import { accountLine } from './subscriptions'

describe('accountLine', () => {
  const account = { kind: 'logged_in' as const, email: 'dev@example.com', plan: 'max', checkedAt: 1 }

  it('reads email, plan and org', () => {
    expect(accountLine({ ...account, orgName: 'Acme' })).toBe('dev@example.com · Max plan · Acme')
  })

  it("drops a personal org that only repeats the email, and anything not reported", () => {
    expect(accountLine({ ...account, orgName: "dev@example.com's Organization" })).toBe('dev@example.com · Max plan')
    expect(accountLine({ ...account, email: null, plan: null, orgName: null })).toBeNull()
    expect(accountLine({ kind: 'logged_out', checkedAt: 1 })).toBeNull()
  })
})
