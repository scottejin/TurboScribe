const appVersionEl = document.getElementById('appVersion');
const updateSourceEl = document.getElementById('updateSource');

const whisperStatusEl = document.getElementById('whisperStatus');
const ffprobeStatusEl = document.getElementById('ffprobeStatus');
const modelStatusEl = document.getElementById('modelStatus');

const quitAppBtn = document.getElementById('quitAppBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsDrawer = document.getElementById('settingsDrawer');
const drawerBackdrop = document.getElementById('drawerBackdrop');

const themeSwitch = document.getElementById('themeSwitch');
const themeAutoBtn = document.getElementById('themeAutoBtn');
const themeModeLabel = document.getElementById('themeModeLabel');

const onboardingPanel = document.getElementById('onboardingPanel');
const onboardingDepsStep = document.getElementById('onboardingDepsStep');
const onboardingModelStep = document.getElementById('onboardingModelStep');
const onboardingReadyStep = document.getElementById('onboardingReadyStep');
const onboardingOpenSettingsBtn = document.getElementById('onboardingOpenSettingsBtn');
const onboardingDoneBtn = document.getElementById('onboardingDoneBtn');

const modeFileBtn = document.getElementById('modeFileBtn');
const modeLiveBtn = document.getElementById('modeLiveBtn');
const filePanel = document.getElementById('filePanel');
const livePanel = document.getElementById('livePanel');

const liveSourceMic = document.getElementById('liveSourceMic');
const liveSourceScreen = document.getElementById('liveSourceScreen');
const liveTaskSelect = document.getElementById('liveTaskSelect');
const startLiveBtn = document.getElementById('startLiveBtn');
const stopLiveBtn = document.getElementById('stopLiveBtn');
const liveElapsed = document.getElementById('liveElapsed');
const liveStatusText = document.getElementById('liveStatusText');
const liveStatusBadge = document.getElementById('liveStatusBadge');

const downloadModelBtn = document.getElementById('downloadModelBtn');
const modelDownloadWrap = document.getElementById('modelDownloadWrap');
const modelDownloadBar = document.getElementById('modelDownloadBar');
const modelDownloadMeta = document.getElementById('modelDownloadMeta');

const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
const updateWrap = document.getElementById('updateWrap');
const updateBar = document.getElementById('updateBar');
const updateMeta = document.getElementById('updateMeta');

const installDepsBtn = document.getElementById('installDepsBtn');
const cancelDepsBtn = document.getElementById('cancelDepsBtn');
const installBrewBtn = document.getElementById('installBrewBtn');
const depsStatusText = document.getElementById('depsStatusText');
const depsLogEl = document.getElementById('depsLog');

const pickFileBtn = document.getElementById('pickFileBtn');
const selectedFileEl = document.getElementById('selectedFile');
const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');
const showOutputBtn = document.getElementById('showOutputBtn');

const transcribeProgressWrap = document.getElementById('transcribeProgressWrap');
const transcribeBar = document.getElementById('transcribeBar');
const transcribeMeta = document.getElementById('transcribeMeta');
const cpuMetricLabel = document.getElementById('cpuMetricLabel');
const cpuMetricBar = document.getElementById('cpuMetricBar');
const powerMetricLabel = document.getElementById('powerMetricLabel');
const powerMetricBar = document.getElementById('powerMetricBar');
const transcribeStatusText = document.getElementById('transcribeStatusText');
const transcribeLogEl = document.getElementById('transcribeLog');
const transcriptBlocks = document.getElementById('transcriptBlocks');
const transcriptArea = document.getElementById('transcriptArea');

const storageKeys = {
  themeMode: 'turboscribe.themeMode',
  onboardingDone: 'turboscribe.onboardingDone',
};

const mediaTheme = window.matchMedia('(prefers-color-scheme: dark)');

let appState = {
  appVersion: '—',
  updateSource: '—',
  whisperInstalled: false,
  ffprobeInstalled: false,
  brewInstalled: false,
  modelInstalled: false,
  modelSizeBytes: 0,
  selectedFile: null,
  fileTranscribing: false,
  outputPath: null,
  updateInfo: null,
  updateDownloading: false,
  dependenciesInstalling: false,
  settingsOpen: false,
  inputMode: 'file',
};

let themeMode = localStorage.getItem(storageKeys.themeMode) || 'system';
let transcriptEntries = [];
let fullTranscriptText = '';
let transcriptRenderPending = false;
let runtimeMetricsTimer = null;
let clipboardPasteDebounceMs = 0;

const MAX_VISIBLE_TRANSCRIPT_ENTRIES = 140;

const liveState = {
  active: false,
  stopping: false,
  sessionId: null,
  stream: null,
  captureStreams: [],
  recorder: null,
  chunks: [],
  pendingChunkUploads: new Set(),
  startedAtMs: 0,
  lastChunkAtMs: 0,
  elapsedTimer: null,
  sourceMode: 'microphone',
  task: 'transcribe',
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

function formatRange(startSeconds, endSeconds) {
  const start = formatDuration(startSeconds);
  const end = Number.isFinite(endSeconds) && endSeconds > 0 ? formatDuration(endSeconds) : null;
  return end && end !== '—' ? `${start} → ${end}` : start;
}

function setProgressIndeterminate(progressEl, indeterminate) {
  if (indeterminate) {
    progressEl.removeAttribute('value');
  } else if (!progressEl.hasAttribute('value')) {
    progressEl.setAttribute('value', '0');
    progressEl.value = 0;
  }
}

function setProgressValue(progressEl, percent) {
  setProgressIndeterminate(progressEl, false);
  progressEl.value = Math.max(0, Math.min(percent, 100));
}

function updateRuntimeMetricsDisplay(sample) {
  const cpu = Number(sample?.cpuPercent || 0);
  const watts = Number(sample?.watts || 0);
  const cpuBarPct = Number(sample?.cpuBarPercent || 0);
  const wattsBarPct = Number(sample?.wattsBarPercent || 0);

  cpuMetricLabel.textContent = `CPU ${cpu.toFixed(1)}%`;
  powerMetricLabel.textContent = `${watts.toFixed(1)}W`;

  cpuMetricBar.style.width = `${Math.max(0, Math.min(cpuBarPct, 100)).toFixed(1)}%`;
  powerMetricBar.style.width = `${Math.max(0, Math.min(wattsBarPct, 100)).toFixed(1)}%`;
}

function stopRuntimeMetricsPolling() {
  if (runtimeMetricsTimer) {
    clearInterval(runtimeMetricsTimer);
    runtimeMetricsTimer = null;
  }
}

async function pollRuntimeMetricsOnce() {
  try {
    const sample = await window.api.sampleRuntimeMetrics();
    updateRuntimeMetricsDisplay(sample);
  } catch {
    // ignore transient metrics failures
  }
}

function startRuntimeMetricsPolling() {
  if (runtimeMetricsTimer) return;

  runtimeMetricsTimer = setInterval(() => {
    void pollRuntimeMetricsOnce();
  }, 1000);

  void pollRuntimeMetricsOnce();
}

function refreshRuntimeMetricsPolling() {
  const shouldPoll = appState.fileTranscribing || liveState.active || liveState.stopping;
  if (shouldPoll) {
    startRuntimeMetricsPolling();
  } else {
    stopRuntimeMetricsPolling();
    updateRuntimeMetricsDisplay({ cpuPercent: 0, watts: 0, cpuBarPercent: 0, wattsBarPercent: 0 });
  }
}

async function tryPickFileFromClipboard() {
  if (appState.inputMode !== 'file') return false;
  if (appState.fileTranscribing || liveState.active || liveState.stopping) return false;

  try {
    const maybePath = await window.api.pickAudioFromClipboard();
    if (maybePath) {
      appState.outputPath = null;
      setSelectedFile(maybePath);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

function resolveTheme() {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return mediaTheme.matches ? 'dark' : 'light';
}

function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;
  themeSwitch.checked = resolved === 'dark';

  if (themeMode === 'system') {
    themeModeLabel.textContent = `Theme: Auto (${resolved})`;
  } else {
    themeModeLabel.textContent = `Theme: ${resolved}`;
  }
}

function setThemeMode(mode) {
  themeMode = mode;
  localStorage.setItem(storageKeys.themeMode, mode);
  applyTheme();
}

function openSettingsDrawer() {
  appState.settingsOpen = true;
  settingsDrawer.classList.add('open');
  settingsDrawer.setAttribute('aria-hidden', 'false');
  drawerBackdrop.classList.remove('hidden');
}

function closeSettingsDrawer() {
  appState.settingsOpen = false;
  settingsDrawer.classList.remove('open');
  settingsDrawer.setAttribute('aria-hidden', 'true');
  drawerBackdrop.classList.add('hidden');
}

function setInputMode(mode) {
  if (liveState.active || appState.fileTranscribing) return;

  appState.inputMode = mode === 'live' ? 'live' : 'file';

  const isFile = appState.inputMode === 'file';
  modeFileBtn.classList.toggle('active', isFile);
  modeFileBtn.setAttribute('aria-selected', String(isFile));
  modeLiveBtn.classList.toggle('active', !isFile);
  modeLiveBtn.setAttribute('aria-selected', String(!isFile));

  filePanel.classList.toggle('hidden', !isFile);
  livePanel.classList.toggle('hidden', isFile);

  updateControls();
}

function requestTranscriptRender() {
  if (transcriptRenderPending) return;
  transcriptRenderPending = true;

  requestAnimationFrame(() => {
    transcriptRenderPending = false;
    renderTranscriptBoard();
  });
}

function renderTranscriptBoard() {
  transcriptBlocks.innerHTML = '';

  if (!transcriptEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'transcript-empty';
    empty.textContent =
      appState.inputMode === 'live'
        ? 'Start live recording to see realtime transcript blocks here.'
        : 'Pick a file and start transcription to populate this transcript view.';
    transcriptBlocks.appendChild(empty);
    transcriptArea.value = fullTranscriptText || '';
    return;
  }

  const hiddenCount = Math.max(transcriptEntries.length - MAX_VISIBLE_TRANSCRIPT_ENTRIES, 0);
  const visibleEntries = hiddenCount
    ? transcriptEntries.slice(-MAX_VISIBLE_TRANSCRIPT_ENTRIES)
    : transcriptEntries;

  if (hiddenCount > 0) {
    const notice = document.createElement('div');
    notice.className = 'transcript-empty';
    notice.textContent = `${hiddenCount} earlier transcript lines are hidden here. Full transcript is saved as TXT on Desktop.`;
    transcriptBlocks.appendChild(notice);
  }

  const lines = [];

  for (const entry of visibleEntries) {
    const card = document.createElement('article');
    card.className = `transcript-item${entry.provisional ? ' provisional' : ''}`;

    const header = document.createElement('div');
    header.className = 'transcript-item-header';

    const timeChip = document.createElement('span');
    timeChip.className = 'transcript-time';
    if (Number.isFinite(entry.startSeconds)) {
      timeChip.textContent = formatRange(entry.startSeconds, entry.endSeconds);
    } else {
      timeChip.textContent = 'Untimed';
    }

    const kind = document.createElement('span');
    kind.className = 'transcript-kind';
    kind.textContent = entry.provisional ? 'Live (provisional)' : 'Final';

    const text = document.createElement('p');
    text.className = 'transcript-text';
    text.textContent = entry.text;

    header.appendChild(timeChip);
    header.appendChild(kind);
    card.appendChild(header);
    card.appendChild(text);

    transcriptBlocks.appendChild(card);
    lines.push(entry.text);
  }

  transcriptBlocks.scrollTop = transcriptBlocks.scrollHeight;
  transcriptArea.value = fullTranscriptText || lines.join('\n');
}

function resetTranscriptBoard() {
  transcriptEntries = [];
  fullTranscriptText = '';
  requestTranscriptRender();
}

function addTranscriptEntry(entry) {
  const normalized = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: String(entry.text || '').trim(),
    startSeconds: Number(entry.startSeconds),
    endSeconds: Number(entry.endSeconds),
    provisional: Boolean(entry.provisional),
  };

  if (!normalized.text) return;

  transcriptEntries.push(normalized);

  const shouldAppendToFull = normalized.provisional || appState.fileTranscribing || liveState.active;
  if (shouldAppendToFull) {
    fullTranscriptText = fullTranscriptText ? `${fullTranscriptText}\n${normalized.text}` : normalized.text;
  } else if (!fullTranscriptText) {
    fullTranscriptText = transcriptEntries.map((item) => item.text).join('\n');
  }

  requestTranscriptRender();
}

function replaceTranscriptWithFinal(segments, fullText) {
  fullTranscriptText = String(fullText || '').trim();
  transcriptEntries = [];

  if (Array.isArray(segments) && segments.length) {
    transcriptEntries = segments
      .map((segment) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: String(segment.text || '').trim(),
        startSeconds: Number(segment.startSeconds),
        endSeconds: Number(segment.endSeconds),
        provisional: false,
      }))
      .filter((segment) => segment.text);

    requestTranscriptRender();
    return;
  }

  const lines = fullTranscriptText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  transcriptEntries = lines.map((line) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: line,
    startSeconds: Number.NaN,
    endSeconds: Number.NaN,
    provisional: false,
  }));

  requestTranscriptRender();
}

