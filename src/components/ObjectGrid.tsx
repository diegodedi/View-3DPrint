import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const MIN_CARD_WIDTH = 250;
const GRID_GAP = 16;
const DEFAULT_ROW_HEIGHT = 315;
const OVERSCAN_ROWS = 2;

/**
 * Virtualized MakerWorld-style Asset Browser grid capable of handling thousands of folders smoothly.
 */
export const ObjectGrid: React.FC<ObjectGridProps> = ({
  items,
  isLoading,
  onSelect,
  onQuickSlice,
  onSelectFolder,
  onAutoThumbnailGenerated,
}) => {
  const mainRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(720);
  const [columns, setColumns] = useState<number>(4);
  const [rowHeight, setRowHeight] = useState<number>(DEFAULT_ROW_HEIGHT);

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
    setScrollTop(0);
  }, [items]);

  useLayoutEffect(() => {
    const container = mainRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return;

    const measureLayout = () => {
      const gridWidth = grid.clientWidth;
      if (gridWidth > 0) {
        const nextCols = Math.max(1, Math.floor((gridWidth + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP)));
        setColumns((prev) => (prev === nextCols ? prev : nextCols));
      }
      setViewportHeight(container.clientHeight || 720);
      const firstCard = grid.firstElementChild as HTMLElement | null;
      if (firstCard) {
        const cardH = Math.round(firstCard.getBoundingClientRect().height);
        if (cardH > 120) {
          const nextRowH = cardH + GRID_GAP;
          setRowHeight((prev) => (Math.abs(prev - nextRowH) <= 1 ? prev : nextRowH));
        }
      }
    };

    measureLayout();
    const ro = new ResizeObserver(measureLayout);
    ro.observe(container);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [items.length]);

  const totalRows = Math.ceil(items.length / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS);
  const startIdx = startRow * columns;
  const endIdx = Math.min(items.length, endRow * columns);
  const visibleItems = items.slice(startIdx, endIdx);

  const paddingTop = startRow * rowHeight;
  const paddingBottom = Math.max(0, (totalRows - endRow) * rowHeight);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.style.setProperty('--grid-pad-top', `${paddingTop}px`);
    grid.style.setProperty('--grid-pad-bottom', `${paddingBottom}px`);
  }, [paddingTop, paddingBottom, isLoading, items.length]);

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  if (isLoading) {
    return (
      <main className="browser-main" aria-label="Carregando catálogo 3D">
        <div className="maker-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div key={n} className="maker-card maker-card-skeleton" aria-hidden="true">
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
      <main className="browser-main browser-empty-state">
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

  return (
    <main
      ref={mainRef}
      className="browser-main"
      aria-label="Galeria de objetos 3D"
      onScroll={handleScroll}
    >
      <div
        ref={gridRef}
        className="maker-grid"
      >
        {visibleItems.map((item) => (
          <ObjectCard
            key={item.id}
            item={item}
            onSelect={onSelect}
            onQuickSlice={onQuickSlice}
            onAutoThumbnailGenerated={onAutoThumbnailGenerated}
          />
        ))}
      </div>
    </main>
  );
};
