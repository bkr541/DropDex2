const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron');
const { createReadStream, promises: fs } = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');
const crypto = require('node:crypto');

const APP_SCHEME = 'dropdex-media';
const USB_CONFIG_FILE = 'usb-connection.json';
const REKORDBOX_DATABASE_FOLDER = 'PIONEER';
const REKORDBOX_MEDIA_FOLDERS = ['Contents', 'Music'];
const REKORDBOX_ROOT_ENTRIES = [REKORDBOX_DATABASE_FOLDER, ...REKORDBOX_MEDIA_FOLDERS];
const mediaTokens = new Map();
let mainWindow = null;
let usbConnection = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

function configPath() {
  return path.join(app.getPath('userData'), USB_CONFIG_FILE);
}

function sanitizeConnection(raw) {
  if (!raw || typeof raw.rootPath !== 'string' || !raw.rootPath.trim()) return null;
  return {
    rootPath: path.resolve(raw.rootPath),
    volumeName: typeof raw.volumeName === 'string' && raw.volumeName.trim()
      ? raw.volumeName.trim()
      : path.basename(path.resolve(raw.rootPath)),
    connectedAt: typeof raw.connectedAt === 'string'
      ? raw.connectedAt
      : new Date().toISOString(),
  };
}

async function loadUsbConnection() {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    usbConnection = sanitizeConnection(raw);
  } catch {
    usbConnection = null;
  }
}

async function persistUsbConnection() {
  if (!usbConnection) {
    await fs.rm(configPath(), { force: true });
    return;
  }
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(usbConnection, null, 2), 'utf8');
}

function isPathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  return segments.every((segment) => (
    typeof segment === 'string'
    && segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes('\0')
  ));
}

async function findCaseInsensitiveEntry(directory, requestedName, expectedKind) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const exact = entries.find((entry) => entry.name === requestedName);
  if (exact) {
    const correctKind = expectedKind === 'directory' ? exact.isDirectory() : exact.isFile();
    if (!correctKind) {
      return { ok: false, error: { kind: 'type_mismatch', segment: requestedName, message: `Expected ${expectedKind}: ${requestedName}` } };
    }
    return { ok: true, name: exact.name };
  }

  const candidates = entries.filter((entry) => {
    const correctKind = expectedKind === 'directory' ? entry.isDirectory() : entry.isFile();
    return correctKind && entry.name.toLowerCase() === requestedName.toLowerCase();
  });

  if (candidates.length === 0) {
    return { ok: false, error: { kind: 'not_found', path: requestedName, message: `Not found: ${requestedName}` } };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      error: {
        kind: 'ambiguous_case_match',
        segment: requestedName,
        candidates: candidates.map((entry) => entry.name),
        path: requestedName,
        message: `Multiple entries match ${requestedName}.`,
      },
    };
  }
  return { ok: true, name: candidates[0].name };
}

async function resolveUsbTrackPath(segments) {
  if (!usbConnection) {
    return { ok: false, error: { kind: 'permission_denied', message: 'No USB drive is connected.' } };
  }
  if (!validateSegments(segments)) {
    return { ok: false, error: { kind: 'security', message: 'Unsafe USB path was rejected.' } };
  }

  let current = usbConnection.rootPath;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const expectedKind = index === segments.length - 1 ? 'file' : 'directory';
      const match = await findCaseInsensitiveEntry(current, segments[index], expectedKind);
      if (!match.ok) {
        const relativePath = segments.slice(0, index + 1).join('/');
        return {
          ok: false,
          error: {
            ...match.error,
            path: relativePath,
          },
        };
      }
      current = path.join(current, match.name);
      if (!isPathInsideRoot(usbConnection.rootPath, current)) {
        return { ok: false, error: { kind: 'security', message: 'Resolved path escaped the selected USB root.' } };
      }
    }

    const stat = await fs.stat(current);
    if (!stat.isFile()) {
      return { ok: false, error: { kind: 'type_mismatch', segment: segments.at(-1), message: 'Resolved USB entry is not a file.' } };
    }
    return { ok: true, filePath: current, size: stat.size };
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : null;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, error: { kind: 'not_found', path: segments.join('/'), message: `Not found: ${segments.join('/')}` } };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, error: { kind: 'permission_denied', message: 'macOS or Windows denied access to the selected USB drive.' } };
    }
    return { ok: false, error: { kind: 'unexpected', message: error instanceof Error ? error.message : String(error) } };
  }
}

