import { useState } from 'react'
import { Brain, ChevronRight, CircleAlert, Info } from 'lucide-react'
import { AgentActivity } from '@/components/agents/agent-activity'
import { Message, MessageContent } from '@/components/agents/message'
import { MessageBubble } from '@/components/agents/message-bubble'
import { MessageScroller } from '@/components/agents/message-scroller'
import { StreamingResponse } from '@/components/agents/streaming-response'
import { TodoList, type TodoItemStatus } from '@/components/agents/todo-list'
import { ToolApproval } from '@/components/agents/tool-approval'
import { ThinkingShimmer } from '@/components/agents/loading-states/thinking-shimmer'
import { cn } from '@/lib/utils'
import { AGENTS } from '@shared/agents'
import type { PlanEntry } from '@agentclientprotocol/sdk'
import type { Thread, TimelineItem } from '@shared/thread'
import { assertNever } from '@shared/thread-reducer'
import { formatDuration } from './format'
import { Markdown } from './markdown'
import { toBlocks, type PermissionItem, type TimelineBlock } from './timeline-blocks'
import { ToolRow } from './tool-row'

const PLAN_STATUS: Record<PlanEntry['status'], TodoItemStatus> = {
  pending: 'pending',
  in_progress: 'in-progress',
  completed: 'completed',
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className="size-3.5" />
        Thought
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open ? <p className="mt-1.5 whitespace-pre-wrap border-l border-border pl-3 leading-6 text-muted-foreground">{text}</p> : null}
    </div>
  )
}

function Permission({ item, threadId }: { item: PermissionItem; threadId: Thread['id'] }) {
  const outcome = item.outcome
  const status = outcome === null ? 'pending' : outcome === 'cancelled' ? 'denied' : item.options.find((o) => o.optionId === outcome.optionId)?.kind.startsWith('allow') ? 'approved' : 'denied'
  const respond = (optionId: string) => void window.oniko.threads.respondPermission(threadId, item.id, optionId)
  return (
    <div data-permission-id={item.id} data-permission-state={status}>
      <ToolApproval
        tool={item.title}
        title="Allow this action?"
        status={status}
        actions={item.options.map((option, i) => (
          <button
            key={option.optionId}
            type="button"
            data-option-kind={option.kind}
            onClick={() => respond(option.optionId)}
            className={cn(
              'rounded-xl px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              i === 0 && option.kind.startsWith('allow')
                ? 'bg-foreground text-background'
                : option.kind.startsWith('allow')
                  ? 'border border-border bg-background text-foreground hover:bg-muted'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.name}
          </button>
        ))}
      />
    </div>
  )
}

function ItemView({ item, thread, streaming }: { item: Exclude<TimelineItem, { kind: 'tool' }>; thread: Thread; streaming: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <Message from="user">
          <MessageContent>
            <MessageBubble className="max-w-[80%] whitespace-pre-wrap">{item.text}</MessageBubble>
          </MessageContent>
        </Message>
      )
    case 'assistant':
      return (
        <StreamingResponse status={streaming ? 'streaming' : 'complete'} showActions={false}>
          <Markdown text={item.text} />
        </StreamingResponse>
      )
    case 'thought':
      return <Thought text={item.text} />
    case 'plan':
      return (
        <TodoList
          title="Plan"
          defaultOpen
          items={item.entries.map((entry, i) => ({ id: `${item.id}-${i}`, title: entry.content, status: PLAN_STATUS[entry.status] }))}
        />
      )
    case 'permission':
      return <Permission item={item} threadId={thread.id} />
    case 'turn_end':
      return (
        <div className="flex justify-end text-xs text-muted-foreground/60">
          {item.stopReason === 'end_turn' ? `Worked for ${formatDuration(item.durationMs)}` : `Stopped (${item.stopReason}) after ${formatDuration(item.durationMs)}`}
        </div>
      )
    case 'notice':
      return (
        <div className={cn('flex items-start gap-2 text-sm', item.level === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
          {item.level === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          <span className="whitespace-pre-wrap">{item.text}</span>
        </div>
      )
    default:
      return assertNever(item)
  }
}

function BlockView({ block, thread, isLast }: { block: TimelineBlock; thread: Thread; isLast: boolean }) {
  if (block.kind === 'activity') {
    const count = block.tools.length
    const current = block.tools.at(-1)
    return (
      <AgentActivity
        status={block.live ? 'working' : 'complete'}
        activeLabel={current ? current.title : 'Working'}
        summary={`Ran ${count} ${count === 1 ? 'tool' : 'tools'}`}
        maxHeight={block.live ? 240 : 520}
        items={block.tools.map((tool) => ({ id: tool.id, type: 'text' as const, content: <ToolRow tool={tool} /> }))}
      />
    )
  }
  const running = thread.status.kind === 'running'
  return <ItemView item={block.item} thread={thread} streaming={isLast && running && block.item.kind === 'assistant'} />
}

export function Timeline({ thread }: { thread: Thread }) {
  const running = thread.status.kind === 'running' || thread.status.kind === 'awaiting_permission'
  const blocks = toBlocks(thread.timeline, running)
  const lastKind = thread.timeline.at(-1)?.kind
  const showWaiting = thread.status.kind === 'connecting' || (thread.status.kind === 'running' && (lastKind === 'user' || lastKind === undefined))
  return (
    <MessageScroller className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-3xl px-6 pb-10 pt-6" busy={running}>
      <div className="flex flex-col gap-5">
        {blocks.map((block, i) => (
          <div key={block.kind === 'activity' ? block.id : block.item.id} data-item-kind={block.kind === 'activity' ? 'activity' : block.item.kind}>
            <BlockView block={block} thread={thread} isLast={i === blocks.length - 1} />
          </div>
        ))}
        {showWaiting ? (
          <div data-testid="waiting" className="text-sm text-muted-foreground">
            <ThinkingShimmer>{thread.status.kind === 'connecting' ? `Connecting to ${AGENTS[thread.agentId].label}…` : 'Thinking…'}</ThinkingShimmer>
          </div>
        ) : null}
      </div>
    </MessageScroller>
  )
}