function updateLiveElapsed() {
  if (!liveState.active) {
    liveElapsed.textContent = 'Elapsed 00:00';
    return;
  }

  const elapsedSeconds = (Date.now() - liveState.startedAtMs) / 1000;
  liveElapsed.textContent = `Elapsed ${formatDuration(elapsedSeconds)}`;
}

function setFileStatus(text) {
  transcribeStatusText.textContent = text;
}

function appendDepsLog(line, stream = 'stdout') {
  const prefix = stream === 'stderr' ? '[err]' : '[out]';
  const next = `${depsLogEl.textContent}${depsLogEl.textContent ? '\n' : ''}${prefix} ${line}`;
  depsLogEl.textContent = next.slice(-28000);
  depsLogEl.scrollTop = depsLogEl.scrollHeight;
}

function appendTranscribeLog(line) {
  if (!transcribeLogEl) return;

  const next = `${transcribeLogEl.textContent}${transcribeLogEl.textContent ? '\n' : ''}${line}`;
  transcribeLogEl.textContent = next.slice(-30000);
  transcribeLogEl.scrollTop = transcribeLogEl.scrollHeight;
}

function areLivePrerequisitesReady() {
  return appState.whisperInstalled && appState.ffprobeInstalled && appState.modelInstalled;
}

function refreshLiveStatusBadge() {
  if (!liveStatusBadge) return;

  if (areLivePrerequisitesReady()) {
    liveStatusBadge.textContent = 'Accuracy profile: turbo live + large-v3 final pass';
    return;
  }

  const missing = [];
  if (!appState.whisperInstalled) missing.push('openai-whisper');
  if (!appState.ffprobeInstalled) missing.push('ffmpeg');
  if (!appState.modelInstalled) missing.push('turbo model');

  liveStatusBadge.textContent = `Setup required before live recording: ${missing.join(', ')}`;
}

