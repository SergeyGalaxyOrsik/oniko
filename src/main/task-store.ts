import { randomUUID } from 'node:crypto'
import type { TasksEvent } from '@shared/events'
import {
  DEFAULT_STATUSES,
  nextStatusColor,
  positionBetween,
  projectStatuses,
  statusTasks,
  type StatusKind,
  type Task,
  type TaskId,
  type TasksState,
  type TaskStatus,
  type TaskStatusId,
} from '@shared/tasks'
import type { ThreadDb } from './db'

export type TaskStoreDeps = {
  db: ThreadDb
  publish: (event: TasksEvent) => void
}

/** Every project's tasks and statuses; main is authoritative, writes through to the db and broadcasts the whole state. */
export class TaskStore {
  private current: TasksState

  constructor(private readonly deps: TaskStoreDeps) {
    this.current = { statuses: deps.db.loadTaskStatuses(), tasks: deps.db.loadTasks() }
  }

  state(): TasksState {
    return this.current
  }

  /** A project gets the default statuses the first time its board is opened. */
  open(project: string): void {
    if (projectStatuses(this.current, project).length) return
    DEFAULT_STATUSES.forEach(({ name, color, kind }, i) => {
      this.deps.db.saveTaskStatus({ id: randomUUID() as TaskStatusId, project, name, color, kind, position: i + 1 })
    })
    this.reload()
  }

  create(input: { project: string; title: string; description: string; statusId: TaskStatusId }): TaskId {
    const status = this.status(input.statusId)
    if (status.project !== input.project) throw new Error('That status belongs to another project')
    const now = Date.now()
    const id = randomUUID() as TaskId
    this.deps.db.saveTask({
      id,
      project: input.project,
      number: Math.max(0, ...this.current.tasks.filter((t) => t.project === input.project).map((t) => t.number)) + 1,
      title: requireTitle(input.title),
      description: input.description.trim(),
      statusId: status.id,
      position: positionBetween(statusTasks(this.current, status.id).at(-1)?.position, undefined),
      createdAt: now,
      updatedAt: now,
    })
    this.reload()
    return id
  }

  update(id: TaskId, patch: { title?: string; description?: string }): void {
    const task = this.task(id)
    this.deps.db.saveTask({
      ...task,
      ...(patch.title !== undefined ? { title: requireTitle(patch.title) } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      updatedAt: Date.now(),
    })
    this.reload()
  }

  /** Puts the task into `statusId` just ahead of `beforeId`, or last when there is none. */
  move(id: TaskId, statusId: TaskStatusId, beforeId: TaskId | null): void {
    const task = this.task(id)
    const status = this.status(statusId)
    if (status.project !== task.project) throw new Error('That status belongs to another project')
    const siblings = statusTasks(this.current, statusId).filter((t) => t.id !== id)
    const index = beforeId ? siblings.findIndex((t) => t.id === beforeId) : -1
    const at = index === -1 ? siblings.length : index
    const position = positionBetween(siblings[at - 1]?.position, siblings[at]?.position)
    if (task.statusId === statusId && task.position === position) return
    this.deps.db.saveTask({ ...task, statusId, position, updatedAt: Date.now() })
    this.reload()
  }

  remove(id: TaskId): void {
    this.deps.db.deleteTask(id)
    this.reload()
  }

  addStatus(project: string, name: string): TaskStatusId {
    const existing = projectStatuses(this.current, project)
    const id = randomUUID() as TaskStatusId
    this.deps.db.saveTaskStatus({
      id,
      project,
      name: requireName(name),
      color: nextStatusColor(existing),
      kind: 'started',
      position: positionBetween(existing.at(-1)?.position, undefined),
    })
    this.reload()
    return id
  }

  updateStatus(id: TaskStatusId, patch: { name?: string; kind?: StatusKind }): void {
    const status = this.status(id)
    this.deps.db.saveTaskStatus({
      ...status,
      ...(patch.name !== undefined ? { name: requireName(patch.name) } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    })
    this.reload()
  }

  /** A project keeps at least one status; tasks in a removed one move to the first that remains. */
  removeStatus(id: TaskStatusId): void {
    const status = this.status(id)
    const fallback = projectStatuses(this.current, status.project).find((s) => s.id !== id)
    if (!fallback) throw new Error('A project needs at least one status')
    this.deps.db.deleteTaskStatus(id, fallback.id)
    this.reload()
  }

  private task(id: TaskId): Task {
    const task = this.current.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`Unknown task ${id}`)
    return task
  }

  private status(id: TaskStatusId): TaskStatus {
    const status = this.current.statuses.find((s) => s.id === id)
    if (!status) throw new Error(`Unknown status ${id}`)
    return status
  }

  /** Re-reading after each write keeps memory identical to the db, including what a status removal moved. */
  private reload(): void {
    this.current = { statuses: this.deps.db.loadTaskStatuses(), tasks: this.deps.db.loadTasks() }
    this.deps.publish({ type: 'tasks', state: this.current })
  }
}

function requireTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('A task needs a name')
  return trimmed
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A status needs a name')
  return trimmed
}
