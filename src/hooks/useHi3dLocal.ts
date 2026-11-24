import { useState, useEffect, useCallback } from 'react';
import type {
  Hi3dConfig,
  Hi3dGenerateResult,
  Hi3dProgressEvent,
  Hi3dStatusPayload,
} from '../types/hi3d';

const MAX_LOG_LINES = 80;

function appendLog(prev: string[], line?: string): string[] {
  if (!line) return prev;
  const next = [...prev, line];
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
}

/**
 * Manages Hi3D Local GPU detection, on-demand installation, 1-image selection, and generation progress.
 */
export function useHi3dLocal(onModelGenerated?: () => Promise<void> | void) {
  const api = window.electronAPI?.hi3d;
  const [status, setStatus] = useState<Hi3dStatusPayload | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [installProgress, setInstallProgress] = useState<{ percent: number; message: string }>({
    percent: 0,
    message: '',
  });
  const [genProgress, setGenProgress] = useState<{ percent: number; message: string }>({
    percent: 0,
    message: '',
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('');
  const [seed, setSeed] = useState<number>(0);
  const [lastResult, setLastResult] = useState<Hi3dGenerateResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!api) {
      setIsLoadingStatus(false);
      return;
    }
    setIsLoadingStatus(true);
    try {
      const next = await api.getStatus();
      setStatus(next);
      setIsInstalling(next.isInstalling);
      setIsGenerating(next.isGenerating);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao detectar ambiente Hi3D.');
    } finally {
      setIsLoadingStatus(false);
    }
  }, [api]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!api) return;
    const unsubInstall = api.onInstallProgress((evt: Hi3dProgressEvent) => {
      if (evt.percent !== undefined || evt.message) {
        setInstallProgress((prev) => ({
          percent: evt.percent ?? prev.percent,
          message: evt.message ?? prev.message,
        }));
      }
      if (evt.log) setLogs((prev) => appendLog(prev, evt.log));
    });
    const unsubGen = api.onGenerateProgress((evt: Hi3dProgressEvent) => {
      if (evt.percent !== undefined || evt.message) {
        setGenProgress((prev) => ({
          percent: evt.percent ?? prev.percent,
          message: evt.message ?? prev.message,
        }));
      }
      if (evt.log) setLogs((prev) => appendLog(prev, evt.log));
    });
    return () => {
      unsubInstall();
      unsubGen();
    };
  }, [api]);

  const updateConfig = useCallback(async (patch: Partial<Hi3dConfig>) => {
    if (!api) return;
    setErrorMessage(null);
    const next = await api.updateConfig(patch);
    setStatus(next);
  }, [api]);

  const chooseRuntimeDir = useCallback(async () => {
    if (!api) return;
    setErrorMessage(null);
    const next = await api.selectRuntimeDir();
    if (next) setStatus(next);
  }, [api]);

  const chooseImage = useCallback(async () => {
    if (!api) return;
    setErrorMessage(null);
    const picked = await api.selectImage();
    if (!picked) return;
    setImagePath(picked);
    setLastResult(null);
    const base = picked.split(/[\\/]/).pop() || '';
    setModelName(base.replace(/\.[^.]+$/, ''));
    const dataUrl = await window.electronAPI?.readImageDataUrl(picked);
    setImagePreviewUrl(dataUrl || null);
  }, [api]);

  const startInstall = useCallback(async () => {
    if (!api) return;
    setErrorMessage(null);
    setLogs([]);
    setInstallProgress({ percent: 2, message: 'Iniciando instalação do motor Hi3D Local...' });
    setIsInstalling(true);
    try {
      const next = await api.install();
      setStatus(next);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha durante a instalação do Hi3D.');
    } finally {
      setIsInstalling(false);
    }
  }, [api]);

  const cancelInstall = useCallback(async () => {
    await api?.cancelInstall();
    setIsInstalling(false);
  }, [api]);

  const startGeneration = useCallback(async () => {
    if (!api || !imagePath || !status) return;
    setErrorMessage(null);
    setLastResult(null);
    setLogs([]);
    setGenProgress({ percent: 2, message: 'Preparando geração 3D local...' });
    setIsGenerating(true);
    try {
      const res = await api.generate({
        imagePath,
        modelName: modelName.trim() || undefined,
        resolution: status.config.resolution,
        outputFormat: status.config.outputFormat,
        targetSizeMm: status.config.targetSizeMm,
        removeBackground: status.config.removeBackground,
        cpuOffload: status.config.cpuOffload,
        seed,
      });
      setLastResult(res);
      if (onModelGenerated) await onModelGenerated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Falha ao gerar modelo 3D.');
    } finally {
      setIsGenerating(false);
    }
  }, [api, imagePath, status, modelName, seed, onModelGenerated]);

  const cancelGeneration = useCallback(async () => {
    await api?.cancelGenerate();
    setIsGenerating(false);
  }, [api]);

  return {
    hasElectronHi3d: Boolean(api),
    status,
    isLoadingStatus,
    isInstalling,
    isGenerating,
    installProgress,
    genProgress,
    logs,
    imagePath,
    imagePreviewUrl,
    modelName,
    seed,
    lastResult,
    errorMessage,
    setModelName,
    setSeed,
    clearError: () => setErrorMessage(null),
    refreshStatus,
    updateConfig,
    chooseRuntimeDir,
    chooseImage,
    startInstall,
    cancelInstall,
    startGeneration,
    cancelGeneration,
  };
}