function renderSetupStatus() {
  appVersionEl.textContent = appState.appVersion || '—';
  updateSourceEl.textContent = appState.updateSource || '—';

  whisperStatusEl.textContent = appState.whisperInstalled
    ? '✅ Installed'
    : '❌ Missing (openai-whisper)';

  ffprobeStatusEl.textContent = appState.ffprobeInstalled
    ? '✅ Installed'
    : '❌ Missing (ffmpeg)';

  modelStatusEl.textContent = appState.modelInstalled
    ? `✅ Installed (${formatBytes(appState.modelSizeBytes)})`
    : 'Not downloaded yet';

  downloadModelBtn.textContent = appState.modelInstalled
    ? 'Re-download large-v3-turbo model'
    : 'Download large-v3-turbo model';

  refreshLiveStatusBadge();
}

function renderOnboarding() {
  const depsReady = appState.whisperInstalled && appState.ffprobeInstalled;
  const modelReady = appState.modelInstalled;
  const allReady = depsReady && modelReady;

  onboardingDepsStep.classList.toggle('done', depsReady);
  onboardingModelStep.classList.toggle('done', modelReady);
  onboardingReadyStep.classList.toggle('done', allReady);

  const done = localStorage.getItem(storageKeys.onboardingDone) === '1';
  if (done) {
    onboardingPanel.classList.add('hidden');
  } else {
    onboardingPanel.classList.remove('hidden');
  }

  onboardingDoneBtn.disabled = !allReady;
}

