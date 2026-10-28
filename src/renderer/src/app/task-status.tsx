import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { StatusColor, TaskStatus, TaskStatusId } from '@shared/tasks'

const STATUS_TEXT: Record<StatusColor, string> = {
  slate: 'text-zinc-400 dark:text-zinc-500',
  blue: 'text-blue-500',
  amber: 'text-amber-500',
  green: 'text-emerald-500',
  violet: 'text-indigo-500',
  rose: 'text-rose-500',
  cyan: 'text-cyan-500',
  orange: 'text-orange-500',
}

const PIE_RADIUS = 2
const PIE_LENGTH = 2 * Math.PI * PIE_RADIUS

/**
 * Linear's workflow icons: a dashed ring for backlog, an empty ring before work starts, a ring
 * filling up as work moves along, a filled check when done and a filled cross when canceled.
 * In-progress statuses fill further the later they sit among the project's started statuses.
 */
export function StatusIcon({ status, statuses, className }: { status: TaskStatus; statuses: TaskStatus[]; className?: string }) {
  const classes = cn('size-3.5 shrink-0', STATUS_TEXT[status.color], className)
  const ring = { cx: 7, cy: 7, r: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }
  switch (status.kind) {
    case 'backlog':
      return (
        <svg viewBox="0 0 14 14" aria-hidden="true" className={classes}>
          <circle {...ring} strokeDasharray="1.4 1.74" />
        </svg>
      )
    case 'unstarted':
      return (
        <svg viewBox="0 0 14 14" aria-hidden="true" className={classes}>
          <circle {...ring} />
        </svg>
      )
    case 'started': {
      const started = statuses.filter((s) => s.kind === 'started')
      const fraction = (started.findIndex((s) => s.id === status.id) + 1) / (started.length + 1)
      return (
        <svg viewBox="0 0 14 14" aria-hidden="true" className={classes}>
          <circle {...ring} />
          <circle
            cx={7}
            cy={7}
            r={PIE_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={PIE_RADIUS * 2}
            strokeDasharray={`${PIE_LENGTH * fraction} ${PIE_LENGTH}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      )
    }
    case 'completed':
      return (
        <svg viewBox="0 0 14 14" aria-hidden="true" className={classes}>
          <circle cx={7} cy={7} r={7} fill="currentColor" />
          <path d="M4.2 7.2 6.1 9l3.7-3.9" fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'canceled':
      return (
        <svg viewBox="0 0 14 14" aria-hidden="true" className={classes}>
          <circle cx={7} cy={7} r={7} fill="currentColor" />
          <path d="m4.8 4.8 4.4 4.4m0-4.4-4.4 4.4" fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      )
  }
}

/**
 * Linear's "Change status…" menu: type to filter, arrows and Enter to pick, or press a status's
 * number while the filter is empty. `children` is the trigger.
 */
export function StatusMenu({
  statuses,
  value,
  onChange,
  children,
  open: controlledOpen,
  onOpenChange,
  align = 'start',
}: {
  statuses: TaskStatus[]
  value: TaskStatusId
  onChange: (id: TaskStatusId) => void
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const setOpen = (next: boolean) => {
    setOwnOpen(next)
    onOpenChange?.(next)
  }
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(Math.max(0, statuses.findIndex((s) => s.id === value)))
    // Only on opening: the highlight then follows the keyboard and the mouse.
  }, [open])
  const matches = statuses.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))

  const pick = (status: TaskStatus | undefined) => {
    if (!status) return
    if (status.id !== value) onChange(status.id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-64 overflow-hidden rounded-lg p-0 shadow-lg"
        data-testid="status-menu-content"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).querySelector('input')?.focus()
        }}
      >
        <input
          value={query}
          aria-label="Change status"
          placeholder="Change status…"
          className="h-10 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive((i) => (i + step + matches.length) % Math.max(1, matches.length))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(matches[active])
            } else if (!query && /^[1-9]$/.test(e.key)) {
              e.preventDefault()
              pick(statuses[Number(e.key) - 1])
            }
          }}
        />
        <div role="listbox" className="max-h-72 overflow-y-auto p-1">
          {matches.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">No matching status</p> : null}
          {matches.map((status, i) => (
            <button
              key={status.id}
              type="button"
              role="option"
              aria-selected={status.id === value}
              data-status-option={status.name}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(status)}
              className={cn('flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm outline-none', i === active && 'bg-accent')}
            >
              <StatusIcon status={status} statuses={statuses} />
              <span className="min-w-0 flex-1 truncate">{status.name}</span>
              {status.id === value ? <Check className="size-4 text-foreground" /> : null}
              <span className="w-3 text-right text-xs tabular-nums text-muted-foreground">{statuses.indexOf(status) < 9 ? statuses.indexOf(status) + 1 : ''}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
