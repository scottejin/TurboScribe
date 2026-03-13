const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MODEL_URL =
  'https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt';
const MODEL_SHA256 = 'aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a';
const MODEL_FILE = 'large-v3-turbo.pt';

const UPDATE_OWNER = process.env.TURBOSCRIBE_UPDATE_OWNER || 'scottejin';
const UPDATE_REPO = process.env.TURBOSCRIBE_UPDATE_REPO || 'TurboScribe';
const UPDATE_REPO_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}`;
const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;

const COMMON_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/homebrew/sbin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.wav',
  '.aac',
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.flac',
  '.ogg',
  '.aiff',
  '.aif',
  '.m4v',
  '.mpg',
  '.mpeg',
]);

let mainWindow;
let currentModelDownload = null;
let currentTranscription = null;
let currentDependencyInstall = null;
let currentUpdateDownload = null;
let realtimeSession = null;
let lastObservedRealtimeFactor = 1.0;
let runtimeMetricsState = {
  lastCpuUsage: process.cpuUsage(),
  lastHrTimeNs: process.hrtime.bigint(),
  emaCpuPercent: 0,
};

function getModelPath() {
  return path.join(os.homedir(), '.cache', 'whisper', MODEL_FILE);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function buildAugmentedPath(currentPath = process.env.PATH || '') {
  const seen = new Set();
  const merged = [];

  for (const entry of [...COMMON_BIN_DIRS, ...String(currentPath).split(':')]) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged.join(':');
}

function buildExecutionEnv(overrides = {}) {
  return {
    ...process.env,
    PATH: buildAugmentedPath(process.env.PATH),
    ...overrides,
  };
}

async function isExecutable(filePath) {
  try {
    await fsp.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findBinary(name) {
  if (!/^[a-zA-Z0-9._-]+$/.test(String(name || ''))) {
    return null;
  }

  for (const dir of COMMON_BIN_DIRS) {
    const candidate = path.join(dir, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [name], {
      env: buildExecutionEnv(),
    });
    const resolved = stdout.trim();
    if (resolved && (await isExecutable(resolved))) {
      return resolved;
    }
  } catch {
    // continue to shell fallback
  }

  for (const shellPath of ['/bin/zsh', '/bin/bash']) {
    if (!(await isExecutable(shellPath))) continue;

    try {
      const { stdout } = await execFileAsync(shellPath, ['-lc', `command -v ${name} || true`], {
        env: buildExecutionEnv(),
      });
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const resolved = lines[lines.length - 1];

      if (resolved && path.isAbsolute(resolved) && (await isExecutable(resolved))) {
        return resolved;
      }
    } catch {
      // try next shell
    }
  }

  return null;
}

function inferPowerProfile() {
  const model = String(os.cpus?.()?.[0]?.model || '').toLowerCase();

  if (/apple\s+m[1-4]/i.test(model)) {
    return { idleWatts: 1.5, peakWatts: 17 };
  }

  if (model.includes('intel')) {
    return { idleWatts: 2.2, peakWatts: 28 };
  }

  return { idleWatts: 1.8, peakWatts: 22 };
}

function estimateCpuPercentFallback() {
  const nowCpu = process.cpuUsage();
  const nowHrNs = process.hrtime.bigint();

  const cpuDeltaMicros =
    nowCpu.user - runtimeMetricsState.lastCpuUsage.user +
    (nowCpu.system - runtimeMetricsState.lastCpuUsage.system);

  const wallDeltaMs = Number(nowHrNs - runtimeMetricsState.lastHrTimeNs) / 1e6;

  runtimeMetricsState.lastCpuUsage = nowCpu;
  runtimeMetricsState.lastHrTimeNs = nowHrNs;

  if (!Number.isFinite(wallDeltaMs) || wallDeltaMs <= 0) {
    return 0;
  }

  const cpuPercent = (cpuDeltaMicros / 1000 / wallDeltaMs) * 100;
  return Math.max(0, cpuPercent);
}

function sampleRuntimeMetrics() {
  let cpuPercent = 0;
  let sampleSource = 'main-process';

  try {
    const metrics = app.getAppMetrics?.() || [];
    const total = metrics.reduce((sum, metric) => {
      const value = Number(metric?.cpu?.percentCPUUsage);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);

    if (Number.isFinite(total) && total > 0) {
      cpuPercent = total;
      sampleSource = 'app-metrics';
      runtimeMetricsState.lastCpuUsage = process.cpuUsage();
      runtimeMetricsState.lastHrTimeNs = process.hrtime.bigint();
    } else {
      cpuPercent = estimateCpuPercentFallback();
    }
  } catch {
    cpuPercent = estimateCpuPercentFallback();
  }

  runtimeMetricsState.emaCpuPercent =
    runtimeMetricsState.emaCpuPercent > 0
      ? runtimeMetricsState.emaCpuPercent * 0.7 + cpuPercent * 0.3
      : cpuPercent;

  const { idleWatts, peakWatts } = inferPowerProfile();
  const normalizedCpu = Math.max(0, runtimeMetricsState.emaCpuPercent);
  const watts = idleWatts + Math.min(normalizedCpu / 100, 2.4) * (peakWatts - idleWatts);

  const cpuBarPercent = Math.max(0, Math.min(normalizedCpu, 100));
  const wattsBarPercent = Math.max(0, Math.min((watts / peakWatts) * 100, 100));

  return {
    cpuPercent: Number(normalizedCpu.toFixed(1)),
    watts: Number(watts.toFixed(1)),
    cpuBarPercent: Number(cpuBarPercent.toFixed(1)),
    wattsBarPercent: Number(wattsBarPercent.toFixed(1)),
    source: sampleSource,
  };
}

function normalizeClipboardPath(raw) {
  let candidate = String(raw || '').trim();
  if (!candidate) return null;

  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  if (!candidate) return null;

  if (candidate.startsWith('file://')) {
    try {
      const url = new URL(candidate);
      candidate = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }

  if (candidate.startsWith('~/')) {
    candidate = path.join(os.homedir(), candidate.slice(2));
  }

  if (!path.isAbsolute(candidate)) {
    return null;
  }

  return candidate;
}

async function resolveMediaPathFromClipboardText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const candidate = normalizeClipboardPath(line);
    if (!candidate) continue;

    try {
      const stat = await fsp.stat(candidate);
      if (!stat.isFile()) continue;

      const ext = path.extname(candidate).toLowerCase();
      if (!SUPPORTED_MEDIA_EXTENSIONS.has(ext)) continue;

      return candidate;
    } catch {
      // try next line
    }
  }

  return null;
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getModelStatus() {
  const modelPath = getModelPath();
  const installed = await fileExists(modelPath);
  let sizeBytes = 0;

  if (installed) {
    const stat = await fsp.stat(modelPath);
    sizeBytes = stat.size;
  }

  return {
    installed,
    modelPath,
    sizeBytes,
    expectedModel: 'large-v3-turbo',
  };
}

async function getSystemStatus() {
  const [whisperPath, ffprobePath, brewPath, model] = await Promise.all([
    findBinary('whisper'),
    findBinary('ffprobe'),
    findBinary('brew'),
    getModelStatus(),
  ]);

  return {
    appVersion: app.getVersion(),
    updateSource: `${UPDATE_OWNER}/${UPDATE_REPO}`,
    whisperInstalled: Boolean(whisperPath),
    ffprobeInstalled: Boolean(ffprobePath),
    brewInstalled: Boolean(brewPath),
    whisperPath,
    ffprobePath,
    brewPath,
    model,
    busy: {
      modelDownload: Boolean(currentModelDownload),
      transcribing: Boolean(currentTranscription),
      dependenciesInstall: Boolean(currentDependencyInstall),
      updateDownload: Boolean(currentUpdateDownload),
      realtimeSession: Boolean(realtimeSession),
    },
  };
}

function parseTimestamp(min, sec, ms) {
  return Number(min) * 60 + Number(sec) + Number(ms) / 1000;
}

function formatTranscriptionProgress({ processedSeconds, durationSeconds, startedAtMs }) {
  const progress = durationSeconds > 0 ? Math.min(processedSeconds / durationSeconds, 1) : 0;
  const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
  const etaSeconds = progress > 0 ? Math.max(elapsedSeconds / progress - elapsedSeconds, 0) : null;

  return { progress, elapsedSeconds, etaSeconds };
}

function parseSegmentLine(line) {
  const match = line.match(/^\[(\d+):(\d{2})\.(\d{3}) --> (\d+):(\d{2})\.(\d{3})\]\s*(.*)$/);
  if (!match) return null;

  const startSeconds = parseTimestamp(match[1], match[2], match[3]);
  const endSeconds = parseTimestamp(match[4], match[5], match[6]);
  const text = (match[7] || '').trim();

  return {
    startSeconds,
    endSeconds,
    text,
  };
}

function attachLineParser(stream, onLine) {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  });

  stream.on('end', () => {
    const trimmed = buffer.trim();
    if (trimmed) onLine(trimmed);
  });
}

async function getMediaTimingInfo(ffprobePath, mediaPath) {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,start_time',
      '-of',
      'default=noprint_wrappers=1:nokey=0',
      mediaPath,
    ],
    {
      env: buildExecutionEnv(),
    },
  );

  const parsed = {
    duration: null,
    start_time: null,
  };

  for (const line of String(stdout || '').split(/\r?\n/)) {
    const [key, value] = line.split('=');
    if (!key || typeof value === 'undefined') continue;
    parsed[key.trim()] = value.trim();
  }

  const durationSeconds = Number(parsed.duration);
  const startTimeSeconds = Number(parsed.start_time);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Could not determine media duration (ffprobe returned invalid output).');
  }

  return {
    durationSeconds,
    startTimeSeconds: Number.isFinite(startTimeSeconds) ? startTimeSeconds : 0,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSessionId(prefix = 'session') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeExt(ext, fallback = '.webm') {
  const normalized = String(ext || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');

  if (!normalized) return fallback;
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function sanitizeFileStem(stem, fallback = 'transcript') {
  const safe = String(stem || '')
    .trim()
    .replace(/\.[^./\\]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return safe || fallback;
}

function timestampForFilename() {
  return new Date()
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\..+/, '');
}

async function writeTranscriptToDesktop({ transcriptText, stem = 'transcript' }) {
  const desktopDir = app.getPath('desktop');
  const exportDir = path.join(desktopDir, 'TurboScribe Exports');
  await fsp.mkdir(exportDir, { recursive: true });

  const safeStem = sanitizeFileStem(stem);
  const fileName = `${safeStem}-${timestampForFilename()}.txt`;
  const outPath = path.join(exportDir, fileName);

  const normalized = String(transcriptText || '').trim();
  await fsp.writeFile(outPath, `${normalized}\n`, 'utf8');
  return outPath;
}

function parseWhisperSegmentsFromJson(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const segments = Array.isArray(obj.segments) ? obj.segments : [];

  return segments
    .map((segment, idx) => ({
      index: idx,
      startSeconds: Number(segment.start) || 0,
      endSeconds: Number(segment.end) || 0,
      text: String(segment.text || '').trim(),
    }))
    .filter((segment) => segment.text);
}

async function transcribeFileWithWhisperJson({
  whisperPath,
  inputPath,
  outputDir,
  model = 'large-v3',
  task = 'transcribe',
  language,
}) {
  await fsp.mkdir(outputDir, { recursive: true });

  const args = [
    inputPath,
    '--model',
    model,
    '--model_dir',
    path.dirname(getModelPath()),
    '--output_dir',
    outputDir,
    '--output_format',
    'json',
    '--verbose',
    'False',
    '--task',
    task,
  ];

  if (language && language !== 'auto') {
    args.push('--language', language);
  }

  await execFileAsync(whisperPath, args, {
    env: buildExecutionEnv(),
    maxBuffer: 32 * 1024 * 1024,
  });

  const outputJsonPath = path.join(outputDir, `${path.parse(inputPath).name}.json`);
  const raw = await fsp.readFile(outputJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  const text = String(parsed.text || '').trim();
  const segments = parseWhisperSegmentsFromJson(parsed);

  return {
    outputJsonPath,
    text,
    segments,
    raw: parsed,
  };
}

async function waitForRealtimeQueueDrain(session) {
  while (session && (session.queue.length > 0 || session.processing)) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
  }
}

async function processRealtimeQueue(session) {
  if (!session || session.processing || session.cancelled) return;

  session.processing = true;

  try {
    while (!session.cancelled && session.queue.length > 0) {
      const job = session.queue.shift();
      if (!job) continue;

      send('realtime:state', {
        state: 'processing-chunk',
        sessionId: session.id,
        chunkIndex: job.chunkIndex,
        queueSize: session.queue.length,
      });

      try {
        const chunkOutDir = path.join(session.transcriptionDir, `chunk-${String(job.chunkIndex).padStart(5, '0')}`);

        const result = await transcribeFileWithWhisperJson({
          whisperPath: session.whisperPath,
          inputPath: job.chunkPath,
          outputDir: chunkOutDir,
          model: session.options.liveModel,
          task: session.options.task,
          language: session.options.language,
        });

        const chunkText = result.text.trim();
        if (chunkText) {
          const segmentPayload = {
            sessionId: session.id,
            chunkIndex: job.chunkIndex,
            text: chunkText,
            startSeconds: Number(job.startSeconds || 0),
            endSeconds: Number(job.endSeconds || 0),
            provisional: true,
          };

          session.liveSegments.push(segmentPayload);
          send('realtime:segment', segmentPayload);
        }
      } catch (error) {
        send('realtime:error', {
          sessionId: session.id,
          message: `Chunk ${job.chunkIndex} failed: ${error.message}`,
        });
      }
    }
  } finally {
    session.processing = false;

    if (!session.cancelled) {
      send('realtime:state', {
        state: 'queue-idle',
        sessionId: session.id,
        queueSize: session.queue.length,
      });
    }
  }
}

function downloadFileWithProgress(url, outputPath, expectedSha256, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      const tempPath = `${outputPath}.part`;
      await fsp.rm(tempPath, { force: true });

      const startedAt = Date.now();

      const requestWithRedirects = (targetUrl, redirectsRemaining = 5) => {
        https
          .get(targetUrl, (response) => {
            if (
              [301, 302, 303, 307, 308].includes(response.statusCode) &&
              response.headers.location &&
              redirectsRemaining > 0
            ) {
              requestWithRedirects(response.headers.location, redirectsRemaining - 1);
              return;
            }

            if (response.statusCode !== 200) {
              reject(new Error(`Download failed with HTTP ${response.statusCode}`));
              return;
            }

            const totalBytes = Number(response.headers['content-length'] || 0);
            let downloadedBytes = 0;
            const fileStream = fs.createWriteStream(tempPath);

            response.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
              const speedBytesPerSec = downloadedBytes / elapsedSeconds;
              const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
              const etaSeconds =
                totalBytes > 0 && speedBytesPerSec > 0
                  ? (totalBytes - downloadedBytes) / speedBytesPerSec
                  : null;

              onProgress({
                downloadedBytes,
                totalBytes,
                percent,
                speedBytesPerSec,
                etaSeconds,
              });
            });

            response.pipe(fileStream);

            fileStream.on('finish', async () => {
              fileStream.close(async () => {
                try {
                  if (expectedSha256) {
                    const hash = crypto.createHash('sha256');
                    const readStream = fs.createReadStream(tempPath);

                    await new Promise((hashResolve, hashReject) => {
                      readStream.on('data', (chunk) => hash.update(chunk));
                      readStream.on('error', hashReject);
                      readStream.on('end', hashResolve);
                    });

                    const digest = hash.digest('hex');
                    if (digest !== expectedSha256) {
                      throw new Error(
                        `Checksum mismatch. Expected ${expectedSha256}, got ${digest}.`,
                      );
                    }
                  }

                  await fsp.rename(tempPath, outputPath);
                  resolve();
                } catch (error) {
                  await fsp.rm(tempPath, { force: true });
                  reject(error);
                }
              });
            });

            fileStream.on('error', async (error) => {
              await fsp.rm(tempPath, { force: true });
              reject(error);
            });
          })
          .on('error', reject);
      };

      requestWithRedirects(url);
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeVersion(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
}

function compareVersions(a, b) {
  const aParts = normalizeVersion(a)
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  const bParts = normalizeVersion(b)
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length, 3);

  for (let i = 0; i < maxLen; i += 1) {
    const left = aParts[i] || 0;
    const right = bParts[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }

  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': `TurboScribe/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
      },
      (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });

        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Request failed (${response.statusCode}): ${data.slice(0, 280)}`));
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Could not parse JSON response: ${error.message}`));
          }
        });
      },
    );

    request.on('error', reject);
  });
}

