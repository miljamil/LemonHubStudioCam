// StudioCam desktop wrapper (V2).
// In dev, loads the running web app at http://localhost:5173.
// In production, you would build the web app and load the static files.
const { app, BrowserWindow, desktopCapturer, session } = require('electron');
const path = require('node:path');

const WEB_URL = process.env.STUDIOCAM_WEB_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0d10',
    title: 'Lemon Hub Studio Cam',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadURL(WEB_URL);
}

app.whenReady().then(() => {
  // Allow getDisplayMedia (screen capture) to pick the primary screen automatically.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      cb({ video: sources[0], audio: 'loopback' });
    });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
