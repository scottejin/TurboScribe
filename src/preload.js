const { contextBridge, ipcRenderer } = require('electron');

function exposeListener(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('api', {
  getSystemStatus: () => ipcRenderer.invoke('system:status'),
  downloadModel: () => ipcRenderer.invoke('model:download'),
  pickAudioFile: () => ipcRenderer.invoke('dialog:pick-audio'),
  startTranscription: (audioPath) => ipcRenderer.invoke('transcribe:start', { audioPath }),
  cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),
  showInFinder: (targetPath) => ipcRenderer.invoke('shell:show-item', { path: targetPath }),

  onModelDownloadProgress: (listener) => exposeListener('model:download-progress', listener),
  onModelDownloadState: (listener) => exposeListener('model:download-state', listener),

  onTranscribeLog: (listener) => exposeListener('transcribe:log', listener),
  onTranscribeStatus: (listener) => exposeListener('transcribe:status', listener),
  onTranscribeSegment: (listener) => exposeListener('transcribe:segment', listener),
  onTranscribeProgress: (listener) => exposeListener('transcribe:progress', listener),
  onTranscribeDone: (listener) => exposeListener('transcribe:done', listener),
  onTranscribeError: (listener) => exposeListener('transcribe:error', listener),
});