function selectBestReleaseAsset(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  if (process.platform === 'darwin') {
    const dmgAssets = assets.filter((asset) => asset?.name?.toLowerCase().endsWith('.dmg'));
    if (!dmgAssets.length) return null;

    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    return (
      dmgAssets.find((asset) => asset.name.toLowerCase().includes(`-${arch}.dmg`)) ||
      dmgAssets.find((asset) => asset.name.toLowerCase().includes('universal')) ||
      dmgAssets[0]
    );
  }

  return assets[0];
}

async function getLatestReleaseInfo() {
  const release = await fetchJson(UPDATE_API_URL);
  const currentVersion = normalizeVersion(app.getVersion());
  const latestVersion = normalizeVersion(release.tag_name || release.name || currentVersion);
  const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;
  const asset = selectBestReleaseAsset(release.assets);

  return {
    repository: `${UPDATE_OWNER}/${UPDATE_REPO}`,
    repositoryUrl: UPDATE_REPO_URL,
    currentVersion,
    latestVersion,
    releaseTag: release.tag_name || `v${latestVersion}`,
    releaseName: release.name || release.tag_name || `v${latestVersion}`,
    releaseUrl: release.html_url || UPDATE_REPO_URL,
    publishedAt: release.published_at || null,
    notes: release.body || '',
    updateAvailable,
    asset: asset
      ? {
          name: asset.name,
          size: asset.size,
          downloadUrl: asset.browser_download_url,
        }
      : null,
  };
}

