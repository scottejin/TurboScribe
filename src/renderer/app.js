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

const uploadDropZone = document.getElementById('uploadDropZone');
const pickFileBtn = document.getElementById('pickFileBtn');
const selectedFileEl = document.getElementById('selectedFile');

const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');
const showOutputBtn = document.getElementById('showOutputBtn');
const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
const clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
const scrollToLatestBtn = document.getElementById('scrollToLatestBtn');

const transcribeProgressWrap = document.getElementById('transcribeProgressWrap');
const transcribeBar = document.getElementById('transcribeBar');
const transcribeMeta = document.getElementById('transcribeMeta');
const transcribeStatusText = document.getElementById('transcribeStatusText');

const cpuMetricLabel = document.getElementById('cpuMetricLabel');
const cpuMetricBar = document.getElementById('cpuMetricBar');
const powerMetricLabel = document.getElementById('powerMetricLabel');
const powerMetricBar = document.getElementById('powerMetricBar');

const transcriptBlocks = document.getElementById('transcriptBlocks');
const transcriptArea = document.getElementById('transcriptArea');

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

const storageKeys = {
  themeMode: 'turboscribe.themeMode',
  onboardingDone: 'turboscribe.onboardingDone',
};

const mediaTheme = window.matchMedia('(prefers-color-scheme: dark)');

const state = {
  appVersion: '—',
  updateSource: '—',
  whisperInstalled: false,
  ffprobeInstalled: false,
  modelInstalled: false,
  modelSizeBytes: 0,
  selectedFile: null,
  outputPath: null,
  fileTranscribing: false,
  dependenciesInstalling: false,
  updateDownloading: false,
  updateInfo: null,
  settingsOpen: false,
  fullTranscriptText: '',
  transcriptEntries: [],
};

const MAX_VISIBLE_TRANSCRIPT_ENTRIES = 180;

let themeMode = localStorage.getItem(storageKeys.themeMode) || 'system';
let transcriptRenderPending = false;
let runtimeMetricsTimer = null;
let clipboardPasteDebounceMs = 0;

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

function setStatus(text) {
  transcribeStatusText.textContent = text;
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

  if (!state.transcriptEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'transcript-empty';
    empty.textContent = 'Upload a file and start transcription to populate this view.';
    transcriptBlocks.appendChild(empty);
    transcriptArea.value = state.fullTranscriptText || '';
    return;
  }

  const hiddenCount = Math.max(state.transcriptEntries.length - MAX_VISIBLE_TRANSCRIPT_ENTRIES, 0);
  const visibleEntries = hiddenCount
    ? state.transcriptEntries.slice(-MAX_VISIBLE_TRANSCRIPT_ENTRIES)
    : state.transcriptEntries;

  if (hiddenCount > 0) {
    const notice = document.createElement('div');
    notice.className = 'transcript-empty';
    notice.textContent = `${hiddenCount} earlier lines hidden for readability. Full transcript is in the exported TXT file.`;
    transcriptBlocks.appendChild(notice);
  }

  for (const entry of visibleEntries) {
    const card = document.createElement('article');
    card.className = 'transcript-item';

    const header = document.createElement('div');
    header.className = 'transcript-item-header';

    const timeChip = document.createElement('span');
    timeChip.className = 'transcript-time';
    timeChip.textContent = Number.isFinite(entry.startSeconds)
      ? formatRange(entry.startSeconds, entry.endSeconds)
      : 'Untimed';

    const kind = document.createElement('span');
    kind.className = 'transcript-kind';
    kind.textContent = entry.kind || 'Transcript';

    const text = document.createElement('p');
    text.className = 'transcript-text';
    text.textContent = entry.text;

    header.appendChild(timeChip);
    header.appendChild(kind);
    card.appendChild(header);
    card.appendChild(text);

    transcriptBlocks.appendChild(card);
  }

  transcriptBlocks.scrollTop = transcriptBlocks.scrollHeight;
  transcriptArea.value = state.fullTranscriptText || state.transcriptEntries.map((entry) => entry.text).join('\n');
}

function resetTranscriptBoard() {
  state.transcriptEntries = [];
  state.fullTranscriptText = '';
  requestTranscriptRender();
}

function addTranscriptEntry(entry) {
  const normalized = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: String(entry.text || '').trim(),
    startSeconds: Number(entry.startSeconds),
    endSeconds: Number(entry.endSeconds),
    kind: entry.kind || 'Segment',
  };

  if (!normalized.text) return;

  state.transcriptEntries.push(normalized);

  if (state.fileTranscribing) {
    state.fullTranscriptText = state.fullTranscriptText
      ? `${state.fullTranscriptText}\n${normalized.text}`
      : normalized.text;
  }

  requestTranscriptRender();
}

