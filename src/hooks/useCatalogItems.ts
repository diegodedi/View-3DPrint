import { useState, useMemo, useCallback } from 'react';
import type { PrintObjectItem } from '../types/models';

/**
 * Hook modular que gerencia a lista de arquivos 3D, busca, categorias e metadados de itens.
 */
export function useCatalogItems() {
  const [items, setItems] = useState<PrintObjectItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('Todas');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const categories = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((item) => {
      if (item.category && item.category !== 'Geral') unique.add(item.category);
    });
    return ['Todas', ...Array.from(unique).sort((a, b) => a.localeCompare(b, 'pt-BR'))];
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (activeCategory !== 'Todas' && item.category !== activeCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.relativeFolder.toLowerCase().includes(q) ||
        item.notes.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, activeCategory]);

  const updateItemMetadata = useCallback(
    async (folderPath: string, payload: { notes?: string; customThumbnail?: string }) => {
      if (!window.electronAPI) return;
      const updatedMeta = await window.electronAPI.saveObjectMetadata(folderPath, payload);
      setItems((prev) =>
        prev.map((item) =>
          item.folderPath === folderPath
            ? {
                ...item,
                notes: updatedMeta.notes,
                thumbnailPath: updatedMeta.customThumbnail || item.thumbnailPath,
              }
            : item
        )
      );
    },
    []
  );

  const clearNotifications = useCallback(() => {
    setErrorMessage(null);
    setStatusMessage(null);
  }, []);

  return {
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
    clearNotifications,
  };
}