async function openHomebrewInstallerInTerminal() {
  const scriptPath = path.join(app.getPath('temp'), 'TurboScribe-install-homebrew.command');
  const script = `#!/bin/bash
set -e
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo
echo "Homebrew installation finished. Press Enter to close this window."
read -r
`;

  await fsp.writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o700 });
  await execFileAsync('open', ['-a', 'Terminal', scriptPath]);
  return scriptPath;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 920,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('system:status', async () => {
  return getSystemStatus();
});

ipcMain.handle('model:download', async () => {
  if (currentModelDownload) {
    throw new Error('A model download is already in progress.');
  }

  currentModelDownload = { startedAt: Date.now() };
  send('model:download-state', { state: 'starting' });

  try {
    const modelPath = getModelPath();

    await downloadFileWithProgress(MODEL_URL, modelPath, MODEL_SHA256, (progress) => {
      send('model:download-progress', progress);
    });

    const status = await getModelStatus();
    send('model:download-state', { state: 'done', status });
    return status;
  } catch (error) {
    send('model:download-state', { state: 'error', message: error.message });
    throw error;
  } finally {
    currentModelDownload = null;
  }
});

ipcMain.handle('updater:check', async () => {
  send('updater:state', { state: 'checking' });

  try {
    const info = await getLatestReleaseInfo();
    send('updater:state', { state: 'checked', ...info });
    return info;
  } catch (error) {
    send('updater:state', { state: 'error', message: error.message });
    throw error;
  }
});

