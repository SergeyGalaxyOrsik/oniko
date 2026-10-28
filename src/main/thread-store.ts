import { randomUUID } from 'node:crypto'
import type { ThreadEvent, ThreadEventBody } from '@shared/events'
import type { Subscription, SubscriptionId } from '@shared/subscriptions'
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
  publish: (event: ThreadEvent) => void
}

/** Authoritative thread state: every change is a reduced event, written through to the db, then broadcast. */
export class ThreadStore {
  private threads: ThreadMap = {}
  private readonly sessions = new Map<ThreadId, AgentSession>()

  constructor(private readonly deps: ThreadStoreDeps) {
    for (const stored of deps.db.loadThreads()) {
      const restored = this.restore(stored)
      this.threads[restored.id] = restored
    }
  }

  /** Threads that predate subscriptions are stored without one and only load once they are adopted. */
  loadAdopted(): void {
    for (const stored of this.deps.db.loadThreads()) {
      if (this.threads[stored.id]) continue
      const restored = this.restore(stored)
      this.dispatch({ threadId: restored.id, type: 'thread_created', thread: restored })
    }
  }

  countUsing(subscriptionId: SubscriptionId): number {
    return Object.values(this.threads).filter((t) => t.subscriptionId === subscriptionId).length
  }

  list(): Thread[] {
    return Object.values(this.threads).sort((a, b) => b.createdAt - a.createdAt)
  }

  create(subscription: Subscription, cwd: string, initialConfig?: Record<string, string>): ThreadId {
    const id = randomUUID() as ThreadId
    this.dispatch({
      threadId: id,
      type: 'thread_created',
      thread: {
        id,
        agentId: subscription.agentId,
        subscriptionId: subscription.id,
        cwd,
        title: '',
        createdAt: Date.now(),
        acpSessionId: null,
        status: { kind: 'connecting' },
        timeline: [],
        config: [],
        commands: [],
      },
    })
    void this.session(id, initialConfig).ensureSession()
    return id
  }

  /** Sessions are created lazily, so a thread without a live process gets one on first use. */
  session(id: ThreadId, initialConfig?: Record<string, string>): AgentSession {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const thread = this.threads[id]
    if (!thread) throw new Error(`Unknown thread ${id}`)
    const session = new AgentSession({
      agentId: thread.agentId,
      cwd: thread.cwd,
      accountEnv: this.deps.accountEnv(thread),
      acpSessionId: thread.acpSessionId,
      ...(initialConfig ? { initialConfig } : {}),
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

  private restore(stored: Thread): Thread {
    const restored = restoreThread(stored)
    this.deps.db.saveChange(restored.id, stored, restored)
    return restored
  }

  private dispatch(event: ThreadEvent): void {
    const prev = this.threads[event.threadId]
    this.threads = reduceThreads(this.threads, event)
    this.deps.db.saveChange(event.threadId, prev, this.threads[event.threadId])
    this.deps.publish(event)
  }
}
