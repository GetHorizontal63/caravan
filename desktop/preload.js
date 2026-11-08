const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('caravanDesktop', {
  connect: url => ipcRenderer.invoke('connect', url),
  currentServer: () => ipcRenderer.invoke('current-server'),
})