ipcMain.handle('updater:download-and-open', async (_event, payload) => {
  if (currentUpdateDownload) {
    throw new Error('An update download is already in progress.');
  }

  const info = payload?.info || (await getLatestReleaseInfo());

  if (!info.updateAvailable) {
    return {
      downloaded: false,
      updateAvailable: false,
      message: 'Already up to date.',
      info,
    };
  }

  if (!info.asset?.downloadUrl) {
    throw new Error('No suitable installer asset found in the latest release.');
  }

  const updatesDir = path.join(app.getPath('downloads'), 'TurboScribe', 'updates');
  const outputPath = path.join(updatesDir, info.asset.name);

  currentUpdateDownload = {
    startedAtMs: Date.now(),
    outputPath,
    info,
  };

  send('updater:state', {
    state: 'downloading',
    releaseTag: info.releaseTag,
    assetName: info.asset.name,
  });

  try {
    await downloadFileWithProgress(info.asset.downloadUrl, outputPath, null, (progress) => {
      send('updater:download-progress', {
        ...progress,
        assetName: info.asset.name,
        releaseTag: info.releaseTag,
      });
    });

    send('updater:state', {
      state: 'downloaded',
      filePath: outputPath,
      releaseTag: info.releaseTag,
      assetName: info.asset.name,
    });

    const openErr = await shell.openPath(outputPath);
    if (openErr) {
      throw new Error(`Update downloaded but failed to open installer: ${openErr}`);
    }

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `TurboScribe ${info.latestVersion} downloaded`,
      detail:
        'The installer has been opened. Close TurboScribe, then replace your app in Applications to finish updating.',
      buttons: ['OK'],
    });

    send('updater:state', {
      state: 'installer-opened',
      filePath: outputPath,
      releaseTag: info.releaseTag,
      assetName: info.asset.name,
    });

    return {
      downloaded: true,
      filePath: outputPath,
      info,
    };
  } catch (error) {
    send('updater:state', { state: 'error', message: error.message });
    throw error;
  } finally {
    currentUpdateDownload = null;
  }
});

