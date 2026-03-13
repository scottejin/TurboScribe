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

  startRealtimeSession: (options) => ipcRenderer.invoke('realtime:start', options),
  pushRealtimeChunk: (payload) => ipcRenderer.invoke('realtime:push-chunk', payload),
  stopRealtimeSession: (payload) => ipcRenderer.invoke('realtime:stop', payload),
  cancelRealtimeSession: (payload) => ipcRenderer.invoke('realtime:cancel', payload),

  sampleRuntimeMetrics: () => ipcRenderer.invoke('metrics:sample'),

  pickAudioFile: () => ipcRenderer.invoke('dialog:pick-audio'),
  pickAudioFromClipboard: () => ipcRenderer.invoke('dialog:pick-audio-from-clipboard'),
  startTranscription: (audioPath) => ipcRenderer.invoke('transcribe:start', { audioPath }),
  cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),
  showInFinder: (targetPath) => ipcRenderer.invoke('shell:show-item', { path: targetPath }),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  onModelDownloadProgress: (listener) => exposeListener('model:download-progress', listener),
  onModelDownloadState: (listener) => exposeListener('model:download-state', listener),

  onUpdaterState: (listener) => exposeListener('updater:state', listener),
  onUpdaterDownloadProgress: (listener) => exposeListener('updater:download-progress', listener),

  onDependenciesState: (listener) => exposeListener('deps:state', listener),
  onDependenciesLog: (listener) => exposeListener('deps:log', listener),

  onRealtimeState: (listener) => exposeListener('realtime:state', listener),
  onRealtimeSegment: (listener) => exposeListener('realtime:segment', listener),
  onRealtimeFinal: (listener) => exposeListener('realtime:final', listener),
  onRealtimeError: (listener) => exposeListener('realtime:error', listener),

  onTranscribeLog: (listener) => exposeListener('transcribe:log', listener),
  onTranscribeStatus: (listener) => exposeListener('transcribe:status', listener),
  onTranscribeSegment: (listener) => exposeListener('transcribe:segment', listener),
  onTranscribeProgress: (listener) => exposeListener('transcribe:progress', listener),
  onTranscribeDone: (listener) => exposeListener('transcribe:done', listener),
  onTranscribeError: (listener) => exposeListener('transcribe:error', listener),
});
