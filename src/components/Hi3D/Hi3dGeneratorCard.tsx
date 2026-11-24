import React from 'react';
import {
  ImagePlus,
  Sparkles,
  Square,
  FolderOpen,
  Box,
  CheckCircle2,
} from 'lucide-react';
import type {
  Hi3dConfig,
  Hi3dEnvironment,
  Hi3dGenerateResult,
  Hi3dOutputFormat,
  Hi3dResolution,
} from '../../types/hi3d';

interface Hi3dGeneratorCardProps {
  config: Hi3dConfig;
  environment: Hi3dEnvironment;
  isInstalled: boolean;
  isBusyInstalling: boolean;
  isGenerating: boolean;
  genProgress: { percent: number; message: string };
  imagePath: string | null;
  imagePreviewUrl: string | null;
  modelName: string;
  seed: number;
  lastResult: Hi3dGenerateResult | null;
  onChooseImage: () => void;
  onModelNameChange: (name: string) => void;
  onSeedChange: (seed: number) => void;
  onUpdateConfig: (patch: Partial<Hi3dConfig>) => void;
  onStartGeneration: () => void;
  onCancelGeneration: () => void;
  onOpenLibrary: () => void;
}

const RESOLUTION_OPTIONS: Array<{ value: Hi3dResolution; label: string; hint: string }> = [
  { value: 512, label: '512³ (Rápido)', hint: 'Recomendado p/ 8 GB VRAM' },
  { value: 1024, label: '1024³ (Alto)', hint: 'Requer ~16 GB+ VRAM' },
  { value: 1536, label: '1536³ (Ultra)', hint: 'Requer ~24 GB+ VRAM' },
];

/**
 * 1-image to 3D generation form and progress/result panel for Hi3D Local.
 */
