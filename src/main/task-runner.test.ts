import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Subscription, SubscriptionId } from '@shared/subscriptions'
import { projectStatuses, type Task, type TaskId } from '@shared/tasks'
import type { ThreadId } from '@shared/thread'
import { ThreadDb } from './db'
import { git, TaskRunner, type TaskNotice } from './task-runner'
import { TaskStore } from './task-store'

let dir: string
let repo: string
let db: ThreadDb

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oniko-runner-'))
  repo = join(dir, 'app')
  mkdirSync(repo)
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  run('init', '-q', '-b', 'main')
  run('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  db = new ThreadDb(join(dir, 'oniko.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const subscription = (id: string, label: string): Subscription => ({
  id: id as SubscriptionId,
  agentId: 'claude',
  label,
  configDir: `/cfg/${id}`,
  createdAt: 1,
  account: { kind: 'unknown' },
  loginCommand: 'login',
})
const work = subscription('work', 'Work')
const personal = subscription('personal', 'Personal')

function setup(project = repo) {
  const prompts: { threadId: ThreadId; text: string }[] = []
  const created: { subscriptionId: SubscriptionId; cwd: string; title: string | undefined }[] = []
  const notices: TaskNotice[] = []
  let runner: TaskRunner | undefined
  const tasks = new TaskStore({ db, publish: () => {}, entered: (task, status) => runner?.entered(task, status) })
  runner = new TaskRunner({
    tasks,
    threads: {
      list: () => [],
      create: (sub, cwd, _config, title) => {
        created.push({ subscriptionId: sub.id, cwd, title })
        return `thread-${created.length}` as ThreadId
      },
      session: (threadId) => ({ prompt: async (text) => void prompts.push({ threadId, text }) }),
    },
    subscriptions: { get: (id) => [work, personal].find((s) => s.id === id), active: () => work },
    worktreeRoot: join(dir, 'worktrees'),
    git,
    notify: (notice) => notices.push(notice),
  })
  tasks.open(project)
  const [backlog, todo, inProgress] = projectStatuses(tasks.state(), project)
  return { tasks, runner, prompts, created, notices, backlog: backlog!, todo: todo!, inProgress: inProgress! }
}

const settled = async (tasks: TaskStore, id: TaskId): Promise<Task> => {
  await vi.waitFor(() => expect(['starting', undefined]).not.toContain(tasks.get(id)?.run?.stage))
  return tasks.get(id)!
}

describe('TaskRunner', () => {
  it('leaves tasks alone outside "Not started"', () => {
    const { tasks, backlog, inProgress, created } = setup()
    const id = tasks.create({ project: repo, title: 'Fix login', description: '', statusId: backlog.id })
    tasks.move(id, inProgress.id, null)
    expect(tasks.get(id)!.run).toBeNull()
    expect(created).toEqual([])
  })

  it('makes a worktree on its own branch, starts a thread on the assigned subscription, and moves to In progress', async () => {
    const { tasks, backlog, todo, inProgress, created, prompts } = setup()
    const id = tasks.create({ project: repo, title: 'Fix the login form', description: 'It rejects valid emails.', statusId: backlog.id })
    tasks.update(id, { subscriptionId: personal.id })
    tasks.move(id, todo.id, null)

    const task = await settled(tasks, id)
    const worktree = join(dir, 'worktrees', 'app', 'app-1-fix-the-login-form')
    expect(task.run).toEqual({ stage: 'working', threadId: 'thread-1', worktree, branch: 'app-1-fix-the-login-form' })
    expect(task.statusId).toBe(inProgress.id)
    expect(created).toEqual([{ subscriptionId: personal.id, cwd: worktree, title: 'APP-1: Fix the login form' }])
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: worktree }).toString().trim()).toBe('app-1-fix-the-login-form')
    expect(prompts[0]!.text).toMatch(/^APP-1: Fix the login form\n\nIt rejects valid emails\.\n\n/)
    expect(() => tasks.update(id, { subscriptionId: work.id })).toThrow(/already started/)
  })

  it('records a failure outside a git repo and retries when moved back', async () => {
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    const { tasks, todo, backlog } = setup(plain)
    const id = tasks.create({ project: plain, title: 'Anything', description: '', statusId: todo.id })
    expect((await settled(tasks, id)).run).toEqual({ stage: 'failed', error: `${plain} is not a git repository` })

    execFileSync('git', ['init', '-q'], { cwd: plain })
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: plain })
    tasks.move(id, backlog.id, null)
    tasks.move(id, todo.id, null)
    expect((await settled(tasks, id)).run?.stage).toBe('working')
  })

  it('asks for a pull request after the first turn when enabled, then notifies', async () => {
    const { tasks, runner, todo, backlog, prompts, notices } = setup()
    const id = tasks.create({ project: repo, title: 'Ship it', description: '', statusId: backlog.id })
    tasks.update(id, { pullRequest: true })
    tasks.move(id, todo.id, null)
    await settled(tasks, id)
    const threadId = 'thread-1' as ThreadId

    runner.onThreadEvent({ threadId, type: 'turn_end', stopReason: 'end_turn', durationMs: 1 })
    expect(tasks.get(id)!.run?.stage).toBe('pull_request')
    expect(prompts.at(-1)!.text).toContain('gh pr create')

    runner.onThreadEvent({ threadId, type: 'turn_end', stopReason: 'end_turn', durationMs: 1 })
    expect(tasks.get(id)!.run?.stage).toBe('finished')
    expect(notices.map((n) => n.title)).toEqual(['APP-1: work done, opening a pull request', 'APP-1: pull request step done'])
  })

  it('finishes without a pull request, notifies on approvals, and ignores a cancelled turn', async () => {
    const { tasks, runner, todo, prompts, notices } = setup()
    const id = tasks.create({ project: repo, title: 'Small fix', description: '', statusId: todo.id })
    await settled(tasks, id)
    const threadId = 'thread-1' as ThreadId

    runner.onThreadEvent({ threadId, type: 'permission_request', requestId: 'r', toolCall: { toolCallId: 'c', title: 'Run pnpm test' }, options: [] })
    runner.onThreadEvent({ threadId, type: 'turn_end', stopReason: 'cancelled', durationMs: 1 })
    expect(tasks.get(id)!.run?.stage).toBe('working')
    runner.onThreadEvent({ threadId, type: 'turn_end', stopReason: 'end_turn', durationMs: 1 })
    expect(tasks.get(id)!.run?.stage).toBe('finished')
    expect(prompts).toHaveLength(1)
    expect(notices).toEqual([
      { title: 'APP-1 needs your approval', body: 'Run pnpm test', threadId },
      { title: 'APP-1: the agent finished', body: 'Small fix', threadId },
    ])
  })

  it('reuses the worktree for a fresh thread after the old one is removed', async () => {
    const { tasks, runner, todo, backlog, created } = setup()
    const id = tasks.create({ project: repo, title: 'Again', description: '', statusId: todo.id })
    const first = await settled(tasks, id)
    runner.onThreadEvent({ threadId: 'thread-1' as ThreadId, type: 'thread_removed' })
    expect(tasks.get(id)!.run).toBeNull()

    tasks.move(id, backlog.id, null)
    tasks.move(id, todo.id, null)
    const second = await settled(tasks, id)
    expect(second.run).toMatchObject({ stage: 'working', threadId: 'thread-2' })
    expect(created[1]!.cwd).toBe(created[0]!.cwd)
    expect(first.run && 'worktree' in first.run && existsSync(first.run.worktree)).toBe(true)
  })

  it('turns a start interrupted by quitting into a failure on launch', () => {
    const { tasks, backlog } = setup()
    const id = tasks.create({ project: repo, title: 'Interrupted', description: '', statusId: backlog.id })
    tasks.setRun(id, { stage: 'starting' })
    const reopened = new TaskStore({ db, publish: () => {} })
    new TaskRunner({
      tasks: reopened,
      threads: { list: () => [], create: () => 'x' as ThreadId, session: () => ({ prompt: async () => {} }) },
      subscriptions: { get: () => undefined, active: () => work },
      worktreeRoot: join(dir, 'worktrees'),
      git,
      notify: () => {},
    })
    expect(reopened.get(id)!.run).toEqual({ stage: 'failed', error: 'Oniko quit before the agent started' })
  })
})
