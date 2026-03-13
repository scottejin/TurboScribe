const { contextBridge, ipcRenderer } = require('electron');

function exposeListener(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('api', {
  getSystemStatus: () => ipcRenderer.invoke('system:status'),
  downloadModel: () => ipcRenderer.invoke('model:download'),

  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAndOpenUpdate: (info) => ipcRenderer.invoke('updater:download-and-open', { info }),

  installHomebrewGuided: () => ipcRenderer.invoke('deps:install-homebrew'),
  installDependencies: () => ipcRenderer.invoke('deps:install'),
  cancelDependenciesInstall: () => ipcRenderer.invoke('deps:cancel'),

  pickAudioFile: () => ipcRenderer.invoke('dialog:pick-audio'),
  startTranscription: (audioPath) => ipcRenderer.invoke('transcribe:start', { audioPath }),
  cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),
  showInFinder: (targetPath) => ipcRenderer.invoke('shell:show-item', { path: targetPath }),

  onModelDownloadProgress: (listener) => exposeListener('model:download-progress', listener),
  onModelDownloadState: (listener) => exposeListener('model:download-state', listener),

  onUpdaterState: (listener) => exposeListener('updater:state', listener),
  onUpdaterDownloadProgress: (listener) => exposeListener('updater:download-progress', listener),

  onDependenciesState: (listener) => exposeListener('deps:state', listener),
  onDependenciesLog: (listener) => exposeListener('deps:log', listener),

  onTranscribeLog: (listener) => exposeListener('transcribe:log', listener),
  onTranscribeStatus: (listener) => exposeListener('transcribe:status', listener),
  onTranscribeSegment: (listener) => exposeListener('transcribe:segment', listener),
  onTranscribeProgress: (listener) => exposeListener('transcribe:progress', listener),
  onTranscribeDone: (listener) => exposeListener('transcribe:done', listener),
  onTranscribeError: (listener) => exposeListener('transcribe:error', listener),
});