export const Hi3dGeneratorCard: React.FC<Hi3dGeneratorCardProps> = ({
  config,
  environment,
  isInstalled,
  isBusyInstalling,
  isGenerating,
  genProgress,
  imagePath,
  imagePreviewUrl,
  modelName,
  seed,
  lastResult,
  onChooseImage,
  onModelNameChange,
  onSeedChange,
  onUpdateConfig,
  onStartGeneration,
  onCancelGeneration,
  onOpenLibrary,
}) => {
  const canGenerate =
    isInstalled &&
    environment.compatibility.isCompatible &&
    Boolean(imagePath) &&
    !isGenerating &&
    !isBusyInstalling;

  const isLowVramWarning =
    environment.gpu &&
    environment.gpu.vramMb < environment.requirements.recommendedVramMb &&
    config.resolution > 512;

  return (
    <section className="hi3d-card" aria-label="Gerar modelo 3D a partir de 1 imagem">
      <div className="hi3d-card-header">
        <div>
          <h3 className="hi3d-card-title">Gerar Modelo 3D (1 Imagem → Malha Pronta)</h3>
          <p className="hi3d-card-subtitle">
            Fluxo automático: remove fundo → gera malha base (Hunyuan3D-2 mini) → refina geometria (Hi3D v1.0) → salva na biblioteca.
          </p>
        </div>
      </div>

      <div className="hi3d-gen-grid">
        <div className="hi3d-image-col">
          <button
            type="button"
            className="hi3d-image-drop"
            onClick={onChooseImage}
            disabled={isGenerating}
          >
            {imagePreviewUrl ? (
              <img
                src={imagePreviewUrl}
                alt="Prévia da imagem de referência"
                className="hi3d-image-preview"
              />
            ) : (
              <div className="hi3d-image-placeholder">
                <ImagePlus size={32} aria-hidden="true" />
                <span>Selecionar Imagem de Referência</span>
                <small>PNG, JPG ou WEBP (objeto inteiro bem iluminado)</small>
              </div>
            )}
          </button>
          {imagePath && (
            <button
              type="button"
              className="hi3d-btn-secondary"
              onClick={onChooseImage}
              disabled={isGenerating}
            >
              Trocar imagem
            </button>
          )}
        </div>

        <div className="hi3d-controls-col">
          <div className="hi3d-field">
            <label className="hi3d-label" htmlFor="hi3d-model-name">Nome do modelo</label>
            <input
              id="hi3d-model-name"
              type="text"
              className="hi3d-input"
              placeholder="Ex.: dragao_miniatura"
              value={modelName}
              onChange={(e) => onModelNameChange(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          <div className="hi3d-field">
            <span className="hi3d-label">Resolução do Refinamento Hi3D</span>
            <div className="hi3d-choice-row">
              {RESOLUTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="hi3d-choice-btn"
                  data-active={config.resolution === opt.value}
                  onClick={() => onUpdateConfig({ resolution: opt.value })}
                  disabled={isGenerating}
                >
                  <strong>{opt.label}</strong>
                  <span>{opt.hint}</span>
                </button>
              ))}
            </div>
            {isLowVramWarning && (
              <p className="hi3d-inline-warn">
                Sua GPU tem {environment.gpu?.vramGb} GB VRAM: {config.resolution}³ pode dar falta de memória. Para maior estabilidade, use 512³.
              </p>
            )}
          </div>

          <div className="hi3d-inline-fields">
            <div className="hi3d-field">
              <label className="hi3d-label" htmlFor="hi3d-format">Formato</label>
              <select
                id="hi3d-format"
                className="hi3d-input"
                value={config.outputFormat}
                onChange={(e) => onUpdateConfig({ outputFormat: e.target.value as Hi3dOutputFormat })}
                disabled={isGenerating}
              >
                <option value="stl">STL (Pronto p/ Impressão 3D)</option>
                <option value="obj">OBJ</option>
              </select>
            </div>

            <div className="hi3d-field">
              <label className="hi3d-label" htmlFor="hi3d-size-mm">Tamanho maior (mm)</label>
              <input
                id="hi3d-size-mm"
                type="number"
                min={20}
                max={300}
                className="hi3d-input"
                value={config.targetSizeMm}
                onChange={(e) => onUpdateConfig({ targetSizeMm: Number(e.target.value) || 100 })}
                disabled={isGenerating}
              />
            </div>

            <div className="hi3d-field">
              <label className="hi3d-label" htmlFor="hi3d-seed">Seed</label>
              <input
                id="hi3d-seed"
                type="number"
                min={0}
                className="hi3d-input"
                value={seed}
                onChange={(e) => onSeedChange(Number(e.target.value) || 0)}
                disabled={isGenerating}
              />
            </div>
          </div>

          <div className="hi3d-toggle-row">
            <label className="hi3d-checkbox">
              <input
                type="checkbox"
                checked={config.removeBackground}
                onChange={(e) => onUpdateConfig({ removeBackground: e.target.checked })}
                disabled={isGenerating}
              />
              <span>Remover fundo automaticamente (rembg)</span>
            </label>

            <label className="hi3d-checkbox">
              <input
                type="checkbox"
                checked={config.cpuOffload}
                onChange={(e) => onUpdateConfig({ cpuOffload: e.target.checked })}
                disabled={isGenerating}
              />
              <span>CPU Offload (economiza VRAM em GPUs de 8–12 GB)</span>
            </label>
          </div>

          <div className="hi3d-action-row">
            {!isGenerating ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onStartGeneration}
                disabled={!canGenerate}
              >
                <Sparkles size={16} aria-hidden="true" />
                <span>Gerar Modelo 3D</span>
              </button>
            ) : (
              <button type="button" className="hi3d-btn-danger" onClick={onCancelGeneration}>
                <Square size={15} aria-hidden="true" />
                <span>Cancelar Geração</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {isGenerating && (
        <div className="hi3d-progress-box" role="status">
          <div className="hi3d-progress-head">
            <span>{genProgress.message || 'Gerando modelo 3D...'}</span>
            <strong>{genProgress.percent}%</strong>
          </div>
          <progress
            className="hi3d-progress-bar"
            value={genProgress.percent}
            max={100}
            aria-label={genProgress.message || 'Progresso da geração 3D'}
          />
        </div>
      )}

      {lastResult && (
        <div className="hi3d-result-banner" role="status">
          <div className="hi3d-result-info">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div>
              <strong>Modelo salvo na biblioteca: {lastResult.modelName}</strong>
              <p>
                {lastResult.triangles.toLocaleString('pt-BR')} triângulos ·{' '}
                {(lastResult.elapsedMs / 1000).toFixed(1)}s · {lastResult.resolution}³
              </p>
            </div>
          </div>
          <div className="hi3d-result-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenLibrary}>
              <Box size={16} aria-hidden="true" />
              <span>Abrir na Biblioteca</span>
            </button>
            <button
              type="button"
              className="hi3d-btn-secondary"
              onClick={() => window.electronAPI?.openFolderInExplorer(lastResult.folderPath)}
            >
              <FolderOpen size={16} aria-hidden="true" />
              <span>Abrir Pasta</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
