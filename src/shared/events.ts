import type { PermissionOption, SessionUpdate, ToolCallUpdate } from '@agentclientprotocol/sdk'
import type { SubscriptionsState } from './subscriptions'
import type { TasksState } from './tasks'
import type { ConfigControl, PermissionOutcome, Thread, ThreadId, ThreadStatus } from './thread'

export type ThreadEventBody =
  | { type: 'thread_created'; thread: Thread }
  | { type: 'status'; status: ThreadStatus }
  | { type: 'session_attached'; acpSessionId: string }
  | { type: 'session_update'; update: SessionUpdate }
  | { type: 'user_prompt'; id: string; text: string }
  | { type: 'permission_request'; requestId: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { type: 'permission_resolved'; requestId: string; outcome: Exclude<PermissionOutcome, null> }
  | { type: 'turn_end'; stopReason: string; durationMs: number }
  | { type: 'config'; config: ConfigControl[] }
  | { type: 'notice'; level: 'info' | 'error'; text: string }
  | { type: 'thread_removed' }

export type ThreadEvent = ThreadEventBody & { threadId: ThreadId }
export type ThreadEventType = ThreadEvent['type']

/** Subscriptions are app-wide, so their event carries the whole replacement state instead of a thread id. */
export type SubscriptionsEvent = { type: 'subscriptions'; state: SubscriptionsState }

/** Tasks are small and edited one at a time, so they also travel as a whole replacement. */
export type TasksEvent = { type: 'tasks'; state: TasksState }

export type AppEvent = ThreadEvent | SubscriptionsEvent | TasksEvent
