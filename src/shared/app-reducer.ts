import type { AppEvent } from './events'
import type { SubscriptionsState } from './subscriptions'
import type { ThreadMap } from './thread'
import { reduceThreads } from './thread-reducer'

export type AppState = { threads: ThreadMap; subscriptions: SubscriptionsState }

export const EMPTY_SUBSCRIPTIONS: SubscriptionsState = { subscriptions: [], activeSubscriptionId: null }

export function reduceApp(state: AppState, event: AppEvent): AppState {
  if (event.type === 'subscriptions') return { ...state, subscriptions: event.state }
  const threads = reduceThreads(state.threads, event)
  return threads === state.threads ? state : { ...state, threads }
}
