const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
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

let mainWindow;
let currentModelDownload = null;
let currentTranscription = null;
let currentDependencyInstall = null;
let currentUpdateDownload = null;

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

async function getAudioDurationSeconds(ffprobePath, audioPath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);

  const parsed = Number(stdout.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Could not determine audio duration (ffprobe returned invalid output).');
  }

  return parsed;
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

  const durationSeconds = await getAudioDurationSeconds(ffprobePath, audioPath);
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

  const startedAtMs = Date.now();
  const transcriptLines = [];

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
  };

  const handleLogLine = (line) => {
    send('transcribe:log', { line });

    if (/Detected language/i.test(line)) {
      send('transcribe:status', { message: line });
    }

    const segment = parseSegmentLine(line);
    if (!segment) return;

    if (segment.text) {
      transcriptLines.push(segment.text);
      send('transcribe:segment', segment);
    }

    const progress = formatTranscriptionProgress({
      processedSeconds: segment.endSeconds,
      durationSeconds,
      startedAtMs,
    });

    send('transcribe:progress', {
      ...progress,
      processedSeconds: segment.endSeconds,
      durationSeconds,
    });
  };

  attachLineParser(child.stdout, handleLogLine);
  attachLineParser(child.stderr, handleLogLine);

  child.on('error', (error) => {
    send('transcribe:error', { message: error.message });
    currentTranscription = null;
  });

  child.on('close', async (code) => {
    const baseName = path.parse(audioPath).name;
    const outputPath = path.join(outputDir, `${baseName}.txt`);

    if (code === 0) {
      let transcript = transcriptLines.join('\n').trim();

      if (!transcript && (await fileExists(outputPath))) {
        transcript = (await fsp.readFile(outputPath, 'utf8')).trim();
      }

      send('transcribe:progress', {
        progress: 1,
        etaSeconds: 0,
        elapsedSeconds: (Date.now() - startedAtMs) / 1000,
        processedSeconds: durationSeconds,
        durationSeconds,
      });

      send('transcribe:done', {
        outputPath,
        outputDir,
        transcript,
        elapsedSeconds: (Date.now() - startedAtMs) / 1000,
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
    outputDir,
  };
});

ipcMain.handle('transcribe:cancel', async () => {
  if (!currentTranscription?.process) return { cancelled: false };

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
