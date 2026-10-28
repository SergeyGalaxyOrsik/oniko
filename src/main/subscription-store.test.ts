import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentId } from '@shared/agents'
import type { SubscriptionsEvent } from '@shared/events'
import type { AccountStatus, SubscriptionId } from '@shared/subscriptions'
import type { AccountSpec } from './agent-registry'
import { MIGRATIONS, ThreadDb } from './db'
import { DEFAULT_LABEL, SubscriptionStore, type SubscriptionStoreDeps } from './subscription-store'
import { ThreadStore } from './thread-store'

let dir: string
let path: string
let defaultDir: string
let personalDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oniko-subs-'))
  path = join(dir, 'oniko.db')
  defaultDir = join(dir, '.claude')
  personalDir = join(dir, '.claude-personal')
  mkdirSync(defaultDir)
  mkdirSync(personalDir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const loggedIn = (email: string): AccountStatus => ({ kind: 'logged_in', email, orgName: null, plan: 'max', checkedAt: 1 })

function fakeSpecs(probe: (configDir: string) => AccountStatus = () => loggedIn('dev@example.com')): Record<AgentId, AccountSpec> {
  return {
    claude: {
      envFor: (configDir) => ({ CLAUDE_CONFIG_DIR: configDir }),
      probeStatus: async (configDir) => probe(configDir),
      defaultDirs: () => [defaultDir, personalDir],
      loginCommand: (configDir) => `login ${configDir}`,
    },
  }
}

function openStore(db: ThreadDb, overrides: Partial<SubscriptionStoreDeps> = {}): { store: SubscriptionStore; events: SubscriptionsEvent[] } {
  const events: SubscriptionsEvent[] = []
  const store = new SubscriptionStore({
    db,
    specs: fakeSpecs(),
    publish: (event) => events.push(event),
    threadsUsing: () => 0,
    onThreadsAdopted: () => {},
    seed: { agentId: 'claude', configDir: defaultDir },
    ...overrides,
  })
  return { store, events }
}

/** A database as the pre-subscription release left it: schema version 1 with one thread. */
function writeVersionOneDb(): void {
  const raw = new DatabaseSync(path)
  raw.exec(MIGRATIONS[0]!)
  raw.exec('PRAGMA user_version = 1')
  raw
    .prepare(
      `INSERT INTO threads (id, agent_id, cwd, title, created_at, updated_at, acp_session_id, config_json, last_status)
       VALUES ('old-1', 'claude', '/tmp/project', 'Before subscriptions', 1, 1, 'sess-old', '[]', '{"kind":"idle"}')`,
    )
    .run()
  raw.close()
}

describe('subscription seeding', () => {
  it('migrates an existing db: seeds Default for ~/.claude, assigns it to old threads and makes it active', () => {
    writeVersionOneDb()
    const db = new ThreadDb(path)
    const { store } = openStore(db)
    const [seeded] = store.state().subscriptions
    expect(seeded).toMatchObject({ label: DEFAULT_LABEL, configDir: defaultDir, loginCommand: `login ${defaultDir}` })
    expect(store.state().activeSubscriptionId).toBe(seeded!.id)
    const threads = new ThreadStore({ db, logDir: dir, accountEnv: () => ({}), publish: () => {} }).list()
    expect(threads.map((t) => [t.id, t.subscriptionId, t.acpSessionId])).toEqual([['old-1', seeded!.id, 'sess-old']])
    db.close()
  })

  it('seeds only once, even after the user removes Default', () => {
    const db = new ThreadDb(path)
    const first = openStore(db).store
    first.remove(first.state().subscriptions[0]!.id)
    expect(openStore(db).store.state()).toEqual({ subscriptions: [], activeSubscriptionId: null })
    db.close()
  })

  it('without ~/.claude, old threads wait for the first added subscription', async () => {
    writeVersionOneDb()
    rmSync(defaultDir, { recursive: true })
    const db = new ThreadDb(path)
    const threads = new ThreadStore({ db, logDir: dir, accountEnv: () => ({}), publish: () => {} })
    let adopted = 0
    const { store } = openStore(db, {
      onThreadsAdopted: () => {
        adopted += 1
        threads.loadAdopted()
      },
    })
    expect(store.state().subscriptions).toEqual([])
    expect(threads.list()).toEqual([])

    const result = await store.add({ agentId: 'claude', configDir: personalDir })
    expect(result.ok).toBe(true)
    const id = store.state().activeSubscriptionId
    expect(adopted).toBe(1)
    expect(threads.list().map((t) => [t.id, t.subscriptionId])).toEqual([['old-1', id]])
    db.close()
  })
})

describe('SubscriptionStore', () => {
  it('adds a folder typed with ~ and a trailing slash, probes it, and broadcasts each step', async () => {
    const db = new ThreadDb(path)
    const { store, events } = openStore(db, { seed: null, specs: fakeSpecs((d) => loggedIn(d.endsWith('personal') ? 'me@home' : 'me@work')) })
    const result = await store.add({ agentId: 'claude', configDir: `${personalDir}/` })
    expect(result).toMatchObject({ ok: true, subscription: { label: 'claude-personal', configDir: personalDir, account: loggedIn('me@home') } })
    expect(events.map((e) => e.state.subscriptions[0]!.account.kind)).toEqual(['unknown', 'checking', 'logged_in'])
    expect(store.state().activeSubscriptionId).toBe(store.state().subscriptions[0]!.id)

    const reopened = openStore(db, { seed: null }).store
    expect(reopened.state().subscriptions[0]!.account).toEqual(loggedIn('me@home'))
    db.close()
  })

  it('rejects relative paths, missing folders and duplicates with a message for the dialog', async () => {
    const db = new ThreadDb(path)
    const { store } = openStore(db, { seed: null })
    await store.add({ agentId: 'claude', configDir: personalDir })
    expect(await store.add({ agentId: 'claude', configDir: '.claude' })).toEqual({ ok: false, error: expect.stringMatching(/absolute/) })
    expect(await store.add({ agentId: 'claude', configDir: join(dir, 'nope') })).toEqual({ ok: false, error: expect.stringMatching(/No folder/) })
    expect(await store.add({ agentId: 'claude', configDir: `${personalDir}//` })).toEqual({ ok: false, error: expect.stringMatching(/already added/) })
    expect(store.state().subscriptions).toHaveLength(1)
    db.close()
  })

  it('refuses to remove a subscription that threads still use', () => {
    const db = new ThreadDb(path)
    const using = new Map<SubscriptionId, number>()
    const { store } = openStore(db, { threadsUsing: (id) => using.get(id) ?? 0 })
    const id = store.state().subscriptions[0]!.id
    using.set(id, 2)
    expect(() => store.remove(id)).toThrow('Used by 2 threads')
    expect(store.state().subscriptions).toHaveLength(1)
    using.set(id, 0)
    store.remove(id)
    expect(store.state()).toEqual({ subscriptions: [], activeSubscriptionId: null })
    db.close()
  })

  it('switches the active subscription and renames, falling back to the folder name for a blank label', async () => {
    const db = new ThreadDb(path)
    const { store } = openStore(db)
    const result = await store.add({ agentId: 'claude', configDir: personalDir, label: 'Personal' })
    if (!result.ok) throw new Error(result.error)
    store.setActive(result.subscription.id)
    store.update(result.subscription.id, { label: '  ' })
    const reopened = openStore(db).store.state()
    expect(reopened.activeSubscriptionId).toBe(result.subscription.id)
    expect(reopened.subscriptions.map((s) => s.label)).toEqual([DEFAULT_LABEL, 'claude-personal'])
    db.close()
  })

  it('suggests only config dirs not added yet', () => {
    const db = new ThreadDb(path)
    expect(openStore(db).store.detect()).toEqual([personalDir])
    db.close()
  })
})