function completeOnboarding() {
  const ready = appState.whisperInstalled && appState.ffprobeInstalled && appState.modelInstalled;
  if (!ready) return;

  localStorage.setItem(storageKeys.onboardingDone, '1');
  renderOnboarding();
}

function updateControls() {
  const busyRecording = appState.fileTranscribing || liveState.active || liveState.stopping;
  const hasUpdate = Boolean(appState.updateInfo?.updateAvailable);
  const canStartFile =
    appState.whisperInstalled &&
    appState.ffprobeInstalled &&
    appState.modelInstalled &&
    Boolean(appState.selectedFile) &&
    !busyRecording &&
    appState.inputMode === 'file';

  modeFileBtn.disabled = busyRecording;
  modeLiveBtn.disabled = busyRecording;

  pickFileBtn.disabled = busyRecording || appState.inputMode !== 'file';
  startBtn.disabled = !canStartFile;
  cancelBtn.disabled = !appState.fileTranscribing;
  showOutputBtn.disabled = !appState.outputPath;

  const liveCaptureSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof MediaRecorder !== 'undefined';

  startLiveBtn.disabled =
    appState.inputMode !== 'live' ||
    liveState.active ||
    liveState.stopping ||
    appState.fileTranscribing ||
    appState.dependenciesInstalling ||
    !areLivePrerequisitesReady() ||
    !liveCaptureSupported;

  stopLiveBtn.disabled = !liveState.active || liveState.stopping;

  const settingsBusy = busyRecording || appState.dependenciesInstalling;
  downloadModelBtn.disabled = settingsBusy;

  checkUpdateBtn.disabled = appState.updateDownloading || settingsBusy;
  downloadUpdateBtn.disabled = !hasUpdate || appState.updateDownloading || settingsBusy;

  installDepsBtn.disabled = appState.dependenciesInstalling || busyRecording;
  cancelDepsBtn.disabled = !appState.dependenciesInstalling;
  installBrewBtn.disabled = appState.dependenciesInstalling || busyRecording;

  refreshRuntimeMetricsPolling();
}

async function refreshSystemStatus() {
  try {
    const status = await window.api.getSystemStatus();

    appState.appVersion = status.appVersion || appState.appVersion;
    appState.updateSource = status.updateSource || appState.updateSource;
    appState.whisperInstalled = Boolean(status.whisperInstalled);
    appState.ffprobeInstalled = Boolean(status.ffprobeInstalled);
    appState.brewInstalled = Boolean(status.brewInstalled);
    appState.modelInstalled = Boolean(status.model?.installed);
    appState.modelSizeBytes = Number(status.model?.sizeBytes || 0);

    renderSetupStatus();
    renderOnboarding();

    if (!areLivePrerequisitesReady() && !liveState.active) {
      setLiveStatus('Complete setup (dependencies + model) before using live recording.');
    }

    updateControls();
  } catch (error) {
    setFileStatus(`Status check failed: ${error.message}`);
  }
}

function setSelectedFile(filePath) {
  appState.selectedFile = filePath;
  selectedFileEl.textContent = filePath || 'No file selected';
  selectedFileEl.title = filePath || '';
  updateControls();
}

function setFileTranscribing(flag) {
  appState.fileTranscribing = flag;
  updateControls();
}

async function onPickFile() {
  const filePath = await window.api.pickAudioFile();
  if (!filePath) return;

  appState.outputPath = null;
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

async function onCheckUpdates() {
  updateWrap.classList.remove('hidden');
  setProgressValue(updateBar, 0);
  updateMeta.textContent = 'Checking latest release…';

  try {
    const info = await window.api.checkForUpdates();
    appState.updateInfo = info;
    updateControls();
  } catch (error) {
    updateMeta.textContent = `Update check failed: ${error.message}`;
  }
}

async function onDownloadAndOpenUpdate() {
  if (!appState.updateInfo?.updateAvailable) return;

  updateWrap.classList.remove('hidden');
  setProgressValue(updateBar, 0);
  updateMeta.textContent = 'Downloading update installer…';

  appState.updateDownloading = true;
  updateControls();

  try {
    await window.api.downloadAndOpenUpdate(appState.updateInfo);
  } catch (error) {
    appState.updateDownloading = false;
    updateControls();
    updateMeta.textContent = `Update failed: ${error.message}`;
  }
}

async function onInstallDependencies() {
  depsLogEl.textContent = '';
  depsStatusText.textContent = 'Starting dependency install…';

  appState.dependenciesInstalling = true;
  updateControls();

  try {
    await window.api.installDependencies();
  } catch (error) {
    appState.dependenciesInstalling = false;
    updateControls();
    depsStatusText.textContent = `Could not start: ${error.message}`;
  }
}

async function onCancelDependencies() {
  await window.api.cancelDependenciesInstall();
}

async function onInstallHomebrewGuided() {
  try {
    const result = await window.api.installHomebrewGuided();
    if (result?.brewPresent) {
      depsStatusText.textContent = 'Homebrew already installed.';
    } else if (result?.opened) {
      depsStatusText.textContent =
        'Terminal opened. Complete Homebrew install there, then run dependency install again.';
    }
  } catch (error) {
    depsStatusText.textContent = `Failed to open Homebrew installer: ${error.message}`;
  }
}

async function onStartFileTranscription() {
  if (!appState.selectedFile) return;

  resetTranscriptBoard();
  if (transcribeLogEl) {
    transcribeLogEl.textContent = 'Starting file transcription…';
  }
  appState.outputPath = null;

  transcribeProgressWrap.classList.remove('hidden');
  setProgressIndeterminate(transcribeBar, true);
  transcribeMeta.textContent = 'Launching Whisper…';
  setFileStatus('Preparing transcription pipeline…');

  setFileTranscribing(true);

  try {
    const started = await window.api.startTranscription(appState.selectedFile);
    if (started?.durationSeconds) {
      transcribeMeta.textContent = `0.0% • ETA calculating… • 00:00/${formatDuration(started.durationSeconds)}`;
    }
  } catch (error) {
    setFileTranscribing(false);
    setFileStatus(`Could not start: ${error.message}`);
  }
}

async function onCancelFileTranscription() {
  await window.api.cancelTranscription();
}

function getSelectedLiveSource() {
  return liveSourceScreen.checked ? 'screen' : 'microphone';
}

function getRecorderMimeCandidates() {
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'audio/mp4',
    '',
  ];
}

