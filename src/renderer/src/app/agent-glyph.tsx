import { Asterisk, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentId } from '@shared/agents'

const GLYPHS: Record<AgentId, { icon: LucideIcon; className: string }> = {
  claude: { icon: Asterisk, className: 'text-[#d97757]' },
}

export function AgentGlyph({ agentId, className }: { agentId: AgentId; className?: string }) {
  const { icon: Icon, className: tone } = GLYPHS[agentId]
  return <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', tone, className)} />
}
