import type { AgentId } from './agents'

export type SubscriptionId = string & { __brand: 'SubscriptionId' }

export type AccountStatus =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'logged_in'; email: string | null; orgName: string | null; plan: string | null; checkedAt: number }
  | { kind: 'logged_out'; checkedAt: number }
  | { kind: 'error'; message: string; checkedAt: number }

export type Subscription = {
  id: SubscriptionId
  agentId: AgentId
  label: string
  /** Absolute, `~` expanded, normalized; unique per agent. */
  configDir: string
  createdAt: number
  account: AccountStatus
  /** Derived in main from the agent's account spec, never stored: the env rule lives only there. */
  loginCommand: string
}

export type SubscriptionsState = {
  subscriptions: Subscription[]
  /** The subscription a new thread starts on. */
  activeSubscriptionId: SubscriptionId | null
}

export type AddSubscriptionResult = { ok: true; subscription: Subscription } | { ok: false; error: string }

export function activeSubscription(state: SubscriptionsState): Subscription | undefined {
  return state.subscriptions.find((s) => s.id === state.activeSubscriptionId)
}

export function planLabel(plan: string | null): string | null {
  if (!plan) return null
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`
}

/**
 * "email · Max plan · Org", skipping whatever the CLI did not report. A personal account's org is
 * named "<email>'s Organization", which repeats the email, so it is left out.
 */
export function accountLine(account: AccountStatus): string | null {
  if (account.kind !== 'logged_in') return null
  const org = account.orgName && account.orgName !== `${account.email}'s Organization` ? account.orgName : null
  return [account.email, planLabel(account.plan), org].filter(Boolean).join(' · ') || null
}