function createMediaRecorderWithFallback(stream) {
  let lastError = null;

  for (const mimeType of getRecorderMimeCandidates()) {
    try {
      if (mimeType && !MediaRecorder.isTypeSupported(mimeType)) continue;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      return {
        recorder,
        mimeType: mimeType || recorder.mimeType || 'default',
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Could not initialize MediaRecorder.');
}

async function blobToBase64(blob) {
  const arr = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arr);
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

async function requestMicrophoneStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}

async function requestLiveStream(sourceMode) {
  if (sourceMode === 'microphone') {
    const mic = await requestMicrophoneStream();
    return {
      recordingStream: mic,
      captureStreams: [mic],
      note: 'Microphone capture active.',
      fallbackUsed: false,
    };
  }

  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    const displayAudioTracks = display.getAudioTracks();
    if (displayAudioTracks.length) {
      const audioOnly = new MediaStream(displayAudioTracks);
      return {
        recordingStream: audioOnly,
        captureStreams: [display],
        note: 'Screen-audio capture active.',
        fallbackUsed: false,
      };
    }

    const mic = await requestMicrophoneStream();
    const merged = new MediaStream(mic.getAudioTracks());

    return {
      recordingStream: merged,
      captureStreams: [display, mic],
      note: 'Screen shared without audio. Using microphone-audio fallback.',
      fallbackUsed: true,
    };
  } catch (error) {
    const reason = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();

    if (reason.includes('notsupported') || reason.includes('not supported')) {
      const mic = await requestMicrophoneStream();
      return {
        recordingStream: mic,
        captureStreams: [mic],
        note: 'Screen-audio capture not supported here. Using microphone-audio fallback.',
        fallbackUsed: true,
      };
    }

    throw error;
  }
}

function stopLiveTracks() {
  const streams = Array.isArray(liveState.captureStreams) && liveState.captureStreams.length
    ? liveState.captureStreams
    : liveState.stream
      ? [liveState.stream]
      : [];

  streams.forEach((stream) => {
    stream.getTracks().forEach((track) => track.stop());
  });

  liveState.captureStreams = [];
  liveState.stream = null;
}

function resetLiveState() {
  if (liveState.elapsedTimer) {
    clearInterval(liveState.elapsedTimer);
    liveState.elapsedTimer = null;
  }

  liveState.active = false;
  liveState.stopping = false;
  liveState.sessionId = null;
  liveState.stream = null;
  liveState.captureStreams = [];
  liveState.recorder = null;
  liveState.chunks = [];
  liveState.pendingChunkUploads = new Set();
  liveState.startedAtMs = 0;
  liveState.lastChunkAtMs = 0;
  liveState.sourceMode = getSelectedLiveSource();
  liveState.task = liveTaskSelect.value;

  updateLiveElapsed();
  updateControls();
}

function setLiveStatus(text) {
  liveStatusText.textContent = text;
  setFileStatus(text);
}

async function onStartLiveRecording() {
  if (liveState.active || liveState.stopping || appState.fileTranscribing) return;

  if (!areLivePrerequisitesReady()) {
    setLiveStatus('Complete setup (dependencies + model) before starting live recording.');
    return;
  }

  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
    setLiveStatus('Live recording is not available in this runtime.');
    return;
  }

  appState.outputPath = null;
  resetTranscriptBoard();
  if (transcribeLogEl) {
    transcribeLogEl.textContent = 'Starting live recording session…';
  }

  const sourceMode = getSelectedLiveSource();
  const task = liveTaskSelect.value === 'translate' ? 'translate' : 'transcribe';

  liveState.sourceMode = sourceMode;
  liveState.task = task;

  transcribeProgressWrap.classList.remove('hidden');
  setProgressIndeterminate(transcribeBar, true);
  transcribeMeta.textContent = 'Live capture running (preview + final max-accuracy pass)';

  setLiveStatus('Starting realtime session…');

  let sessionStarted = false;

  try {
    const session = await window.api.startRealtimeSession({
      sourceMode,
      task,
      liveModel: 'turbo',
      finalModel: 'large-v3',
    });

    sessionStarted = true;
    liveState.sessionId = session.sessionId;

    const streamBundle = await requestLiveStream(sourceMode);
    const stream = streamBundle.recordingStream;

    if (!stream.getAudioTracks().length) {
      throw new Error('No audio track available for live recording.');
    }

    const recorderBundle = createMediaRecorderWithFallback(stream);
    const recorder = recorderBundle.recorder;

    liveState.stream = stream;
    liveState.captureStreams = streamBundle.captureStreams || [stream];
    liveState.recorder = recorder;
    liveState.chunks = [];
    liveState.pendingChunkUploads = new Set();
    liveState.startedAtMs = Date.now();

    liveState.captureStreams.forEach((captureStream) => {
      captureStream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (liveState.active && !liveState.stopping) {
            setLiveStatus('Capture source ended. Finalizing…');
            void onStopLiveRecording();
          }
        });
      });
    });
    liveState.lastChunkAtMs = liveState.startedAtMs;
    liveState.active = true;
    liveState.stopping = false;

    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data || !event.data.size || !liveState.sessionId) return;

      const uploadPromise = (async () => {
        try {
          liveState.chunks.push(event.data);

          const now = Date.now();
          const durationMs = Math.max(now - liveState.lastChunkAtMs, 1000);
          liveState.lastChunkAtMs = now;

          const chunkBase64 = await blobToBase64(event.data);
          const extension = event.data.type.includes('mp4') ? '.mp4' : '.webm';

          await window.api.pushRealtimeChunk({
            sessionId: liveState.sessionId,
            chunkBase64,
            extension,
            durationMs,
          });
        } catch (error) {
          appendTranscribeLog(`Chunk push failed: ${error.message}`);
        }
      })();

      liveState.pendingChunkUploads.add(uploadPromise);
      uploadPromise.finally(() => {
        liveState.pendingChunkUploads.delete(uploadPromise);
      });
    });

    recorder.addEventListener('error', (event) => {
      appendTranscribeLog(`Recorder error: ${event.error?.message || 'Unknown recorder error'}`);
      setLiveStatus('Recorder encountered an error.');
    });

    liveState.elapsedTimer = setInterval(updateLiveElapsed, 500);
    updateLiveElapsed();

    recorder.start(4000);
    const liveStartMessage = streamBundle.fallbackUsed
      ? `Live recording started with fallback. ${streamBundle.note}`
      : 'Live recording started. Whisper is transcribing chunks in realtime…';
    setLiveStatus(liveStartMessage);
    appendTranscribeLog(
      `Live source: ${sourceMode} | Task: ${task} | Recorder: ${recorderBundle.mimeType} | Model: turbo (final pass: large-v3)` +
        (streamBundle.note ? ` | Note: ${streamBundle.note}` : ''),
    );
    updateControls();
    setInputMode('live');
  } catch (error) {
    stopLiveTracks();

    if (sessionStarted && liveState.sessionId) {
      try {
        await window.api.cancelRealtimeSession({ sessionId: liveState.sessionId });
      } catch {
        // ignore
      }
    }

    resetLiveState();
    const label = [error?.name, error?.message].filter(Boolean).join(': ') || 'Unknown error';
    setLiveStatus(`Failed to start live recording: ${label}`);
    appendTranscribeLog(`Live start error: ${label}`);
  }
}