ipcMain.handle('deps:install-homebrew', async () => {
  const brewPath = await findBinary('brew');
  if (brewPath) {
    send('deps:state', {
      state: 'brew-present',
      message: `Homebrew already installed at ${brewPath}`,
    });
    return {
      opened: false,
      brewPresent: true,
      brewPath,
    };
  }

  const scriptPath = await openHomebrewInstallerInTerminal();
  send('deps:state', {
    state: 'homebrew-installer-opened',
    message: 'Terminal opened with Homebrew installer.',
    scriptPath,
  });

  return {
    opened: true,
    brewPresent: false,
    scriptPath,
  };
});

ipcMain.handle('deps:install', async () => {
  if (currentDependencyInstall) {
    throw new Error('Dependency installation is already running.');
  }

  const brewPath = await findBinary('brew');
  if (!brewPath) {
    send('deps:state', {
      state: 'no-brew',
      message: 'Homebrew not found. Use “Install Homebrew (guided)” in Settings first.',
    });
    throw new Error('Homebrew is required. Install Homebrew first.');
  }

  const args = ['install', 'openai-whisper', 'ffmpeg'];
  const child = spawn(brewPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildExecutionEnv({
      HOMEBREW_NO_AUTO_UPDATE: '1',
    }),
  });

  currentDependencyInstall = {
    process: child,
    startedAtMs: Date.now(),
  };

  send('deps:state', {
    state: 'running',
    message: 'Installing dependencies with Homebrew…',
    command: `${brewPath} ${args.join(' ')}`,
  });

  attachLineParser(child.stdout, (line) => {
    send('deps:log', { stream: 'stdout', line });
  });

  attachLineParser(child.stderr, (line) => {
    send('deps:log', { stream: 'stderr', line });
  });

  child.on('error', (error) => {
    send('deps:state', {
      state: 'error',
      message: error.message,
    });
    currentDependencyInstall = null;
  });

  child.on('close', async (code) => {
    const elapsedSeconds = (Date.now() - currentDependencyInstall.startedAtMs) / 1000;

    if (code === 0) {
      const status = await getSystemStatus();
      send('deps:state', {
        state: 'done',
        message: 'Dependencies installed successfully.',
        elapsedSeconds,
        status,
      });
    } else {
      send('deps:state', {
        state: 'error',
        message: `Dependency installation failed (exit code ${code}).`,
        elapsedSeconds,
      });
    }

    currentDependencyInstall = null;
  });

  return {
    started: true,
  };
});

ipcMain.handle('deps:cancel', async () => {
  if (!currentDependencyInstall?.process) {
    return { cancelled: false };
  }

  currentDependencyInstall.process.kill('SIGTERM');
  send('deps:state', {
    state: 'cancelled',
    message: 'Dependency install cancelled.',
  });
  currentDependencyInstall = null;
  return { cancelled: true };
});

ipcMain.handle('realtime:start', async (_event, payload = {}) => {
  if (realtimeSession) {
    throw new Error('A realtime recording session is already active.');
  }

  const [whisperPath, ffprobePath] = await Promise.all([findBinary('whisper'), findBinary('ffprobe')]);

  if (!whisperPath) {
    throw new Error('Whisper CLI is not installed. Install it with: brew install openai-whisper');
  }
  if (!ffprobePath) {
    throw new Error('ffprobe is not installed. Install FFmpeg with: brew install ffmpeg');
  }

  const modelStatus = await getModelStatus();
  if (!modelStatus.installed) {
    throw new Error('Turbo model not found. Download the model first.');
  }

  const sessionId = makeSessionId('realtime');
  const tempRoot = path.join(app.getPath('temp'), 'TurboScribe', 'realtime', sessionId);
  const chunksDir = path.join(tempRoot, 'chunks');
  const transcriptionDir = path.join(tempRoot, 'transcripts');

  await fsp.mkdir(chunksDir, { recursive: true });
  await fsp.mkdir(transcriptionDir, { recursive: true });

  realtimeSession = {
    id: sessionId,
    startedAtMs: Date.now(),
    options: {
      sourceMode: payload.sourceMode === 'screen' ? 'screen' : 'microphone',
      task: payload.task === 'translate' ? 'translate' : 'transcribe',
      language: payload.language || undefined,
      liveModel: payload.liveModel || 'large-v3',
      finalModel: payload.finalModel || 'large-v3',
    },
    whisperPath,
    ffprobePath,
    tempRoot,
    chunksDir,
    transcriptionDir,
    queue: [],
    processing: false,
    cancelled: false,
    chunkCounter: 0,
    cumulativeDurationSeconds: 0,
    liveSegments: [],
  };

  send('realtime:state', {
    state: 'started',
    sessionId,
    sourceMode: realtimeSession.options.sourceMode,
    task: realtimeSession.options.task,
    liveModel: realtimeSession.options.liveModel,
    finalModel: realtimeSession.options.finalModel,
  });

  return {
    sessionId,
    sourceMode: realtimeSession.options.sourceMode,
    task: realtimeSession.options.task,
    liveModel: realtimeSession.options.liveModel,
    finalModel: realtimeSession.options.finalModel,
  };
});

