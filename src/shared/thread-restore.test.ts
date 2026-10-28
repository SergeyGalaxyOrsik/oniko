import { describe, expect, it } from 'vitest'
import { INTERRUPTED_NOTICE, restoreThread } from './thread-restore'
import { newThread } from './test-fixtures'

describe('restoreThread', () => {
  it('marks a thread interrupted mid-turn and cancels its open permission', () => {
    const restored = restoreThread(
      newThread({
        status: { kind: 'awaiting_permission', requestId: 'perm-1', startedAt: 1 },
        timeline: [
          { kind: 'user', id: 'u-0', text: 'run it' },
          { kind: 'permission', id: 'perm-1', toolCallId: 'tc', title: 'echo', options: [], outcome: null },
        ],
      }),
    )
    expect(restored.status).toEqual({ kind: 'dormant' })
    expect(restored.timeline).toMatchObject([
      { kind: 'user' },
      { kind: 'permission', outcome: 'cancelled' },
      { kind: 'notice', level: 'info', text: INTERRUPTED_NOTICE },
    ])
  })

  it('leaves a settled thread untouched apart from going dormant', () => {
    const thread = newThread({ status: { kind: 'idle' }, timeline: [{ kind: 'assistant', id: 'assistant-0', text: 'hi' }] })
    expect(restoreThread(thread)).toEqual({ ...thread, status: { kind: 'dormant' } })
  })
})
