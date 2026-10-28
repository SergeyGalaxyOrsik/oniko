import type { AgentId, AgentInfo } from './agents'
import type { AppEvent } from './events'
import type { AddSubscriptionResult, SubscriptionId, SubscriptionsState } from './subscriptions'
import type { StatusKind, TaskId, TasksState, TaskStatusId } from './tasks'
import type { Thread, ThreadId } from './thread'

export const EVENT_CHANNEL = 'oniko:event'
/** Main asks the renderer to show a thread, e.g. after a notification about it is clicked. */
export const OPEN_THREAD_CHANNEL = 'oniko:openThread'
/** One-way: the renderer reports its uncaught errors to main for telemetry. */
export const RENDERER_ERROR_CHANNEL = 'telemetry:rendererError'

/**
 * Every broadcast event carries the bus's sequence number, and a snapshot records the last one
 * it includes, so a renderer can tell which events a snapshot already reflects.
 */
export type SequencedEvent = { seq: number; event: AppEvent }
/** `home` lets the renderer shorten paths to `~`; a sandboxed renderer cannot ask the OS. */
export type AppSnapshot = { seq: number; home: string; threads: Thread[]; subscriptions: SubscriptionsState; tasks: TasksState }
/** `available` is false when this build or environment has no telemetry server. */
export type TelemetryState = { enabled: boolean; available: boolean }
export type RendererErrorReport = { name: string; message: string; stack?: string }

export type OnikoApi = {
  snapshot(): Promise<AppSnapshot>
  agents: { list(): Promise<AgentInfo[]> }
  threads: {
    /** Starts on the active subscription unless one is given. */
    /** `config` holds values picked before the session exists, keyed by config id. */
    create(input: { cwd: string; subscriptionId?: SubscriptionId; config?: Record<string, string> }): Promise<ThreadId>
    prompt(id: ThreadId, text: string): Promise<void>
    cancel(id: ThreadId): Promise<void>
    setConfig(id: ThreadId, configId: string, value: string): Promise<void>
    respondPermission(id: ThreadId, requestId: string, optionId: string | null): Promise<void>
    authenticate(id: ThreadId, methodId: string): Promise<void>
    remove(id: ThreadId): Promise<void>
  }
  subscriptions: {
    list(): Promise<SubscriptionsState>
    add(input: { agentId: AgentId; configDir: string; label?: string }): Promise<AddSubscriptionResult>
    update(id: SubscriptionId, patch: { label: string }): Promise<void>
    remove(id: SubscriptionId): Promise<void>
    refresh(id?: SubscriptionId): Promise<void>
    setActive(id: SubscriptionId): Promise<void>
    /** Config dirs that look like Claude subscriptions and are not added yet. */
    detect(): Promise<string[]>
  }
  tasks: {
    /** Seeds the default statuses for a project that has none yet. */
    open(project: string): Promise<void>
    create(input: { project: string; title: string; description: string; statusId: TaskStatusId }): Promise<TaskId>
    /** The subscription can only change until the agent has started. */
    update(id: TaskId, patch: { title?: string; description?: string; subscriptionId?: SubscriptionId | null; pullRequest?: boolean }): Promise<void>
    /** Places the task in `statusId` ahead of `beforeId`, or last when it is null. */
    move(id: TaskId, statusId: TaskStatusId, beforeId: TaskId | null): Promise<void>
    remove(id: TaskId): Promise<void>
    addStatus(project: string, name: string): Promise<TaskStatusId>
    updateStatus(id: TaskStatusId, patch: { name?: string; kind?: StatusKind }): Promise<void>
    /** Its tasks move to the project's first remaining status. */
    removeStatus(id: TaskStatusId): Promise<void>
  }
  folders: { recent(): Promise<string[]> }
  dialog: { pickFolder(options?: { showHidden?: boolean }): Promise<string | null> }
  telemetry: {
    get(): Promise<TelemetryState>
    /** Turning it off also drops whatever is still queued. */
    setEnabled(enabled: boolean): Promise<void>
    reportError(report: RendererErrorReport): void
  }
  onEvent(cb: (event: SequencedEvent) => void): () => void
  onOpenThread(cb: (id: ThreadId) => void): () => void
}

/** One table drives both the preload bridge and the ipcMain handlers, so channel names cannot drift. */
export const CHANNELS = {
  snapshot: 'app:snapshot',
  agentsList: 'agents:list',
  threadsCreate: 'threads:create',
  threadsPrompt: 'threads:prompt',
  threadsCancel: 'threads:cancel',
  threadsSetConfig: 'threads:setConfig',
  threadsRespondPermission: 'threads:respondPermission',
  threadsAuthenticate: 'threads:authenticate',
  threadsRemove: 'threads:remove',
  subscriptionsList: 'subscriptions:list',
  subscriptionsAdd: 'subscriptions:add',
  subscriptionsUpdate: 'subscriptions:update',
  subscriptionsRemove: 'subscriptions:remove',
  subscriptionsRefresh: 'subscriptions:refresh',
  subscriptionsSetActive: 'subscriptions:setActive',
  subscriptionsDetect: 'subscriptions:detect',
  tasksOpen: 'tasks:open',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksMove: 'tasks:move',
  tasksRemove: 'tasks:remove',
  tasksAddStatus: 'tasks:addStatus',
  tasksUpdateStatus: 'tasks:updateStatus',
  tasksRemoveStatus: 'tasks:removeStatus',
  foldersRecent: 'folders:recent',
  dialogPickFolder: 'dialog:pickFolder',
  telemetryGet: 'telemetry:get',
  telemetrySetEnabled: 'telemetry:setEnabled',
} as const
