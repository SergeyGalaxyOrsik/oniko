import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from './events'
import type { ThreadMap } from './thread'
import { reduceThreads } from './thread-reducer'
import { chunk, newThread, threadId, update } from './test-fixtures'

function run(events: ThreadEvent[], initial: ThreadMap = {}): ThreadMap {
  return events.reduce(reduceThreads, initial)
}

const created: ThreadEvent = { threadId, type: 'thread_created', thread: newThread() }

describe('reduceThreads', () => {
  it('merges consecutive agent message chunks into one assistant item', () => {
    const state = run([
      created,
      { threadId, type: 'user_prompt', id: 'u-1', text: 'Reply with exactly: pong' },
      update(chunk('po')),
      update(chunk('ng')),
    ])
    expect(state[threadId]!.timeline).toEqual([
      { kind: 'user', id: 'u-1', text: 'Reply with exactly: pong' },
      { kind: 'assistant', id: 'assistant-1', text: 'pong' },
    ])
  })

  it('starts a new assistant item after a tool call interrupts the text', () => {
    const state = run([
      created,
      update(chunk('Running it.')),
      update({ sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'Bash', kind: 'execute', status: 'pending' }),
      update(chunk('Done.')),
    ])
    expect(state[threadId]!.timeline.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
  })

  it('keeps thoughts separate from assistant text', () => {
    const state = run([
      created,
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking' } }),
      update(chunk('Answer')),
    ])
    expect(state[threadId]!.timeline).toMatchObject([
      { kind: 'thought', text: 'Thinking' },
      { kind: 'assistant', text: 'Answer' },
    ])
  })

  it('merges tool_call_update into the existing tool item by id', () => {
    const state = run([
      created,
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'toolu_01',
        title: 'Terminal',
        kind: 'execute',
        status: 'pending',
        content: [],
        locations: [],
        rawInput: { command: 'echo oniko-ok' },
      }),
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'toolu_01', title: '`echo oniko-ok`' }),
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'toolu_01',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'oniko-ok\n' } }],
      }),
    ])
    const tools = state[threadId]!.timeline.filter((i) => i.kind === 'tool')
    expect(tools).toEqual([
      {
        kind: 'tool',
        id: 'toolu_01',
        title: '`echo oniko-ok`',
        toolKind: 'execute',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'oniko-ok\n' } }],
        locations: [],
      },
    ])
  })

  it('records a permission request and then its resolution', () => {
    const options = [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' as const },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' as const },
    ]
    const asked = run([
      created,
      {
        threadId,
        type: 'permission_request',
        requestId: 'perm-1',
        toolCall: { toolCallId: 'toolu_02', title: 'echo oniko-ok', kind: 'execute', status: 'pending' },
        options,
      },
    ])
    const permission = asked[threadId]!.timeline.find((i) => i.kind === 'permission')
    expect(permission).toMatchObject({ id: 'perm-1', toolCallId: 'toolu_02', title: 'echo oniko-ok', outcome: null, options })
    expect(asked[threadId]!.timeline.find((i) => i.kind === 'tool')).toMatchObject({ id: 'toolu_02', status: 'pending' })

    const resolved = run([{ threadId, type: 'permission_resolved', requestId: 'perm-1', outcome: { optionId: 'allow' } }], asked)
    expect(resolved[threadId]!.timeline.find((i) => i.kind === 'permission')).toMatchObject({ outcome: { optionId: 'allow' } })
  })

  it('appends a turn_end item with the stop reason and duration', () => {
    const state = run([created, update(chunk('pong')), { threadId, type: 'turn_end', stopReason: 'end_turn', durationMs: 2300 }])
    expect(state[threadId]!.timeline.at(-1)).toEqual({ kind: 'turn_end', id: 'turn-1', stopReason: 'end_turn', durationMs: 2300 })
  })

  it('walks the status state machine through a turn', () => {
    const statuses = [
      { kind: 'idle' as const },
      { kind: 'running' as const, startedAt: 5 },
      { kind: 'awaiting_permission' as const, requestId: 'perm-1', startedAt: 5 },
      { kind: 'running' as const, startedAt: 5 },
      { kind: 'idle' as const },
      { kind: 'exited' as const, code: 0 },
    ]
    let state = run([created])
    expect(state[threadId]!.status).toEqual({ kind: 'connecting' })
    for (const status of statuses) {
      state = reduceThreads(state, { threadId, type: 'status', status })
      expect(state[threadId]!.status).toEqual(status)
    }
  })

  it('titles the thread from the first prompt only', () => {
    const state = run([
      created,
      { threadId, type: 'user_prompt', id: 'u-1', text: '  Fix   the\nlogin bug  ' },
      { threadId, type: 'user_prompt', id: 'u-2', text: 'And the logout one' },
    ])
    expect(state[threadId]!.title).toBe('Fix the login bug')
  })

  it('replaces the plan within a turn and starts a new one next turn', () => {
    const entry = (content: string, status: 'pending' | 'completed') => ({ content, status, priority: 'medium' as const })
    const state = run([
      created,
      { threadId, type: 'user_prompt', id: 'u-1', text: 'go' },
      update({ sessionUpdate: 'plan', entries: [entry('a', 'pending')] }),
      update({ sessionUpdate: 'plan', entries: [entry('a', 'completed')] }),
      { threadId, type: 'user_prompt', id: 'u-2', text: 'again' },
      update({ sessionUpdate: 'plan', entries: [entry('b', 'pending')] }),
    ])
    const plans = state[threadId]!.timeline.filter((i) => i.kind === 'plan')
    expect(plans).toMatchObject([{ entries: [entry('a', 'completed')] }, { entries: [entry('b', 'pending')] }])
  })

  it('replaces config controls from config_option_update', () => {
    const state = run([
      created,
      update({
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            type: 'select',
            category: 'model',
            currentValue: 'opus',
            options: [
              { value: 'opus', name: 'Opus' },
              { value: 'sonnet', name: 'Sonnet' },
            ],
          },
        ],
      }),
    ])
    expect(state[threadId]!.config).toEqual([
      {
        id: 'model',
        label: 'Model',
        category: 'model',
        source: 'config_option',
        value: 'opus',
        options: [
          { value: 'opus', label: 'Opus' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
      },
    ])
  })

  it('ignores events for unknown threads and removes threads', () => {
    const state = run([created])
    expect(reduceThreads(state, { threadId: 'nope' as typeof threadId, type: 'notice', level: 'info', text: 'x' })).toBe(state)
    expect(run([{ threadId, type: 'thread_removed' }], state)).toEqual({})
  })
})
