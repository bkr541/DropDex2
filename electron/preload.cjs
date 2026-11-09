const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dropdexDesktop', Object.freeze({
  isElectron: true,
  // The full location on this computer of a file the user picked in a file chooser. Browsers do not share this; the desktop app can.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  getRuntimeInfo: () => ipcRenderer.invoke('dropdex:runtime-info'),
  getInstallationId: () => ipcRenderer.invoke('dropdex:installation-id'),
  getRouletteRuntimeHealth: () => ipcRenderer.invoke('dropdex:roulette-runtime-health'),
  getUsbState: () => ipcRenderer.invoke('dropdex:usb-state'),
  getUsbActivityState: () => ipcRenderer.invoke('dropdex:usb-activity-state'),
  selectUsbRoot: () => ipcRenderer.invoke('dropdex:select-usb-root'),
  reconnectUsb: (expectedVolumeName = null) => ipcRenderer.invoke('dropdex:reconnect-usb', expectedVolumeName),
  releaseUsb: () => ipcRenderer.invoke('dropdex:release-usb'),
  disconnectUsb: () => ipcRenderer.invoke('dropdex:disconnect-usb'),
  encodePreview: (input) => ipcRenderer.invoke('dropdex:encode-preview', input),
  getUsbDetails: () => ipcRenderer.invoke('dropdex:usb-details'),
  chooseAudioCopyUsb: (expected) => ipcRenderer.invoke('dropdex:choose-audio-copy-usb', expected),
  prepareAudioCopy: (request) => ipcRenderer.invoke('dropdex:prepare-audio-copy', request),
  startAudioCopy: (planId) => ipcRenderer.invoke('dropdex:start-audio-copy', planId),
  cancelAudioCopy: (planId) => ipcRenderer.invoke('dropdex:cancel-audio-copy', planId),
  onAudioCopyProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('dropdex:audio-copy-progress', handler);
    return () => ipcRenderer.removeListener('dropdex:audio-copy-progress', handler);
  },
  getTransferDestination: () => ipcRenderer.invoke('dropdex:transfer-destination'),
  selectTransferDestination: () => ipcRenderer.invoke('dropdex:select-transfer-destination'),
  clearTransferDestination: () => ipcRenderer.invoke('dropdex:clear-transfer-destination'),
  scanTransfer: () => ipcRenderer.invoke('dropdex:scan-transfer'),
  startTransfer: (categories) => ipcRenderer.invoke('dropdex:start-transfer', categories),
  cancelTransfer: () => ipcRenderer.invoke('dropdex:cancel-transfer'),
  onTransferProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('dropdex:transfer-progress', handler);
    return () => ipcRenderer.removeListener('dropdex:transfer-progress', handler);
  },
  resolveTrackSource: (segments) => ipcRenderer.invoke('dropdex:resolve-track-source', segments),
  inspectStemAsset: (locator) => ipcRenderer.invoke('dropdex:inspect-stem-asset', locator),
  resolveStemAsset: (locator) => ipcRenderer.invoke('dropdex:resolve-stem-asset', locator),
  deleteStemAsset: (locator) => ipcRenderer.invoke('dropdex:delete-stem-asset', locator),
  prepareRouletteStems: (input) => ipcRenderer.invoke('dropdex:prepare-roulette-stems', input),
  prepareRoulettePreview: (input) => ipcRenderer.invoke('dropdex:prepare-roulette-preview', input),
  cancelRouletteStems: (trackId) => ipcRenderer.invoke('dropdex:cancel-roulette-stems', trackId),
  separateFlipLabTrack: (input) => ipcRenderer.invoke('dropdex:flip-lab-separate', input),
  clearFlipLabStemCache: () => ipcRenderer.invoke('dropdex:flip-lab-clear-stem-cache'),
  onFlipLabSeparationProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('dropdex:flip-lab-separation-progress', handler);
    return () => ipcRenderer.removeListener('dropdex:flip-lab-separation-progress', handler);
  },
  metadataApplyAvailability: () => ipcRenderer.invoke('dropdex:metadata-apply-availability'),
  metadataApplyPreflight: (scope, savedDrafts) => ipcRenderer.invoke('dropdex:metadata-apply-preflight', { scope, savedDrafts }),
  metadataApply: (token, scope, savedDrafts) => ipcRenderer.invoke('dropdex:metadata-apply', { token, scope, savedDrafts }),
  metadataRecoveryVerify: (recovery) => ipcRenderer.invoke('dropdex:metadata-recovery-verify', { recovery }),
  cueApplyAvailability: () => ipcRenderer.invoke('dropdex:cue-apply-availability'),
  cueBaselineVerify: (scope, savedDrafts) => ipcRenderer.invoke('dropdex:cue-baseline-verify', { scope, savedDrafts }),
  cueApplyPreflight: (scope, savedDrafts) => ipcRenderer.invoke('dropdex:cue-apply-preflight', { scope, savedDrafts }),
  cueApply: (token, scope, savedDrafts) => ipcRenderer.invoke('dropdex:cue-apply', { token, scope, savedDrafts }),
  openExternal: (url) => ipcRenderer.invoke('dropdex:open-external', url),
  openLayoutLab: () => ipcRenderer.invoke('dropdex:open-layout-lab'),
}));
