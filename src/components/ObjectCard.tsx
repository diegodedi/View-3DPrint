import React, { useEffect, useState } from 'react';
import { Play, Layers, Cuboid, FolderOpen } from 'lucide-react';
import type { PrintObjectItem } from '../types/models';
import { formatFileSize } from '../utils/formatters';
import { buildLocalAssetUrl } from '../utils/thumbPredecoder';
import {
  deprioritizeThumbnailKey,
  getCachedGeneratedThumbnail,
  prioritizeThumbnailItem,
  subscribeThumbnailReady,
} from '../utils/thumbnailQueue';

interface ObjectCardProps {
  item: PrintObjectItem;
  onSelect: (id: string) => void;
  onQuickSlice: (modelPath: string) => void;
}

/**
 * MakerWorld-style asset card backed by centralized WebP SSD cache and non-discarding priority indexer.
 */
const ObjectCardComponent: React.FC<ObjectCardProps> = ({
  item,
  onSelect,
  onQuickSlice,
}) => {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    getCachedGeneratedThumbnail(item.folderPath)
  );
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const primaryModel = item.models[0];

  const thumbSrc =
    resolvedUrl ||
    fallbackUrl ||
    (item.thumbnailPath ? buildLocalAssetUrl(item.thumbnailPath, item.updatedAt) : null);

  useEffect(() => {
    setFallbackUrl(null);
    setResolvedUrl(getCachedGeneratedThumbnail(item.folderPath));
  }, [item.folderPath, item.thumbnailPath, item.updatedAt]);

  useEffect(() => {
    return subscribeThumbnailReady(item.folderPath, (url) => {
      setResolvedUrl(url);
    });
  }, [item.folderPath]);

  useEffect(() => {
    if (thumbSrc || !primaryModel || !window.electronAPI) return;
    prioritizeThumbnailItem(item);
    return () => {
      deprioritizeThumbnailKey(item.folderPath);
    };
  }, [thumbSrc, item, primaryModel]);

  const handleImgError = async () => {
    if (!item.thumbnailPath || fallbackUrl || !window.electronAPI) return;
    const dataUrl = await window.electronAPI.readImageDataUrl(item.thumbnailPath);
    if (dataUrl) setFallbackUrl(dataUrl);
  };

  return (
    <article
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
            decoding="async"
            width={280}
            height={185}
            onError={handleImgError}
          />
        ) : (
          <div className="maker-thumb-empty">
            <Cuboid size={36} color="var(--color-text-muted)" />
            <span className="maker-thumb-hint">Preparando miniatura...</span>
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
