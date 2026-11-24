import React, { Suspense, useState, useCallback } from 'react';
import { useLibrary } from './hooks/useLibrary';
import { Header } from './components/Header';
import { ObjectGrid } from './components/ObjectGrid';
import { WebTabWorkspace } from './components/WebTabs/WebTabWorkspace';
import type { WorkspaceTabId } from './types/webTabs';

const DetailsPanel = React.lazy(() =>
  import('./components/DetailsPanel').then((m) => ({ default: m.DetailsPanel }))
);
const SlicerModal = React.lazy(() =>
  import('./components/SlicerModal').then((m) => ({ default: m.SlicerModal }))
);
const Hi3dWorkspace = React.lazy(() =>
  import('./components/Hi3D/Hi3dWorkspace').then((m) => ({ default: m.Hi3dWorkspace }))
);

/**
 * Root MakerWorld-style 3D Asset Browser displaying the entire root directory in a visual card grid.
 */
export const App: React.FC = () => {
  const {
    settings,
    crealityCatalog,
    items,
    totalRootCount,
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
    setSelectedId,
    setSelectedModelIndex,
    clearNotifications,
    chooseFolder,
    refreshLibrary,
    launchInSlicer,
    launchConfiguredInSlicer,
    updateSettings,
    saveNotesAndThumb,
    registerAutoThumbnailPath,
  } = useLibrary();

  const [isSlicerModalOpen, setIsSlicerModalOpen] = useState<boolean>(false);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceTabId>('viewer');

  const handleCaptureThumbnail = useCallback(
    (dataUrl: string) => {
      if (!selectedItem) return;
      saveNotesAndThumb(selectedItem.folderPath, { customThumbnail: dataUrl });
    },
    [selectedItem, saveNotesAndThumb]
  );

  const handleAutoThumbnailGenerated = useCallback(
    (folderPath: string, thumbnailPath: string) => {
      registerAutoThumbnailPath(folderPath, thumbnailPath);
    },
    [registerAutoThumbnailPath]
  );

  const handleSaveNotes = useCallback(
    (folderPath: string, notes: string) => {
      saveNotesAndThumb(folderPath, { notes });
    },
    [saveNotesAndThumb]
  );

  return (
    <div className="app-shell">
      <Header
        settings={settings}
        searchQuery={searchQuery}
        totalCount={totalRootCount}
        categories={categories}
        activeCategory={activeCategory}
        activeWorkspace={activeWorkspace}
        onSearchChange={setSearchQuery}
        onSelectCategory={setActiveCategory}
        onSelectWorkspace={setActiveWorkspace}
        onSelectFolder={chooseFolder}
        onRefresh={refreshLibrary}
        onOpenSlicerModal={() => setIsSlicerModalOpen(true)}
      />

      {(errorMessage || statusMessage) && (
        <div
          className={`status-banner ${errorMessage ? 'status-banner-error' : 'status-banner-success'}`}
          role="status"
        >
          <span>{errorMessage || statusMessage}</span>
          <button
            type="button"
            className="btn btn-close-banner"
            onClick={clearNotifications}
          >
            Fechar
          </button>
        </div>
      )}

      <div className={activeWorkspace === 'viewer' ? 'workspace-viewer-pane' : 'workspace-hidden'}>
        <ObjectGrid
          items={items}
          isLoading={isLoading}
          onSelect={setSelectedId}
          onQuickSlice={launchInSlicer}
          onSelectFolder={chooseFolder}
          onAutoThumbnailGenerated={handleAutoThumbnailGenerated}
        />
      </div>

      <WebTabWorkspace
        activeTab={activeWorkspace === 'chat' || activeWorkspace === 'gen3d' ? activeWorkspace : null}
        isSuspended={isSlicerModalOpen || Boolean(selectedItem)}
      />

      {activeWorkspace === 'hi3d' && (
        <Suspense fallback={null}>
          <Hi3dWorkspace
            onModelGenerated={refreshLibrary}
            onOpenLibrary={() => setActiveWorkspace('viewer')}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        {selectedItem && (
          <DetailsPanel
            item={selectedItem}
            selectedModelIndex={selectedModelIndex}
            settings={settings}
            crealityCatalog={crealityCatalog}
            onSelectModelIndex={setSelectedModelIndex}
            onOpenInSlicer={launchInSlicer}
            onOpenConfiguredInSlicer={launchConfiguredInSlicer}
            onUpdateSettings={updateSettings}
            onSaveNotes={handleSaveNotes}
            onCaptureThumbnail={handleCaptureThumbnail}
            onRefreshLibrary={refreshLibrary}
            onClose={() => setSelectedId(null)}
          />
        )}

        {isSlicerModalOpen && (
          <SlicerModal
            isOpen={isSlicerModalOpen}
            settings={settings}
            crealityCatalog={crealityCatalog}
            onClose={() => setIsSlicerModalOpen(false)}
            onSaveSettings={updateSettings}
          />
        )}
      </Suspense>
    </div>
  );
};
