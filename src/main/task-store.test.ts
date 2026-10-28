import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, projectStatuses, statusTasks, type TasksState } from '@shared/tasks'
import { ThreadDb } from './db'
import { TaskStore } from './task-store'

let dir: string
let db: ThreadDb
let published: TasksState[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oniko-tasks-'))
  db = new ThreadDb(join(dir, 'oniko.db'))
  published = []
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const project = '/work/app'
const newStore = () => new TaskStore({ db, publish: (e) => published.push(e.state) })

function opened() {
  const store = newStore()
  store.open(project)
  const [backlog, todo, , done] = projectStatuses(store.state(), project)
  return { store, backlog: backlog!, todo: todo!, done: done! }
}

const titles = (store: TaskStore, statusId: Parameters<typeof statusTasks>[1]) => statusTasks(store.state(), statusId).map((t) => t.title)

describe('TaskStore', () => {
  it('seeds the default statuses once per project and broadcasts them', () => {
    const store = newStore()
    store.open(project)
    store.open(project)
    expect(projectStatuses(store.state(), project).map((s) => s.name)).toEqual(DEFAULT_STATUSES.map((s) => s.name))
    expect(projectStatuses(store.state(), '/other')).toEqual([])
    expect(published).toHaveLength(1)
  })

  it('creates, edits and persists a task with a name and description', () => {
    const { store, todo } = opened()
    const id = store.create({ project, title: '  Ship tasks ', description: 'List and board', statusId: todo.id })
    store.update(id, { description: 'List, board, custom statuses' })
    expect(newStore().state().tasks).toMatchObject([{ id, title: 'Ship tasks', description: 'List, board, custom statuses', statusId: todo.id }])
    expect(() => store.update(id, { title: '   ' })).toThrow('needs a name')
  })

  it('moves a task between statuses and orders it ahead of another', () => {
    const { store, backlog, todo } = opened()
    const a = store.create({ project, title: 'a', description: '', statusId: backlog.id })
    const b = store.create({ project, title: 'b', description: '', statusId: backlog.id })
    const c = store.create({ project, title: 'c', description: '', statusId: todo.id })
    store.move(b, todo.id, c)
    expect(titles(store, todo.id)).toEqual(['b', 'c'])
    store.move(a, todo.id, null)
    expect(titles(store, todo.id)).toEqual(['b', 'c', 'a'])
    store.move(a, todo.id, b)
    expect(titles(store, todo.id)).toEqual(['a', 'b', 'c'])
    expect(titles(store, backlog.id)).toEqual([])
  })

  it('adds and renames custom statuses after the defaults', () => {
    const { store } = opened()
    const id = store.addStatus(project, 'Review')
    store.updateStatus(id, { name: 'Code review' })
    const statuses = projectStatuses(newStore().state(), project)
    expect(statuses.map((s) => s.name)).toEqual([...DEFAULT_STATUSES.map((s) => s.name), 'Code review'])
    expect(statuses.slice(0, -1).map((s) => s.color)).not.toContain(statuses.at(-1)!.color)
  })

  it('moves a removed status’s tasks to the end of the first remaining one, and keeps the last status', () => {
    const { store, backlog, todo, done } = opened()
    store.create({ project, title: 'old', description: '', statusId: backlog.id })
    store.create({ project, title: 'x', description: '', statusId: todo.id })
    store.create({ project, title: 'y', description: '', statusId: todo.id })
    store.removeStatus(todo.id)
    expect(titles(store, backlog.id)).toEqual(['old', 'x', 'y'])
    store.removeStatus(backlog.id)
    expect(titles(store, projectStatuses(store.state(), project)[0]!.id)).toEqual(['old', 'x', 'y'])
    for (const s of projectStatuses(store.state(), project).slice(0, -1)) store.removeStatus(s.id)
    expect(projectStatuses(store.state(), project).map((s) => s.id)).toEqual([done.id])
    expect(() => store.removeStatus(done.id)).toThrow('at least one status')
  })
})

describe('task numbers and status kinds', () => {
  it('numbers tasks per project and gives defaults their workflow kind', () => {
    const { store, todo } = opened()
    const a = store.create({ project, title: 'a', description: '', statusId: todo.id })
    const b = store.create({ project, title: 'b', description: '', statusId: todo.id })
    store.open('/other')
    const other = store.create({ project: '/other', title: 'c', description: '', statusId: projectStatuses(store.state(), '/other')[0]!.id })
    const numbers = Object.fromEntries(store.state().tasks.map((t) => [t.id, t.number]))
    expect([numbers[a], numbers[b], numbers[other]]).toEqual([1, 2, 1])
    expect(projectStatuses(store.state(), project).map((s) => s.kind)).toEqual(['backlog', 'unstarted', 'started', 'completed'])
    const review = store.addStatus(project, 'Review')
    store.updateStatus(review, { kind: 'canceled' })
    expect(store.state().statuses.find((s) => s.id === review)!.kind).toBe('canceled')
  })
})
