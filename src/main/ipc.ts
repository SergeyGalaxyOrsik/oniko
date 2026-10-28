import { homedir } from 'node:os'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { z } from 'zod'
import { AGENT_IDS, AGENTS, type AgentId } from '@shared/agents'
import { CHANNELS, type AppSnapshot } from '@shared/api'
import type { SubscriptionId } from '@shared/subscriptions'
import type { ThreadId } from '@shared/thread'
import type { EventBus } from './event-bus'
import type { SubscriptionStore } from './subscription-store'
import type { ThreadStore } from './thread-store'

const threadId = z
  .string()
  .min(1)
  .transform((s) => s as ThreadId)
const subscriptionId = z
  .string()
  .min(1)
  .transform((s) => s as SubscriptionId)
const agentId = z.enum(AGENT_IDS as [AgentId, ...AgentId[]])

export type IpcDeps = {
  bus: EventBus
  store: ThreadStore
  subscriptions: SubscriptionStore
  recentFolders: () => string[]
  rememberFolder: (path: string) => void
}

/** The renderer is untrusted input: every payload is parsed here and nowhere downstream. */
export function registerIpc({ bus, store, subscriptions, recentFolders, rememberFolder }: IpcDeps): void {
  const handle = <S extends z.ZodTuple>(channel: string, schema: S, fn: (...args: z.infer<S>) => unknown) => {
    ipcMain.handle(channel, (_event, ...raw: unknown[]) => fn(...schema.parse(raw)))
  }

  handle(CHANNELS.snapshot, z.tuple([]), (): AppSnapshot => ({
    seq: bus.seq,
    home: homedir(),
    threads: store.list(),
    subscriptions: subscriptions.state(),
  }))
  handle(CHANNELS.agentsList, z.tuple([]), () => Object.values(AGENTS))
  handle(
    CHANNELS.threadsCreate,
    z.tuple([z.object({ cwd: z.string().min(1), subscriptionId: subscriptionId.optional(), config: z.record(z.string(), z.string()).optional() })]),
    ({ cwd, subscriptionId, config }) => {
      const subscription = subscriptionId ? subscriptions.get(subscriptionId) : subscriptions.active()
      if (!subscription) throw new Error('Add a subscription in Settings')
      rememberFolder(cwd)
      return store.create(subscription, cwd, config)
    },
  )
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

  handle(CHANNELS.subscriptionsList, z.tuple([]), () => subscriptions.state())
  handle(
    CHANNELS.subscriptionsAdd,
    z.tuple([z.object({ agentId, configDir: z.string(), label: z.string().optional() })]),
    (input) => subscriptions.add(input),
  )
  handle(CHANNELS.subscriptionsUpdate, z.tuple([subscriptionId, z.object({ label: z.string() })]), (id, patch) =>
    subscriptions.update(id, patch),
  )
  handle(CHANNELS.subscriptionsRemove, z.tuple([subscriptionId]), (id) => subscriptions.remove(id))
  handle(CHANNELS.subscriptionsRefresh, z.tuple([subscriptionId.optional()]), (id) => subscriptions.refresh(id))
  handle(CHANNELS.subscriptionsSetActive, z.tuple([subscriptionId]), (id) => subscriptions.setActive(id))
  handle(CHANNELS.subscriptionsDetect, z.tuple([]), () => subscriptions.detect())

  handle(CHANNELS.foldersRecent, z.tuple([]), () => recentFolders())
  handle(CHANNELS.dialogPickFolder, z.tuple([z.object({ showHidden: z.boolean().optional() }).optional()]), async (options) => {
    const win = BrowserWindow.getFocusedWindow()
    const showHidden = options?.showHidden ?? false
    const dialogOptions: OpenDialogOptions = {
      properties: showHidden ? ['openDirectory', 'showHiddenFiles'] : ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    const picked = result.canceled ? null : (result.filePaths[0] ?? null)
    // A hidden-files pick is a config dir for Settings, not a project folder.
    if (picked && !showHidden) rememberFolder(picked)
    return picked
  })
}
