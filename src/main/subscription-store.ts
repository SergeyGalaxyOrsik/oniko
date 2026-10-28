import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'
import type { AgentId } from '@shared/agents'
import type { SubscriptionsEvent } from '@shared/events'
import type { AccountStatus, AddSubscriptionResult, Subscription, SubscriptionId, SubscriptionsState } from '@shared/subscriptions'
import { normalizeConfigDir, type AccountSpec } from './agent-registry'
import type { StoredSubscription, ThreadDb } from './db'

const ACTIVE_KEY = 'activeSubscriptionId'
const SEEDED_KEY = 'subscriptionsSeeded'
export const DEFAULT_LABEL = 'Default'

export type SubscriptionStoreDeps = {
  db: ThreadDb
  specs: Record<AgentId, AccountSpec>
  publish: (event: SubscriptionsEvent) => void
  threadsUsing: (id: SubscriptionId) => number
  /** Called when threads that predate subscriptions were just given one, so they can be loaded. */
  onThreadsAdopted: () => void
  /** The agent's default config dir, seeded once as "Default" when it exists. */
  seed: { agentId: AgentId; configDir: string } | null
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function defaultLabel(configDir: string): string {
  return basename(configDir).replace(/^\./, '') || configDir
}

/** Subscriptions, the active one, and their last known login; main is authoritative and broadcasts every change. */
export class SubscriptionStore {
  private subs: Subscription[]
  private activeId: SubscriptionId | null

  constructor(private readonly deps: SubscriptionStoreDeps) {
    this.seedOnce()
    // A probe in flight when Oniko quit never finished, so its "checking" means nothing now.
    this.subs = deps.db.loadSubscriptions().map((s) => this.view(s.account.kind === 'checking' ? { ...s, account: { kind: 'unknown' } } : s))
    const stored = deps.db.getSetting(ACTIVE_KEY, z.string())
    this.activeId = this.subs.find((s) => s.id === stored)?.id ?? this.subs[0]?.id ?? null
  }

  state(): SubscriptionsState {
    return { subscriptions: this.subs, activeSubscriptionId: this.activeId }
  }

  get(id: SubscriptionId): Subscription | undefined {
    return this.subs.find((s) => s.id === id)
  }

  active(): Subscription | undefined {
    return this.activeId ? this.get(this.activeId) : undefined
  }

  async add(input: { agentId: AgentId; configDir: string; label?: string }): Promise<AddSubscriptionResult> {
    const configDir = normalizeConfigDir(input.configDir)
    if (!configDir) return { ok: false, error: 'Enter an absolute folder path, like ~/.claude-work' }
    if (!isDirectory(configDir)) return { ok: false, error: `No folder at ${configDir}` }
    const duplicate = this.subs.find((s) => s.agentId === input.agentId && s.configDir === configDir)
    if (duplicate) return { ok: false, error: `This folder is already added as “${duplicate.label}”` }

    const id = this.insert({ agentId: input.agentId, configDir, label: input.label?.trim() || defaultLabel(configDir) })
    await this.refresh(id)
    return { ok: true, subscription: this.get(id)! }
  }

  update(id: SubscriptionId, patch: { label: string }): void {
    const sub = this.get(id)
    if (!sub) return
    this.write({ ...sub, label: patch.label.trim() || defaultLabel(sub.configDir) })
    this.publish()
  }

  /** The UI disables removal for a subscription in use; this is the guard behind it. */
  remove(id: SubscriptionId): void {
    const using = this.deps.threadsUsing(id)
    if (using > 0) throw new Error(`Used by ${using} thread${using === 1 ? '' : 's'}`)
    this.deps.db.deleteSubscription(id)
    this.subs = this.subs.filter((s) => s.id !== id)
    if (this.activeId === id) this.setActiveId(this.subs[0]?.id ?? null)
    this.publish()
  }

  setActive(id: SubscriptionId): void {
    if (!this.get(id) || this.activeId === id) return
    this.setActiveId(id)
    this.publish()
  }

  async refresh(id?: SubscriptionId): Promise<void> {
    const targets = this.subs.filter((s) => id === undefined || s.id === id)
    if (!targets.length) return
    for (const sub of targets) this.replace({ ...sub, account: { kind: 'checking' } })
    this.publish()
    await Promise.all(
      targets.map(async (sub) => {
        const account = await this.deps.specs[sub.agentId].probeStatus(sub.configDir)
        const current = this.get(sub.id)
        if (!current) return
        this.write({ ...current, account })
        this.publish()
      }),
    )
  }

  detect(): string[] {
    return (Object.entries(this.deps.specs) as [AgentId, AccountSpec][]).flatMap(([agentId, spec]) =>
      spec.defaultDirs().filter((dir) => !this.subs.some((s) => s.agentId === agentId && s.configDir === dir)),
    )
  }

  private seedOnce(): void {
    const { db, seed } = this.deps
    if (db.getSetting(SEEDED_KEY, z.boolean())) return
    db.setSetting(SEEDED_KEY, true)
    if (!seed || !isDirectory(seed.configDir) || db.loadSubscriptions().length) return
    const sub: StoredSubscription = {
      id: randomUUID() as SubscriptionId,
      agentId: seed.agentId,
      label: DEFAULT_LABEL,
      configDir: seed.configDir,
      createdAt: Date.now(),
      account: { kind: 'unknown' },
    }
    db.saveSubscription(sub)
    db.assignOrphanThreads(sub.id)
    db.setSetting(ACTIVE_KEY, sub.id)
  }

  private insert(fields: { agentId: AgentId; configDir: string; label: string }): SubscriptionId {
    const account: AccountStatus = { kind: 'unknown' }
    const sub = this.view({ id: randomUUID() as SubscriptionId, createdAt: Date.now(), account, ...fields })
    this.deps.db.saveSubscription(sub)
    this.subs = [...this.subs, sub]
    if (!this.activeId) this.setActiveId(sub.id)
    if (this.deps.db.assignOrphanThreads(sub.id) > 0) this.deps.onThreadsAdopted()
    this.publish()
    return sub.id
  }

  private view(stored: StoredSubscription): Subscription {
    return { ...stored, loginCommand: this.deps.specs[stored.agentId].loginCommand(stored.configDir) }
  }

  private replace(sub: Subscription): void {
    this.subs = this.subs.map((s) => (s.id === sub.id ? sub : s))
  }

  private write(sub: Subscription): void {
    const { loginCommand: _derived, ...stored } = sub
    this.deps.db.saveSubscription(stored)
    this.replace(sub)
  }

  private setActiveId(id: SubscriptionId | null): void {
    this.activeId = id
    this.deps.db.setSetting(ACTIVE_KEY, id)
  }

  private publish(): void {
    this.deps.publish({ type: 'subscriptions', state: this.state() })
  }
}
