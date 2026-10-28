import type { ContentBlock, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import { controlsFromConfigOptions, withValue } from './config'
import type { ThreadEvent } from './events'
import type { Thread, ThreadMap, TimelineItem, ToolItem } from './thread'

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`)
}

const TITLE_LIMIT = 80

function textOf(block: ContentBlock): string {
  return block.type === 'text' ? block.text : ''
}

/** Ids derive from timeline position so main and renderer compute the same id independently. */
function nextId(thread: Thread, prefix: string): string {
  return `${prefix}-${thread.timeline.length}`
}

function appendText(thread: Thread, kind: 'assistant' | 'thought', text: string): Thread {
  if (!text) return thread
  const last = thread.timeline.at(-1)
  if (last && last.kind === kind) {
    return { ...thread, timeline: [...thread.timeline.slice(0, -1), { ...last, text: last.text + text }] }
  }
  return { ...thread, timeline: [...thread.timeline, { kind, id: nextId(thread, kind), text }] }
}

function upsertTool(thread: Thread, call: (ToolCall | ToolCallUpdate) & { toolCallId: string }): Thread {
  const index = thread.timeline.findIndex((item) => item.kind === 'tool' && item.id === call.toolCallId)
  const existing = index >= 0 ? (thread.timeline[index] as ToolItem) : undefined
  const merged: ToolItem = {
    kind: 'tool',
    id: call.toolCallId,
    title: call.title ?? existing?.title ?? 'Tool call',
    toolKind: call.kind ?? existing?.toolKind ?? 'other',
    status: call.status ?? existing?.status ?? 'pending',
    content: call.content ?? existing?.content ?? [],
    locations: call.locations
      ? call.locations.map((l) => (l.line == null ? { path: l.path } : { path: l.path, line: l.line }))
      : (existing?.locations ?? []),
  }
  if (index < 0) return { ...thread, timeline: [...thread.timeline, merged] }
  const timeline = thread.timeline.slice()
  timeline[index] = merged
  return { ...thread, timeline }
}

function lastUserIndex(timeline: TimelineItem[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i]!.kind === 'user') return i
  return -1
}

function applySessionUpdate(thread: Thread, update: SessionUpdate): Thread {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return appendText(thread, 'assistant', textOf(update.content))
    case 'agent_thought_chunk':
      return appendText(thread, 'thought', textOf(update.content))
    case 'tool_call':
    case 'tool_call_update':
      return upsertTool(thread, update)
    case 'plan': {
      const turnStart = lastUserIndex(thread.timeline)
      const index = thread.timeline.findIndex((item, i) => i > turnStart && item.kind === 'plan')
      if (index < 0) {
        return { ...thread, timeline: [...thread.timeline, { kind: 'plan', id: nextId(thread, 'plan'), entries: update.entries }] }
      }
      const timeline = thread.timeline.slice()
      timeline[index] = { kind: 'plan', id: timeline[index]!.id, entries: update.entries }
      return { ...thread, timeline }
    }
    case 'available_commands_update':
      return { ...thread, commands: update.availableCommands }
    case 'current_mode_update': {
      const legacy = thread.config.find((c) => c.source === 'mode')
      return legacy ? { ...thread, config: withValue(thread.config, legacy.id, update.currentModeId) } : thread
    }
    case 'config_option_update':
      return {
        ...thread,
        config: [...controlsFromConfigOptions(update.configOptions), ...thread.config.filter((c) => c.source !== 'config_option')],
      }
    case 'notice': {
      const text = update.description ? `${update.title}: ${update.description}` : update.title
      const level = update.severity === 'error' ? 'error' : 'info'
      return { ...thread, timeline: [...thread.timeline, { kind: 'notice', id: nextId(thread, 'notice'), level, text }] }
    }
    // Our own user_prompt event records the user turn, and the rest carry nothing the timeline shows.
    case 'user_message_chunk':
    case 'session_info_update':
    case 'usage_update':
    case 'compaction_update':
    case 'compaction_summary_chunk':
      return thread
    default:
      return assertNever(update)
  }
}

function reduceThread(thread: Thread, event: Exclude<ThreadEvent, { type: 'thread_created' | 'thread_removed' }>): Thread {
  switch (event.type) {
    case 'status':
      return { ...thread, status: event.status }
    case 'session_attached':
      return { ...thread, acpSessionId: event.acpSessionId }
    case 'session_update':
      return applySessionUpdate(thread, event.update)
    case 'user_prompt':
      return {
        ...thread,
        title: thread.title || event.text.trim().replace(/\s+/g, ' ').slice(0, TITLE_LIMIT),
        timeline: [...thread.timeline, { kind: 'user', id: event.id, text: event.text }],
      }
    case 'permission_request': {
      const withTool = upsertTool(thread, event.toolCall)
      const tool = withTool.timeline.find((item): item is ToolItem => item.kind === 'tool' && item.id === event.toolCall.toolCallId)
      return {
        ...withTool,
        timeline: [
          ...withTool.timeline,
          {
            kind: 'permission',
            id: event.requestId,
            toolCallId: event.toolCall.toolCallId,
            title: event.toolCall.title ?? tool?.title ?? 'Permission requested',
            options: event.options,
            outcome: null,
          },
        ],
      }
    }
    case 'permission_resolved':
      return {
        ...thread,
        timeline: thread.timeline.map((item) =>
          item.kind === 'permission' && item.id === event.requestId ? { ...item, outcome: event.outcome } : item,
        ),
      }
    case 'turn_end':
      return {
        ...thread,
        timeline: [...thread.timeline, { kind: 'turn_end', id: nextId(thread, 'turn'), stopReason: event.stopReason, durationMs: event.durationMs }],
      }
    case 'config':
      return { ...thread, config: event.config }
    case 'notice':
      return { ...thread, timeline: [...thread.timeline, { kind: 'notice', id: nextId(thread, 'notice'), level: event.level, text: event.text }] }
    default:
      return assertNever(event)
  }
}

export function reduceThreads(state: ThreadMap, event: ThreadEvent): ThreadMap {
  if (event.type === 'thread_created') return { ...state, [event.thread.id]: event.thread }
  const thread = state[event.threadId]
  if (!thread) return state
  if (event.type === 'thread_removed') {
    const { [event.threadId]: _removed, ...rest } = state
    return rest
  }
  const next = reduceThread(thread, event)
  return next === thread ? state : { ...state, [event.threadId]: next }
}

