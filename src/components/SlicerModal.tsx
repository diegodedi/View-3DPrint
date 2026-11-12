import React, { useEffect } from 'react';
import { Plus, Check, X } from 'lucide-react';
import type { AppSettings, CrealityCatalog, SlicerProfile } from '../types/models';

interface SlicerModalProps {
  isOpen: boolean;
  settings: AppSettings;
  crealityCatalog: CrealityCatalog;
  onClose: () => void;
  onSaveSettings: (partial: Partial<AppSettings>) => void;
}

/**
 * Modal dialog to select the active 3D slicer, default Creality printer/filament, or add custom .exe.
 */
export const SlicerModal: React.FC<SlicerModalProps> = ({
  isOpen,
  settings,
  crealityCatalog,
  onClose,
  onSaveSettings,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAddCustomSlicer = async () => {
    if (!window.electronAPI) return;
    const picked: SlicerProfile | null = await window.electronAPI.selectSlicerExecutable();
    if (!picked) return;

    const updatedList = [...settings.slicers, picked];
    onSaveSettings({
      slicers: updatedList,
      activeSlicerId: picked.id,
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slicer-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel">
        <div className="inspector-header-row">
          <h2 id="slicer-modal-title" className="inspector-title">
            Configurar Fatiador & Perfil Creality
          </h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Fechar modal">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="smart-label">
          Selecione o fatiador principal (Creality Print detectado automaticamente com suporte a Auto-Config .3MF):
        </p>

        <div className="smart-field">
          <button
            type="button"
            className={`btn full-width-btn ${
              settings.activeSlicerId === 'system-default'
                ? 'btn-slicer-choice-active'
                : 'btn-slicer-choice'
            }`}
            onClick={() => onSaveSettings({ activeSlicerId: 'system-default' })}
          >
            <span>Fatiador Padrão do Windows</span>
            {settings.activeSlicerId === 'system-default' && (
              <Check size={18} color="var(--color-primary)" />
            )}
          </button>

          {settings.slicers.map((slicer) => {
            const isSelected = settings.activeSlicerId === slicer.id;
            return (
              <button
                key={slicer.id}
                type="button"
                className={`btn full-width-btn ${
                  isSelected ? 'btn-slicer-choice-active' : 'btn-slicer-choice'
                }`}
                onClick={() => onSaveSettings({ activeSlicerId: slicer.id })}
              >
                <div className="slicer-name-label">
                  <div>{slicer.name}</div>
                  <div className="smart-label">{slicer.executablePath}</div>
                </div>
                {isSelected && <Check size={18} color="var(--color-primary)" />}
              </button>
            );
          })}
        </div>

        {crealityCatalog.printers.length > 0 && (
          <div className="smart-grid-fields">
            <div className="smart-field smart-field-full">
              <label htmlFor="modal-creality-printer" className="smart-label">
                Impressora Creality Padrão (Auto-Config .3MF):
              </label>
              <select
                id="modal-creality-printer"
                className="smart-select"
                value={settings.crealityPrinter || crealityCatalog.defaultPrinter}
                onChange={(e) => onSaveSettings({ crealityPrinter: e.target.value })}
              >
                <option value="keep-current">Apenas Overrides na Peça (Qualquer Máquina)</option>
                {crealityCatalog.printers.map((printer) => (
                  <option key={printer} value={printer}>
                    {printer}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="inspector-header-row">
          <button type="button" className="btn" onClick={handleAddCustomSlicer}>
            <Plus size={18} aria-hidden="true" />
            <span>Adicionar Executável (.exe)</span>
          </button>

          <button type="button" className="btn btn-primary" onClick={onClose}>
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
};