ipcMain.handle('realtime:push-chunk', async (_event, payload = {}) => {
  const sessionId = payload.sessionId;
  if (!realtimeSession || !sessionId || sessionId !== realtimeSession.id) {
    throw new Error('No active realtime session.');
  }

  if (realtimeSession.cancelled) {
    throw new Error('Realtime session has been cancelled.');
  }

  const chunkBase64 = payload.chunkBase64;
  if (!chunkBase64) {
    throw new Error('Chunk payload missing.');
  }

  const extension = sanitizeExt(payload.extension || '.webm', '.webm');
  const chunkIndex = ++realtimeSession.chunkCounter;
  const chunkName = `chunk-${String(chunkIndex).padStart(5, '0')}${extension}`;
  const chunkPath = path.join(realtimeSession.chunksDir, chunkName);

  const buffer = Buffer.from(chunkBase64, 'base64');
  await fsp.writeFile(chunkPath, buffer);

  const durationSeconds = Math.max(0, Number(payload.durationMs || 0) / 1000);
  const startSeconds = realtimeSession.cumulativeDurationSeconds;
  const endSeconds = startSeconds + durationSeconds;
  realtimeSession.cumulativeDurationSeconds = endSeconds;

  realtimeSession.queue.push({
    chunkIndex,
    chunkPath,
    startSeconds,
    endSeconds,
  });

  send('realtime:state', {
    state: 'chunk-received',
    sessionId: realtimeSession.id,
    chunkIndex,
    queueSize: realtimeSession.queue.length,
  });

  void processRealtimeQueue(realtimeSession);

  return {
    accepted: true,
    chunkIndex,
    queueSize: realtimeSession.queue.length,
  };
});

ipcMain.handle('realtime:stop', async (_event, payload = {}) => {
  const sessionId = payload.sessionId;
  if (!realtimeSession || !sessionId || sessionId !== realtimeSession.id) {
    throw new Error('No active realtime session.');
  }

  const session = realtimeSession;

  send('realtime:state', {
    state: 'finalizing-started',
    sessionId: session.id,
    message: 'Waiting for live chunks to finish processing…',
  });

  await waitForRealtimeQueueDrain(session);

  const recordingBase64 = payload.recordingBase64;
  if (!recordingBase64) {
    throw new Error('Final recording data missing.');
  }

  const extension = sanitizeExt(payload.extension || '.webm', '.webm');
  const finalInputPath = path.join(session.tempRoot, `recording-final${extension}`);
  await fsp.writeFile(finalInputPath, Buffer.from(recordingBase64, 'base64'));

  send('realtime:state', {
    state: 'finalizing-transcription',
    sessionId: session.id,
    message: 'Running final high-accuracy transcription pass…',
  });

  const finalOutDir = path.join(session.transcriptionDir, 'final');
  const finalResult = await transcribeFileWithWhisperJson({
    whisperPath: session.whisperPath,
    inputPath: finalInputPath,
    outputDir: finalOutDir,
    model: session.options.finalModel,
    task: session.options.task,
    language: session.options.language,
  });

  const desktopTxtPath = await writeTranscriptToDesktop({
    transcriptText: finalResult.text,
    stem: `live-${session.options.task}`,
  });

  const desktopDir = app.getPath('desktop');
  const exportDir = path.join(desktopDir, 'TurboScribe Exports');
  await fsp.mkdir(exportDir, { recursive: true });

  const outBase = `${sanitizeFileStem(path.parse(desktopTxtPath).name)}-meta`;
  const outputJsonPath = path.join(exportDir, `${outBase}.json`);

  await fsp.writeFile(
    outputJsonPath,
    JSON.stringify(
      {
        sessionId: session.id,
        task: session.options.task,
        model: session.options.finalModel,
        createdAt: new Date().toISOString(),
        segments: finalResult.segments,
        text: finalResult.text,
      },
      null,
      2,
    ),
    'utf8',
  );

  const elapsedSeconds = (Date.now() - session.startedAtMs) / 1000;

  const response = {
    sessionId: session.id,
    outputPath: desktopTxtPath,
    jsonPath: outputJsonPath,
    transcript: finalResult.text,
    segments: finalResult.segments,
    elapsedSeconds,
    task: session.options.task,
    liveModel: session.options.liveModel,
    finalModel: session.options.finalModel,
  };

  send('realtime:final', response);
  send('realtime:state', {
    state: 'finalized',
    sessionId: session.id,
    outputPath: desktopTxtPath,
  });

  realtimeSession = null;
  return response;
});

ipcMain.handle('realtime:cancel', async (_event, payload = {}) => {
  const sessionId = payload.sessionId;
  if (!realtimeSession || !sessionId || sessionId !== realtimeSession.id) {
    return { cancelled: false };
  }

  realtimeSession.cancelled = true;
  realtimeSession.queue = [];

  send('realtime:state', {
    state: 'cancelled',
    sessionId: realtimeSession.id,
  });

  realtimeSession = null;
  return { cancelled: true };
});

ipcMain.handle('metrics:sample', async () => {
  return sampleRuntimeMetrics();
});

