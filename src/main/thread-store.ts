import { randomUUID } from 'node:crypto'
import type { AgentId } from '@shared/agents'
import type { ThreadEvent, ThreadEventBody } from '@shared/events'
import type { Thread, ThreadId, ThreadMap } from '@shared/thread'
import { reduceThreads } from '@shared/thread-reducer'
import { AgentSession, logPathFor } from './agent-session'

export type ThreadStoreDeps = {
  logDir: string
  broadcast: (event: ThreadEvent) => void
}

/** Authoritative thread state: every change is a reduced event, then broadcast unchanged to renderers. */
export class ThreadStore {
  private threads: ThreadMap = {}
  private readonly sessions = new Map<ThreadId, AgentSession>()

  constructor(private readonly deps: ThreadStoreDeps) {}

  list(): Thread[] {
    return Object.values(this.threads).sort((a, b) => b.createdAt - a.createdAt)
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
    this.threads = reduceThreads(this.threads, event)
    this.deps.broadcast(event)
  }
}
