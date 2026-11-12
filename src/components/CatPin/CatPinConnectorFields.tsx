import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { CatpinConnectorConfig, CatpinConnectorType } from '../../utils/catpin/connectorMeshBuilder';

interface CatPinConnectorFieldsProps {
  connectorConfig: CatpinConnectorConfig;
  cutGapMm: number;
  onChangeCutGap: (gapMm: number) => void;
  onChangeConnector: (patch: Partial<CatpinConnectorConfig>) => void;
  onInvertPin: () => void;
}

const CLEARANCE_PRESETS = [
  { value: 0.1, label: '0.10mm (Resina)' },
  { value: 0.2, label: '0.20mm (FDM)' },
  { value: 0.3, label: '0.30mm (Folga)' },
];

/**
 * Controles de configuração de conectores (Pinos e Furos) e folgas.
 */
export const CatPinConnectorFields: React.FC<CatPinConnectorFieldsProps> = ({
  connectorConfig,
  cutGapMm,
  onChangeCutGap,
  onChangeConnector,
  onInvertPin,
}) => {
  return (
    <div className="catpin-section-box">
      <span className="catpin-section-title">2. Folga de Corte & Conectores</span>

      <div className="smart-field">
        <label className="catpin-slider-row" htmlFor="catpin-cutgap-slider">
          <span>Folga de Corte (Cut Gap):</span>
          <strong className="text-primary">{cutGapMm.toFixed(2)} mm</strong>
        </label>
        <input
          id="catpin-cutgap-slider" type="range" min={0.0} max={1.0} step={0.05}
          value={cutGapMm}
          onChange={(e) => onChangeCutGap(Number(e.target.value))}
        />
      </div>

      <div className="smart-field">
        <label className="smart-label" htmlFor="catpin-conn-select">Tipo de Conector:</label>
        <select
          id="catpin-conn-select" className="smart-select" value={connectorConfig.type}
          onChange={(e) => onChangeConnector({ type: e.target.value as CatpinConnectorType })}
        >
          <option value="cylinder">Pino Cilíndrico</option>
          <option value="trapezoid">Pino Trapezoidal Anti-Rotação</option>
          <option value="none">Sem Conector (Apenas Corte)</option>
        </select>
      </div>

      {connectorConfig.type !== 'none' && (
        <>
          <div className="smart-field">
            <label className="smart-label">Pino Macho Fixado Em:</label>
            <div className="grid-2col-gap2">
              <button
                type="button"
                className="catpin-chip-btn"
                data-active={(!connectorConfig.pinSide || connectorConfig.pinSide === 'partA')}
                onClick={() => onChangeConnector({ pinSide: 'partA' })}
                title="Pino na Parte A; Furo na Parte B"
              >
                Parte A
              </button>
              <button
                type="button"
                className="catpin-chip-btn"
                data-active={connectorConfig.pinSide === 'partB'}
                onClick={() => onChangeConnector({ pinSide: 'partB' })}
                title="Pino na Parte B; Furo na Parte A"
              >
                Parte B
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn full-width-btn"
            onClick={onInvertPin}
            title="Inverte a direção do pino (180°)"
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>⇄ Inverter Direção do Pino (180°)</span>
          </button>

          <div className="smart-field">
            <label className="catpin-slider-row" htmlFor="catpin-diam-slider">
              <span>Diâmetro / Largura (D):</span>
              <strong className="text-main">{connectorConfig.diameterMm.toFixed(1)} mm</strong>
            </label>
            <input
              id="catpin-diam-slider" type="range" min={2.0} max={30.0} step={0.5}
              value={connectorConfig.diameterMm}
              onChange={(e) => onChangeConnector({ diameterMm: Number(e.target.value) })}
            />
          </div>

          <div className="smart-field">
            <label className="catpin-slider-row" htmlFor="catpin-pindepth-slider">
              <span>Profundidade do Pino (H):</span>
              <strong className="text-main">{connectorConfig.depthMm.toFixed(1)} mm</strong>
            </label>
            <input
              id="catpin-pindepth-slider" type="range" min={4.0} max={40.0} step={0.5}
              value={connectorConfig.depthMm}
              onChange={(e) => onChangeConnector({ depthMm: Number(e.target.value) })}
            />
          </div>

          <div className="smart-field">
            <label className="catpin-slider-row" htmlFor="catpin-clear-slider">
              <span>Folga do Encaixe (Clearance):</span>
              <strong className="text-primary">{connectorConfig.clearanceMm.toFixed(2)} mm</strong>
            </label>

            <div className="catpin-clearance-group">
              {CLEARANCE_PRESETS.map((preset) => (
                <button
                  key={preset.value} type="button" className="catpin-chip-btn"
                  data-active={Math.abs(connectorConfig.clearanceMm - preset.value) < 0.005}
                  onClick={() => onChangeConnector({ clearanceMm: preset.value })}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <input
              id="catpin-clear-slider" type="range" min={0.05} max={0.6} step={0.01}
              value={connectorConfig.clearanceMm}
              onChange={(e) => onChangeConnector({ clearanceMm: Number(e.target.value) })}
            />
          </div>
        </>
      )}
    </div>
  );
};

