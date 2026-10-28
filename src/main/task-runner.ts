import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { newThreadConfig } from '@shared/config'
import type { ThreadEvent } from '@shared/events'
import type { Subscription } from '@shared/subscriptions'
import { projectStatuses, taskBranch, taskKey, taskThreadId, type Task, type TaskId, type TaskStatus } from '@shared/tasks'
import type { ThreadId } from '@shared/thread'
import type { AgentSession } from './agent-session'
import type { SubscriptionStore } from './subscription-store'
import type { TaskStore } from './task-store'
import type { ThreadStore } from './thread-store'

export type Git = (cwd: string, args: string[]) => Promise<string>

export type TaskNotice = { title: string; body: string; threadId: ThreadId }

export type TaskRunnerDeps = {
  tasks: TaskStore
  threads: Pick<ThreadStore, 'create' | 'list'> & { session(id: ThreadId): Pick<AgentSession, 'prompt'> }
  subscriptions: Pick<SubscriptionStore, 'get' | 'active'>
  /** Worktrees go in `<root>/<project folder>/<branch>`. */
  worktreeRoot: string
  git: Git
  notify: (notice: TaskNotice) => void
}

export const git: Git = (cwd, args) =>
  new Promise((done, fail) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) fail(new Error(stderr.trim() || error.message))
      else done(stdout)
    })
  })

export function taskPrompt(task: Task, branch: string): string {
  return [
    `${taskKey(task)}: ${task.title}`,
    task.description,
    `You are working in a git worktree of ${task.project} on the branch \`${branch}\`, made for this task alone. ` +
      'When the work is done, commit it on this branch with a clear message.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function pullRequestPrompt(branch: string): string {
  return (
    `Commit anything left uncommitted, push \`${branch}\` to origin and open a pull request for it with \`gh pr create\`, ` +
    'with a title and description that explain the change. Reply with the pull request URL.'
  )
}

/**
 * Puts an agent on a task: a task entering a "Not started" status gets its own worktree and a thread
 * there, moves to the first "In progress" status, and the user hears from it by notification.
 */
export class TaskRunner {
  constructor(private readonly deps: TaskRunnerDeps) {
    // A start the app quit in the middle of never finished; it is retried like a failure.
    for (const task of deps.tasks.state().tasks) {
      if (task.run?.stage === 'starting') deps.tasks.setRun(task.id, { stage: 'failed', error: 'Oniko quit before the agent started' })
    }
  }

  entered(task: Task, status: TaskStatus): void {
    if (status.kind !== 'unstarted' || (task.run && task.run.stage !== 'failed')) return
    void this.start(task.id)
  }

  private async start(id: TaskId): Promise<void> {
    const { tasks, threads } = this.deps
    tasks.setRun(id, { stage: 'starting' })
    try {
      const subscription = this.subscriptionFor(tasks.get(id))
      const { worktree, branch } = await this.worktreeFor(this.require(id))
      const task = this.require(id)
      const config = Object.fromEntries(newThreadConfig(threads.list(), subscription.agentId, subscription.id).map((c) => [c.id, c.value]))
      const threadId = threads.create(subscription, worktree, config, `${taskKey(task)}: ${task.title}`)
      tasks.setRun(id, { stage: 'working', threadId, worktree, branch })
      const started = projectStatuses(tasks.state(), task.project).find((s) => s.kind === 'started')
      if (started) tasks.move(id, started.id, null)
      void threads.session(threadId).prompt(taskPrompt(task, branch))
    } catch (error) {
      // The task may have been deleted while git ran.
      if (tasks.get(id)) tasks.setRun(id, { stage: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Follows a task's thread: asks for the pull request after the first turn, and notifies on what needs the user. */
  onThreadEvent(event: ThreadEvent): void {
    const task = this.deps.tasks.state().tasks.find((t) => taskThreadId(t) === event.threadId)
    const run = task?.run
    if (!task || !run || !('threadId' in run)) return
    const key = taskKey(task)
    const notify = (title: string, body: string) => this.deps.notify({ title, body, threadId: run.threadId })

    if (event.type === 'thread_removed') {
      // The worktree stays on disk; entering "Not started" again starts a fresh thread in it.
      this.deps.tasks.setRun(task.id, null)
    } else if (event.type === 'permission_request') {
      notify(`${key} needs your approval`, event.toolCall.title ?? task.title)
    } else if (event.type === 'status' && event.status.kind === 'error') {
      notify(`${key}: the agent failed`, event.status.message)
    } else if (event.type === 'turn_end' && event.stopReason !== 'cancelled') {
      if (run.stage === 'working' && task.pullRequest) {
        this.deps.tasks.setRun(task.id, { ...run, stage: 'pull_request' })
        notify(`${key}: work done, opening a pull request`, task.title)
        void this.deps.threads.session(run.threadId).prompt(pullRequestPrompt(run.branch))
        return
      }
      if (run.stage !== 'finished') this.deps.tasks.setRun(task.id, { ...run, stage: 'finished' })
      notify(run.stage === 'pull_request' ? `${key}: pull request step done` : `${key}: the agent finished`, task.title)
    }
  }

  private subscriptionFor(task: Task | undefined): Subscription {
    const assigned = task?.subscriptionId ? this.deps.subscriptions.get(task.subscriptionId) : undefined
    const subscription = assigned ?? this.deps.subscriptions.active()
    if (!subscription) throw new Error('Add a subscription in Settings')
    return subscription
  }

  /** Reuses the task's worktree from an earlier run; refuses a folder that is not one of this repo's worktrees. */
  private async worktreeFor(task: Task): Promise<{ worktree: string; branch: string }> {
    const { git, worktreeRoot } = this.deps
    const branch = taskBranch(task)
    const worktree = join(worktreeRoot, basename(task.project), branch)
    await git(task.project, ['rev-parse', '--is-inside-work-tree']).catch(() => {
      throw new Error(`${task.project} is not a git repository`)
    })
    if (existsSync(worktree)) {
      const listed = (await git(task.project, ['worktree', 'list', '--porcelain']))
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => resolve(line.slice('worktree '.length)))
      // Git may print the canonical path, which differs where a parent is a symlink (macOS's /var).
      const here = [resolve(worktree), realpathSync(worktree)]
      if (listed.some((path) => here.includes(path))) return { worktree, branch }
      throw new Error(`${worktree} already exists and is not a worktree of ${task.project}`)
    }
    mkdirSync(join(worktreeRoot, basename(task.project)), { recursive: true })
    const hasBranch = (await git(task.project, ['branch', '--list', branch])).trim() !== ''
    await git(task.project, hasBranch ? ['worktree', 'add', worktree, branch] : ['worktree', 'add', '-b', branch, worktree])
    return { worktree, branch }
  }

  private require(id: TaskId): Task {
    const task = this.deps.tasks.get(id)
    if (!task) throw new Error('The task was deleted')
    return task
  }
}
