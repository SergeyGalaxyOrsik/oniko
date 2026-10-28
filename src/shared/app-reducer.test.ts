import { describe, expect, it } from 'vitest'
import { EMPTY_SUBSCRIPTIONS, reduceApp, type AppState } from './app-reducer'
import type { Subscription, SubscriptionsState } from './subscriptions'
import { EMPTY_TASKS } from './tasks'
import { chunk, newThread, subscriptionId, threadId, update } from './test-fixtures'

const sub: Subscription = {
  id: subscriptionId,
  agentId: 'claude',
  label: 'Default',
  configDir: '/Users/someone/.claude',
  createdAt: 1,
  account: { kind: 'checking' },
  loginCommand: 'claude auth login',
}

describe('reduceApp', () => {
  const initial: AppState = { threads: { [threadId]: newThread() }, subscriptions: EMPTY_SUBSCRIPTIONS, tasks: EMPTY_TASKS }

  it('replaces the subscriptions state wholesale and leaves threads alone', () => {
    const next: SubscriptionsState = { subscriptions: [sub], activeSubscriptionId: sub.id }
    const state = reduceApp(initial, { type: 'subscriptions', state: next })
    expect(state.subscriptions).toBe(next)
    expect(state.threads).toBe(initial.threads)
    const loggedIn = { ...sub, account: { kind: 'logged_in' as const, email: 'a@b', orgName: null, plan: 'max', checkedAt: 2 } }
    expect(reduceApp(state, { type: 'subscriptions', state: { ...next, subscriptions: [loggedIn] } }).subscriptions.subscriptions).toEqual([loggedIn])
  })

  it('routes thread events to the thread reducer and keeps identity when nothing changed', () => {
    const state = reduceApp(initial, update(chunk('hi')))
    expect(state.threads[threadId]!.timeline).toMatchObject([{ kind: 'assistant', text: 'hi' }])
    expect(state.subscriptions).toBe(initial.subscriptions)
    expect(reduceApp(initial, { ...update(chunk('x')), threadId: 'other' as typeof threadId })).toBe(initial)
  })
})
