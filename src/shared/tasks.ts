import type { SubscriptionId } from './subscriptions'
import type { Thread, ThreadId } from './thread'

export type TaskId = string & { __brand: 'TaskId' }
export type TaskStatusId = string & { __brand: 'TaskStatusId' }

/** Projects are keyed by their folder, the same `cwd` threads are grouped by. */
export type TaskStatus = {
  id: TaskStatusId
  project: string
  name: string
  color: StatusColor
  /** Which part of the workflow the status stands for; it picks the icon, as in Linear. */
  kind: StatusKind
  /** Orders columns; fractional so a status can be placed between two others without renumbering. */
  position: number
}

export type Task = {
  id: TaskId
  project: string
  /** Per project, from 1, never reused while the task exists; shown as `ONI-12`. */
  number: number
  title: string
  description: string
  statusId: TaskStatusId
  /** Orders tasks inside their status. */
  position: number
  createdAt: number
  updatedAt: number
  /** The subscription the agent runs on; null means whichever is active when it starts. Fixed once a thread exists. */
  subscriptionId: SubscriptionId | null
  /** After the agent's first turn, ask it to push the branch and open a pull request. */
  pullRequest: boolean
  run: TaskRun | null
}

/**
 * The agent working a task, from the moment the task enters a "Not started" status. A failed run
 * is retried by moving the task into one again.
 */
export type TaskRun =
  | { stage: 'starting' }
  | { stage: 'failed'; error: string }
  | { stage: 'working' | 'pull_request' | 'finished'; threadId: ThreadId; worktree: string; branch: string }

export type TasksState = { statuses: TaskStatus[]; tasks: Task[] }

export const EMPTY_TASKS: TasksState = { statuses: [], tasks: [] }

export const STATUS_COLORS = ['slate', 'blue', 'amber', 'green', 'violet', 'rose', 'cyan', 'orange'] as const
export type StatusColor = (typeof STATUS_COLORS)[number]

export const STATUS_KINDS = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const
export type StatusKind = (typeof STATUS_KINDS)[number]

export const STATUS_KIND_LABELS: Record<StatusKind, string> = {
  backlog: 'Backlog',
  unstarted: 'Not started',
  started: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled',
}

/** Every project starts with these; the user can rename, remove or add to them. */
export const DEFAULT_STATUSES: readonly { name: string; color: StatusColor; kind: StatusKind }[] = [
  { name: 'Backlog', color: 'slate', kind: 'backlog' },
  { name: 'To do', color: 'slate', kind: 'unstarted' },
  { name: 'In progress', color: 'amber', kind: 'started' },
  { name: 'Done', color: 'violet', kind: 'completed' },
]

/** A new custom status takes the first color the project is not using yet. */
export function nextStatusColor(existing: TaskStatus[]): StatusColor {
  const used = new Set(existing.map((s) => s.color))
  return STATUS_COLORS.find((c) => !used.has(c)) ?? STATUS_COLORS[existing.length % STATUS_COLORS.length]!
}

export function projectStatuses(state: TasksState, project: string): TaskStatus[] {
  return state.statuses.filter((s) => s.project === project).sort((a, b) => a.position - b.position)
}

export function statusTasks(state: TasksState, statusId: TaskStatusId): Task[] {
  return state.tasks.filter((t) => t.statusId === statusId).sort((a, b) => a.position - b.position)
}

/** Projects that have a board, so one outlives its last thread. */
export function taskProjects(state: TasksState): string[] {
  return [...new Set(state.statuses.map((s) => s.project))]
}

/** `ONI` for a folder named `oniko`: the first three letters or digits of the folder name. */
export function projectKey(project: string): string {
  const name = project.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  return name.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'TSK'
}

export function taskKey(task: Pick<Task, 'project' | 'number'>): string {
  return `${projectKey(task.project)}-${task.number}`
}

/** `oni-12-fix-the-login-form`: the key plus a slug of the title, used for both the branch and the worktree folder. */
export function taskBranch(task: Pick<Task, 'project' | 'number' | 'title'>): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '')
  return [taskKey(task).toLowerCase(), slug].filter(Boolean).join('-')
}

export function taskThreadId(task: Task): ThreadId | null {
  return task.run && 'threadId' in task.run ? task.run.threadId : null
}

/** A task's thread runs in its worktree, but belongs under the task's project. */
export function threadProject(state: TasksState, thread: Pick<Thread, 'id' | 'cwd'>): string {
  return state.tasks.find((t) => taskThreadId(t) === thread.id)?.project ?? thread.cwd
}

/** Tasks of a project in the order the list shows them: by status, then by position. */
export function projectTasks(state: TasksState, project: string): Task[] {
  return projectStatuses(state, project).flatMap((s) => statusTasks(state, s.id))
}

/** A position that sorts after `before` and ahead of `after`; either end may be open. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}