function replaceTranscriptWithFinal(fullText) {
  state.fullTranscriptText = String(fullText || '').trim();

  const lines = state.fullTranscriptText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  state.transcriptEntries = lines.map((line) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: line,
    startSeconds: Number.NaN,
    endSeconds: Number.NaN,
    kind: 'Final',
  }));

  requestTranscriptRender();
}

function copyTranscriptToClipboard() {
  const text = (state.fullTranscriptText || '').trim();
  if (!text) return;

  navigator.clipboard
    .writeText(text)
    .then(() => setStatus('Transcript copied to clipboard.'))
    .catch(() => {
      transcriptArea.value = text;
      transcriptArea.classList.remove('hidden');
      transcriptArea.select();
      document.execCommand('copy');
      transcriptArea.classList.add('hidden');
      setStatus('Transcript copied to clipboard.');
    });
}

function openSettingsDrawer() {
  state.settingsOpen = true;
  settingsDrawer.classList.add('open');
  settingsDrawer.setAttribute('aria-hidden', 'false');
  drawerBackdrop.classList.remove('hidden');
}

function closeSettingsDrawer() {
  state.settingsOpen = false;
  settingsDrawer.classList.remove('open');
  settingsDrawer.setAttribute('aria-hidden', 'true');
  drawerBackdrop.classList.add('hidden');
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

function prerequisitesReady() {
  return state.whisperInstalled && state.ffprobeInstalled && state.modelInstalled;
}

function renderOnboarding() {
  const depsReady = state.whisperInstalled && state.ffprobeInstalled;
  const modelReady = state.modelInstalled;
  const allReady = depsReady && modelReady;

  onboardingDepsStep.classList.toggle('done', depsReady);
  onboardingModelStep.classList.toggle('done', modelReady);
  onboardingReadyStep.classList.toggle('done', allReady);

  const done = localStorage.getItem(storageKeys.onboardingDone) === '1';
  onboardingPanel.classList.toggle('hidden', done);
  onboardingDoneBtn.disabled = !allReady;
}

function completeOnboarding() {
  if (!prerequisitesReady()) return;
  localStorage.setItem(storageKeys.onboardingDone, '1');
  renderOnboarding();
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
  if (!runtimeMetricsTimer) return;
  clearInterval(runtimeMetricsTimer);
  runtimeMetricsTimer = null;
}

async function pollRuntimeMetricsOnce() {
  try {
    const sample = await window.api.sampleRuntimeMetrics();
    updateRuntimeMetricsDisplay(sample);
  } catch {
    // ignore metrics transient failures
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
  if (state.fileTranscribing) {
    startRuntimeMetricsPolling();
  } else {
    stopRuntimeMetricsPolling();
    updateRuntimeMetricsDisplay({ cpuPercent: 0, watts: 0, cpuBarPercent: 0, wattsBarPercent: 0 });
  }
}

function updateControls() {
  const canStart = prerequisitesReady() && Boolean(state.selectedFile) && !state.fileTranscribing;

  pickFileBtn.disabled = state.fileTranscribing;
  startBtn.disabled = !canStart;
  cancelBtn.disabled = !state.fileTranscribing;
  showOutputBtn.disabled = !state.outputPath;

  copyTranscriptBtn.disabled = !(state.fullTranscriptText || '').trim();

  const settingsBusy = state.fileTranscribing || state.dependenciesInstalling;
  downloadModelBtn.disabled = settingsBusy;

  checkUpdateBtn.disabled = state.updateDownloading || settingsBusy;
  downloadUpdateBtn.disabled =
    !Boolean(state.updateInfo?.updateAvailable) || state.updateDownloading || settingsBusy;

  installDepsBtn.disabled = state.dependenciesInstalling || state.fileTranscribing;
  cancelDepsBtn.disabled = !state.dependenciesInstalling;
  installBrewBtn.disabled = state.dependenciesInstalling || state.fileTranscribing;

  refreshRuntimeMetricsPolling();
}

function renderSetupStatus() {
  appVersionEl.textContent = state.appVersion || '—';
  updateSourceEl.textContent = state.updateSource || '—';

  whisperStatusEl.textContent = state.whisperInstalled
    ? '✅ Installed'
    : '❌ Missing (openai-whisper)';
  ffprobeStatusEl.textContent = state.ffprobeInstalled ? '✅ Installed' : '❌ Missing (ffmpeg)';
  modelStatusEl.textContent = state.modelInstalled
    ? `✅ Installed (${formatBytes(state.modelSizeBytes)})`
    : 'Not downloaded yet';

  downloadModelBtn.textContent = state.modelInstalled
    ? 'Re-download large-v3-turbo model'
    : 'Download large-v3-turbo model';

  uploadDropZone.classList.toggle('disabled', !prerequisitesReady());
}

async function refreshSystemStatus() {
  try {
    const status = await window.api.getSystemStatus();

    state.appVersion = status.appVersion || state.appVersion;
    state.updateSource = status.updateSource || state.updateSource;
    state.whisperInstalled = Boolean(status.whisperInstalled);
    state.ffprobeInstalled = Boolean(status.ffprobeInstalled);
    state.modelInstalled = Boolean(status.model?.installed);
    state.modelSizeBytes = Number(status.model?.sizeBytes || 0);

    renderSetupStatus();
    renderOnboarding();
    updateControls();

    if (!prerequisitesReady() && !state.fileTranscribing) {
      setStatus('Complete setup in Settings before transcription.');
    }
  } catch (error) {
    setStatus(`Status check failed: ${error.message}`);
  }
}

function setSelectedFile(filePath) {
  state.selectedFile = filePath;
  selectedFileEl.textContent = filePath || 'No file selected';
  selectedFileEl.title = filePath || '';
  updateControls();
}

function fileFromDropEvent(event) {
  const files = event.dataTransfer?.files;
  if (!files || !files.length) return null;

  for (const file of files) {
    if (file?.path) return file.path;
  }

  return null;
}

async function tryPickFileFromClipboard() {
  if (state.fileTranscribing) return false;

  try {
    const maybePath = await window.api.pickAudioFromClipboard();
    if (maybePath) {
      state.outputPath = null;
      setSelectedFile(maybePath);
      setStatus('Loaded file path from clipboard.');
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

async function onPickFile() {
  const filePath = await window.api.pickAudioFile();
  if (!filePath) return;

  state.outputPath = null;
  setSelectedFile(filePath);
}

async function onStartTranscription() {
  if (!state.selectedFile) return;
  if (!prerequisitesReady()) {
    setStatus('Complete setup in Settings before starting transcription.');
    return;
  }

  resetTranscriptBoard();
  state.outputPath = null;

  transcribeProgressWrap.classList.remove('hidden');
  setProgressIndeterminate(transcribeBar, true);
  transcribeMeta.textContent = 'Launching Whisper…';
  setStatus('Preparing transcription pipeline…');

  state.fileTranscribing = true;
  updateControls();

  try {
    const started = await window.api.startTranscription(state.selectedFile);
    if (started?.durationSeconds) {
      transcribeMeta.textContent = `0.0% • ETA calculating… • 00:00/${formatDuration(started.durationSeconds)}`;
    }
  } catch (error) {
    state.fileTranscribing = false;
    setStatus(`Could not start: ${error.message}`);
    updateControls();
  }
}

async function onCancelTranscription() {
  await window.api.cancelTranscription();
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
    state.updateInfo = await window.api.checkForUpdates();
    updateControls();
  } catch (error) {
    updateMeta.textContent = `Update check failed: ${error.message}`;
  }
}

async function onDownloadAndOpenUpdate() {
  if (!state.updateInfo?.updateAvailable) return;

  updateWrap.classList.remove('hidden');
  setProgressValue(updateBar, 0);
  updateMeta.textContent = 'Downloading update installer…';

  state.updateDownloading = true;
  updateControls();

  try {
    await window.api.downloadAndOpenUpdate(state.updateInfo);
  } catch (error) {
    state.updateDownloading = false;
    updateControls();
    updateMeta.textContent = `Update failed: ${error.message}`;
  }
}

async function onInstallDependencies() {
  depsLogEl.textContent = '';
  depsStatusText.textContent = 'Starting dependency install…';

  state.dependenciesInstalling = true;
  updateControls();

  try {
    await window.api.installDependencies();
  } catch (error) {
    state.dependenciesInstalling = false;
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
    state.updateInfo = evt;
    state.updateDownloading = false;

    if (evt.updateAvailable) {
      setProgressValue(updateBar, 0);
      updateMeta.textContent = `Update found: ${evt.currentVersion} → ${evt.latestVersion}`;
    } else {
      setProgressValue(updateBar, 100);
      updateMeta.textContent = `Up to date (v${evt.currentVersion})`;
    }
  }

  if (evt.state === 'downloading') {
    state.updateDownloading = true;
    updateMeta.textContent = `Downloading ${evt.assetName || 'installer'}…`;
  }

  if (evt.state === 'downloaded') {
    state.updateDownloading = false;
    setProgressValue(updateBar, 100);
    updateMeta.textContent = `Downloaded ${evt.assetName}`;
  }

  if (evt.state === 'installer-opened') {
    state.updateDownloading = false;
    updateMeta.textContent = 'Installer opened. Replace app in Applications to finish update.';
  }

  if (evt.state === 'error') {
    state.updateDownloading = false;
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
    state.dependenciesInstalling = true;
    depsStatusText.textContent = evt.message || 'Installing dependencies…';
  }

  if (evt.state === 'done') {
    state.dependenciesInstalling = false;
    const elapsed = Number.isFinite(evt.elapsedSeconds)
      ? `Completed in ${formatDuration(evt.elapsedSeconds)}`
      : 'Completed';
    depsStatusText.textContent = elapsed;
    await refreshSystemStatus();
  }

  if (evt.state === 'error') {
    state.dependenciesInstalling = false;
    depsStatusText.textContent = `Error: ${evt.message}`;
  }

  if (evt.state === 'cancelled') {
    state.dependenciesInstalling = false;
    depsStatusText.textContent = 'Cancelled';
  }

  if (evt.state === 'no-brew') {
    state.dependenciesInstalling = false;
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
  const prefix = evt.stream === 'stderr' ? '[err]' : '[out]';
  const next = `${depsLogEl.textContent}${depsLogEl.textContent ? '\n' : ''}${prefix} ${evt.line}`;
  depsLogEl.textContent = next.slice(-28000);
  depsLogEl.scrollTop = depsLogEl.scrollHeight;
});

window.api.onTranscribeStatus((evt) => {
  setStatus(evt.message || 'Working…');
});

window.api.onTranscribeSegment((segment) => {
  addTranscriptEntry({
    text: segment.text,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    kind: 'Segment',
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
  state.fileTranscribing = false;
  setProgressValue(transcribeBar, 100);

  if (evt.transcript) {
    replaceTranscriptWithFinal(evt.transcript);
  }

  if (evt.outputPath) {
    state.outputPath = evt.outputPath;
    setStatus(`Done in ${formatDuration(evt.elapsedSeconds || 0)} • TXT saved on Desktop`);
  } else {
    setStatus(`Done in ${formatDuration(evt.elapsedSeconds || 0)}`);
  }

  renderOnboarding();
  updateControls();
});

window.api.onTranscribeError((evt) => {
  state.fileTranscribing = false;
  setStatus(`Error: ${evt.message}`);
  updateControls();
});

window.api.onTranscribeLog(() => {
  // Intentionally ignored in UI (kept for debugging hooks).
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
  if (event.key === 'Escape' && state.settingsOpen) {
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

pickFileBtn.addEventListener('click', onPickFile);
startBtn.addEventListener('click', onStartTranscription);
cancelBtn.addEventListener('click', onCancelTranscription);

showOutputBtn.addEventListener('click', async () => {
  if (!state.outputPath) return;
  await window.api.showInFinder(state.outputPath);
});

copyTranscriptBtn.addEventListener('click', copyTranscriptToClipboard);

clearTranscriptBtn.addEventListener('click', () => {
  resetTranscriptBoard();
  setStatus('Transcript view cleared.');
  updateControls();
});

scrollToLatestBtn.addEventListener('click', () => {
  transcriptBlocks.scrollTop = transcriptBlocks.scrollHeight;
});

uploadDropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadDropZone.classList.add('dragover');
});

uploadDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadDropZone.classList.add('dragover');
});

uploadDropZone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadDropZone.classList.remove('dragover');
});

uploadDropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadDropZone.classList.remove('dragover');

  if (state.fileTranscribing) return;

  const pathFromDrop = fileFromDropEvent(event);
  if (!pathFromDrop) return;

  state.outputPath = null;
  setSelectedFile(pathFromDrop);
  setStatus('File loaded from drag-and-drop.');
});

downloadModelBtn.addEventListener('click', onDownloadModel);
checkUpdateBtn.addEventListener('click', onCheckUpdates);
downloadUpdateBtn.addEventListener('click', onDownloadAndOpenUpdate);
installDepsBtn.addEventListener('click', onInstallDependencies);
cancelDepsBtn.addEventListener('click', onCancelDependencies);
installBrewBtn.addEventListener('click', onInstallHomebrewGuided);

applyTheme();
resetTranscriptBoard();
refreshSystemStatus();
updateControls();
