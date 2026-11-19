import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DEFAULT_GEN3D_URL,
  type ExternalWebTabId,
  type WebTabBounds,
  type WebTabRuntimeState,
  type WebTabsConfig,
} from '../types/webTabs';

const EMPTY_TAB_STATE: WebTabRuntimeState = {
  isLoaded: false,
  isLoading: false,
  currentUrl: '',
  canGoBack: false,
  canGoForward: false,
  error: null,
};

function readElementBounds(el: HTMLDivElement | null): WebTabBounds {
  if (!el) return { x: 0, y: 0, width: 0, height: 0 };
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Manages Electron WebContentsView lifecycle, bounds sync, and persisted URLs for Chat & 3D Generation tabs.
 */
export function useWebTabs(
  activeTab: ExternalWebTabId | null,
  isSuspended: boolean,
  viewportRef: React.RefObject<HTMLDivElement>
) {
  const api = window.electronAPI?.webTabs;
  const [config, setConfig] = useState<WebTabsConfig>({
    chatUrl: null,
    gen3dUrl: DEFAULT_GEN3D_URL,
    defaultGen3dUrl: DEFAULT_GEN3D_URL,
    loadedTabs: [],
  });
  const [tabStates, setTabStates] = useState<Record<ExternalWebTabId, WebTabRuntimeState>>({
    chat: { ...EMPTY_TAB_STATE },
    gen3d: { ...EMPTY_TAB_STATE },
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConfigReady, setIsConfigReady] = useState<boolean>(false);
  const activeTabRef = useRef<ExternalWebTabId | null>(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    if (!api) {
      setIsConfigReady(true);
      return;
    }
    api.getConfig().then((loaded) => {
      setConfig(loaded);
      setIsConfigReady(true);
    }).catch(() => setIsConfigReady(true));

    return api.onStateChanged((evt) => {
      setTabStates((prev) => ({
        ...prev,
        [evt.tabId]: {
          ...prev[evt.tabId],
          isLoaded: evt.isLoaded ?? prev[evt.tabId].isLoaded,
          isLoading: evt.isLoading ?? prev[evt.tabId].isLoading,
          currentUrl: evt.currentUrl ?? prev[evt.tabId].currentUrl,
          canGoBack: evt.canGoBack ?? prev[evt.tabId].canGoBack,
          canGoForward: evt.canGoForward ?? prev[evt.tabId].canGoForward,
          error: evt.error !== undefined ? evt.error : prev[evt.tabId].error,
        },
      }));
    });
  }, [api]);

  useEffect(() => {
    if (!api) return;
    api.setSuspended(isSuspended).catch(() => {});
  }, [api, isSuspended]);

  useEffect(() => {
    if (!api || !isConfigReady) return;
    if (!activeTab) {
      api.activate(null).catch(() => {});
      return;
    }
    const bounds = readElementBounds(viewportRef.current);
    api.activate(activeTab, bounds).then((res) => {
      if (!res.needsSelection && res.currentUrl) {
        setTabStates((prev) => ({
          ...prev,
          [activeTab]: { ...prev[activeTab], isLoaded: true, currentUrl: res.currentUrl || prev[activeTab].currentUrl },
        }));
      }
    }).catch(() => {});
  }, [api, activeTab, isConfigReady, viewportRef]);

  useEffect(() => {
    if (!api || !activeTab) return;
    const el = viewportRef.current;
    if (!el) return;

    const syncBounds = () => {
      if (!activeTabRef.current) return;
      api.setBounds(readElementBounds(el)).catch(() => {});
    };
    const observer = new ResizeObserver(syncBounds);
    observer.observe(el);
    window.addEventListener('resize', syncBounds);
    syncBounds();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [api, activeTab, viewportRef]);

  const setTabUrl = useCallback(async (tabId: ExternalWebTabId, url: string) => {
    if (!api) return false;
    setActionError(null);
    try {
      const bounds = readElementBounds(viewportRef.current);
      const res = await api.setUrl(tabId, url, bounds);
      setConfig((prev) => ({ ...prev, ...res.config }));
      setTabStates((prev) => ({
        ...prev,
        [tabId]: { ...prev[tabId], isLoaded: true, currentUrl: res.currentUrl, error: null },
      }));
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Endereço inválido.');
      return false;
    }
  }, [api, viewportRef]);

  const resetGen3dDefault = useCallback(async () => {
    if (!api) return;
    setActionError(null);
    const bounds = readElementBounds(viewportRef.current);
    const res = await api.resetGen3d(bounds);
    setConfig((prev) => ({ ...prev, ...res.config }));
    setTabStates((prev) => ({
      ...prev,
      gen3d: { ...prev.gen3d, isLoaded: true, currentUrl: res.currentUrl, error: null },
    }));
  }, [api, viewportRef]);

  const logoutChat = useCallback(async (clearSession: boolean) => {
    if (!api) return;
    setActionError(null);
    const res = await api.logoutChat(clearSession);
    setConfig((prev) => ({ ...prev, ...res.config }));
    setTabStates((prev) => ({ ...prev, chat: { ...EMPTY_TAB_STATE } }));
  }, [api]);

  const reloadTab = useCallback((tabId: ExternalWebTabId) => {
    api?.reload(tabId).catch(() => {});
  }, [api]);

  const navigateHistory = useCallback((tabId: ExternalWebTabId, direction: 'back' | 'forward') => {
    api?.navigateHistory(tabId, direction).catch(() => {});
  }, [api]);

  const closeTabView = useCallback(async (tabId: ExternalWebTabId) => {
    if (!api) return;
    await api.closeView(tabId);
    setTabStates((prev) => ({ ...prev, [tabId]: { ...EMPTY_TAB_STATE } }));
  }, [api]);

  const reopenTabView = useCallback(async (tabId: ExternalWebTabId) => {
    if (!api) return;
    const bounds = readElementBounds(viewportRef.current);
    const res = await api.activate(tabId, bounds);
    if (!res.needsSelection) {
      setTabStates((prev) => ({
        ...prev,
        [tabId]: { ...prev[tabId], isLoaded: true, currentUrl: res.currentUrl || prev[tabId].currentUrl },
      }));
    }
  }, [api, viewportRef]);

  return {
    hasElectronWebTabs: Boolean(api),
    config,
    tabStates,
    actionError,
    clearActionError: () => setActionError(null),
    setTabUrl,
    resetGen3dDefault,
    logoutChat,
    reloadTab,
    navigateHistory,
    closeTabView,
    reopenTabView,
  };
}
