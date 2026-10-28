import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleDot, FolderGit2, GitBranch, GitPullRequest, Loader2, Lock, MessageSquare, PenLine, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { activeSubscription, type SubscriptionsState } from '@shared/subscriptions'
import { taskKey, taskThreadId, type Task, type TaskRun, type TaskStatus } from '@shared/tasks'
import type { ThreadId, ThreadMap } from '@shared/thread'
import { AgentGlyph } from './agent-glyph'
import { relativeTime } from './format'
import { shortenHome } from './subscription-ui'
import { SubscriptionMenuItems } from './subscription-picker'
import { StatusIcon, StatusMenu } from './task-status'
import { useNow } from './use-now'

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]') !== null

/** Saves on blur and while typing pauses, so there is no Save button, as in Linear. */
function useAutosave(value: string, save: (value: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // What the pending timer would save, so leaving the page saves it instead of dropping it.
  const pending = useRef<(() => void) | null>(null)
  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    save(value)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      pending.current?.()
    },
    [],
  )
  const schedule = (next: string) => {
    if (timer.current) clearTimeout(timer.current)
    pending.current = () => save(next)
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = null
      save(next)
    }, 600)
  }
  return { flush, schedule }
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="px-2 text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  )
}

/** Before the agent starts the choice is open, and "active" follows whatever new threads start on. */
function SubscriptionProperty({ task, subscriptions, threads }: { task: Task; subscriptions: SubscriptionsState; threads: ThreadMap }) {
  const threadId = taskThreadId(task)
  const assigned = task.subscriptionId ? subscriptions.subscriptions.find((s) => s.id === task.subscriptionId) : undefined
  const running = threadId ? subscriptions.subscriptions.find((s) => s.id === threads[threadId]?.subscriptionId) : undefined
  const active = activeSubscription(subscriptions)
  const shown = running ?? assigned ?? active
  const label = (
    <>
      {shown ? <AgentGlyph agentId={shown.agentId} /> : null}
      <span className="min-w-0 truncate">{shown?.label ?? 'No subscription'}</span>
      {!threadId && !assigned && shown ? <span className="text-muted-foreground">· active</span> : null}
    </>
  )
  const row = 'w-full justify-start gap-2.5 px-2 font-normal'
  if (threadId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(row, 'flex h-8 items-center text-sm')} data-testid="task-subscription">
            {label}
            <Lock className="ml-auto size-3 text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent>The agent stays on the subscription it started with</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={row} data-testid="task-subscription">
          {label}
          <ChevronDown className="ml-auto size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onSelect={() => void window.oniko.tasks.update(task.id, { subscriptionId: null })} className="gap-2" data-subscription-option="active">
          <span className="flex-1">Active subscription{active ? ` (${active.label})` : ''}</span>
          {task.subscriptionId === null ? <Check className="size-4" /> : <span className="size-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SubscriptionMenuItems
          subscriptions={subscriptions.subscriptions}
          activeId={task.subscriptionId}
          onSelect={(id) => void window.oniko.tasks.update(task.id, { subscriptionId: id })}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const STAGE_LABELS: Record<Extract<TaskRun, { threadId: ThreadId }>['stage'], string> = {
  working: 'Working on it',
  pull_request: 'Opening a pull request',
  finished: 'Finished',
}

/** Where the task's agent is: how to start it, what went wrong, or its thread, branch and worktree. */
function AgentProperty({
  task,
  statuses,
  threads,
  home,
  onOpenThread,
}: {
  task: Task
  statuses: TaskStatus[]
  threads: ThreadMap
  home: string
  onOpenThread: (id: ThreadId) => void
}) {
  const run = task.run
  const hint = 'px-2 text-xs leading-relaxed text-muted-foreground'
  const queue = statuses.find((s) => s.kind === 'unstarted')?.name ?? 'a Not started status'
  if (!run) return <p className={hint}>Move the task to {queue} to start an agent on it in its own worktree.</p>
  if (run.stage === 'starting')
    return (
      <p className={cn(hint, 'flex items-center gap-2')}>
        <Loader2 className="size-3.5 animate-spin" />
        Creating the worktree…
      </p>
    )
  if (run.stage === 'failed')
    return (
      <div className="space-y-1 px-2 text-xs leading-relaxed" data-testid="task-run-error">
        <p className="text-destructive">{run.error}</p>
        <p className="text-muted-foreground">Move the task to {queue} again to retry.</p>
      </div>
    )
  const status = threads[run.threadId]?.status
  const stage =
    status?.kind === 'awaiting_permission' ? 'Needs your approval' : status?.kind === 'running' && run.stage === 'finished' ? 'Working on it' : STAGE_LABELS[run.stage]
  return (
    <div className="space-y-1">
      <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 px-2 font-normal" onClick={() => onOpenThread(run.threadId)} data-testid="task-open-thread">
        <MessageSquare />
        <span className="min-w-0 truncate">{stage}</span>
        {status?.kind === 'running' ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" /> : null}
      </Button>
      <p className="flex items-center gap-2.5 px-2 py-1 text-xs text-muted-foreground" title={run.branch}>
        <GitBranch className="size-4 shrink-0" />
        <span className="min-w-0 truncate font-mono">{run.branch}</span>
      </p>
      <p className="flex items-center gap-2.5 px-2 py-1 text-xs text-muted-foreground" title={run.worktree}>
        <FolderGit2 className="size-4 shrink-0" />
        <span className="min-w-0 truncate font-mono">{shortenHome(run.worktree, home)}</span>
      </p>
    </div>
  )
}

/** One task, opened full-size: editable title and description, properties on the right. Esc goes back. */
export function TaskPage({
  task,
  statuses,
  subscriptions,
  threads,
  home,
  onBack,
  onOpenThread,
}: {
  task: Task
  statuses: TaskStatus[]
  subscriptions: SubscriptionsState
  threads: ThreadMap
  home: string
  onBack: () => void
  onOpenThread: (id: ThreadId) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [statusOpen, setStatusOpen] = useState(false)
  const now = useNow(30_000)
  const ago = (at: number) => (relativeTime(at, now) === 'now' ? 'just now' : `${relativeTime(at, now)} ago`)
  const status = statuses.find((s) => s.id === task.statusId)

  // A change that arrives from elsewhere shows up unless the field is being edited.
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(task.title)
    if (document.activeElement !== descriptionRef.current) setDescription(task.description)
  }, [task.title, task.description])

  const saveTitle = (value: string) => {
    if (value.trim() && value.trim() !== task.title) void window.oniko.tasks.update(task.id, { title: value })
  }
  const saveDescription = (value: string) => {
    if (value.trim() !== task.description) void window.oniko.tasks.update(task.id, { description: value })
  }
  const titleSave = useAutosave(title, saveTitle)
  const descriptionSave = useAutosave(description, saveDescription)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"], [data-testid="status-menu-content"]')) return
      if (e.key === 'Escape') {
        if (isTyping(e.target)) (e.target as HTMLElement).blur()
        else onBack()
      } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault()
        setStatusOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="task-page" data-task-key={taskKey(task)}>
      {/* One scroll for both columns, no divider: the properties sit beside the content, as in Linear. */}
      <div className="mx-auto flex w-full max-w-6xl items-start gap-12 px-10 py-12">
        <div className="min-w-0 flex-1">
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            aria-label="Task title"
            data-testid="task-page-title"
            onChange={(e) => {
              const next = e.target.value.replace(/\n/g, ' ')
              setTitle(next)
              titleSave.schedule(next)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            onBlur={() => {
              if (!title.trim()) setTitle(task.title)
              titleSave.flush()
            }}
            className="field-sizing-content w-full resize-none bg-transparent text-2xl font-semibold tracking-tight outline-none"
          />
          <textarea
            ref={descriptionRef}
            value={description}
            aria-label="Description"
            placeholder="Add description…"
            data-testid="task-page-description"
            onChange={(e) => {
              setDescription(e.target.value)
              descriptionSave.schedule(e.target.value)
            }}
            onBlur={descriptionSave.flush}
            className="mt-4 field-sizing-content min-h-24 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
          />
          <div className="mt-10 border-t pt-8">
            <h2 className="text-sm font-semibold">Activity</h2>
            <ul className="mt-4 space-y-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2.5">
                <CircleDot className="size-3.5" />
                Task created · {ago(task.createdAt)}
              </li>
              {task.updatedAt > task.createdAt ? (
                <li className="flex items-center gap-2.5">
                  <PenLine className="size-3.5" />
                  Last updated · {ago(task.updatedAt)}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <aside className="sticky top-12 w-64 shrink-0 space-y-6 pt-1">
        <Property label="Properties">
          {status ? (
            <StatusMenu
              statuses={statuses}
              value={task.statusId}
              open={statusOpen}
              onOpenChange={setStatusOpen}
              onChange={(id) => void window.oniko.tasks.move(task.id, id, null)}
            >
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 px-2 font-normal" data-testid="task-status-picker">
                <StatusIcon status={status} statuses={statuses} />
                {status.name}
              </Button>
            </StatusMenu>
          ) : null}
          <SubscriptionProperty task={task} subscriptions={subscriptions} threads={threads} />
          <Button
            variant="ghost"
            size="sm"
            role="switch"
            aria-checked={task.pullRequest}
            disabled={task.run?.stage === 'pull_request' || task.run?.stage === 'finished'}
            className="w-full justify-start gap-2.5 px-2 font-normal"
            onClick={() => void window.oniko.tasks.update(task.id, { pullRequest: !task.pullRequest })}
            data-testid="task-pull-request"
          >
            <GitPullRequest className={cn(!task.pullRequest && 'text-muted-foreground')} />
            <span className={cn(!task.pullRequest && 'text-muted-foreground')}>Open a pull request</span>
            {task.pullRequest ? <Check className="ml-auto" /> : null}
          </Button>
        </Property>
        <Property label="Agent">
          <AgentProperty task={task} statuses={statuses} threads={threads} home={home} onOpenThread={onOpenThread} />
        </Property>
        <Property label="Task">
          <p className="px-2 font-mono text-xs text-muted-foreground">{taskKey(task)}</p>
        </Property>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2.5 px-2 font-normal text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            void window.oniko.tasks.remove(task.id)
            onBack()
          }}
          data-testid="task-delete"
        >
          <Trash2 />
          Delete task
        </Button>
        </aside>
      </div>
    </div>
  )
}
