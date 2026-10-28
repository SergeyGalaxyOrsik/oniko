import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('oniko', {})
