import React, { useEffect, useRef, useState } from 'react';
import { Play, Layers, Cuboid, FolderOpen } from 'lucide-react';
import type { PrintObjectItem } from '../types/models';
import { formatFileSize } from '../utils/formatters';
import { renderBufferToThumbnailDataUrlAsync } from '../utils/thumbnailRenderer';
import { enqueueThumbnailJob } from '../utils/thumbnailQueue';

interface ObjectCardProps {
  item: PrintObjectItem;
  onSelect: (id: string) => void;
  onQuickSlice: (modelPath: string) => void;
  onAutoThumbnailGenerated: (folderPath: string, dataUrl: string) => void;
}

function buildLocalAssetUrl(thumbnailPath: string, version: number): string {
  return `local-asset://thumb?path=${encodeURIComponent(thumbnailPath)}&v=${version}`;
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
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const primaryModel = item.models[0];

  const thumbSrc = item.thumbnailPath
    ? (fallbackUrl || buildLocalAssetUrl(item.thumbnailPath, item.updatedAt))
    : generatedUrl;

  useEffect(() => {
    setFallbackUrl(null);
  }, [item.thumbnailPath, item.updatedAt]);

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
    if (!isVisible || item.thumbnailPath || !primaryModel || !window.electronAPI) return;
    let active = true;

    async function generateThumb() {
      try {
        setIsGenerating(true);
        const dataUrl = await enqueueThumbnailJob(async () => {
          if (!active || !window.electronAPI) return '';
          const buffer = await window.electronAPI.readModelBuffer(primaryModel.path);
          if (!active) return '';
          return renderBufferToThumbnailDataUrlAsync(buffer, primaryModel.extension);
        });

        if (active && dataUrl) {
          setGeneratedUrl(dataUrl);
          onAutoThumbnailGenerated(item.folderPath, dataUrl);
        }
      } catch {
        if (active) setGeneratedUrl(null);
      } finally {
        if (active) setIsGenerating(false);
      }
    }

    generateThumb();
    return () => {
      active = false;
    };
  }, [isVisible, item.thumbnailPath, item.folderPath, primaryModel, onAutoThumbnailGenerated]);

  const handleImgError = async () => {
    if (!item.thumbnailPath || fallbackUrl || !window.electronAPI) return;
    const dataUrl = await window.electronAPI.readImageDataUrl(item.thumbnailPath);
    if (dataUrl) setFallbackUrl(dataUrl);
  };

  return (
    <article
      ref={cardRef}
      className="maker-card"
      onClick={() => onSelect(item.id)}
      role="button"
      tabIndex={0}
      aria-label={`Inspecionar objeto 3D ${item.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
    >
      <div className="maker-thumb-box">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={`Visualização 3D de ${item.name}`}
            className="maker-thumb-img"
            loading="lazy"
            decoding="async"
            width={280}
            height={185}
            onError={handleImgError}
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
