import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ExternalLink, FolderOpen, X } from 'lucide-react';
import type {
  AppSettings,
  BoundingBoxDimensions,
  CrealityCatalog,
  MeshAnalysisMetrics,
  PrintIntent,
  PrintObjectItem,
  SerializedMeshPayload,
  SmartSliceConfig,
} from '../types/models';
import { formatFileSize } from '../utils/formatters';
import { analyzeMeshGeometry, recommendCrealitySliceConfig } from '../utils/meshAnalyzer';
import { extractSerializedMesh } from '../utils/meshExtractor';
import { SmartSlicePanel } from './SmartSlicePanel';
import { Viewer3D } from './Viewer3D';
import { ModelNotesField } from './ModelNotesField';
import { CatPinModal } from './CatPin/CatPinModal';

interface DetailsPanelProps {
  item: PrintObjectItem | null;
  selectedModelIndex: number;
  settings: AppSettings;
  crealityCatalog: CrealityCatalog;
  onSelectModelIndex: (index: number) => void;
  onOpenInSlicer: (modelPath: string | string[]) => void;
  onOpenConfiguredInSlicer: (
    modelPath: string,
    meshPayload: SerializedMeshPayload,
    sliceConfig: SmartSliceConfig
  ) => Promise<void>;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onSaveNotes: (folderPath: string, notes: string) => void;
  onCaptureThumbnail: (dataUrl: string) => void;
  onRefreshLibrary?: () => void;
  onClose: () => void;
}

/**
 * 3D Inspector Modal with interactive MatCap canvas, deep geometry analysis, and 1-click Creality Print setup.
 */
