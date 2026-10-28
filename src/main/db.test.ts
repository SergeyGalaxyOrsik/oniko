import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Thread } from '@shared/thread'
import { reduceThreads } from '@shared/thread-reducer'
import { INTERRUPTED_NOTICE } from '@shared/thread-restore'
import { chunk, newThread, threadId, update } from '@shared/test-fixtures'
import { ThreadDb } from './db'
import { ThreadStore } from './thread-store'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oniko-db-'))
  path = join(dir, 'oniko.db')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sample: Thread = newThread({
  title: 'Remember zephyr',
  acpSessionId: 'sess-1',
  status: { kind: 'idle' },
  config: [{ id: 'model', label: 'Model', source: 'config_option', value: 'opus', options: [{ value: 'opus', label: 'Opus' }] }],
  timeline: [
    { kind: 'user', id: 'u-0', text: 'Remember the word zephyr. Reply ok.' },
    { kind: 'assistant', id: 'assistant-1', text: 'ok' },
    { kind: 'turn_end', id: 'turn-2', stopReason: 'end_turn', durationMs: 900 },
  ],
})

describe('ThreadDb', () => {
  it('round-trips a thread across reopening the file', () => {
    const db = new ThreadDb(path)
    db.saveChange(sample.id, undefined, sample)
    db.close()
    const reopened = new ThreadDb(path)
    expect(reopened.loadThreads()).toEqual([sample])
    reopened.close()
  })

  it('coalesces streaming chunks into one row per item', () => {
    const db = new ThreadDb(path)
    let state = { [threadId]: newThread() }
    db.saveChange(threadId, undefined, state[threadId])
    for (const piece of ['ze', 'ph', 'yr']) {
      const next = reduceThreads(state, update(chunk(piece)))
      db.saveChange(threadId, state[threadId], next[threadId])
      state = next as typeof state
    }
    expect(db.loadThreads()[0]!.timeline).toEqual([{ kind: 'assistant', id: 'assistant-0', text: 'zephyr' }])
    db.close()
  })

  it('deletes a removed thread with its items', () => {
    const db = new ThreadDb(path)
    db.saveChange(sample.id, undefined, sample)
    db.saveChange(sample.id, sample, undefined)
    expect(db.loadThreads()).toEqual([])
    db.close()
  })

  it('runs migrations once and keeps data when reopened', () => {
    new ThreadDb(path).close()
    const db = new ThreadDb(path)
    db.setSetting('recentFolders', ['/a', '/b'])
    db.close()
    const again = new ThreadDb(path)
    expect(again.getSetting('recentFolders', z.array(z.string()))).toEqual(['/a', '/b'])
    again.close()
  })
})

describe('ThreadStore startup', () => {
  it('turns a thread interrupted mid-turn into a dormant thread with a notice, and persists that', () => {
    const db = new ThreadDb(path)
    db.saveChange(sample.id, undefined, {
      ...sample,
      status: { kind: 'awaiting_permission', requestId: 'perm-1', startedAt: 1 },
      timeline: [...sample.timeline, { kind: 'permission', id: 'perm-1', toolCallId: 'tc', title: 'echo', options: [], outcome: null }],
    })
    const store = new ThreadStore({ db, logDir: dir, accountEnv: () => ({}), broadcast: () => {} })
    const [thread] = store.list()
    expect(thread!.status).toEqual({ kind: 'dormant' })
    expect(thread!.timeline.slice(-2)).toMatchObject([
      { kind: 'permission', outcome: 'cancelled' },
      { kind: 'notice', text: INTERRUPTED_NOTICE },
    ])
    expect(db.loadThreads()[0]!.timeline).toEqual(thread!.timeline)
    db.close()
  })
})
