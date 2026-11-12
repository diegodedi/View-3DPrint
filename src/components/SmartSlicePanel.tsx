import React from 'react';
import { Sparkles, Play } from 'lucide-react';
import type {
  CrealityCatalog,
  MeshAnalysisMetrics,
  PrintIntent,
  SmartSliceConfig,
} from '../types/models';
import { SmartSliceFields } from './SmartSliceFields';

interface SmartSlicePanelProps {
  metrics: MeshAnalysisMetrics | null;
  isAnalyzing: boolean;
  sliceConfig: SmartSliceConfig | null;
  intent: PrintIntent;
  slicerLabel: string;
  catalog: CrealityCatalog;
  selectedPrinter: string;
  selectedFilament: string;
  isSending: boolean;
  onChangeIntent: (intent: PrintIntent) => void;
  onUpdateSliceConfig: (patch: Partial<SmartSliceConfig>) => void;
  onChangePrinter: (printer: string) => void;
  onChangeFilament: (filament: string) => void;
  onSendConfigured: () => void;
}

const INTENT_OPTIONS: Array<{ id: PrintIntent; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'quality', label: 'Fino' },
  { id: 'strength', label: 'Forte' },
  { id: 'draft', label: 'Rápido' },
];

/**
 * Interactive Creality Print smart geometry analyzer and 1-click .3MF configurator panel.
 */
export const SmartSlicePanel: React.FC<SmartSlicePanelProps> = ({
  metrics,
  isAnalyzing,
  sliceConfig,
  intent,
  slicerLabel,
  catalog,
  selectedPrinter,
  selectedFilament,
  isSending,
  onChangeIntent,
  onUpdateSliceConfig,
  onChangePrinter,
  onChangeFilament,
  onSendConfigured,
}) => {
  if (isAnalyzing) {
    return (
      <section className="smart-panel" aria-busy="true">
        <div className="smart-panel-title">
          <Sparkles size={16} aria-hidden="true" />
          <span>Analisando geometria 3D...</span>
        </div>
      </section>
    );
  }

  if (!metrics || !sliceConfig) {
    return (
      <section className="smart-panel">
        <span className="smart-label">Aguardando leitura da malha 3D para sugerir perfil.</span>
      </section>
    );
  }

  return (
    <section className="smart-panel" aria-label="Configurador Inteligente Creality Print">
      <div className="smart-panel-header">
        <div className="smart-panel-title">
          <Sparkles size={16} aria-hidden="true" />
          <span>Auto-Config · Creality Print</span>
        </div>
      </div>

      <div className="smart-metrics-strip">
        <div className="smart-metric-cell">
          <span className="smart-metric-label">Volume Real</span>
          <span className="smart-metric-val">{metrics.volumeCm3} cm³</span>
        </div>
        <div className="smart-metric-cell">
          <span className="smart-metric-label">Peso Est.</span>
          <span className="smart-metric-val">~{sliceConfig.estimatedGrams} g</span>
        </div>
        <div className="smart-metric-cell">
          <span className="smart-metric-label">Balanços</span>
          <span className="smart-metric-val">{metrics.severeOverhangAreaMm2} mm²</span>
        </div>
      </div>

      <div className="intent-tabs" role="tablist" aria-label="Objetivo da impressão">
        {INTENT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={intent === opt.id}
            className="intent-tab"
            data-active={intent === opt.id}
            onClick={() => onChangeIntent(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {catalog.printers.length > 0 && (
        <div className="smart-grid-fields">
          <div className="smart-field smart-field-full">
            <label htmlFor="creality-printer-select" className="smart-label">
              Impressora Creality (Perfil .3MF)
            </label>
            <select
              id="creality-printer-select"
              className="smart-select"
              value={selectedPrinter}
              onChange={(e) => onChangePrinter(e.target.value)}
            >
              <option value="keep-current">Apenas Overrides na Peça (Qualquer Máquina)</option>
              {catalog.printers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {selectedPrinter !== 'keep-current' && catalog.filaments.length > 0 && (
            <div className="smart-field smart-field-full">
              <label htmlFor="creality-filament-select" className="smart-label">
                Filamento Base
              </label>
              <select
                id="creality-filament-select"
                className="smart-select"
                value={selectedFilament}
                onChange={(e) => onChangeFilament(e.target.value)}
              >
                {catalog.filaments.map((f) => (
                  <option key={f} value={f}>
                    {f.split('@')[0].trim()}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <SmartSliceFields sliceConfig={sliceConfig} onUpdateSliceConfig={onUpdateSliceConfig} />

      <ul className="smart-reasons-list" aria-label="Diagnóstico automático da peça">
        {sliceConfig.reasons.map((reason, idx) => (
          <li key={idx}>• {reason}</li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn-primary full-width-btn"
        disabled={isSending}
        onClick={onSendConfigured}
      >
        <Play size={18} fill="currentColor" aria-hidden="true" />
        <span>
          {isSending ? 'Empacotando .3MF Configurado...' : `Enviar Configurado p/ ${slicerLabel}`}
        </span>
      </button>
    </section>
  );
};