export const DetailsPanel: React.FC<DetailsPanelProps> = ({
  item,
  selectedModelIndex,
  settings,
  crealityCatalog,
  onSelectModelIndex,
  onOpenInSlicer,
  onOpenConfiguredInSlicer,
  onUpdateSettings,
  onSaveNotes,
  onCaptureThumbnail,
  onRefreshLibrary,
  onClose,
}) => {
  const loadedMeshRef = useRef<{ object3d: THREE.Object3D; dims: BoundingBoxDimensions } | null>(null);
  const [metrics, setMetrics] = useState<MeshAnalysisMetrics | null>(null);
  const [sliceConfig, setSliceConfig] = useState<SmartSliceConfig | null>(null);
  const [intent, setIntent] = useState<PrintIntent>('auto');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isCatpinOpen, setIsCatpinOpen] = useState<boolean>(false);

  useEffect(() => {
    setIntent('auto');
    setIsCatpinOpen(false);
  }, [item]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCatpinOpen) {
          setIsCatpinOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCatpinOpen, onClose]);

  const handleMeshLoaded = useCallback(
    (object3d: THREE.Object3D, dims: BoundingBoxDimensions) => {
      loadedMeshRef.current = { object3d, dims };
      const analyzed = analyzeMeshGeometry(object3d, dims);
      setMetrics(analyzed);
      setSliceConfig(
        recommendCrealitySliceConfig({
          metrics: analyzed,
          intent: 'auto',
          printerName: settings.crealityPrinter,
        })
      );
      setIntent('auto');
    },
    [settings.crealityPrinter]
  );

  const handleChangeIntent = (nextIntent: PrintIntent) => {
    setIntent(nextIntent);
    if (!metrics) return;
    setSliceConfig(
      recommendCrealitySliceConfig({
        metrics,
        intent: nextIntent,
        printerName: settings.crealityPrinter,
      })
    );
  };

  const handleChangePrinter = (printerName: string) => {
    onUpdateSettings({ crealityPrinter: printerName });
    if (metrics) {
      setSliceConfig(recommendCrealitySliceConfig({ metrics, intent, printerName }));
    }
  };

  const handleSendConfigured = async () => {
    if (!item || !loadedMeshRef.current || !sliceConfig) return;
    const activeModel = item.models[selectedModelIndex] || item.models[0];
    try {
      setIsSending(true);
      const meshPayload = extractSerializedMesh(
        loadedMeshRef.current.object3d,
        loadedMeshRef.current.dims
      );
      await onOpenConfiguredInSlicer(activeModel.path, meshPayload, sliceConfig);
    } finally {
      setIsSending(false);
    }
  };

  if (!item) return null;

  const activeModel = item.models[selectedModelIndex] || item.models[0];
  const activeSlicer = settings.slicers.find((s) => s.id === settings.activeSlicerId);
  const slicerLabel = activeSlicer ? activeSlicer.name : 'Creality Print';

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Inspecionar ${item.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="inspector-modal">
        <Viewer3D
          modelFile={activeModel}
          onCaptureThumbnail={onCaptureThumbnail}
          onMeshLoaded={handleMeshLoaded}
          onMeshLoadingChange={setIsAnalyzing}
          onOpenCatpinCut={() => setIsCatpinOpen(true)}
        />

        <aside className="inspector-aside">
          <div className="inspector-header-row">
            <div>
              <span className="inspector-category-tag">{item.category}</span>
              <h2 className="inspector-title">{item.name}</h2>
            </div>

            <button type="button" className="btn" onClick={onClose} aria-label="Fechar visualização 3D">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <SmartSlicePanel
            metrics={metrics}
            isAnalyzing={isAnalyzing}
            sliceConfig={sliceConfig}
            intent={intent}
            slicerLabel={slicerLabel}
            catalog={crealityCatalog}
            selectedPrinter={settings.crealityPrinter || crealityCatalog.defaultPrinter}
            selectedFilament={settings.crealityFilament || crealityCatalog.defaultFilament}
            isSending={isSending}
            onChangeIntent={handleChangeIntent}
            onUpdateSliceConfig={(patch) =>
              setSliceConfig((prev) => (prev ? { ...prev, ...patch } : prev))
            }
            onChangePrinter={handleChangePrinter}
            onChangeFilament={(filament) => onUpdateSettings({ crealityFilament: filament })}
            onSendConfigured={handleSendConfigured}
          />

          <div className="smart-grid-fields">
            <button
              type="button"
              className="btn"
              onClick={() => onOpenInSlicer(activeModel.path)}
              title="Abrir o arquivo original direto no fatiador sem injetar parâmetros"
            >
              <ExternalLink size={15} aria-hidden="true" />
              <span>Abrir Puro</span>
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => window.electronAPI?.openFolderInExplorer(item.folderPath)}
            >
              <FolderOpen size={15} aria-hidden="true" />
              <span>Abrir Pasta</span>
            </button>
          </div>

          {item.models.length > 1 && (
            <div className="smart-field">
              <span className="smart-label">PEÇAS DO PROJETO ({item.models.length}):</span>
              <button
                type="button"
                className="btn btn-primary full-width-btn"
                onClick={() => onOpenInSlicer(item.models.map((m) => m.path))}
                title="Abre todas as peças deste projeto juntas no fatiador"
              >
                <ExternalLink size={15} aria-hidden="true" />
                <span>Abrir Todas no Fatiador ({item.models.length})</span>
              </button>
              {item.models.map((model, idx) => (
                <button
                  key={model.path}
                  type="button"
                  className={idx === selectedModelIndex ? 'btn btn-primary full-width-btn' : 'btn full-width-btn'}
                  onClick={() => onSelectModelIndex(idx)}
                >
                  <span>{model.name}</span>
                  <span>({formatFileSize(model.sizeBytes)})</span>
                </button>
              ))}
            </div>
          )}

          <ModelNotesField
            initialNotes={item.notes}
            folderPath={item.folderPath}
            onSaveNotes={onSaveNotes}
          />
        </aside>
      </div>

      <CatPinModal
        isOpen={isCatpinOpen}
        modelName={activeModel.name}
        modelPath={activeModel.path}
        objectFolderPath={item?.folderPath}
        onClose={() => setIsCatpinOpen(false)}
        onSavedParts={onRefreshLibrary}
      />
    </div>
  );
};
