import type { ComponentType, SVGProps } from 'react'
import { ClaudeIcon } from '@/components/icons/claude'
import { cn } from '@/lib/utils'
import type { AgentId } from '@shared/agents'

const GLYPHS: Record<AgentId, { icon: ComponentType<SVGProps<SVGSVGElement>>; className: string }> = {
  claude: { icon: ClaudeIcon, className: 'text-[#d97757]' },
}

export function AgentGlyph({ agentId, className }: { agentId: AgentId; className?: string }) {
  const { icon: Icon, className: tone } = GLYPHS[agentId]
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', tone, className)} />
}
