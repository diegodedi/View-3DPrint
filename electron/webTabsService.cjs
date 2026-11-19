const { ipcMain, session, WebContentsView } = require('electron');
const {
  DEFAULT_GEN3D_URL,
  TAB_PARTITIONS,
  loadWebTabsConfig,
  saveWebTabsConfig,
  normalizeWebUrl,
  buildChromeUserAgent,
  sanitizeBounds,
} = require('./webTabsConfig.cjs');

const views = new Map();
let activeTabId = null;
let isOverlaySuspended = false;
let lastBounds = { x: 0, y: 0, width: 0, height: 0 };
let getMainWindowRef = () => null;

function emitTabState(tabId, patch) {
  const win = getMainWindowRef();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('webtabs:state-changed', { tabId, ...patch });
}

function buildPopupOptions(partition) {
  return {
    width: 540,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function attachViewEvents(tabId, view, chromeUa) {
  view.webContents.on('did-create-window', (childWin) => {
    childWin.webContents.setUserAgent(chromeUa);
  });
  view.webContents.on('did-start-loading', () => emitTabState(tabId, { isLoading: true }));
  view.webContents.on('did-stop-loading', () => {
    emitTabState(tabId, {
      isLoading: false,
      currentUrl: view.webContents.getURL(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    });
  });
  view.webContents.on('did-navigate', (_e, url) => {
    emitTabState(tabId, {
      currentUrl: url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    });
  });
  view.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    emitTabState(tabId, { isLoading: false, error: `Falha ao carregar (${desc || code})` });
  });
}

function createTabView(tabId) {
  const win = getMainWindowRef();
  if (!win || win.isDestroyed()) return null;

  const partition = TAB_PARTITIONS[tabId];
  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const chromeUa = buildChromeUserAgent(view.webContents.getUserAgent());
  view.webContents.setUserAgent(chromeUa);

  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: buildPopupOptions(partition) };
    } catch {
      return { action: 'deny' };
    }
  });

  attachViewEvents(tabId, view, chromeUa);
  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(tabId, view);
  return view;
}

function hideAllViews() {
  for (const view of views.values()) {
    view.setVisible(false);
  }
}

function applyActiveViewVisibility() {
  hideAllViews();
  if (!activeTabId || isOverlaySuspended) return;
  const view = views.get(activeTabId);
  if (!view || lastBounds.width < 10 || lastBounds.height < 10) return;
  view.setBounds(lastBounds);
  view.setVisible(true);
}

function destroyTabView(tabId) {
  const view = views.get(tabId);
  if (!view) return;
  const win = getMainWindowRef();
  if (win && !win.isDestroyed()) {
    try {
      win.contentView.removeChildView(view);
    } catch {
      // View já desanexada
    }
  }
  try {
    view.webContents.close();
  } catch {
    // WebContents já encerrado
  }
  views.delete(tabId);
  emitTabState(tabId, { isLoaded: false, isLoading: false, currentUrl: '' });
}

function loadUrlInTab(tabId, url, bounds) {
  if (bounds) lastBounds = sanitizeBounds(bounds);
  activeTabId = tabId;
  const view = views.get(tabId) || createTabView(tabId);
  if (view) {
    view.webContents.loadURL(url);
    emitTabState(tabId, { isLoaded: true, isLoading: true, currentUrl: url, error: null });
  }
  applyActiveViewVisibility();
}

/**
 * Registers IPC handlers for embedded Chat and 3D Generation tabs.
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function registerWebTabsIpc(getMainWindow) {
  getMainWindowRef = getMainWindow;

  ipcMain.handle('webtabs:get-config', () => ({
    ...loadWebTabsConfig(),
    defaultGen3dUrl: DEFAULT_GEN3D_URL,
    loadedTabs: Array.from(views.keys()),
  }));

  ipcMain.handle('webtabs:activate', (_e, { tabId, bounds }) => {
    if (bounds) lastBounds = sanitizeBounds(bounds);
    if (!tabId || !TAB_PARTITIONS[tabId]) {
      activeTabId = null;
      hideAllViews();
      return { activeTabId: null };
    }

    activeTabId = tabId;
    const config = loadWebTabsConfig();
    const targetUrl = tabId === 'chat' ? config.chatUrl : config.gen3dUrl;
    if (!targetUrl) {
      hideAllViews();
      return { activeTabId, needsSelection: true };
    }

    if (!views.has(tabId)) {
      loadUrlInTab(tabId, targetUrl, bounds);
    } else {
      applyActiveViewVisibility();
    }
    const view = views.get(tabId);
    return { activeTabId, needsSelection: false, currentUrl: view?.webContents.getURL() || targetUrl };
  });

  ipcMain.handle('webtabs:set-bounds', (_e, { bounds }) => {
    lastBounds = sanitizeBounds(bounds);
    applyActiveViewVisibility();
    return true;
  });

  ipcMain.handle('webtabs:set-suspended', (_e, { suspended }) => {
    isOverlaySuspended = Boolean(suspended);
    applyActiveViewVisibility();
    return true;
  });

  ipcMain.handle('webtabs:set-url', (_e, { tabId, url, bounds }) => {
    if (!TAB_PARTITIONS[tabId]) throw new Error('Aba inválida.');
    const normalized = normalizeWebUrl(url);
    const config = saveWebTabsConfig(tabId === 'chat' ? { chatUrl: normalized } : { gen3dUrl: normalized });
    loadUrlInTab(tabId, normalized, bounds);
    return { config, currentUrl: normalized };
  });

  ipcMain.handle('webtabs:reset-gen3d', (_e, { bounds }) => {
    const config = saveWebTabsConfig({ gen3dUrl: DEFAULT_GEN3D_URL });
    loadUrlInTab('gen3d', DEFAULT_GEN3D_URL, bounds);
    return { config, currentUrl: DEFAULT_GEN3D_URL };
  });

  ipcMain.handle('webtabs:logout-chat', async (_e, { clearSession }) => {
    destroyTabView('chat');
    if (clearSession) {
      const tabSession = session.fromPartition(TAB_PARTITIONS.chat);
      await tabSession.clearStorageData();
      await tabSession.clearCache();
    }
    const config = saveWebTabsConfig({ chatUrl: null });
    hideAllViews();
    return { config };
  });

  ipcMain.handle('webtabs:reload', (_e, { tabId }) => {
    const view = views.get(tabId);
    if (view) view.webContents.reload();
    return Boolean(view);
  });

  ipcMain.handle('webtabs:navigate-history', (_e, { tabId, direction }) => {
    const view = views.get(tabId);
    if (!view) return false;
    const history = view.webContents.navigationHistory;
    if (direction === 'back' && history.canGoBack()) {
      history.goBack();
      return true;
    }
    if (direction === 'forward' && history.canGoForward()) {
      history.goForward();
      return true;
    }
    return false;
  });

  ipcMain.handle('webtabs:close-view', (_e, { tabId }) => {
    destroyTabView(tabId);
    return true;
  });
}

module.exports = { registerWebTabsIpc };