async function onStopLiveRecording() {
  if (!liveState.active || !liveState.recorder || !liveState.sessionId) return;

  liveState.stopping = true;
  updateControls();
  setLiveStatus('Stopping capture and running final high-accuracy pass…');
  transcribeMeta.textContent = 'Finalizing live recording…';
  setProgressIndeterminate(transcribeBar, true);

  const recorder = liveState.recorder;

  try {
    if (recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        recorder.addEventListener('stop', resolve, { once: true });
        recorder.stop();
      });
    }

    if (liveState.elapsedTimer) {
      clearInterval(liveState.elapsedTimer);
      liveState.elapsedTimer = null;
    }

    if (liveState.pendingChunkUploads.size > 0) {
      setLiveStatus('Finishing last captured chunks…');
      await Promise.allSettled(Array.from(liveState.pendingChunkUploads));
    }

    stopLiveTracks();

    const blobType = liveState.chunks[0]?.type || (liveState.sourceMode === 'screen' ? 'video/webm' : 'audio/webm');
    const finalBlob = new Blob(liveState.chunks, { type: blobType });

    if (!finalBlob.size) {
      throw new Error('No audio captured. Check microphone/screen-audio permissions and try again.');
    }

    const recordingBase64 = await blobToBase64(finalBlob);
    const extension = blobType.includes('mp4') ? '.mp4' : '.webm';

    appendTranscribeLog('Running final large-v3 pass over complete recording…');

    const result = await window.api.stopRealtimeSession({
      sessionId: liveState.sessionId,
      recordingBase64,
      extension,
    });

    if (result?.segments?.length || result?.transcript) {
      replaceTranscriptWithFinal(result.segments, result.transcript);
    }

    if (result?.outputPath) {
      appState.outputPath = result.outputPath;
    }

    setProgressValue(transcribeBar, 100);
    transcribeMeta.textContent = `Finalized • ${formatDuration(result?.elapsedSeconds || 0)}`;
    setLiveStatus(`Live transcription complete (${formatDuration(result?.elapsedSeconds || 0)}).`);
  } catch (error) {
    setLiveStatus(`Failed to finalize live recording: ${error.message}`);
    appendTranscribeLog(`Finalize error: ${error.message}`);

    try {
      await window.api.cancelRealtimeSession({ sessionId: liveState.sessionId });
    } catch {
      // ignore
    }
  } finally {
    resetLiveState();
  }
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

