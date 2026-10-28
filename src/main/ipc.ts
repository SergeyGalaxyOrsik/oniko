import { homedir } from 'node:os'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { z } from 'zod'
import { AGENT_IDS, AGENTS, type AgentId } from '@shared/agents'
import { CHANNELS, RENDERER_ERROR_CHANNEL, type AppSnapshot } from '@shared/api'
import type { SubscriptionId } from '@shared/subscriptions'
import { STATUS_KINDS, type TaskId, type TaskStatusId } from '@shared/tasks'
import type { ThreadId } from '@shared/thread'
import type { EventBus } from './event-bus'
import type { SubscriptionStore } from './subscription-store'
import type { TaskStore } from './task-store'
import type { Telemetry } from './telemetry'
import type { ThreadStore } from './thread-store'

const threadId = z
  .string()
  .min(1)
  .transform((s) => s as ThreadId)
const subscriptionId = z
  .string()
  .min(1)
  .transform((s) => s as SubscriptionId)
const taskId = z
  .string()
  .min(1)
  .transform((s) => s as TaskId)
const taskStatusId = z
  .string()
  .min(1)
  .transform((s) => s as TaskStatusId)
const project = z.string().min(1)
const agentId = z.enum(AGENT_IDS as [AgentId, ...AgentId[]])

export type IpcDeps = {
  bus: EventBus
  store: ThreadStore
  subscriptions: SubscriptionStore
  tasks: TaskStore
  recentFolders: () => string[]
  rememberFolder: (path: string) => void
  telemetry: Telemetry
}

/** The renderer is untrusted input: every payload is parsed here and nowhere downstream. */
export function registerIpc({ bus, store, subscriptions, tasks, recentFolders, rememberFolder, telemetry }: IpcDeps): void {
  const handle = <S extends z.ZodTuple>(channel: string, schema: S, fn: (...args: z.infer<S>) => unknown) => {
    ipcMain.handle(channel, async (_event, ...raw: unknown[]) => {
      telemetry.invoked(channel)
      try {
        return await fn(...schema.parse(raw))
      } catch (err) {
        telemetry.failed(channel, err)
        throw err
      }
    })
  }

  handle(CHANNELS.snapshot, z.tuple([]), (): AppSnapshot => ({
    seq: bus.seq,
    home: homedir(),
    threads: store.list(),
    subscriptions: subscriptions.state(),
    tasks: tasks.state(),
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

  handle(CHANNELS.tasksOpen, z.tuple([project]), (p) => tasks.open(p))
  handle(
    CHANNELS.tasksCreate,
    z.tuple([z.object({ project, title: z.string(), description: z.string(), statusId: taskStatusId })]),
    (input) => tasks.create(input),
  )
  handle(
    CHANNELS.tasksUpdate,
    z.tuple([
      taskId,
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        subscriptionId: subscriptionId.nullable().optional(),
        pullRequest: z.boolean().optional(),
      }),
    ]),
    (id, patch) =>
      tasks.update(id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.subscriptionId !== undefined ? { subscriptionId: patch.subscriptionId } : {}),
        ...(patch.pullRequest !== undefined ? { pullRequest: patch.pullRequest } : {}),
      }),
  )
  handle(CHANNELS.tasksMove, z.tuple([taskId, taskStatusId, taskId.nullable()]), (id, statusId, beforeId) => tasks.move(id, statusId, beforeId))
  handle(CHANNELS.tasksRemove, z.tuple([taskId]), (id) => tasks.remove(id))
  handle(CHANNELS.tasksAddStatus, z.tuple([project, z.string()]), (p, name) => tasks.addStatus(p, name))
  handle(CHANNELS.tasksUpdateStatus, z.tuple([taskStatusId, z.object({ name: z.string().optional(), kind: z.enum(STATUS_KINDS).optional() })]), (id, patch) =>
    tasks.updateStatus(id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    }),
  )
  handle(CHANNELS.tasksRemoveStatus, z.tuple([taskStatusId]), (id) => tasks.removeStatus(id))

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

  handle(CHANNELS.telemetryGet, z.tuple([]), () => telemetry.state())
  handle(CHANNELS.telemetrySetEnabled, z.tuple([z.boolean()]), (enabled) => telemetry.setEnabled(enabled))
  ipcMain.on(RENDERER_ERROR_CHANNEL, (_event, raw: unknown) => telemetry.rendererError(raw))
}
