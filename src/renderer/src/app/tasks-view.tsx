import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronRight, Ellipsis, List, Pencil, Plus, SquareKanban, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { SubscriptionsState } from '@shared/subscriptions'
import type { ThreadId, ThreadMap } from '@shared/thread'
import {
  projectStatuses,
  projectTasks,
  STATUS_KIND_LABELS,
  STATUS_KINDS,
  statusTasks,
  taskKey,
  type StatusKind,
  type Task,
  type TaskId,
  type TasksState,
  type TaskStatus,
  type TaskStatusId,
} from '@shared/tasks'
import { NewTaskDialog } from './task-dialog'
import { TaskPage } from './task-page'
import { StatusIcon, StatusMenu } from './task-status'

type Layout = 'list' | 'board'
const LAYOUT_KEY = 'oniko.tasks.layout'

/** The layout is a per-window convenience, so it lives in localStorage and falls back to the list. */
function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'list'
    } catch {
      return 'list'
    }
  })
  const set = (next: Layout) => {
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // Not remembering the layout is harmless.
    }
  }
  return [layout, set]
}

const shortDate = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  const options: { value: Layout; label: string; icon: ReactNode }[] = [
    { value: 'list', label: 'List', icon: <List /> },
    { value: 'board', label: 'Board', icon: <SquareKanban /> },
  ]
  return (
    <div role="radiogroup" aria-label="Layout" className="flex items-center rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={layout === o.value}
          aria-label={o.label}
          title={o.label}
          data-layout={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5',
            layout === o.value && 'bg-accent text-foreground',
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

/** Rename, change the workflow type, or delete a status; a deleted status's tasks move to the first one left. */
function StatusOptions({ status, statuses, count, onRename }: { status: TaskStatus; statuses: TaskStatus[]; count: number; onRename: () => void }) {
  const fallback = statuses.find((s) => s.id !== status.id)
  // The rename input mounts only once the menu has closed: while it is open, the menu holds focus.
  const renaming = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`${status.name} options`} data-testid="status-menu">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        onCloseAutoFocus={(e) => {
          if (!renaming.current) return
          renaming.current = false
          e.preventDefault()
          onRename()
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true
          }}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <StatusIcon status={status} statuses={statuses} className="text-muted-foreground" />
            Type
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={status.kind} onValueChange={(kind) => void window.oniko.tasks.updateStatus(status.id, { kind: kind as StatusKind })}>
              {STATUS_KINDS.map((kind) => (
                <DropdownMenuRadioItem key={kind} value={kind}>
                  {STATUS_KIND_LABELS[kind]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!fallback} onSelect={() => void window.oniko.tasks.removeStatus(status.id)}>
          <Trash2 />
          <span className="flex flex-col">
            Delete status
            {fallback && count ? (
              <span className="text-xs text-muted-foreground">
                {count} task{count === 1 ? '' : 's'} move{count === 1 ? 's' : ''} to {fallback.name}
              </span>
            ) : null}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A status name that turns into an input while renaming; Enter or blur saves, Esc cancels. */
function StatusName({ status, editing, onDone }: { status: TaskStatus; editing: boolean; onDone: () => void }) {
  const [name, setName] = useState(status.name)
  useEffect(() => setName(status.name), [status.name, editing])
  if (!editing) return <span className="truncate text-[13px] font-medium">{status.name}</span>
  const save = () => {
    if (name.trim() && name.trim() !== status.name) void window.oniko.tasks.updateStatus(status.id, { name })
    onDone()
  }
  return (
    <input
      value={name}
      autoFocus
      aria-label="Status name"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') onDone()
      }}
      className="h-6 w-40 rounded-sm border bg-background px-1.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  )
}

function AddStatus({ project, className }: { project: string; className?: string }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) void window.oniko.tasks.addStatus(project, name)
    setName('')
    setAdding(false)
  }
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        data-testid="add-status"
        className={cn('flex h-9 items-center gap-2 rounded-md px-3 text-[13px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        <Plus className="size-3.5" />
        Add status
      </button>
    )
  }
  return (
    <form onSubmit={submit} className={cn('flex h-9 items-center gap-2 px-3', className)}>
      <input
        value={name}
        autoFocus
        aria-label="New status name"
        placeholder="Status name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? null : setAdding(false))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setAdding(false)
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-sm border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <Button type="submit" size="xs">
        Add
      </Button>
    </form>
  )
}

const openOnKey = (open: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    open()
  }
}

type ViewProps = {
  project: string
  state: TasksState
  statuses: TaskStatus[]
  onOpen: (id: TaskId) => void
  onNew: (statusId: TaskStatusId) => void
}

/** Linear's list: a tinted, collapsible header per status, then one dense row per task. */
function ListView({ project, state, statuses, onOpen, onNew }: ViewProps) {
  const [collapsed, setCollapsed] = useState<Set<TaskStatusId>>(new Set())
  const [renaming, setRenaming] = useState<TaskStatusId | null>(null)
  const toggle = (id: TaskStatusId) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    // One grid for the whole list, rows as subgrids: the key column is as wide as the longest key in any
    // group, and rows start where the header's status icon does, as in Linear.
    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-3 px-2 py-2" data-testid="tasks-list">
      {statuses.map((status) => {
        const tasks = statusTasks(state, status.id)
        const open = !collapsed.has(status.id)
        return (
          <section key={status.id} data-status-section={status.name} className="col-span-full mb-0.5 grid grid-cols-subgrid">
            <div
              data-status-header={status.name}
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => toggle(status.id)}
              onKeyDown={openOnKey(() => toggle(status.id))}
              className="group/header col-span-full flex h-9 cursor-default items-center gap-2 rounded-md bg-muted/70 pr-1.5 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-90')} />
              <StatusIcon status={status} statuses={statuses} />
              <StatusName status={status} editing={renaming === status.id} onDone={() => setRenaming(null)} />
              <span className="text-[13px] tabular-nums text-muted-foreground">{tasks.length}</span>
              <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100 has-[[data-state=open]]:opacity-100" onClick={(e) => e.stopPropagation()}>
                <StatusOptions status={status} statuses={statuses} count={tasks.length} onRename={() => setRenaming(status.id)} />
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Add task to ${status.name}`} onClick={() => onNew(status.id)}>
                  <Plus />
                </Button>
              </span>
            </div>
            {open ? (
              <ul className="col-span-full grid grid-cols-subgrid">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    data-task-row={task.title}
                    role="link"
                    tabIndex={0}
                    onClick={() => onOpen(task.id)}
                    onKeyDown={openOnKey(() => onOpen(task.id))}
                    className="col-span-full grid h-11 cursor-default grid-cols-subgrid items-center rounded-md pr-3 pl-7 text-[13px] outline-none hover:bg-accent/60 focus-visible:bg-accent/60"
                  >
                    <span className="tabular-nums whitespace-nowrap text-muted-foreground">{taskKey(task)}</span>
                    <StatusMenu statuses={statuses} value={task.statusId} onChange={(id) => void window.oniko.tasks.move(task.id, id, null)}>
                      <button
                        type="button"
                        aria-label={`Change status of ${task.title}`}
                        data-testid="task-status-picker"
                        onClick={(e) => e.stopPropagation()}
                        className="-m-1 flex shrink-0 rounded-sm p-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <StatusIcon status={status} statuses={statuses} />
                      </button>
                    </StatusMenu>
                    <span className="flex min-w-0 items-baseline gap-3">
                      <span className="min-w-0 truncate font-medium">{task.title}</span>
                      {task.description ? <span className="hidden min-w-0 truncate text-muted-foreground lg:block">{task.description.split('\n')[0]}</span> : null}
                    </span>
                    <span className="text-right text-xs tabular-nums whitespace-nowrap text-muted-foreground">{shortDate(task.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
      <AddStatus project={project} className="col-span-full mt-1 pl-2" />
    </div>
  )
}

/** Where a dragged card would land: ahead of `beforeId` in `statusId`, or last when it is null. */
type DropTarget = { statusId: TaskStatusId; beforeId: TaskId | null }

/** Linear's board: one column per status, cards that drag between and within columns. */
function BoardView({ project, state, statuses, onOpen, onNew }: ViewProps) {
  const [dragging, setDragging] = useState<TaskId | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [renaming, setRenaming] = useState<TaskStatusId | null>(null)

  const onDragOver = (event: DragEvent, statusId: TaskStatusId, tasks: Task[]) => {
    if (!dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-task-id]')
    let beforeId: TaskId | null = null
    if (card) {
      const index = tasks.findIndex((t) => t.id === card.dataset['taskId'])
      const rect = card.getBoundingClientRect()
      const after = event.clientY > rect.top + rect.height / 2
      beforeId = (after ? tasks[index + 1]?.id : tasks[index]?.id) ?? null
    }
    if (target?.statusId !== statusId || target.beforeId !== beforeId) setTarget({ statusId, beforeId })
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    if (dragging && target && target.beforeId !== dragging) void window.oniko.tasks.move(dragging, target.statusId, target.beforeId)
    setDragging(null)
    setTarget(null)
  }

  const indicator = <div aria-hidden="true" className="-my-0.5 h-0.5 shrink-0 rounded-full bg-primary" />

  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 py-3" data-testid="tasks-board">
      {statuses.map((status) => {
        const tasks = statusTasks(state, status.id)
        const here = target?.statusId === status.id
        return (
          <section
            key={status.id}
            data-status-column={status.name}
            onDragOver={(e) => onDragOver(e, status.id, tasks)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && here) setTarget(null)
            }}
            onDrop={drop}
            className={cn('flex max-h-full w-80 shrink-0 flex-col rounded-lg bg-muted/50 transition-colors', here && 'bg-muted')}
          >
            <div data-status-header={status.name} className="group/header flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
              <StatusIcon status={status} statuses={statuses} />
              <StatusName status={status} editing={renaming === status.id} onDone={() => setRenaming(null)} />
              <span className="text-[13px] tabular-nums text-muted-foreground">{tasks.length}</span>
              <span className="ml-auto flex items-center gap-0.5">
                <StatusOptions status={status} statuses={statuses} count={tasks.length} onRename={() => setRenaming(status.id)} />
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Add task to ${status.name}`} onClick={() => onNew(status.id)}>
                  <Plus />
                </Button>
              </span>
            </div>
            <div className="flex min-h-12 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
              {tasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-1.5">
                  {here && target.beforeId === task.id && task.id !== dragging ? indicator : null}
                  <div
                    role="link"
                    tabIndex={0}
                    draggable
                    data-task-id={task.id}
                    data-task-card={task.title}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', task.id)
                      setDragging(task.id)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setTarget(null)
                    }}
                    onClick={() => onOpen(task.id)}
                    onKeyDown={openOnKey(() => onOpen(task.id))}
                    className={cn(
                      'cursor-default rounded-md border border-border/70 bg-background px-3 py-2.5 text-left shadow-xs outline-none transition-[border-color,opacity] hover:border-border focus-visible:ring-2 focus-visible:ring-ring',
                      dragging === task.id && 'opacity-40',
                    )}
                  >
                    <span className="block text-xs tabular-nums text-muted-foreground">{taskKey(task)}</span>
                    <span className="mt-1.5 flex items-start gap-2">
                      <StatusMenu statuses={statuses} value={task.statusId} onChange={(id) => void window.oniko.tasks.move(task.id, id, null)}>
                        <button
                          type="button"
                          aria-label={`Change status of ${task.title}`}
                          onClick={(e) => e.stopPropagation()}
                          className="-m-0.5 mt-px flex shrink-0 rounded-sm p-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <StatusIcon status={status} statuses={statuses} />
                        </button>
                      </StatusMenu>
                      <span className="min-w-0 text-[13px] leading-snug font-medium [overflow-wrap:anywhere]">{task.title}</span>
                    </span>
                    {task.description ? <span className="mt-1.5 line-clamp-2 block text-xs whitespace-pre-line text-muted-foreground">{task.description}</span> : null}
                    <span className="mt-2.5 block text-xs text-muted-foreground">{shortDate(task.createdAt)}</span>
                  </div>
                </div>
              ))}
              {here && target.beforeId === null ? indicator : null}
            </div>
          </section>
        )
      })}
      <div className="w-64 shrink-0">
        <AddStatus project={project} className="w-full" />
      </div>
    </div>
  )
}