window.api.onUpdaterState((evt) => {
  updateWrap.classList.remove('hidden');

  if (evt.state === 'checking') {
    updateMeta.textContent = 'Checking latest release…';
  }

  if (evt.state === 'checked') {
    appState.updateInfo = evt;
    appState.updateDownloading = false;

    if (evt.updateAvailable) {
      setProgressValue(updateBar, 0);
      updateMeta.textContent = `Update found: ${evt.currentVersion} → ${evt.latestVersion}`;
    } else {
      setProgressValue(updateBar, 100);
      updateMeta.textContent = `Up to date (v${evt.currentVersion})`;
    }
  }

  if (evt.state === 'downloading') {
    appState.updateDownloading = true;
    updateMeta.textContent = `Downloading ${evt.assetName || 'installer'}…`;
  }

  if (evt.state === 'downloaded') {
    appState.updateDownloading = false;
    setProgressValue(updateBar, 100);
    updateMeta.textContent = `Downloaded ${evt.assetName}`;
  }

  if (evt.state === 'installer-opened') {
    appState.updateDownloading = false;
    updateMeta.textContent = 'Installer opened. Replace app in Applications to finish update.';
  }

  if (evt.state === 'error') {
    appState.updateDownloading = false;
    updateMeta.textContent = `Updater error: ${evt.message}`;
  }

  updateControls();
});

window.api.onUpdaterDownloadProgress((evt) => {
  updateWrap.classList.remove('hidden');

  const percent = Number(evt.percent || 0);
  setProgressValue(updateBar, percent);

  const downloaded = formatBytes(evt.downloadedBytes || 0);
  const total = evt.totalBytes ? formatBytes(evt.totalBytes) : 'unknown';
  const speed = evt.speedBytesPerSec ? `${formatBytes(evt.speedBytesPerSec)}/s` : '—';
  const eta = Number.isFinite(evt.etaSeconds) ? formatDuration(evt.etaSeconds) : '—';

  updateMeta.textContent = `${percent.toFixed(1)}% • ${downloaded}/${total} • ${speed} • ETA ${eta}`;
});

window.api.onDependenciesState(async (evt) => {
  if (evt.state === 'running') {
    appState.dependenciesInstalling = true;
    depsStatusText.textContent = evt.message || 'Installing dependencies…';
  }

  if (evt.state === 'done') {
    appState.dependenciesInstalling = false;
    const elapsed = Number.isFinite(evt.elapsedSeconds)
      ? `Completed in ${formatDuration(evt.elapsedSeconds)}`
      : 'Completed';
    depsStatusText.textContent = elapsed;
    await refreshSystemStatus();
  }

  if (evt.state === 'error') {
    appState.dependenciesInstalling = false;
    depsStatusText.textContent = `Error: ${evt.message}`;
  }

  if (evt.state === 'cancelled') {
    appState.dependenciesInstalling = false;
    depsStatusText.textContent = 'Cancelled';
  }

  if (evt.state === 'no-brew') {
    appState.dependenciesInstalling = false;
    depsStatusText.textContent = evt.message || 'Homebrew missing';
  }

  if (evt.state === 'homebrew-installer-opened') {
    depsStatusText.textContent = evt.message || 'Homebrew installer opened';
  }

  if (evt.state === 'brew-present') {
    depsStatusText.textContent = evt.message || 'Homebrew already installed';
  }

  renderOnboarding();
  updateControls();
});

window.api.onDependenciesLog((evt) => {
  appendDepsLog(evt.line, evt.stream);
});

window.api.onTranscribeLog((evt) => {
  appendTranscribeLog(evt.line);
});

window.api.onTranscribeStatus((evt) => {
  setFileStatus(evt.message || 'Working…');
});

window.api.onTranscribeSegment((segment) => {
  addTranscriptEntry({
    text: segment.text,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    provisional: false,
  });
});

window.api.onTranscribeProgress((evt) => {
  const pct = Math.max(0, Math.min((evt.progress || 0) * 100, 100));
  const eta = Number.isFinite(evt.etaSeconds) ? formatDuration(evt.etaSeconds) : 'calculating…';
  const processed = formatDuration(evt.processedSeconds || 0);
  const total = formatDuration(evt.durationSeconds || 0);

  setProgressValue(transcribeBar, pct);
  transcribeMeta.textContent = evt.estimated
    ? `${pct.toFixed(1)}% • ETA ${eta} • ${processed}/${total} (estimated)`
    : `${pct.toFixed(1)}% • ETA ${eta} • ${processed}/${total}`;
});

window.api.onTranscribeDone((evt) => {
  setFileTranscribing(false);
  setProgressValue(transcribeBar, 100);

  if (evt.transcript) {
    replaceTranscriptWithFinal([], evt.transcript);
  }

  if (evt.outputPath) {
    appState.outputPath = evt.outputPath;
    setFileStatus(`Done in ${formatDuration(evt.elapsedSeconds || 0)} • TXT saved on Desktop`);
  } else {
    setFileStatus(`Done in ${formatDuration(evt.elapsedSeconds || 0)}`);
  }

  updateControls();
  renderOnboarding();
});

window.api.onTranscribeError((evt) => {
  setFileTranscribing(false);
  setFileStatus(`Error: ${evt.message}`);
  updateControls();
});

