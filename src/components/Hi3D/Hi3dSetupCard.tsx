import React, { useState } from 'react';
import { Download, FolderOpen, Square, Terminal, CheckCircle2 } from 'lucide-react';
import type { Hi3dStatusPayload } from '../../types/hi3d';

interface Hi3dSetupCardProps {
  status: Hi3dStatusPayload;
  isInstalling: boolean;
  installProgress: { percent: number; message: string };
  logs: string[];
  onChooseRuntimeDir: () => void;
  onStartInstall: () => void;
  onCancelInstall: () => void;
}

/**
 * On-demand 1-click installer card for isolated Python 3.10 + Hi3Dv1.0 + Hunyuan3D-2 runtime.
 */
export const Hi3dSetupCard: React.FC<Hi3dSetupCardProps> = ({
  status,
  isInstalling,
  installProgress,
  logs,
  onChooseRuntimeDir,
  onStartInstall,
  onCancelInstall,
}) => {
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const { config, environment, installState } = status;
  const canInstall = environment.compatibility.isCompatible && !isInstalling;

  return (
    <section className="hi3d-card" aria-label="Instalação do Motor Hi3D Local">
      <div className="hi3d-card-header">
        <div>
          <h3 className="hi3d-card-title">
            {installState.isInstalled ? 'Motor Hi3D Local Pronto' : 'Instalar Motor Hi3D Local (1 clique)'}
          </h3>
          <p className="hi3d-card-subtitle">
            Cria ambiente Python 3.10 isolado fora do instalador do app com Hi3D v1.0 + Hunyuan3D-2 mini + CUDA 12.4.
          </p>
        </div>
        {installState.isInstalled && (
          <span className="hi3d-badge-ok">
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>Instalado</span>
          </span>
        )}
      </div>

      <div className="hi3d-folder-row">
        <div className="hi3d-folder-info">
          <span className="hi3d-label">Pasta do motor e cache dos modelos (~25 GB)</span>
          <code className="hi3d-path-code" title={config.runtimeDir}>{config.runtimeDir}</code>
        </div>
        <button
          type="button"
          className="hi3d-btn-secondary"
          onClick={onChooseRuntimeDir}
          disabled={isInstalling}
        >
          <FolderOpen size={16} aria-hidden="true" />
          <span>Escolher Pasta</span>
        </button>
      </div>

      <div className="hi3d-setup-actions">
        {!isInstalling ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStartInstall}
            disabled={!canInstall}
          >
            <Download size={16} aria-hidden="true" />
            <span>
              {installState.isInstalled ? 'Revalidar / Reparar Motor' : 'Instalar Motor Hi3D Local'}
            </span>
          </button>
        ) : (
          <button type="button" className="hi3d-btn-danger" onClick={onCancelInstall}>
            <Square size={15} aria-hidden="true" />
            <span>Cancelar Instalação</span>
          </button>
        )}

        {logs.length > 0 && (
          <button
            type="button"
            className="hi3d-btn-secondary"
            onClick={() => setShowLogs((prev) => !prev)}
          >
            <Terminal size={15} aria-hidden="true" />
            <span>{showLogs ? 'Ocultar Logs' : `Ver Logs (${logs.length})`}</span>
          </button>
        )}
      </div>

      {isInstalling && (
        <div className="hi3d-progress-box" role="status">
          <div className="hi3d-progress-head">
            <span>{installProgress.message || 'Instalando...'}</span>
            <strong>{installProgress.percent}%</strong>
          </div>
          <progress
            className="hi3d-progress-bar"
            value={installProgress.percent}
            max={100}
            aria-label={installProgress.message || 'Progresso da instalação'}
          />
        </div>
      )}

      {showLogs && logs.length > 0 && (
        <pre className="hi3d-log-viewer">{logs.join('\n')}</pre>
      )}
    </section>
  );
};
