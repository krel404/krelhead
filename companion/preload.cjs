const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tome', {
  state: () => ipcRenderer.invoke('tome:state'),
  folder: () => ipcRenderer.invoke('tome:folder'),
  connect: () => ipcRenderer.invoke('tome:connect'),
  start: value => ipcRenderer.invoke('tome:start', { account: value.account, openAtLogin: value.openAtLogin }),
  pause: () => ipcRenderer.invoke('tome:pause'),
  disconnect: () => ipcRenderer.invoke('tome:disconnect'),
});
