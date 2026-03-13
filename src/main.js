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

let mainWindow;
let currentDownload = null;
let currentTranscription = null;

function getModelPath() {
  return path.join(os.homedir(), '.cache', 'whisper', MODEL_FILE);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function findBinary(name) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [name]);
    const resolved = stdout.trim();
    return resolved || null;
  } catch {
    return null;
  }
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
  const [whisperPath, ffprobePath, model] = await Promise.all([
    findBinary('whisper'),
    findBinary('ffprobe'),
    getModelStatus(),
  ]);

  return {
    whisperInstalled: Boolean(whisperPath),
    ffprobeInstalled: Boolean(ffprobePath),
    whisperPath,
    ffprobePath,
    model,
    busy: {
      download: Boolean(currentDownload),
      transcribing: Boolean(currentTranscription),
    },
  };
}

function parseTimestamp(min, sec, ms) {
  return Number(min) * 60 + Number(sec) + Number(ms) / 1000;
}

function formatTranscriptionProgress({ processedSeconds, durationSeconds, startedAtMs }) {
  const progress = durationSeconds > 0 ? Math.min(processedSeconds / durationSeconds, 1) : 0;
  const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
  const etaSeconds = progress > 0 ? Math.max((elapsedSeconds / progress) - elapsedSeconds, 0) : null;

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
                  const hash = crypto.createHash('sha256');
                  const readStream = fs.createReadStream(tempPath);

                  await new Promise((hashResolve, hashReject) => {
                    readStream.on('data', (chunk) => hash.update(chunk));
                    readStream.on('error', hashReject);
                    readStream.on('end', hashResolve);
                  });

                  const digest = hash.digest('hex');
                  if (digest !== expectedSha256) {
                    throw new Error(`Checksum mismatch. Expected ${expectedSha256}, got ${digest}.`);
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
  if (currentDownload) {
    throw new Error('A model download is already in progress.');
  }

  currentDownload = { startedAt: Date.now() };
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
    currentDownload = null;
  }
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
