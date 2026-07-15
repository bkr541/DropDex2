const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dropdexDesktop', Object.freeze({
  isElectron: true,
  getRuntimeInfo: () => ipcRenderer.invoke('dropdex:runtime-info'),
  getUsbState: () => ipcRenderer.invoke('dropdex:usb-state'),
  selectUsbRoot: () => ipcRenderer.invoke('dropdex:select-usb-root'),
  disconnectUsb: () => ipcRenderer.invoke('dropdex:disconnect-usb'),
  resolveTrackSource: (segments) => ipcRenderer.invoke('dropdex:resolve-track-source', segments),
  openExternal: (url) => ipcRenderer.invoke('dropdex:open-external', url),
}));
