const whisperStatusEl = document.getElementById('whisperStatus');
const ffprobeStatusEl = document.getElementById('ffprobeStatus');
const modelStatusEl = document.getElementById('modelStatus');

const downloadModelBtn = document.getElementById('downloadModelBtn');
const modelDownloadWrap = document.getElementById('modelDownloadWrap');
const modelDownloadBar = document.getElementById('modelDownloadBar');
const modelDownloadMeta = document.getElementById('modelDownloadMeta');

const pickFileBtn = document.getElementById('pickFileBtn');
const selectedFileEl = document.getElementById('selectedFile');
const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');

const transcribeProgressWrap = document.getElementById('transcribeProgressWrap');
const transcribeBar = document.getElementById('transcribeBar');
const transcribeMeta = document.getElementById('transcribeMeta');
const transcribeStatusText = document.getElementById('transcribeStatusText');

const transcriptArea = document.getElementById('transcriptArea');
const showOutputBtn = document.getElementById('showOutputBtn');

let appState = {
  whisperInstalled: false,
  ffprobeInstalled: false,
  modelInstalled: false,
  modelSizeBytes: 0,
  selectedFile: null,
  transcribing: false,
  outputPath: null,
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const rounded = Math.round(seconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateControls() {
  const canStart =
    appState.whisperInstalled &&
    appState.ffprobeInstalled &&
    appState.modelInstalled &&
    Boolean(appState.selectedFile) &&
    !appState.transcribing;

  startBtn.disabled = !canStart;
  cancelBtn.disabled = !appState.transcribing;
  pickFileBtn.disabled = appState.transcribing;
  downloadModelBtn.disabled = appState.transcribing;
  showOutputBtn.disabled = !appState.outputPath;
}

function renderSetupStatus() {
  whisperStatusEl.textContent = appState.whisperInstalled
    ? '✅ Installed'
    : '❌ Missing (brew install openai-whisper)';

  ffprobeStatusEl.textContent = appState.ffprobeInstalled
    ? '✅ Installed'
    : '❌ Missing (brew install ffmpeg)';

  modelStatusEl.textContent = appState.modelInstalled
    ? `✅ Installed (${formatBytes(appState.modelSizeBytes)})`
    : 'Not downloaded yet';

  if (appState.modelInstalled) {
    downloadModelBtn.textContent = 'Re-download model';
  } else {
    downloadModelBtn.textContent = 'Download large-v3-turbo model';
  }
}

async function refreshSystemStatus() {
  try {
    const status = await window.api.getSystemStatus();

    appState.whisperInstalled = Boolean(status.whisperInstalled);
    appState.ffprobeInstalled = Boolean(status.ffprobeInstalled);
    appState.modelInstalled = Boolean(status.model?.installed);
    appState.modelSizeBytes = Number(status.model?.sizeBytes || 0);

    renderSetupStatus();
    updateControls();
  } catch (error) {
    transcribeStatusText.textContent = `Status check failed: ${error.message}`;
  }
}

function setSelectedFile(filePath) {
  appState.selectedFile = filePath;
  selectedFileEl.textContent = filePath || 'No file selected';
  updateControls();
}

function setTranscribing(flag) {
  appState.transcribing = flag;
  updateControls();
}

async function onPickFile() {
  const filePath = await window.api.pickAudioFile();
  if (!filePath) return;

  appState.outputPath = null;
  showOutputBtn.disabled = true;
  setSelectedFile(filePath);
}

async function onDownloadModel() {
  modelDownloadWrap.classList.remove('hidden');
  modelDownloadBar.value = 0;
  modelDownloadMeta.textContent = 'Starting download…';

  try {
    await window.api.downloadModel();
  } catch (error) {
    modelDownloadMeta.textContent = `Download failed: ${error.message}`;
  }
}

async function onStartTranscription() {
  if (!appState.selectedFile) return;

  transcriptArea.value = '';
  appState.outputPath = null;
  transcribeProgressWrap.classList.remove('hidden');
  transcribeBar.value = 0;
  transcribeMeta.textContent = 'Starting…';
  transcribeStatusText.textContent = 'Launching Whisper…';

  setTranscribing(true);

  try {
    const started = await window.api.startTranscription(appState.selectedFile);
    if (started?.durationSeconds) {
      transcribeMeta.textContent = `0% • ETA — • Duration ${formatDuration(started.durationSeconds)}`;
    }
  } catch (error) {
    setTranscribing(false);
    transcribeStatusText.textContent = `Could not start: ${error.message}`;
  }
}

async function onCancelTranscription() {
  await window.api.cancelTranscription();
}

function appendTranscript(text) {
  if (!text) return;
  transcriptArea.value += (transcriptArea.value ? '\n' : '') + text;
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

window.api.onModelDownloadState(async (evt) => {
  if (evt.state === 'starting') {
    modelDownloadWrap.classList.remove('hidden');
    modelDownloadMeta.textContent = 'Downloading model…';
  }

  if (evt.state === 'done') {
    modelDownloadBar.value = 100;
    modelDownloadMeta.textContent = 'Download complete';
    await refreshSystemStatus();
  }

  if (evt.state === 'error') {
    modelDownloadMeta.textContent = `Error: ${evt.message}`;
  }
});

window.api.onModelDownloadProgress((evt) => {
  modelDownloadWrap.classList.remove('hidden');

  const percent = Number(evt.percent || 0);
  modelDownloadBar.value = Math.max(0, Math.min(percent, 100));

  const downloaded = formatBytes(evt.downloadedBytes || 0);
  const total = evt.totalBytes ? formatBytes(evt.totalBytes) : 'unknown';
  const speed = evt.speedBytesPerSec ? `${formatBytes(evt.speedBytesPerSec)}/s` : '—';
  const eta = Number.isFinite(evt.etaSeconds) ? formatDuration(evt.etaSeconds) : '—';

  modelDownloadMeta.textContent = `${percent.toFixed(1)}% • ${downloaded}/${total} • ${speed} • ETA ${eta}`;
});

window.api.onTranscribeStatus((evt) => {
  transcribeStatusText.textContent = evt.message || 'Working…';
});

window.api.onTranscribeSegment((segment) => {
  appendTranscript(segment.text);
});

window.api.onTranscribeProgress((evt) => {
  const pct = Math.max(0, Math.min((evt.progress || 0) * 100, 100));
  transcribeBar.value = pct;

  const eta = Number.isFinite(evt.etaSeconds) ? formatDuration(evt.etaSeconds) : '—';
  const processed = formatDuration(evt.processedSeconds || 0);
  const total = formatDuration(evt.durationSeconds || 0);

  transcribeMeta.textContent = `${pct.toFixed(1)}% • ETA ${eta} • ${processed}/${total}`;
});

window.api.onTranscribeDone((evt) => {
  setTranscribing(false);
  transcribeStatusText.textContent = `Done in ${formatDuration(evt.elapsedSeconds || 0)}`;

  if (evt.transcript && !transcriptArea.value.trim()) {
    transcriptArea.value = evt.transcript;
  }

  if (evt.outputPath) {
    appState.outputPath = evt.outputPath;
  }

  updateControls();
});

window.api.onTranscribeError((evt) => {
  setTranscribing(false);
  transcribeStatusText.textContent = `Error: ${evt.message}`;
});

showOutputBtn.addEventListener('click', async () => {
  if (!appState.outputPath) return;
  await window.api.showInFinder(appState.outputPath);
});

pickFileBtn.addEventListener('click', onPickFile);
downloadModelBtn.addEventListener('click', onDownloadModel);
startBtn.addEventListener('click', onStartTranscription);
cancelBtn.addEventListener('click', onCancelTranscription);

refreshSystemStatus();
