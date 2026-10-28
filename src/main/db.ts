import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { AGENT_IDS, type AgentId } from '@shared/agents'
import type { AccountStatus, Subscription, SubscriptionId } from '@shared/subscriptions'
import { STATUS_COLORS, STATUS_KINDS, type Task, type TaskId, type TaskStatus, type TaskStatusId } from '@shared/tasks'
import type { ConfigControl, Thread, ThreadId, ThreadStatus, TimelineItem } from '@shared/thread'

/** Append-only. Each entry runs once, in order, tracked by PRAGMA user_version. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS threads (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL,
     cwd TEXT NOT NULL,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     acp_session_id TEXT,
     config_json TEXT NOT NULL,
     last_status TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS timeline_items (
     thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     item_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     json TEXT NOT NULL,
     PRIMARY KEY (thread_id, item_id)
   );
   CREATE INDEX IF NOT EXISTS timeline_items_order ON timeline_items(thread_id, seq);
   CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value_json TEXT NOT NULL
   );`,
  // Seeding and assigning existing threads needs the filesystem, so SubscriptionStore does it after this runs.
  `CREATE TABLE IF NOT EXISTS subscriptions (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL,
     label TEXT NOT NULL,
     config_dir TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     account_json TEXT NOT NULL,
     UNIQUE (agent_id, config_dir)
   );
   ALTER TABLE threads ADD COLUMN subscription_id TEXT REFERENCES subscriptions(id);`,
  // Default statuses are seeded per project when its board is first opened, see TaskStore.
  `CREATE TABLE IF NOT EXISTS task_statuses (
     id TEXT PRIMARY KEY,
     project TEXT NOT NULL,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     position REAL NOT NULL
   );
   CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY,
     project TEXT NOT NULL,
     title TEXT NOT NULL,
     description TEXT NOT NULL,
     status_id TEXT NOT NULL REFERENCES task_statuses(id),
     position REAL NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status_id, position);`,
  // Numbers existing tasks per project in creation order; statuses named like the defaults get their kind.
  `ALTER TABLE task_statuses ADD COLUMN kind TEXT NOT NULL DEFAULT 'started';
   UPDATE task_statuses SET kind = CASE name WHEN 'Backlog' THEN 'backlog' WHEN 'To do' THEN 'unstarted' WHEN 'Done' THEN 'completed' ELSE 'started' END;
   ALTER TABLE tasks ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
   UPDATE tasks SET number = (
     SELECT COUNT(*) FROM tasks AS t
     WHERE t.project = tasks.project AND (t.created_at < tasks.created_at OR (t.created_at = tasks.created_at AND t.id <= tasks.id))
   );`,
]

/** A subscription as stored: the login command is derived from the agent spec on load. */
export type StoredSubscription = Omit<Subscription, 'loginCommand'>

const threadRow = z.object({
  id: z.string(),
  agent_id: z.enum(AGENT_IDS as [AgentId, ...AgentId[]]),
  subscription_id: z.string(),
  cwd: z.string(),
  title: z.string(),
  created_at: z.number(),
  acp_session_id: z.string().nullable(),
  config_json: z.string(),
  last_status: z.string(),
})

const subscriptionRow = z.object({
  id: z.string(),
  agent_id: z.enum(AGENT_IDS as [AgentId, ...AgentId[]]),
  label: z.string(),
  config_dir: z.string(),
  created_at: z.number(),
  account_json: z.string(),
})

const taskStatusRow = z.object({
  id: z.string(),
  project: z.string(),
  name: z.string(),
  color: z.enum(STATUS_COLORS),
  kind: z.enum(STATUS_KINDS),
  position: z.number(),
})

