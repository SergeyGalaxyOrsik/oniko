import { randomUUID } from 'node:crypto'
import type { AgentId } from '@shared/agents'
import type { SequencedEvent, ThreadSnapshot } from '@shared/api'
import type { ThreadEvent, ThreadEventBody } from '@shared/events'
import type { Thread, ThreadId, ThreadMap } from '@shared/thread'
import { reduceThreads } from '@shared/thread-reducer'
import { restoreThread } from '@shared/thread-restore'
import type { EnvLayer } from './agent-registry'
import { AgentSession, logPathFor } from './agent-session'
import type { ThreadDb } from './db'

export type ThreadStoreDeps = {
  db: ThreadDb
  logDir: string
  accountEnv: (thread: Thread) => EnvLayer
  broadcast: (event: SequencedEvent) => void
}

/** Authoritative thread state: every change is a reduced event, written through to the db, then broadcast. */
export class ThreadStore {
  private threads: ThreadMap = {}
  private seq = 0
  private readonly sessions = new Map<ThreadId, AgentSession>()

  constructor(private readonly deps: ThreadStoreDeps) {
    for (const stored of deps.db.loadThreads()) {
      const restored = restoreThread(stored)
      deps.db.saveChange(restored.id, stored, restored)
      this.threads[restored.id] = restored
    }
  }

  list(): Thread[] {
    return Object.values(this.threads).sort((a, b) => b.createdAt - a.createdAt)
  }

  snapshot(): ThreadSnapshot {
    return { seq: this.seq, threads: this.list() }
  }

  create(agentId: AgentId, cwd: string): ThreadId {
    const id = randomUUID() as ThreadId
    this.dispatch({
      threadId: id,
      type: 'thread_created',
      thread: { id, agentId, cwd, title: '', createdAt: Date.now(), acpSessionId: null, status: { kind: 'connecting' }, timeline: [], config: [], commands: [] },
    })
    void this.session(id).ensureSession()
    return id
  }

  /** Sessions are created lazily, so a thread without a live process gets one on first use. */
  session(id: ThreadId): AgentSession {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const thread = this.threads[id]
    if (!thread) throw new Error(`Unknown thread ${id}`)
    const session = new AgentSession({
      agentId: thread.agentId,
      cwd: thread.cwd,
      accountEnv: this.deps.accountEnv(thread),
      acpSessionId: thread.acpSessionId,
      logPath: logPathFor(this.deps.logDir, id),
      emit: (event: ThreadEventBody) => this.dispatch({ ...event, threadId: id }),
    })
    this.sessions.set(id, session)
    return session
  }

  remove(id: ThreadId): void {
    this.sessions.get(id)?.dispose()
    this.sessions.delete(id)
    this.dispatch({ threadId: id, type: 'thread_removed' })
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
  }

  private dispatch(event: ThreadEvent): void {
    const prev = this.threads[event.threadId]
    this.threads = reduceThreads(this.threads, event)
    this.deps.db.saveChange(event.threadId, prev, this.threads[event.threadId])
    this.seq += 1
    this.deps.broadcast({ seq: this.seq, event })
  }
}
