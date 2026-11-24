import React from 'react';
import { Cpu, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import type { Hi3dEnvironment } from '../../types/hi3d';

interface Hi3dGpuAlertProps {
  environment: Hi3dEnvironment;
  onRefresh: () => void;
  disabled?: boolean;
}

/**
 * Displays detected GPU status and mandatory minimum hardware requirements for local Hi3D inference.
 */
export const Hi3dGpuAlert: React.FC<Hi3dGpuAlertProps> = ({
  environment,
  onRefresh,
  disabled,
}) => {
  const { gpu, freeDiskGb, compatibility } = environment;
  const variant = compatibility.level;

  const StatusIcon = variant === 'unsupported'
    ? XCircle
    : variant === 'minimum'
      ? AlertTriangle
      : CheckCircle2;

  return (
    <section
      className={`hi3d-gpu-banner hi3d-gpu-${variant}`}
      role={variant === 'unsupported' ? 'alert' : 'status'}
      aria-label="Requisitos de placa gráfica para Hi3D Local"
    >
      <div className="hi3d-gpu-header">
        <div className="hi3d-gpu-title-row">
          <StatusIcon size={20} aria-hidden="true" />
          <h2 className="hi3d-gpu-title">Requisitos de Placa Gráfica (Execução Local)</h2>
        </div>
        <button
          type="button"
          className="hi3d-btn-secondary"
          onClick={onRefresh}
          disabled={disabled}
          title="Reverificar placa gráfica e espaço em disco"
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>Reverificar</span>
        </button>
      </div>

      <p className="hi3d-gpu-summary">{compatibility.summary}</p>

      <div className="hi3d-req-grid">
        <div className="hi3d-req-pill">
          <Cpu size={14} aria-hidden="true" />
          <span><strong>Mínimo GPU:</strong> NVIDIA RTX 30xx / 40xx / 50xx (Compute ≥ 8.0)</span>
        </div>
        <div className="hi3d-req-pill">
          <span><strong>VRAM mínima:</strong> 8 GB (512³ c/ Offload) · 16–24 GB+ (1024³ / 1536³)</span>
        </div>
        <div className="hi3d-req-pill">
          <span>
            <strong>Disco:</strong> ~25 GB livres
            {freeDiskGb !== null ? ` (atual na pasta: ${freeDiskGb} GB)` : ''}
          </span>
        </div>
        {gpu && (
          <div className="hi3d-req-pill">
            <span><strong>Detectada:</strong> {gpu.name} · {gpu.vramGb} GB · Driver {gpu.driverVersion}</span>
          </div>
        )}
      </div>

      {compatibility.warnings.length > 0 && (
        <ul className="hi3d-gpu-warnings">
          {compatibility.warnings.map((warning, idx) => (
            <li key={idx}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
};
