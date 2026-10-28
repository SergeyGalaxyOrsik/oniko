import type {
  AuthMethod,
  AvailableCommand,
  PermissionOption,
  PlanEntry,
  ToolCallContent,
  ToolCallStatus,
} from '@agentclientprotocol/sdk'
import type { AgentId } from './agents'

export type ThreadId = string & { __brand: 'ThreadId' }

export type ThreadStatus =
  | { kind: 'dormant' }
  | { kind: 'connecting' }
  | { kind: 'auth_required'; methods: AuthMethod[] }
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'awaiting_permission'; requestId: string; startedAt: number }
  | { kind: 'error'; message: string }
  | { kind: 'exited'; code: number | null }

export type ToolItem = {
  kind: 'tool'
  id: string
  title: string
  toolKind: string
  status: ToolCallStatus
  content: ToolCallContent[]
  locations: { path: string; line?: number }[]
}

export type PermissionOutcome = null | { optionId: string } | 'cancelled'

export type TimelineItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | ToolItem
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | {
      kind: 'permission'
      id: string
      toolCallId: string
      title: string
      options: PermissionOption[]
      outcome: PermissionOutcome
    }
  | { kind: 'turn_end'; id: string; stopReason: string; durationMs: number }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }

export type ConfigSource = 'config_option' | 'mode' | 'model'

export type ConfigControl = {
  id: string
  label: string
  source: ConfigSource
  value: string
  options: { value: string; label: string; description?: string }[]
}

export type Thread = {
  id: ThreadId
  agentId: AgentId
  cwd: string
  title: string
  createdAt: number
  acpSessionId: string | null
  status: ThreadStatus
  timeline: TimelineItem[]
  config: ConfigControl[]
  commands: AvailableCommand[]
}

export type ThreadMap = Record<ThreadId, Thread>

export function isBusy(status: ThreadStatus): boolean {
  return status.kind === 'running' || status.kind === 'awaiting_permission' || status.kind === 'connecting'
}
