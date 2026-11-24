import React from 'react';
import { FolderOpen, RefreshCw, Settings, Box, MessageSquare, Sparkles, Cpu } from 'lucide-react';
import type { AppSettings } from '../types/models';
import type { WorkspaceTabId } from '../types/webTabs';

interface HeaderProps {
  settings: AppSettings;
  searchQuery: string;
  totalCount: number;
  categories: string[];
  activeCategory: string;
  activeWorkspace: WorkspaceTabId;
  onSearchChange: (val: string) => void;
  onSelectCategory: (cat: string) => void;
  onSelectWorkspace: (tab: WorkspaceTabId) => void;
  onSelectFolder: () => void;
  onRefresh: () => void;
  onOpenSlicerModal: () => void;
}

/**
 * Top MakerWorld-style Asset Browser bar with root path info, instant search, and category filter bar.
 */
export const Header: React.FC<HeaderProps> = ({
  settings,
  searchQuery,
  totalCount,
  categories,
  activeCategory,
  activeWorkspace,
  onSearchChange,
  onSelectCategory,
  onSelectWorkspace,
  onSelectFolder,
  onRefresh,
  onOpenSlicerModal,
}) => {
  const activeSlicer = settings.slicers.find((s) => s.id === settings.activeSlicerId);
  const slicerLabel = activeSlicer ? activeSlicer.name : 'Padrão do Windows';

  return (
    <div>
      <header className="top-header">
        <div className="brand-group">
          <div className="brand-logo-row">
            <Box size={26} color="var(--color-primary)" aria-hidden="true" />
            <h1 className="brand-title">MakerView 3D</h1>
            <span
              className="brand-version"
              aria-label={`Versão ${__APP_VERSION__}`}
              title={`Versão atual do aplicativo: v${__APP_VERSION__}`}
            >
              v{__APP_VERSION__}
            </span>
          </div>
          <span className="brand-count">
            {totalCount} {totalCount === 1 ? 'modelo' : 'modelos'}
          </span>
        </div>

        <div className="workspace-tabs-nav" role="tablist" aria-label="Navegação principal">
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'viewer'}
            className="workspace-tab-btn"
            data-active={activeWorkspace === 'viewer'}
            onClick={() => onSelectWorkspace('viewer')}
          >
            <Box size={16} aria-hidden="true" />
            <span>Objetos 3D</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'chat'}
            className="workspace-tab-btn"
            data-active={activeWorkspace === 'chat'}
            onClick={() => onSelectWorkspace('chat')}
          >
            <MessageSquare size={16} aria-hidden="true" />
            <span>Chat</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'gen3d'}
            className="workspace-tab-btn"
            data-active={activeWorkspace === 'gen3d'}
            onClick={() => onSelectWorkspace('gen3d')}
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>3D Generation</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'hi3d'}
            className="workspace-tab-btn"
            data-active={activeWorkspace === 'hi3d'}
            onClick={() => onSelectWorkspace('hi3d')}
          >
            <Cpu size={16} aria-hidden="true" />
            <span>Hi3D Local</span>
          </button>
        </div>

        {activeWorkspace === 'viewer' && (
          <nav className="header-controls" aria-label="Controles do Asset Browser">
            <input
              type="search"
              className="search-input"
              placeholder="Pesquisar entre todos os modelos da pasta raiz..."
              aria-label="Pesquisar objeto 3D"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />

            <button
              type="button"
              className="btn"
              onClick={onSelectFolder}
              title="Selecionar pasta raiz com todos os seus modelos 3D"
            >
              <FolderOpen size={18} aria-hidden="true" />
              <span>Trocar Pasta Raiz</span>
            </button>

            <button type="button" className="btn" onClick={onRefresh} title="Atualizar biblioteca">
              <RefreshCw size={18} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="btn"
              onClick={onOpenSlicerModal}
              title="Configurar Fatiador 1-Click"
            >
              <Settings size={18} aria-hidden="true" />
              <span>{slicerLabel}</span>
            </button>
          </nav>
        )}
      </header>

      {activeWorkspace === 'viewer' && categories.length > 1 && (
        <div className="category-bar" role="tablist" aria-label="Categorias da pasta raiz">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={activeCategory === cat}
              className="category-chip"
              data-active={activeCategory === cat}
              onClick={() => onSelectCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
