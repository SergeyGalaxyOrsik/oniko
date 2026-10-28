import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { AGENT_IDS, AGENTS, type AgentId } from '@shared/agents'
import { CHANNELS } from '@shared/api'
import type { ThreadId } from '@shared/thread'
import type { ThreadStore } from './thread-store'

const threadId = z
  .string()
  .min(1)
  .transform((s) => s as ThreadId)
const agentId = z.enum(AGENT_IDS as [AgentId, ...AgentId[]])

export type IpcDeps = {
  store: ThreadStore
  recentFolders: () => string[]
  rememberFolder: (path: string) => void
}

/** The renderer is untrusted input: every payload is parsed here and nowhere downstream. */
export function registerIpc({ store, recentFolders, rememberFolder }: IpcDeps): void {
  const handle = <S extends z.ZodTuple>(channel: string, schema: S, fn: (...args: z.infer<S>) => unknown) => {
    ipcMain.handle(channel, (_event, ...raw: unknown[]) => fn(...schema.parse(raw)))
  }

  handle(CHANNELS.agentsList, z.tuple([]), () => Object.values(AGENTS))
  handle(CHANNELS.threadsList, z.tuple([]), () => store.snapshot())
  handle(CHANNELS.threadsCreate, z.tuple([z.object({ agentId, cwd: z.string().min(1) })]), ({ agentId, cwd }) => {
    rememberFolder(cwd)
    return store.create(agentId, cwd)
  })
  handle(CHANNELS.threadsPrompt, z.tuple([threadId, z.string().min(1)]), (id, text) => store.session(id).prompt(text))
  handle(CHANNELS.threadsCancel, z.tuple([threadId]), (id) => store.session(id).cancel())
  handle(CHANNELS.threadsSetConfig, z.tuple([threadId, z.string(), z.string()]), (id, configId, value) =>
    store.session(id).setConfig(configId, value),
  )
  handle(CHANNELS.threadsRespondPermission, z.tuple([threadId, z.string(), z.string().nullable()]), (id, requestId, optionId) =>
    store.session(id).respondPermission(requestId, optionId),
  )
  handle(CHANNELS.threadsAuthenticate, z.tuple([threadId, z.string()]), (id, methodId) => store.session(id).authenticate(methodId))
  handle(CHANNELS.threadsRemove, z.tuple([threadId]), (id) => store.remove(id))
  handle(CHANNELS.foldersRecent, z.tuple([]), () => recentFolders())
  handle(CHANNELS.dialogPickFolder, z.tuple([]), async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.canceled ? null : (result.filePaths[0] ?? null)
    if (picked) rememberFolder(picked)
    return picked
  })
}