window.api.onRealtimeState((evt) => {
  if (!evt || !evt.state) return;

  if (evt.state === 'started') {
    setLiveStatus('Realtime session started. Capturing audio…');
    appendTranscribeLog(`Realtime session ${evt.sessionId} started.`);
  }

  if (evt.state === 'chunk-received') {
    setLiveStatus(`Realtime chunk ${evt.chunkIndex} captured.`);
  }

  if (evt.state === 'processing-chunk') {
    setLiveStatus(`Processing chunk ${evt.chunkIndex}…`);
  }

  if (evt.state === 'queue-idle' && liveState.active) {
    setLiveStatus('Realtime queue caught up. Listening for more audio…');
  }

  if (evt.state === 'finalizing-started') {
    setLiveStatus('Finalizing: waiting for remaining realtime chunks…');
  }

  if (evt.state === 'finalizing-transcription') {
    setLiveStatus('Finalizing: running full high-accuracy transcription…');
  }

  if (evt.state === 'cancelled') {
    setLiveStatus('Realtime session cancelled.');
  }
});

window.api.onRealtimeSegment((evt) => {
  addTranscriptEntry({
    text: evt.text,
    startSeconds: evt.startSeconds,
    endSeconds: evt.endSeconds,
    provisional: true,
  });

  const elapsed = (Date.now() - liveState.startedAtMs) / 1000;
  transcribeMeta.textContent = `Live capture • ${formatDuration(elapsed)} elapsed`;
  setProgressIndeterminate(transcribeBar, true);
});

window.api.onRealtimeFinal((evt) => {
  replaceTranscriptWithFinal(evt.segments, evt.transcript);
  if (evt.outputPath) {
    appState.outputPath = evt.outputPath;
    setFileStatus(`Live transcription finalized • TXT saved on Desktop`);
  }
  setProgressValue(transcribeBar, 100);
  transcribeMeta.textContent = `Finalized • ${formatDuration(evt.elapsedSeconds || 0)}`;
  renderOnboarding();
  updateControls();
});

window.api.onRealtimeError((evt) => {
  appendTranscribeLog(`Realtime error: ${evt.message}`);
  setLiveStatus(`Realtime error: ${evt.message}`);
});

quitAppBtn.addEventListener('click', async () => {
  quitAppBtn.disabled = true;
  try {
    await window.api.quitApp();
  } catch {
    quitAppBtn.disabled = false;
  }
});

settingsBtn.addEventListener('click', openSettingsDrawer);
settingsCloseBtn.addEventListener('click', closeSettingsDrawer);
drawerBackdrop.addEventListener('click', closeSettingsDrawer);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && appState.settingsOpen) {
    closeSettingsDrawer();
    return;
  }

  const isPasteShortcut = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'v';
  if (!isPasteShortcut) return;

  const activeTag = document.activeElement?.tagName?.toLowerCase();
  const isTypingContext =
    activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable;
  if (isTypingContext) return;

  const now = Date.now();
  if (now - clipboardPasteDebounceMs < 280) return;
  clipboardPasteDebounceMs = now;

  event.preventDefault();
  void tryPickFileFromClipboard();
});

window.addEventListener('paste', (event) => {
  if (appState.inputMode !== 'file') return;

  const activeTag = document.activeElement?.tagName?.toLowerCase();
  const isTypingContext =
    activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable;
  if (isTypingContext) return;

  event.preventDefault();
  void tryPickFileFromClipboard();
});

themeSwitch.addEventListener('change', () => {
  setThemeMode(themeSwitch.checked ? 'dark' : 'light');
});

themeAutoBtn.addEventListener('click', () => {
  setThemeMode('system');
});

mediaTheme.addEventListener('change', () => {
  if (themeMode === 'system') applyTheme();
});

onboardingOpenSettingsBtn.addEventListener('click', openSettingsDrawer);
onboardingDoneBtn.addEventListener('click', completeOnboarding);

modeFileBtn.addEventListener('click', () => setInputMode('file'));
modeLiveBtn.addEventListener('click', () => setInputMode('live'));

showOutputBtn.addEventListener('click', async () => {
  if (!appState.outputPath) return;
  await window.api.showInFinder(appState.outputPath);
});

pickFileBtn.addEventListener('click', onPickFile);
downloadModelBtn.addEventListener('click', onDownloadModel);
checkUpdateBtn.addEventListener('click', onCheckUpdates);
downloadUpdateBtn.addEventListener('click', onDownloadAndOpenUpdate);
installDepsBtn.addEventListener('click', onInstallDependencies);
cancelDepsBtn.addEventListener('click', onCancelDependencies);
installBrewBtn.addEventListener('click', onInstallHomebrewGuided);
startBtn.addEventListener('click', onStartFileTranscription);
cancelBtn.addEventListener('click', onCancelFileTranscription);
startLiveBtn.addEventListener('click', onStartLiveRecording);
stopLiveBtn.addEventListener('click', onStopLiveRecording);

liveTaskSelect.addEventListener('change', () => {
  liveState.task = liveTaskSelect.value;
});

liveSourceMic.addEventListener('change', () => {
  if (liveSourceMic.checked) liveState.sourceMode = 'microphone';
});

liveSourceScreen.addEventListener('change', () => {
  if (liveSourceScreen.checked) liveState.sourceMode = 'screen';
});

applyTheme();
setInputMode('file');
resetTranscriptBoard();
refreshSystemStatus();
updateControls();
