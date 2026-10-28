import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_CHANNEL, OPEN_THREAD_CHANNEL, RENDERER_ERROR_CHANNEL, type OnikoApi, type SequencedEvent } from '@shared/api'
import type { ThreadId } from '@shared/thread'

const call =
  <Args extends unknown[], R>(channel: string) =>
  (...args: Args): Promise<R> =>
    ipcRenderer.invoke(channel, ...args)

const api: OnikoApi = {
  snapshot: call(CHANNELS.snapshot),
  agents: { list: call(CHANNELS.agentsList) },
  threads: {
    create: call(CHANNELS.threadsCreate),
    prompt: call(CHANNELS.threadsPrompt),
    cancel: call(CHANNELS.threadsCancel),
    setConfig: call(CHANNELS.threadsSetConfig),
    respondPermission: call(CHANNELS.threadsRespondPermission),
    authenticate: call(CHANNELS.threadsAuthenticate),
    remove: call(CHANNELS.threadsRemove),
  },
  subscriptions: {
    list: call(CHANNELS.subscriptionsList),
    add: call(CHANNELS.subscriptionsAdd),
    update: call(CHANNELS.subscriptionsUpdate),
    remove: call(CHANNELS.subscriptionsRemove),
    refresh: call(CHANNELS.subscriptionsRefresh),
    setActive: call(CHANNELS.subscriptionsSetActive),
    detect: call(CHANNELS.subscriptionsDetect),
  },
  tasks: {
    open: call(CHANNELS.tasksOpen),
    create: call(CHANNELS.tasksCreate),
    update: call(CHANNELS.tasksUpdate),
    move: call(CHANNELS.tasksMove),
    remove: call(CHANNELS.tasksRemove),
    addStatus: call(CHANNELS.tasksAddStatus),
    updateStatus: call(CHANNELS.tasksUpdateStatus),
    removeStatus: call(CHANNELS.tasksRemoveStatus),
  },
  folders: { recent: call(CHANNELS.foldersRecent) },
  dialog: { pickFolder: call(CHANNELS.dialogPickFolder) },
  telemetry: {
    get: call(CHANNELS.telemetryGet),
    setEnabled: call(CHANNELS.telemetrySetEnabled),
    reportError: (report) => ipcRenderer.send(RENDERER_ERROR_CHANNEL, report),
  },
  onEvent(cb) {
    const listener = (_event: IpcRendererEvent, event: SequencedEvent) => cb(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => ipcRenderer.off(EVENT_CHANNEL, listener)
  },
  onOpenThread(cb) {
    const listener = (_event: IpcRendererEvent, id: ThreadId) => cb(id)
    ipcRenderer.on(OPEN_THREAD_CHANNEL, listener)
    return () => ipcRenderer.off(OPEN_THREAD_CHANNEL, listener)
  },
}

contextBridge.exposeInMainWorld('oniko', api)
