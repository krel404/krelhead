import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, safeStorage } from 'electron';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accounts, defaultInstallations, foreverRoot, installAddon } from './files.mjs';
import { SyncSession } from './sync.mjs';
import { validateConnection, verifyConnection, readSnapshotFile, uploadSnapshot } from './lib/tome-uploader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(join(here, 'index.html')).href;
app.setName('Tome Companion');
app.setAppUserModelId('com.krelhead.tome-companion');
let window, tray, settings, session, draft = {}, quitting = false, setupBusy = false;
let startupWarning = '', loadWarning = '';
export let ready = Promise.resolve();
const settingsPath = () => join(app.getPath('userData'), 'connection.json');
const loginOptions = () => process.platform === 'win32' ? { path: process.execPath, args: ['--background'] } : {};

async function saveSettings() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Your operating system’s secure storage is unavailable. Unlock your account and try again.');
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(settings));
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, encrypted, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

async function readSettings() {
  try {
    if ((await stat(settingsPath())).size > 32_000) throw new Error('Invalid settings');
    const decoded = await safeStorage.decryptStringAsync(await readFile(settingsPath()));
    const data = JSON.parse(decoded.result);
    if (typeof data.root !== 'string' || typeof data.account !== 'string' || typeof data.paused !== 'boolean') throw new Error('Invalid settings');
    data.connection = validateConnection(data.connection);
    settings = data;
    if (decoded.shouldReEncrypt) await saveSettings();
  } catch (error) {
    if (error.code !== 'ENOENT') loadWarning = 'Could not unlock the saved connection. Import your Discord connection file again.';
  }
}

function restartSession() {
  session?.stop(); session = undefined;
  if (settings && !settings.paused) {
    session = new SyncSession(settings, { read: readSnapshotFile, upload: uploadSnapshot });
    void session.tick();
  }
}

function configureStartup(enabled) {
  startupWarning = '';
  if (!app.isPackaged) { startupWarning = 'Start at login is available in the installed app.'; return; }
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginOptions() });
  const result = app.getLoginItemSettings(loginOptions());
  if (enabled && (!result.openAtLogin || result.status === 'requires-approval' || result.executableWillLaunchAtLogin === false)) {
    startupWarning = 'Allow Tome Companion in your system’s Login Items / Startup Apps settings so uploads resume after a restart.';
  }
}

async function state() {
  return {
    root: draft.root || '', accounts: draft.root ? await accounts(draft.root).catch(() => []) : [],
    account: draft.account || '', connected: Boolean(draft.connection),
    server: draft.server || '', endpointHost: draft.connection ? new URL(draft.connection.endpoint).host : '',
    configured: Boolean(settings), paused: settings?.paused ?? false,
    openAtLogin: settings?.openAtLogin ?? true,
    message: loadWarning || (settings?.paused ? 'Uploads paused. Resume whenever you’re ready.' : session?.state.message) || 'Choose your game folder and link Discord to get started.',
    lastSyncedAt: session?.state.lastSyncedAt ?? null, characters: session?.state.characters ?? 0,
    needsRelink: session?.state.needsRelink ?? false, startupWarning,
  };
}