ipcMain.handle('dialog:pick-audio-from-clipboard', async () => {
  const rawText = clipboard.readText();
  const resolvedPath = await resolveMediaPathFromClipboardText(rawText);
  return resolvedPath || null;
});

ipcMain.handle('dialog:pick-audio', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose audio/video file',
    properties: ['openFile'],
    filters: [
      {
        name: 'Audio/Video',
        extensions: [
          'mp3',
          'm4a',
          'wav',
          'aac',
          'mp4',
          'mov',
          'mkv',
          'webm',
          'flac',
          'ogg',
          'aiff',
          'aif',
        ],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('transcribe:start', async (_event, payload) => {
  if (currentTranscription) {
    throw new Error('A transcription is already running.');
  }

  const audioPath = payload?.audioPath;
  if (!audioPath) throw new Error('No audio file selected.');

  send('transcribe:status', { message: 'Checking Whisper + FFmpeg installation…' });

  const [whisperPath, ffprobePath] = await Promise.all([findBinary('whisper'), findBinary('ffprobe')]);

  if (!whisperPath) {
    throw new Error('Whisper CLI is not installed. Install it with: brew install openai-whisper');
  }
  if (!ffprobePath) {
    throw new Error('ffprobe is not installed. Install FFmpeg with: brew install ffmpeg');
  }

  send('transcribe:status', { message: 'Checking Whisper model files…' });
  const modelStatus = await getModelStatus();
  if (!modelStatus.installed) {
    throw new Error('Turbo model not found. Download the model first.');
  }

  send('transcribe:status', { message: 'Reading media timing info…' });
  const mediaInfo = await getMediaTimingInfo(ffprobePath, audioPath);
  const durationSeconds = mediaInfo.durationSeconds;
  const mediaStartOffsetSeconds = Math.max(0, mediaInfo.startTimeSeconds || 0);

  const outputDir = path.join(app.getPath('documents'), 'TurboScribe', 'Transcripts');
  await fsp.mkdir(outputDir, { recursive: true });

  const args = [
    audioPath,
    '--model',
    'turbo',
    '--model_dir',
    path.dirname(getModelPath()),
    '--output_dir',
    outputDir,
    '--output_format',
    'txt',
    '--verbose',
    'True',
  ];

  send('transcribe:status', {
    message: `Launching Whisper (duration ${durationSeconds.toFixed(2)}s, start offset ${mediaStartOffsetSeconds.toFixed(2)}s)…`,
  });

  const startedAtMs = Date.now();
  const transcriptLines = [];
  let hasRealProgress = false;
  let firstSegmentStartSeconds = null;
  let fallbackTimer = null;

  const etaTracker = {
    lastProcessedSeconds: 0,
    lastElapsedSeconds: 0,
    speedEma: 0,
    lastEtaSeconds: null,
  };

  const estimatedRealtimeFactor = Math.min(Math.max(lastObservedRealtimeFactor || 1.0, 0.35), 3.0);
  const fallbackEstimateTotalSeconds = Math.max(12, durationSeconds * estimatedRealtimeFactor + 4);

  const child = spawn(whisperPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildExecutionEnv(),
  });

  currentTranscription = {
    process: child,
    startedAtMs,
    durationSeconds,
    outputDir,
    audioPath,
    fallbackTimer,
  };

  const emitEstimatedProgress = () => {
    if (!currentTranscription || hasRealProgress) return;

    const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
    const progress = Math.min(elapsedSeconds / fallbackEstimateTotalSeconds, 0.94);
    const etaSeconds = Math.max(fallbackEstimateTotalSeconds - elapsedSeconds, 0);

    send('transcribe:progress', {
      progress,
      etaSeconds,
      elapsedSeconds,
      processedSeconds: progress * durationSeconds,
      durationSeconds,
      estimated: true,
    });
  };

  fallbackTimer = setInterval(emitEstimatedProgress, 1000);
  currentTranscription.fallbackTimer = fallbackTimer;
  emitEstimatedProgress();

  child.on('spawn', () => {
    send('transcribe:status', {
      message: `Whisper process started (PID ${child.pid}). Detecting language + processing segments…`,
    });
  });

  const handleLogLine = (line) => {
    send('transcribe:log', { line });

    if (/Detecting language/i.test(line)) {
      send('transcribe:status', { message: 'Detecting spoken language…' });
    }

    if (/Detected language/i.test(line)) {
      send('transcribe:status', { message: line });
    }

    const segment = parseSegmentLine(line);
    if (!segment) return;

    if (firstSegmentStartSeconds === null) {
      firstSegmentStartSeconds = segment.startSeconds;
    }

    if (segment.text) {
      transcriptLines.push(segment.text);
      send('transcribe:segment', segment);
    }

    let processedSeconds = segment.endSeconds - mediaStartOffsetSeconds;

    if (
      !Number.isFinite(processedSeconds) ||
      processedSeconds < 0 ||
      processedSeconds > durationSeconds + 2
    ) {
      processedSeconds = segment.endSeconds - (firstSegmentStartSeconds || 0);
    }

    if (
      !Number.isFinite(processedSeconds) ||
      processedSeconds < 0 ||
      processedSeconds > durationSeconds + 2
    ) {
      processedSeconds = segment.endSeconds;
    }

    processedSeconds = Math.max(0, Math.min(processedSeconds, durationSeconds));

    const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
    const progressRatio = durationSeconds > 0 ? Math.min(processedSeconds / durationSeconds, 1) : 0;

    const processedDelta = processedSeconds - etaTracker.lastProcessedSeconds;
    const elapsedDelta = Math.max(elapsedSeconds - etaTracker.lastElapsedSeconds, 0);

    if (processedDelta > 0.015 && elapsedDelta > 0.05) {
      const instantSpeed = processedDelta / elapsedDelta;
      etaTracker.speedEma = etaTracker.speedEma > 0 ? etaTracker.speedEma * 0.78 + instantSpeed * 0.22 : instantSpeed;
    }

    const remainingSeconds = Math.max(durationSeconds - processedSeconds, 0);
    let etaSeconds =
      etaTracker.speedEma > 0.01 ? Math.max(remainingSeconds / etaTracker.speedEma, 0) : null;

    if ((!Number.isFinite(etaSeconds) || etaSeconds === null) && Number.isFinite(etaTracker.lastEtaSeconds)) {
      etaSeconds = Math.max(etaTracker.lastEtaSeconds - elapsedDelta, 0);
    }

    if (Number.isFinite(etaSeconds) && Number.isFinite(etaTracker.lastEtaSeconds)) {
      const allowedIncrease = progressRatio > 0.9 ? 0.65 : 2.8;
      etaSeconds = Math.min(etaSeconds, etaTracker.lastEtaSeconds + allowedIncrease);
    }

    if (progressRatio > 0.965 && Number.isFinite(etaSeconds)) {
      etaSeconds = Math.min(etaSeconds, Math.max((1 - progressRatio) * 18, 0));
    }

    if (progressRatio >= 0.999) {
      etaSeconds = 0;
    }

    if (Number.isFinite(etaSeconds)) {
      etaTracker.lastEtaSeconds = etaSeconds;
    }

    etaTracker.lastProcessedSeconds = processedSeconds;
    etaTracker.lastElapsedSeconds = elapsedSeconds;

    hasRealProgress = true;

    send('transcribe:progress', {
      progress: progressRatio,
      etaSeconds,
      elapsedSeconds,
      processedSeconds,
      durationSeconds,
      estimated: false,
    });

    send('transcribe:status', {
      message: `Transcribing… ${Math.round(progressRatio * 100)}%`,
    });
  };

  attachLineParser(child.stdout, handleLogLine);
  attachLineParser(child.stderr, handleLogLine);

  child.on('error', (error) => {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }

    send('transcribe:error', { message: error.message });
    currentTranscription = null;
  });

  child.on('close', async (code) => {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }

    const baseName = path.parse(audioPath).name;
    const outputPath = path.join(outputDir, `${baseName}.txt`);

    if (code === 0) {
      send('transcribe:status', { message: 'Finalizing transcript output…' });

      let transcript = transcriptLines.join('\n').trim();
      if (await fileExists(outputPath)) {
        const fromFile = (await fsp.readFile(outputPath, 'utf8')).trim();
        if (fromFile) {
          transcript = fromFile;
        }
      }

      const desktopOutputPath = await writeTranscriptToDesktop({
        transcriptText: transcript,
        stem: `${path.parse(audioPath).name}-transcript`,
      });

      const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
      if (durationSeconds > 0 && Number.isFinite(elapsedSeconds) && elapsedSeconds > 0) {
        const observed = elapsedSeconds / durationSeconds;
        if (Number.isFinite(observed) && observed > 0.05 && observed < 10) {
          lastObservedRealtimeFactor = lastObservedRealtimeFactor * 0.7 + observed * 0.3;
        }
      }

      send('transcribe:progress', {
        progress: 1,
        etaSeconds: 0,
        elapsedSeconds,
        processedSeconds: durationSeconds,
        durationSeconds,
        estimated: false,
      });

      send('transcribe:done', {
        outputPath: desktopOutputPath,
        sourceOutputPath: outputPath,
        outputDir,
        transcript,
        elapsedSeconds,
      });
    } else {
      send('transcribe:error', {
        message: `Transcription failed (exit code ${code}).`,
      });
    }

    currentTranscription = null;
  });

  return {
    started: true,
    durationSeconds,
    startOffsetSeconds: mediaStartOffsetSeconds,
    outputDir,
  };
});

ipcMain.handle('transcribe:cancel', async () => {
  if (!currentTranscription?.process) return { cancelled: false };

  if (currentTranscription.fallbackTimer) {
    clearInterval(currentTranscription.fallbackTimer);
  }

  currentTranscription.process.kill('SIGTERM');
  send('transcribe:status', { message: 'Transcription cancelled.' });
  currentTranscription = null;
  return { cancelled: true };
});

ipcMain.handle('shell:show-item', async (_event, payload) => {
  const targetPath = payload?.path;
  if (!targetPath) return false;
  return shell.showItemInFolder(targetPath);
});

ipcMain.handle('app:quit', async () => {
  if (currentTranscription?.fallbackTimer) {
    clearInterval(currentTranscription.fallbackTimer);
  }

  if (currentTranscription?.process) {
    try {
      currentTranscription.process.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  if (currentDependencyInstall?.process) {
    try {
      currentDependencyInstall.process.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  if (realtimeSession) {
    realtimeSession.cancelled = true;
    realtimeSession.queue = [];
  }

  setTimeout(() => app.quit(), 10);
  return { quitting: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
