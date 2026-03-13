const appVersionEl = document.getElementById('appVersion');
const updateSourceEl = document.getElementById('updateSource');

const whisperStatusEl = document.getElementById('whisperStatus');
const ffprobeStatusEl = document.getElementById('ffprobeStatus');
const modelStatusEl = document.getElementById('modelStatus');

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
const transcribeStatusText = document.getElementById('transcribeStatusText');
const transcribeLogEl = document.getElementById('transcribeLog');
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
  transcribing: false,
  outputPath: null,
  updateInfo: null,
  updateDownloading: false,
  dependenciesInstalling: false,
  settingsOpen: false,
};

let themeMode = localStorage.getItem(storageKeys.themeMode) || 'system';

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

function updateControls() {
  const canStart =
    appState.whisperInstalled &&
    appState.ffprobeInstalled &&
    appState.modelInstalled &&
    Boolean(appState.selectedFile) &&
    !appState.transcribing;

  const hasUpdate = Boolean(appState.updateInfo?.updateAvailable);

  startBtn.disabled = !canStart;
  cancelBtn.disabled = !appState.transcribing;
  pickFileBtn.disabled = appState.transcribing;
  showOutputBtn.disabled = !appState.outputPath;

  downloadModelBtn.disabled = appState.transcribing || appState.dependenciesInstalling;

  checkUpdateBtn.disabled = appState.updateDownloading || appState.dependenciesInstalling;
  downloadUpdateBtn.disabled =
    !hasUpdate || appState.updateDownloading || appState.dependenciesInstalling;

  installDepsBtn.disabled = appState.dependenciesInstalling || appState.transcribing;
  cancelDepsBtn.disabled = !appState.dependenciesInstalling;
  installBrewBtn.disabled = appState.dependenciesInstalling;

  onboardingDoneBtn.disabled = !(
    appState.whisperInstalled &&
    appState.ffprobeInstalled &&
    appState.modelInstalled
  );
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
    return;
  }

  onboardingPanel.classList.remove('hidden');
  onboardingDoneBtn.textContent = allReady
    ? 'Finish onboarding'
    : 'Finish onboarding (complete setup first)';
}

function completeOnboarding() {
  const ready = appState.whisperInstalled && appState.ffprobeInstalled && appState.modelInstalled;
  if (!ready) return;

  localStorage.setItem(storageKeys.onboardingDone, '1');
  renderOnboarding();
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
    updateControls();
  } catch (error) {
    transcribeStatusText.textContent = `Status check failed: ${error.message}`;
  }
}

function setSelectedFile(filePath) {
  appState.selectedFile = filePath;
  selectedFileEl.textContent = filePath || 'No file selected';
  selectedFileEl.title = filePath || '';
  updateControls();
}

function setTranscribing(flag) {
  appState.transcribing = flag;
  updateControls();
}

function appendDepsLog(line, stream = 'stdout') {
  const prefix = stream === 'stderr' ? '[err]' : '[out]';
  const next = `${depsLogEl.textContent}${depsLogEl.textContent ? '\n' : ''}${prefix} ${line}`;
  depsLogEl.textContent = next.slice(-24000);
  depsLogEl.scrollTop = depsLogEl.scrollHeight;
}

function appendTranscribeLog(line) {
  const next = `${transcribeLogEl.textContent}${transcribeLogEl.textContent ? '\n' : ''}${line}`;
  transcribeLogEl.textContent = next.slice(-24000);
  transcribeLogEl.scrollTop = transcribeLogEl.scrollHeight;
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

async function onStartTranscription() {
  if (!appState.selectedFile) return;

  transcriptArea.value = '';
  transcribeLogEl.textContent = 'Starting transcription…';
  appState.outputPath = null;

  transcribeProgressWrap.classList.remove('hidden');
  setProgressIndeterminate(transcribeBar, true);
  transcribeMeta.textContent = 'Launching Whisper…';
  transcribeStatusText.textContent = 'Preparing transcription pipeline…';

  setTranscribing(true);

  try {
    const started = await window.api.startTranscription(appState.selectedFile);
    if (started?.durationSeconds) {
      transcribeMeta.textContent = `0.0% • ETA calculating… • 00:00/${formatDuration(started.durationSeconds)}`;
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
  transcribeStatusText.textContent = evt.message || 'Working…';
});

window.api.onTranscribeSegment((segment) => {
  appendTranscript(segment.text);
});

window.api.onTranscribeProgress((evt) => {
  const pct = Math.max(0, Math.min((evt.progress || 0) * 100, 100));
  const eta = Number.isFinite(evt.etaSeconds) ? formatDuration(evt.etaSeconds) : 'calculating…';
  const processed = formatDuration(evt.processedSeconds || 0);
  const total = formatDuration(evt.durationSeconds || 0);

  if (evt.estimated) {
    setProgressValue(transcribeBar, pct);
    transcribeMeta.textContent = `${pct.toFixed(1)}% • ETA ${eta} • ${processed}/${total} (estimated)`;
  } else {
    setProgressValue(transcribeBar, pct);
    transcribeMeta.textContent = `${pct.toFixed(1)}% • ETA ${eta} • ${processed}/${total}`;
  }
});

window.api.onTranscribeDone((evt) => {
  setTranscribing(false);
  setProgressValue(transcribeBar, 100);
  transcribeStatusText.textContent = `Done in ${formatDuration(evt.elapsedSeconds || 0)}`;

  if (evt.transcript && !transcriptArea.value.trim()) {
    transcriptArea.value = evt.transcript;
  }

  if (evt.outputPath) {
    appState.outputPath = evt.outputPath;
  }

  updateControls();
  renderOnboarding();
});

window.api.onTranscribeError((evt) => {
  setTranscribing(false);
  transcribeStatusText.textContent = `Error: ${evt.message}`;
  updateControls();
});

settingsBtn.addEventListener('click', openSettingsDrawer);
settingsCloseBtn.addEventListener('click', closeSettingsDrawer);
drawerBackdrop.addEventListener('click', closeSettingsDrawer);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && appState.settingsOpen) {
    closeSettingsDrawer();
  }
});

themeSwitch.addEventListener('change', () => {
  setThemeMode(themeSwitch.checked ? 'dark' : 'light');
});

themeAutoBtn.addEventListener('click', () => {
  setThemeMode('system');
});

mediaTheme.addEventListener('change', () => {
  if (themeMode === 'system') {
    applyTheme();
  }
});

onboardingOpenSettingsBtn.addEventListener('click', openSettingsDrawer);
onboardingDoneBtn.addEventListener('click', completeOnboarding);

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
startBtn.addEventListener('click', onStartTranscription);
cancelBtn.addEventListener('click', onCancelTranscription);

applyTheme();
refreshSystemStatus();
updateControls();