const taskRow = z.object({
  id: z.string(),
  project: z.string(),
  number: z.number(),
  title: z.string(),
  description: z.string(),
  status_id: z.string(),
  position: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

const itemRow = z.object({ thread_id: z.string(), json: z.string() })
const settingRow = z.object({ value_json: z.string() })

export class ThreadDb {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    const current = Number(z.object({ user_version: z.number() }).parse(this.db.prepare('PRAGMA user_version').get()).user_version)
    for (let version = current; version < MIGRATIONS.length; version++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[version]!)
        this.db.exec(`PRAGMA user_version = ${version + 1}`)
      })
    }
  }

  /**
   * Rows are trusted as Oniko's own writes: scalar columns are checked, JSON payloads are not
   * re-validated item by item. A thread without a subscription waits for the first one to be added
   * (see assignOrphanThreads) and is not loaded until then.
   */
  loadThreads(): Thread[] {
    const items = new Map<string, TimelineItem[]>()
    for (const raw of this.db.prepare('SELECT thread_id, json FROM timeline_items ORDER BY thread_id, seq').all()) {
      const row = itemRow.parse(raw)
      const list = items.get(row.thread_id) ?? []
      list.push(JSON.parse(row.json) as TimelineItem)
      items.set(row.thread_id, list)
    }
    return this.db
      .prepare('SELECT * FROM threads WHERE subscription_id IS NOT NULL ORDER BY created_at DESC')
      .all()
      .map((raw) => {
        const row = threadRow.parse(raw)
        return {
          id: row.id as ThreadId,
          agentId: row.agent_id,
          subscriptionId: row.subscription_id as SubscriptionId,
          cwd: row.cwd,
          title: row.title,
          createdAt: row.created_at,
          acpSessionId: row.acp_session_id,
          status: JSON.parse(row.last_status) as ThreadStatus,
          timeline: items.get(row.id) ?? [],
          config: JSON.parse(row.config_json) as ConfigControl[],
          commands: [],
        }
      })
  }

  /**
   * Writes the difference between two reduced states of one thread. The reducer never mutates,
   * so an item whose reference is unchanged is unchanged; a streaming chunk rewrites one row.
   */
  saveChange(id: ThreadId, prev: Thread | undefined, next: Thread | undefined): void {
    if (prev === next) return
    this.transaction(() => {
      if (!next) {
        this.db.prepare('DELETE FROM threads WHERE id = ?').run(id)
        return
      }
      this.db
        .prepare(
          `INSERT INTO threads (id, agent_id, subscription_id, cwd, title, created_at, updated_at, acp_session_id, config_json, last_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at,
             acp_session_id = excluded.acp_session_id, config_json = excluded.config_json, last_status = excluded.last_status`,
        )
        .run(next.id, next.agentId, next.subscriptionId, next.cwd, next.title, next.createdAt, Date.now(), next.acpSessionId, JSON.stringify(next.config), JSON.stringify(next.status))
      const upsert = this.db.prepare(
        `INSERT INTO timeline_items (thread_id, seq, item_id, kind, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, item_id) DO UPDATE SET seq = excluded.seq, kind = excluded.kind, json = excluded.json`,
      )
      next.timeline.forEach((item, seq) => {
        if (prev?.timeline[seq] !== item) upsert.run(next.id, seq, item.id, item.kind, JSON.stringify(item))
      })
    })
  }

  loadSubscriptions(): StoredSubscription[] {
    return this.db
      .prepare('SELECT * FROM subscriptions ORDER BY created_at')
      .all()
      .map((raw) => {
        const row = subscriptionRow.parse(raw)
        return {
          id: row.id as SubscriptionId,
          agentId: row.agent_id,
          label: row.label,
          configDir: row.config_dir,
          createdAt: row.created_at,
          account: JSON.parse(row.account_json) as AccountStatus,
        }
      })
  }

  saveSubscription(sub: StoredSubscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, agent_id, label, config_dir, created_at, account_json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, account_json = excluded.account_json`,
      )
      .run(sub.id, sub.agentId, sub.label, sub.configDir, sub.createdAt, JSON.stringify(sub.account))
  }

  deleteSubscription(id: SubscriptionId): void {
    this.db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
  }

  /** Gives every thread that predates subscriptions to this one; returns how many it adopted. */
  assignOrphanThreads(id: SubscriptionId): number {
    return Number(this.db.prepare('UPDATE threads SET subscription_id = ? WHERE subscription_id IS NULL').run(id).changes)
  }

  loadTaskStatuses(): TaskStatus[] {
    return this.db
      .prepare('SELECT * FROM task_statuses ORDER BY project, position')
      .all()
      .map((raw) => {
        const row = taskStatusRow.parse(raw)
        return { id: row.id as TaskStatusId, project: row.project, name: row.name, color: row.color, kind: row.kind, position: row.position }
      })
  }

  saveTaskStatus(status: TaskStatus): void {
    this.db
      .prepare(
        `INSERT INTO task_statuses (id, project, name, color, kind, position) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, kind = excluded.kind, position = excluded.position`,
      )
      .run(status.id, status.project, status.name, status.color, status.kind, status.position)
  }

  /** Moves the status's tasks to the end of `fallback`, keeping their order, then drops the status. */
  deleteTaskStatus(id: TaskStatusId, fallback: TaskStatusId): void {
    this.transaction(() => {
      const { last } = z
        .object({ last: z.number().nullable() })
        .parse(this.db.prepare('SELECT MAX(position) AS last FROM tasks WHERE status_id = ?').get(fallback))
      const { first } = z
        .object({ first: z.number().nullable() })
        .parse(this.db.prepare('SELECT MIN(position) AS first FROM tasks WHERE status_id = ?').get(id))
      const shift = last === null || first === null ? 0 : last - first + 1
      this.db.prepare('UPDATE tasks SET status_id = ?, position = position + ? WHERE status_id = ?').run(fallback, shift, id)
      this.db.prepare('DELETE FROM task_statuses WHERE id = ?').run(id)
    })
  }

  loadTasks(): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks ORDER BY project, position')
      .all()
      .map((raw) => {
        const row = taskRow.parse(raw)
        return {
          id: row.id as TaskId,
          project: row.project,
          number: row.number,
          title: row.title,
          description: row.description,
          statusId: row.status_id as TaskStatusId,
          position: row.position,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      })
  }

  saveTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, project, number, title, description, status_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, status_id = excluded.status_id,
           position = excluded.position, updated_at = excluded.updated_at`,
      )
      .run(task.id, task.project, task.number, task.title, task.description, task.statusId, task.position, task.createdAt, task.updatedAt)
  }

  deleteTask(id: TaskId): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  getSetting<T>(key: string, schema: z.ZodType<T>): T | null {
    const raw = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)
    if (!raw) return null
    const parsed = schema.safeParse(JSON.parse(settingRow.parse(raw).value_json))
    return parsed.success ? parsed.data : null
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(key, JSON.stringify(value))
  }

  close(): void {
    this.db.close()
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
