import React, { useEffect, useState } from 'react';
import { FolderSearch } from 'lucide-react';
import type { PrintObjectItem } from '../types/models';
import { ObjectCard } from './ObjectCard';

interface ObjectGridProps {
  items: PrintObjectItem[];
  isLoading: boolean;
  onSelect: (id: string) => void;
  onQuickSlice: (modelPath: string) => void;
  onSelectFolder: () => void;
  onAutoThumbnailGenerated: (folderPath: string, dataUrl: string) => void;
}

const PAGE_BATCH_SIZE = 60;

/**
 * Full-screen MakerWorld-style Asset Browser grid capable of handling 1,000+ folders smoothly.
 */
export const ObjectGrid: React.FC<ObjectGridProps> = ({
  items,
  isLoading,
  onSelect,
  onQuickSlice,
  onSelectFolder,
  onAutoThumbnailGenerated,
}) => {
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_BATCH_SIZE);

  useEffect(() => {
    setVisibleLimit(PAGE_BATCH_SIZE);
  }, [items.length]);

  if (isLoading) {
    return (
      <main className="browser-main" aria-label="Carregando catálogo 3D">
        <div className="maker-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div
              key={n}
              className="maker-card maker-card-skeleton"
              aria-hidden="true"
            >
              <div className="maker-thumb-box" />
              <div className="maker-card-body">
                <div className="maker-card-title">Escaneando pasta raiz...</div>
                <p className="maker-card-desc">Processando arquivos 3D e descrições...</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main
        className="browser-main browser-empty-state"
      >
        <FolderSearch size={56} color="var(--color-text-muted)" aria-hidden="true" />
        <h2 className="browser-empty-title">Nenhum objeto 3D encontrado nesta raiz</h2>
        <p className="browser-empty-desc">
          Selecione a sua pasta principal de modelos 3D. O aplicativo vai varrer todas as subpastas automaticamente e exibir todos os modelos aqui.
        </p>
        <button type="button" className="btn btn-primary" onClick={onSelectFolder}>
          Selecionar Pasta Raiz 3D
        </button>
      </main>
    );
  }

  const visibleItems = items.slice(0, visibleLimit);

  return (
    <main className="browser-main" aria-label="Galeria de objetos 3D">
      <div className="maker-grid">
        {visibleItems.map((item) => (
          <ObjectCard
            key={item.id}
            item={item}
            onSelect={() => onSelect(item.id)}
            onQuickSlice={onQuickSlice}
            onAutoThumbnailGenerated={onAutoThumbnailGenerated}
          />
        ))}
      </div>

      {items.length > visibleLimit && (
        <div className="browser-pagination">
          <button
            type="button"
            className="btn"
            onClick={() => setVisibleLimit((prev) => prev + PAGE_BATCH_SIZE)}
          >
            Mostrar mais modelos ({items.length - visibleLimit} restantes)
          </button>
        </div>
      )}
    </main>
  );
};
