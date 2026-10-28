import type { AgentInfo } from './agents'
import type { AppEvent } from './events'
import type { Thread, ThreadId } from './thread'

export const EVENT_CHANNEL = 'oniko:event'

/**
 * Every broadcast event carries the store's sequence number, and a snapshot records the last one
 * it includes, so a renderer can tell which events a snapshot already reflects.
 */
export type SequencedEvent = { seq: number; event: AppEvent }
export type ThreadSnapshot = { seq: number; threads: Thread[] }

export type OnikoApi = {
  agents: { list(): Promise<AgentInfo[]> }
  threads: {
    list(): Promise<ThreadSnapshot>
    create(input: { cwd: string }): Promise<ThreadId>
    prompt(id: ThreadId, text: string): Promise<void>
    cancel(id: ThreadId): Promise<void>
    setConfig(id: ThreadId, configId: string, value: string): Promise<void>
    respondPermission(id: ThreadId, requestId: string, optionId: string | null): Promise<void>
    authenticate(id: ThreadId, methodId: string): Promise<void>
    remove(id: ThreadId): Promise<void>
  }
  folders: { recent(): Promise<string[]> }
  dialog: { pickFolder(): Promise<string | null> }
  onEvent(cb: (event: SequencedEvent) => void): () => void
}

/** One table drives both the preload bridge and the ipcMain handlers, so channel names cannot drift. */
export const CHANNELS = {
  agentsList: 'agents:list',
  threadsList: 'threads:list',
  threadsCreate: 'threads:create',
  threadsPrompt: 'threads:prompt',
  threadsCancel: 'threads:cancel',
  threadsSetConfig: 'threads:setConfig',
  threadsRespondPermission: 'threads:respondPermission',
  threadsAuthenticate: 'threads:authenticate',
  threadsRemove: 'threads:remove',
  foldersRecent: 'folders:recent',
  dialogPickFolder: 'dialog:pickFolder',
} as const
