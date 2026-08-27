const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dropdexDesktop', Object.freeze({
  isElectron: true,
  getRuntimeInfo: () => ipcRenderer.invoke('dropdex:runtime-info'),
  getUsbState: () => ipcRenderer.invoke('dropdex:usb-state'),
  getUsbActivityState: () => ipcRenderer.invoke('dropdex:usb-activity-state'),
  selectUsbRoot: () => ipcRenderer.invoke('dropdex:select-usb-root'),
  releaseUsb: () => ipcRenderer.invoke('dropdex:release-usb'),
  disconnectUsb: () => ipcRenderer.invoke('dropdex:disconnect-usb'),
  resolveTrackSource: (segments) => ipcRenderer.invoke('dropdex:resolve-track-source', segments),
  metadataApplyAvailability: () => ipcRenderer.invoke('dropdex:metadata-apply-availability'),
  metadataApplyPreflight: (scope, savedDrafts) => ipcRenderer.invoke('dropdex:metadata-apply-preflight', { scope, savedDrafts }),
  cueApplyAvailability: () => ipcRenderer.invoke('dropdex:cue-apply-availability'),
  cueApplyPreflight: (scope, savedDrafts) => ipcRenderer.invoke('dropdex:cue-apply-preflight', { scope, savedDrafts }),
  cueApply: (token, scope, savedDrafts) => ipcRenderer.invoke('dropdex:cue-apply', { token, scope, savedDrafts }),
  openExternal: (url) => ipcRenderer.invoke('dropdex:open-external', url),
}));