async function inspectUsbRoot(rootPath) {
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      return { status: 'wrong_root', foundFolders: [], missingFolders: [REKORDBOX_DATABASE_FOLDER] };
    }
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const directoryNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const foundFolders = [];
    for (const indicator of REKORDBOX_ROOT_ENTRIES) {
      const found = directoryNames.find((entry) => entry.toLowerCase() === indicator.toLowerCase());
      if (found) foundFolders.push(found);
    }
    const hasDatabaseFolder = foundFolders.some(
      (entry) => entry.toLowerCase() === REKORDBOX_DATABASE_FOLDER.toLowerCase(),
    );
    if (!hasDatabaseFolder) {
      return {
        status: 'wrong_root',
        foundFolders,
        missingFolders: [REKORDBOX_DATABASE_FOLDER],
      };
    }
    const hasMediaFolder = REKORDBOX_MEDIA_FOLDERS.some((indicator) => (
      foundFolders.some((entry) => entry.toLowerCase() === indicator.toLowerCase())
    ));
    return {
      status: 'available',
      foundFolders,
      missingFolders: hasMediaFolder ? [] : ['Contents or Music'],
    };
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : 'io_error';
    return {
      status: 'unavailable',
      errorCode: String(code),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function desktopConnectionState() {
  if (!usbConnection) {
    return { status: 'disconnected', volumeName: null, connectedAt: null, structureWarning: null, error: null };
  }
  const check = await inspectUsbRoot(usbConnection.rootPath);
  if (check.status === 'unavailable') {
    return {
      status: 'unavailable',
      volumeName: usbConnection.volumeName,
      connectedAt: usbConnection.connectedAt,
      structureWarning: null,
      error: check.message,
    };
  }
  if (check.status === 'wrong_root') {
    return {
      status: 'wrong_root',
      volumeName: usbConnection.volumeName,
      connectedAt: usbConnection.connectedAt,
      structureWarning: 'No Rekordbox folders found. Select the USB root folder, not PIONEER or a subfolder.',
      error: null,
    };
  }
  return {
    status: 'connected',
    volumeName: usbConnection.volumeName,
    connectedAt: usbConnection.connectedAt,
    structureWarning: check.missingFolders.length > 0
      ? 'Could not find a media folder (Contents or Music). Track playback may be unavailable.'
      : null,
    error: null,
  };
}

function mimeTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a':
    case '.mp4': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.wav': return 'audio/wav';
    case '.aif':
    case '.aiff': return 'audio/aiff';
    case '.flac': return 'audio/flac';
    case '.ogg': return 'audio/ogg';
    case '.opus': return 'audio/opus';
    default: return 'application/octet-stream';
  }
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end === null) return null;
  if (start === null) {
    const suffixLength = Math.min(size, end);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end };
}

function pruneMediaTokens() {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [token, entry] of mediaTokens) {
    if (entry.lastAccess < cutoff) mediaTokens.delete(token);
  }
}

async function handleMediaRequest(request) {
  try {
    const requestUrl = new URL(request.url);
    const token = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''));
    const entry = mediaTokens.get(token);
    if (!entry || !usbConnection || !isPathInsideRoot(usbConnection.rootPath, entry.filePath)) {
      return new Response('Media source expired.', { status: 404 });
    }
    entry.lastAccess = Date.now();
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        },
      });
    }
    const stat = await fs.stat(entry.filePath);
    const range = parseRange(request.headers.get('range'), stat.size);
    if (range && range.invalid) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` },
      });
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    const contentLength = end - start + 1;
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': String(contentLength),
      'Content-Type': mimeTypeFor(entry.filePath),
    });
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);

    if (request.method === 'HEAD') {
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    const nodeStream = createReadStream(entry.filePath, { start, end });
    return new Response(Readable.toWeb(nodeStream), {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Media stream failed.', { status: 500 });
  }
}

async function selectUsbRoot() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Rekordbox USB Root',
    buttonLabel: 'Connect USB',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true, state: await desktopConnectionState() };
  }

  const rootPath = path.resolve(result.filePaths[0]);
  usbConnection = {
    rootPath,
    volumeName: path.basename(rootPath) || rootPath,
    connectedAt: new Date().toISOString(),
  };
  await persistUsbConnection();
  mediaTokens.clear();
  return { cancelled: false, state: await desktopConnectionState() };
}

function registerIpcHandlers() {
  ipcMain.handle('dropdex:runtime-info', () => ({ platform: process.platform, version: app.getVersion() }));
  ipcMain.handle('dropdex:usb-state', () => desktopConnectionState());
  ipcMain.handle('dropdex:select-usb-root', () => selectUsbRoot());
  ipcMain.handle('dropdex:disconnect-usb', async () => {
    usbConnection = null;
    mediaTokens.clear();
    await persistUsbConnection();
    return desktopConnectionState();
  });
  ipcMain.handle('dropdex:resolve-track-source', async (_event, segments) => {
    pruneMediaTokens();
    const resolved = await resolveUsbTrackPath(segments);
    if (!resolved.ok) return resolved;
    const token = crypto.randomUUID();
    mediaTokens.set(token, { filePath: resolved.filePath, lastAccess: Date.now() });
    return {
      ok: true,
      source: {
        kind: 'url',
        url: `${APP_SCHEME}://track/${encodeURIComponent(token)}`,
        size: resolved.size,
      },
    };
  });
  ipcMain.handle('dropdex:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0a0c',
    title: 'DropDex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? '';
    const currentOrigin = currentUrl ? new URL(currentUrl).origin : '';
    const nextOrigin = new URL(url).origin;
    if (nextOrigin !== currentOrigin && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL || (!app.isPackaged ? 'http://127.0.0.1:3000' : null);
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setName('DropDex');

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.dropdex.desktop');
  await loadUsbConnection();
  protocol.handle(APP_SCHEME, handleMediaRequest);
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
