export type AgentId = 'claude'

export type AgentInfo = {
  id: AgentId
  label: string
  description: string
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    description: 'Claude Code over ACP, using your local Claude login',
  },
}

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[]
