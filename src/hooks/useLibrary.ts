import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AppSettings, PrintObjectItem } from '../types/models';
import { clearThumbnailQueue } from '../utils/thumbnailQueue';
import { useSlicerSettings } from './useSlicerSettings';
import { useCatalogItems } from './useCatalogItems';

const ELECTRON_REQUIRED_MESSAGE =
  'API do Electron não detectada. Abra pela janela do aplicativo (npm run dev ou INICIAR_APP.bat) — no navegador comum o acesso às pastas locais fica bloqueado.';

/**
 * Orquestrador principal da biblioteca 3D: coordena catálogo, seleção e fatiamento.
 */
export function useLibrary() {
  const {
    items,
    setItems,
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    isLoading,
    setIsLoading,
    errorMessage,
    setErrorMessage,
    statusMessage,
    setStatusMessage,
    categories,
    filteredItems,
    updateItemMetadata,
    registerAutoThumbnailPath,
    clearNotifications,
  } = useCatalogItems();

  const {
    settings,
    crealityCatalog,
    setSettings,
    hydrateInitialCatalog,
    updateSettings,
    launchInSlicer,
    launchConfiguredInSlicer,
  } = useSlicerSettings(setStatusMessage, setErrorMessage);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedModelIndex, setSelectedModelIndex] = useState<number>(0);

  const applyLoadedData = useCallback(
    (loadedSettings: AppSettings, loadedItems: PrintObjectItem[], loadedCatalog?: typeof crealityCatalog) => {
      clearThumbnailQueue();
      if (loadedCatalog) {
        hydrateInitialCatalog(loadedSettings, loadedCatalog);
      }
      setSettings(loadedSettings);
      setItems(loadedItems);
      setActiveCategory('Todas');
      setSelectedId(null);
      setSelectedModelIndex(0);
    },
    [setSettings, hydrateInitialCatalog, setItems, setActiveCategory]
  );

  useEffect(() => {
    let isMounted = true;
    async function init() {
      if (!window.electronAPI) {
        setIsLoading(false);
        setErrorMessage(ELECTRON_REQUIRED_MESSAGE);
        return;
      }
      try {
        setIsLoading(true);
        const res = await window.electronAPI.getInitialState();
        if (isMounted) {
          applyLoadedData(res.settings, res.items, res.crealityCatalog);
          setErrorMessage(null);
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage((err as Error).message || 'Falha ao carregar biblioteca 3D.');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    init();
    return () => {
      isMounted = false;
    };
  }, [applyLoadedData, setIsLoading, setErrorMessage]);

  const chooseFolder = useCallback(async () => {
    if (!window.electronAPI) {
      setErrorMessage(ELECTRON_REQUIRED_MESSAGE);
      return;
    }
    try {
      setIsLoading(true);
      const res = await window.electronAPI.selectLibraryFolder();
      if (res) {
        applyLoadedData(res.settings, res.items);
        setStatusMessage(`Raiz carregada: ${res.items.length} objeto(s) 3D encontrados.`);
      }
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [applyLoadedData, setIsLoading, setStatusMessage, setErrorMessage]);

  const refreshLibrary = useCallback(async () => {
    if (!window.electronAPI) {
      setErrorMessage(ELECTRON_REQUIRED_MESSAGE);
      return;
    }
    try {
      setIsLoading(true);
      const res = await window.electronAPI.rescanLibrary(settings.libraryPath);
      applyLoadedData(res.settings, res.items);
      setStatusMessage('Catálogo atualizado com sucesso.');
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [applyLoadedData, settings.libraryPath, setIsLoading, setStatusMessage, setErrorMessage]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  return {
    settings,
    crealityCatalog,
    items: filteredItems,
    totalRootCount: items.length,
    categories,
    activeCategory,
    selectedItem,
    selectedModelIndex,
    searchQuery,
    isLoading,
    errorMessage,
    statusMessage,
    setSearchQuery,
    setActiveCategory,
    setSelectedId: (id: string | null) => {
      setSelectedId(id);
      setSelectedModelIndex(0);
    },
    setSelectedModelIndex,
    clearNotifications,
    chooseFolder,
    refreshLibrary,
    launchInSlicer,
    launchConfiguredInSlicer,
    updateSettings,
    saveNotesAndThumb: updateItemMetadata,
    registerAutoThumbnailPath,
  };
}
