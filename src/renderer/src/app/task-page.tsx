import { useEffect, useRef, useState } from 'react'
import { CircleDot, PenLine, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { taskKey, type Task, type TaskStatus } from '@shared/tasks'
import { relativeTime } from './format'
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

/** One task, opened full-size: editable title and description, properties on the right. Esc goes back. */
export function TaskPage({ task, statuses, onBack }: { task: Task; statuses: TaskStatus[]; onBack: () => void }) {
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
    <div className="flex min-h-0 flex-1" data-testid="task-page" data-task-key={taskKey(task)}>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-10 py-12">
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
      </div>
      <aside className="w-72 shrink-0 space-y-6 overflow-y-auto border-l px-4 py-8">
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
  )
}
