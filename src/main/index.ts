import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { z } from 'zod'
import { EVENT_CHANNEL } from '@shared/api'
import { ThreadDb } from './db'
import { registerIpc } from './ipc'
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
  const logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  const db = new ThreadDb(join(app.getPath('userData'), 'oniko.db'))
  const recentFolders = () => db.getSetting(RECENT_KEY, z.array(z.string())) ?? []
  const rememberFolder = (path: string) => {
    db.setSetting(RECENT_KEY, [path, ...recentFolders().filter((p) => p !== path)].slice(0, RECENT_LIMIT))
  }
  const smokeCwd = process.env['ONIKO_SMOKE_CWD']
  if (smokeCwd) rememberFolder(smokeCwd)
  const store = new ThreadStore({
    db,
    logDir,
    broadcast: (event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(EVENT_CHANNEL, event)
    },
  })
  registerIpc({ store, recentFolders, rememberFolder })
  app.on('before-quit', () => store.disposeAll())
  app.on('will-quit', () => db.close())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
