import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_CHANNEL, type OnikoApi, type SequencedEvent } from '@shared/api'

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
  folders: { recent: call(CHANNELS.foldersRecent) },
  dialog: { pickFolder: call(CHANNELS.dialogPickFolder) },
  onEvent(cb) {
    const listener = (_event: IpcRendererEvent, event: SequencedEvent) => cb(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => ipcRenderer.off(EVENT_CHANNEL, listener)
  },
}

contextBridge.exposeInMainWorld('oniko', api)
