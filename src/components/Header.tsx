import React from 'react';
import { FolderOpen, RefreshCw, Settings, Box } from 'lucide-react';
import type { AppSettings } from '../types/models';

interface HeaderProps {
  settings: AppSettings;
  searchQuery: string;
  totalCount: number;
  categories: string[];
  activeCategory: string;
  onSearchChange: (val: string) => void;
  onSelectCategory: (cat: string) => void;
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
  onSearchChange,
  onSelectCategory,
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
          <Box size={26} color="var(--color-primary)" aria-hidden="true" />
          <h1 className="brand-title">MakerView 3D</h1>
          <span className="folder-badge" title={settings.libraryPath}>
            Raiz: {settings.libraryPath} ({totalCount} modelos)
          </span>
        </div>

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
      </header>

      {categories.length > 1 && (
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
