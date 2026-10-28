import type { ToolCallContent } from '@agentclientprotocol/sdk'
import { FileText, Globe, Pencil, Search, SquareTerminal, Trash2, Wrench, Brain, ArrowRightLeft, type LucideIcon } from 'lucide-react'
import { FileDiff } from '@/components/agents/file-diff'
import { ToolResult, ToolResultOutput, type ToolResultStatus } from '@/components/agents/tool-result'
import type { ToolItem } from '@shared/thread'
import { basename, diffLines } from './format'

const KIND_ICONS: Record<string, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: ArrowRightLeft,
  search: Search,
  execute: SquareTerminal,
  think: Brain,
  fetch: Globe,
}

const STATUS: Record<ToolItem['status'], ToolResultStatus> = {
  pending: 'running',
  in_progress: 'running',
  completed: 'success',
  failed: 'error',
}

function ContentView({ content }: { content: ToolCallContent }) {
  switch (content.type) {
    case 'diff':
      return <FileDiff file={basename(content.path)} lines={diffLines(content.oldText, content.newText)} defaultOpen />
    case 'content':
      return content.content.type === 'text' ? (
        <ToolResultOutput>{content.content.text}</ToolResultOutput>
      ) : (
        <p className="text-xs text-muted-foreground">{content.content.type} content</p>
      )
    case 'terminal':
      return <p className="text-xs text-muted-foreground">Terminal {content.terminalId}</p>
  }
}

export function ToolRow({ tool }: { tool: ToolItem }) {
  const Icon = KIND_ICONS[tool.toolKind] ?? Wrench
  const location = tool.locations[0]
  return (
    <div data-tool-id={tool.id} data-tool-status={tool.status} className="py-0.5">
      <ToolResult
        tool={tool.toolKind}
        title={tool.title}
        status={STATUS[tool.status]}
        icon={<Icon className="size-3.5" />}
        meta={location ? `${basename(location.path)}${location.line ? `:${location.line}` : ''}` : undefined}
        kind={tool.toolKind === 'execute' ? 'terminal' : 'custom'}
        collapseOnComplete
      >
        {tool.content.length ? (
          <div className="space-y-2">
            {tool.content.map((content, i) => (
              <ContentView key={i} content={content} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No output</p>
        )}
      </ToolResult>
    </div>
  )
}
