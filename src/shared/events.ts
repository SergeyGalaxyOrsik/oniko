import type { PermissionOption, SessionUpdate, ToolCallUpdate } from '@agentclientprotocol/sdk'
import type { ConfigControl, PermissionOutcome, Thread, ThreadId, ThreadStatus } from './thread'

type Payload =
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

export type ThreadEvent = Payload & { threadId: ThreadId }
export type ThreadEventType = ThreadEvent['type']
