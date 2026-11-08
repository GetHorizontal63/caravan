// Caravan desktop shell: remembers a server address and shows that server's web UI
// in a dedicated window (like Jellyfin Media Player), with native menus and full screen.
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const configFile = () => path.join(app.getPath('userData'), 'config.json')
const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')) } catch { return {} } }
const writeConfig = c => fs.writeFileSync(configFile(), JSON.stringify(c, null, 2))

let win

function showConnect() {
  win.loadFile(path.join(__dirname, 'connect.html'))
}

function showServer(url) {
  win.loadURL(url).catch(() => showConnect())
}

function createWindow() {
  const cfg = readConfig()
  win = new BrowserWindow({
    width: cfg.bounds?.width ?? 1280,
    height: cfg.bounds?.height ?? 860,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#101218',
    title: 'Caravan',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  win.on('close', () => writeConfig({ ...readConfig(), bounds: win.getBounds() }))
  // keep the reader in-app; open everything else (external links in books) in the browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('did-fail-load', (_e, code) => { if (code !== -3) showConnect() })

  if (cfg.server) showServer(cfg.server)
  else showConnect()

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Caravan', submenu: [
      { label: 'Change server…', click: showConnect },
      { role: 'reload' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' }] },
  ]))
}

ipcMain.handle('connect', async (_e, url) => {
  const res = await fetch(url.replace(/\/+$/, '') + '/api/system/info', { signal: AbortSignal.timeout(8000) }).catch(() => null)
  const info = res && res.ok ? await res.json().catch(() => null) : null
  if (info?.name !== 'Caravan' && info?.name !== 'JellyReader') return { ok: false, error: 'No Caravan server found at that address.' }
  const server = url.replace(/\/+$/, '')
  writeConfig({ ...readConfig(), server })
  showServer(server)
  return { ok: true }
})
ipcMain.handle('current-server', () => readConfig().server ?? '')

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
