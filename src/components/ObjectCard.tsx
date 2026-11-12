import React, { useEffect, useRef, useState } from 'react';
import { Play, Layers, Cuboid, FolderOpen } from 'lucide-react';
import type { PrintObjectItem } from '../types/models';
import { formatFileSize } from '../utils/formatters';
import { renderBufferToThumbnailDataUrl } from '../utils/threeHelpers';
import { enqueueThumbnailJob } from '../utils/thumbnailQueue';

interface ObjectCardProps {
  item: PrintObjectItem;
  onSelect: () => void;
  onQuickSlice: (modelPath: string) => void;
  onAutoThumbnailGenerated: (folderPath: string, dataUrl: string) => void;
}

/**
 * MakerWorld-style asset card with lazy viewport intersection and queued MatCap 3D thumbnail rendering.
 */
const ObjectCardComponent: React.FC<ObjectCardProps> = ({
  item,
  onSelect,
  onQuickSlice,
  onAutoThumbnailGenerated,
}) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const primaryModel = item.models[0];

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let active = true;

    async function loadOrGenerateThumb() {
      if (!window.electronAPI) return;

      if (item.thumbnailPath) {
        if (!thumbDataUrl) {
          const existingUrl = await window.electronAPI.readImageDataUrl(item.thumbnailPath);
          if (active && existingUrl) {
            setThumbDataUrl(existingUrl);
          }
        }
        return;
      }

      if (!primaryModel) return;
      try {
        setIsGenerating(true);
        const generatedUrl = await enqueueThumbnailJob(async () => {
          if (!active || !window.electronAPI) return '';
          const buffer = await window.electronAPI.readModelBuffer(primaryModel.path);
          if (!active) return '';
          return renderBufferToThumbnailDataUrl(buffer, primaryModel.extension);
        });

        if (active && generatedUrl) {
          setThumbDataUrl(generatedUrl);
          onAutoThumbnailGenerated(item.folderPath, generatedUrl);
        }
      } catch {
        if (active) setThumbDataUrl(null);
      } finally {
        if (active) setIsGenerating(false);
      }
    }

    loadOrGenerateThumb();
    return () => {
      active = false;
    };
  }, [isVisible, item.thumbnailPath, item.folderPath, primaryModel, onAutoThumbnailGenerated]);

  return (
    <article
      ref={cardRef}
      className="maker-card"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`Inspecionar objeto 3D ${item.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="maker-thumb-box">
        {thumbDataUrl ? (
          <img
            src={thumbDataUrl}
            alt={`Visualização 3D de ${item.name}`}
            className="maker-thumb-img"
            loading="lazy"
            decoding="async"
            width={280}
            height={185}
          />
        ) : (
          <div className="maker-thumb-empty">
            <Cuboid size={36} color="var(--color-text-muted)" />
            <span className="maker-thumb-hint">
              {isGenerating ? 'Renderizando MatCap...' : 'Aguardando fila...'}
            </span>
          </div>
        )}

        <span className="maker-badge-top">
          <Layers size={11} className="maker-model-icon" />
          {item.models.length} {item.models.length === 1 ? 'peça' : 'peças'}
        </span>

        <span className="maker-badge-ext">{primaryModel.extension}</span>
      </div>

      <div className="maker-card-body">
        <h3 className="maker-card-title" title={item.name}>
          {item.name}
        </h3>

        <p className="maker-card-desc" title={item.description}>
          {item.description}
        </p>

        <div className="maker-card-footer">
          <button
            type="button"
            className="btn btn-card-action"
            onClick={(e) => {
              e.stopPropagation();
              window.electronAPI?.openFolderInExplorer(item.folderPath);
            }}
            title={`Abrir pasta: ${item.relativeFolder}`}
            aria-label="Abrir pasta no Windows Explorer"
          >
            <FolderOpen size={15} />
          </button>

          <span className="maker-tag-text">
            {formatFileSize(primaryModel.sizeBytes)}
          </span>

          <button
            type="button"
            className="btn btn-primary btn-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onQuickSlice(primaryModel.path);
            }}
            title={`Abrir ${primaryModel.name} direto no fatiador`}
          >
            <Play size={13} fill="currentColor" />
            <span>Fatiar</span>
          </button>
        </div>
      </div>
    </article>
  );
};

export const ObjectCard = React.memo(ObjectCardComponent);