function showWindow() {
  if (!window) {
    window = new BrowserWindow({ width: 640, height: 850, minWidth: 540, minHeight: 700, show: false,
      title: 'Tome Companion', backgroundColor: '#111019', icon: join(here, 'resources/book.png'),
      webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    void window.loadFile(join(here, 'index.html'));
  }
  window.show(); window.focus();
}

function handle(name, action) {
  ipcMain.handle(name, async (event, value) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('Untrusted caller');
    if (name !== 'tome:state' && setupBusy) return { error: 'Finish the current setup step first.' };
    if (name !== 'tome:state') setupBusy = true;
    try { return { state: await action(value) }; }
    catch (error) {
      // Only application-authored messages; never send raw OS/network errors or token-bearing data to the renderer.
      const known = ['Choose ', 'Import ', 'Your operating', 'The addon', 'This account', 'Connection file', 'Use an HTTPS', 'Invalid uploader'];
      return { error: known.some(prefix => error.message?.startsWith(prefix)) ? error.message : 'Could not complete this step. Check folder access and try again.' };
    } finally { if (name !== 'tome:state') setupBusy = false; }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('before-quit', () => { quitting = true; session?.stop(); });
  app.on('window-all-closed', () => {});
  ready = app.whenReady().then(async () => {
  await readSettings();
  draft = settings ? { ...settings } : { root: (await defaultInstallations())[0] };

  handle('tome:state', state);
  handle('tome:folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose World of Warcraft', properties: ['openDirectory'] });
    if (!result.canceled) { draft.root = await foreverRoot(result.filePaths[0]); draft.account = undefined; }
    return state();
  });
  handle('tome:connect', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open the connection file from /character connect', filters: [{ name: 'Tome connection', extensions: ['json'] }], properties: ['openFile'] });
    if (!result.canceled) {
      const file = result.filePaths[0];
      if ((await stat(file)).size > 16_000) throw new Error('Connection file is too large. Download a new one using /character connect.');
      const data = JSON.parse(await readFile(file, 'utf8'));
      const connection = validateConnection(data);
      try { await verifyConnection(connection); }
      catch { throw new Error('Connection file could not be verified. Check that Tome is online and download a new file using /character connect.'); }
      draft.connection = connection;
      draft.server = typeof data.server === 'string' ? data.server.slice(0, 100) : '';
    }
    return state();
  });
  handle('tome:start', async value => {
    if (!draft.connection) throw new Error('Import your Discord connection file first.');
    if (!draft.root) throw new Error('Choose your World of Warcraft folder first.');
    if (typeof value?.account !== 'string' || !(await accounts(draft.root)).includes(value.account)) throw new Error('Choose your WoW account. Log in to WoW once if no accounts appear.');
    if (typeof value.openAtLogin !== 'boolean') throw new Error('Invalid settings');
    const next = { root: await foreverRoot(draft.root), account: value.account, connection: draft.connection,
      server: draft.server || '', openAtLogin: value.openAtLogin, paused: false };
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Your operating system’s secure storage is unavailable. Unlock your account and try again.');
    await installAddon(next.root, join(here, 'resources/TomeSnapshot'));
    const previous = settings; settings = next;
    try { await saveSettings(); } catch (error) { settings = previous; throw error; }
    draft = { ...settings }; loadWarning = '';
    try { configureStartup(settings.openAtLogin); } catch { startupWarning = 'Could not enable startup. Add Tome Companion to your system’s Login Items / Startup Apps.'; }
    restartSession();
    return state();
  });
  handle('tome:pause', async () => {
    if (!settings) return state();
    const previous = settings.paused;
    settings.paused = !previous;
    try { await saveSettings(); } catch (error) { settings.paused = previous; throw error; }
    restartSession(); return state();
  });
  handle('tome:disconnect', async () => {
    session?.stop(); session = undefined;
    await rm(settingsPath(), { force: true });
    settings = undefined; draft.connection = undefined; draft.server = ''; loadWarning = '';
    try { configureStartup(false); } catch { startupWarning = 'Remove Tome Companion from Login Items / Startup Apps in your system settings.'; }
    return state();
  });

  if (process.platform !== 'darwin') {
    const icon = nativeImage.createFromPath(join(here, 'resources/book.png')).resize({ width: 20, height: 20 });
    tray = new Tray(icon); tray.setToolTip('Tome Companion');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Tome Companion', click: showWindow }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
    tray.on('click', showWindow);
  }
  restartSession();
  setInterval(() => { void session?.tick(); }, 5000);
  const background = process.argv.includes('--background') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!background || !settings) showWindow();
  });
  void ready.catch(() => { dialog.showErrorBox('Tome Companion', 'Could not start the companion. Close it and try again.'); app.quit(); });
}
