import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { projectKey, type TaskStatus, type TaskStatusId } from '@shared/tasks'
import { StatusIcon, StatusMenu } from './task-status'

/** Linear's "New issue" composer: borderless title and description, properties along the bottom. */
export function NewTaskDialog({
  project,
  statusId: initialStatusId,
  statuses,
  onClose,
}: {
  project: string
  /** The status the task starts in; null keeps the dialog closed. */
  statusId: TaskStatusId | null
  statuses: TaskStatus[]
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState<TaskStatusId | null>(null)

  useEffect(() => {
    if (!initialStatusId) return
    setTitle('')
    setDescription('')
    setStatusId(initialStatusId)
  }, [initialStatusId])

  const status = statuses.find((s) => s.id === statusId)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!statusId || !title.trim()) return
    await window.oniko.tasks.create({ project, title, description, statusId })
    onClose()
  }

  return (
    <Dialog open={initialStatusId !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="top-[30%] gap-0 overflow-hidden p-0 sm:max-w-2xl" data-testid="task-dialog">
        <DialogDescription className="sr-only">Name and describe the task, then pick its status.</DialogDescription>
        <form
          onSubmit={(e) => void submit(e)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
        >
          <div className="flex items-center gap-1.5 px-5 pt-4 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-medium">
              {projectKey(project)}
            </Badge>
            <ChevronRight className="size-3" />
            <DialogTitle className="text-xs font-normal">New task</DialogTitle>
          </div>
          <div className="px-5 pt-3 pb-4">
            <input
              id="task-title"
              value={title}
              autoFocus
              aria-label="Task title"
              placeholder="Task title"
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/70"
            />
            <textarea
              id="task-description"
              value={description}
              aria-label="Description"
              placeholder="Add description…"
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 field-sizing-content max-h-80 min-h-20 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <div className="flex items-center gap-2 border-t px-4 py-3">
            {status && statusId ? (
              <StatusMenu statuses={statuses} value={statusId} onChange={setStatusId}>
                <Button type="button" variant="outline" size="xs" className="h-7 gap-1.5 rounded-full px-2.5 font-normal" data-testid="task-status-picker">
                  <StatusIcon status={status} statuses={statuses} />
                  {status.name}
                </Button>
              </StatusMenu>
            ) : null}
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">⌘↵ to create</span>
            <Button type="submit" size="sm" disabled={!title.trim()} data-testid="task-save">
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
