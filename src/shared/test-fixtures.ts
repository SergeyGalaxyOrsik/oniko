import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { ThreadEvent } from './events'
import type { SubscriptionId } from './subscriptions'
import type { Thread, ThreadId } from './thread'

export const threadId = 't-1' as ThreadId
export const subscriptionId = 'sub-1' as SubscriptionId

export function newThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    agentId: 'claude',
    subscriptionId,
    cwd: '/tmp/project',
    title: '',
    createdAt: 1_000,
    acpSessionId: null,
    status: { kind: 'connecting' },
    timeline: [],
    config: [],
    commands: [],
    ...overrides,
  }
}

export function update(u: SessionUpdate): ThreadEvent {
  return { threadId, type: 'session_update', update: u }
}

export const chunk = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
})
