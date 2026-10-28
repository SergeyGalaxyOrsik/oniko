import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_CHANNEL, type OnikoApi } from '@shared/api'
import type { ThreadEvent } from '@shared/events'

const call =
  <Args extends unknown[], R>(channel: string) =>
  (...args: Args): Promise<R> =>
    ipcRenderer.invoke(channel, ...args)

const api: OnikoApi = {
  agents: { list: call(CHANNELS.agentsList) },
  threads: {
    list: call(CHANNELS.threadsList),
    create: call(CHANNELS.threadsCreate),
    prompt: call(CHANNELS.threadsPrompt),
    cancel: call(CHANNELS.threadsCancel),
    setConfig: call(CHANNELS.threadsSetConfig),
    respondPermission: call(CHANNELS.threadsRespondPermission),
    authenticate: call(CHANNELS.threadsAuthenticate),
    remove: call(CHANNELS.threadsRemove),
  },
  folders: { recent: call(CHANNELS.foldersRecent) },
  dialog: { pickFolder: call(CHANNELS.dialogPickFolder) },
  onEvent(cb) {
    const listener = (_event: IpcRendererEvent, event: ThreadEvent) => cb(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => ipcRenderer.off(EVENT_CHANNEL, listener)
  },
}

contextBridge.exposeInMainWorld('oniko', api)
