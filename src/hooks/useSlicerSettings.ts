import { useState, useEffect, useCallback } from 'react';
import type {
  AppSettings,
  CrealityCatalog,
  SerializedMeshPayload,
  SmartSliceConfig,
} from '../types/models';

export const FALLBACK_SETTINGS: AppSettings = {
  libraryPath: './sample-library',
  slicers: [],
  activeSlicerId: 'system-default',
  crealityPrinter: 'keep-current',
  crealityFilament: '',
};

export const EMPTY_CATALOG: CrealityCatalog = {
  printers: [],
  filaments: [],
  defaultPrinter: 'keep-current',
  defaultFilament: '',
};

/**
 * Hook modular que gerencia configurações do fatiador Creality Print e chamadas de abertura.
 */
export function useSlicerSettings(
  setStatusMessage: (msg: string | null) => void,
  setErrorMessage: (msg: string | null) => void
) {
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS);
  const [crealityCatalog, setCrealityCatalog] = useState<CrealityCatalog>(EMPTY_CATALOG);

  useEffect(() => {
    let active = true;
    async function syncCrealityCatalog() {
      if (!window.electronAPI) return;
      const activeSlicer = settings.slicers.find((s) => s.id === settings.activeSlicerId);
      const exePath = activeSlicer ? activeSlicer.executablePath : null;
      try {
        const cat = await window.electronAPI.getCrealityCatalog(exePath, settings.crealityPrinter);
        if (active) setCrealityCatalog(cat);
      } catch {
        if (active) setCrealityCatalog(EMPTY_CATALOG);
      }
    }
    syncCrealityCatalog();
    return () => {
      active = false;
    };
  }, [settings.slicers, settings.activeSlicerId, settings.crealityPrinter]);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    if (!window.electronAPI) return;
    const updated = await window.electronAPI.saveSettings(partial);
    setSettings(updated);
    setStatusMessage('Configuração de fatiamento atualizada.');
  }, [setStatusMessage]);

  const launchInSlicer = useCallback(
    async (modelPath: string | string[]) => {
      if (!window.electronAPI) return;
      try {
        const activeSlicer = settings.slicers.find((s) => s.id === settings.activeSlicerId);
        const exePath = activeSlicer ? activeSlicer.executablePath : 'system-default';
        await window.electronAPI.openInSlicer(modelPath as string, exePath);
        const targetName = activeSlicer ? activeSlicer.name : 'Fatiador Padrão do Windows';
        const count = Array.isArray(modelPath) ? ` (${modelPath.length} peças)` : '';
        setStatusMessage(`Abrindo modelo${count} no ${targetName}...`);
      } catch (err) {
        setErrorMessage((err as Error).message || 'Erro ao abrir o fatiador.');
      }
    },
    [settings, setStatusMessage, setErrorMessage]
  );

  const launchConfiguredInSlicer = useCallback(
    async (modelPath: string, meshPayload: SerializedMeshPayload, sliceConfig: SmartSliceConfig) => {
      if (!window.electronAPI) return;
      try {
        const activeSlicer = settings.slicers.find((s) => s.id === settings.activeSlicerId);
        const exePath = activeSlicer ? activeSlicer.executablePath : 'system-default';
        const targetName = activeSlicer ? activeSlicer.name : 'Creality Print';

        await window.electronAPI.openConfiguredInSlicer({
          modelPath,
          slicerExecutablePath: exePath,
          meshPayload,
          sliceConfig,
          printerName: settings.crealityPrinter,
          filamentName: settings.crealityFilament,
        });

        setStatusMessage(
          `Projeto .3MF configurado (${sliceConfig.layerHeight.toFixed(2)}mm · ${sliceConfig.infillDensity}% ${sliceConfig.infillPattern}) enviado ao ${targetName}!`
        );
      } catch (err) {
        setErrorMessage((err as Error).message || 'Erro ao gerar pacote .3MF configurado.');
      }
    },
    [settings, setStatusMessage, setErrorMessage]
  );

  return {
    settings,
    crealityCatalog,
    setSettings,
    updateSettings,
    launchInSlicer,
    launchConfiguredInSlicer,
  };
}