export function TasksView({
  project,
  state,
  taskId,
  subscriptions,
  threads,
  home,
  onOpenTask,
  onOpenThread,
}: {
  project: string
  state: TasksState
  taskId: TaskId | null
  subscriptions: SubscriptionsState
  threads: ThreadMap
  home: string
  onOpenTask: (id: TaskId | null) => void
  onOpenThread: (id: ThreadId) => void
}) {
  const [layout, setLayout] = useLayout()
  const [newIn, setNewIn] = useState<TaskStatusId | null>(null)
  const statuses = projectStatuses(state, project)
  const count = projectTasks(state, project).length
  const task = taskId ? state.tasks.find((t) => t.id === taskId) : undefined

  useEffect(() => {
    void window.oniko.tasks.open(project)
  }, [project])

  // A task deleted while open, here or elsewhere, sends the page back to the list.
  useEffect(() => {
    if (taskId && !task && state.statuses.length) onOpenTask(null)
  }, [taskId, task, state.statuses.length, onOpenTask])

  if (task)
    return (
      <TaskPage
        key={task.id}
        task={task}
        statuses={statuses}
        subscriptions={subscriptions}
        threads={threads}
        home={home}
        onBack={() => onOpenTask(null)}
        onOpenThread={onOpenThread}
      />
    )

  const first = statuses[0]
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="tasks-view">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium">All tasks</span>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        <div className="ml-auto flex items-center gap-2">
          <LayoutToggle layout={layout} onChange={setLayout} />
          <Button variant="ghost" size="sm" className="h-7 text-[13px]" disabled={!first} onClick={() => first && setNewIn(first.id)} data-testid="new-task">
            <Plus />
            New task
          </Button>
        </div>
      </div>
      {layout === 'board' ? (
        <BoardView project={project} state={state} statuses={statuses} onOpen={onOpenTask} onNew={setNewIn} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ListView project={project} state={state} statuses={statuses} onOpen={onOpenTask} onNew={setNewIn} />
        </div>
      )}
      <NewTaskDialog project={project} statusId={newIn} statuses={statuses} onClose={() => setNewIn(null)} />
    </div>
  )
}
