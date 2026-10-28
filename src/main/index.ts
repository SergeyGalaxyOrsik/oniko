import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import { z } from 'zod'
import icon from '../../resources/icon.png?asset'
import { EVENT_CHANNEL, OPEN_THREAD_CHANNEL } from '@shared/api'
import { ACCOUNT_SPECS } from './agent-registry'
import { ThreadDb } from './db'
import { EventBus } from './event-bus'
import { registerIpc } from './ipc'
import { SubscriptionStore } from './subscription-store'
import { git, TaskRunner } from './task-runner'
import { TaskStore } from './task-store'
import { ThreadStore } from './thread-store'

const userDataOverride = process.env['ONIKO_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

const RECENT_KEY = 'recentFolders'
const RECENT_LIMIT = 8

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#fafafa',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    // Windows and Linux take the window icon; macOS shows the dock icon set on ready.
    icon,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  // Unpackaged, the dock shows Electron's own icon until told otherwise.
  app.dock?.setIcon(icon)
  const logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  const db = new ThreadDb(join(app.getPath('userData'), 'oniko.db'))
  const recentFolders = () => db.getSetting(RECENT_KEY, z.array(z.string())) ?? []
  const rememberFolder = (path: string) => {
    db.setSetting(RECENT_KEY, [path, ...recentFolders().filter((p) => p !== path)].slice(0, RECENT_LIMIT))
  }
  const smokeCwd = process.env['ONIKO_SMOKE_CWD']
  if (smokeCwd) rememberFolder(smokeCwd)
  const bus = new EventBus((event) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(EVENT_CHANNEL, event)
  })
  // The stores reference each other only through these late-bound callbacks.
  let store: ThreadStore | undefined
  let runner: TaskRunner | undefined
  // An unreferenced Notification can be collected before it is clicked, losing the click handler.
  const notes = new Set<Notification>()
  const subscriptions = new SubscriptionStore({
    db,
    specs: ACCOUNT_SPECS,
    publish: (event) => bus.publish(event),
    threadsUsing: (id) => store?.countUsing(id) ?? 0,
    onThreadsAdopted: () => store?.loadAdopted(),
    seed: { agentId: 'claude', configDir: join(homedir(), '.claude') },
  })
  store = new ThreadStore({
    db,
    logDir,
    accountEnv: (thread) => {
      const sub = subscriptions.get(thread.subscriptionId)
      if (!sub) throw new Error('This thread’s subscription was removed')
      return ACCOUNT_SPECS[sub.agentId].envFor(sub.configDir)
    },
    publish: (event) => {
      bus.publish(event)
      runner?.onThreadEvent(event)
    },
  })
  const tasks = new TaskStore({ db, publish: (event) => bus.publish(event), entered: (task, status) => runner?.entered(task, status) })
  runner = new TaskRunner({
    tasks,
    threads: store,
    subscriptions,
    worktreeRoot: process.env['ONIKO_WORKTREES'] ?? join(homedir(), '.oniko', 'worktrees'),
    git,
    notify: ({ title, body, threadId }) => {
      const note = new Notification({ title, body })
      notes.add(note)
      note.on('close', () => notes.delete(note))
      note.on('click', () => {
        notes.delete(note)
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return
        win.show()
        win.focus()
        win.webContents.send(OPEN_THREAD_CHANNEL, threadId)
      })
      note.show()
    },
  })
  void subscriptions.refresh()
  registerIpc({ bus, store, subscriptions, tasks, recentFolders, rememberFolder })
  app.on('before-quit', () => store.disposeAll())
  app.on('will-quit', () => db.close())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
