import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useHi3dLocal } from '../../hooks/useHi3dLocal';
import { Hi3dGpuAlert } from './Hi3dGpuAlert';
import { Hi3dSetupCard } from './Hi3dSetupCard';
import { Hi3dGeneratorCard } from './Hi3dGeneratorCard';

interface Hi3dWorkspaceProps {
  onModelGenerated: () => Promise<void> | void;
  onOpenLibrary: () => void;
}

/**
 * Isolated 1-image local 3D generation workspace powered by Hunyuan3D-2 mini + Hi3D v1.0.
 */
export const Hi3dWorkspace: React.FC<Hi3dWorkspaceProps> = ({
  onModelGenerated,
  onOpenLibrary,
}) => {
  const hi3d = useHi3dLocal(onModelGenerated);

  if (!hi3d.hasElectronHi3d) {
    return (
      <main className="hi3d-workspace" aria-label="Hi3D Local">
        <div className="hi3d-empty-box">
          <p>O motor Hi3D Local está disponível apenas no aplicativo desktop Electron.</p>
        </div>
      </main>
    );
  }

  if (hi3d.isLoadingStatus || !hi3d.status) {
    return (
      <main className="hi3d-workspace" aria-label="Hi3D Local">
        <div className="hi3d-empty-box" role="status">
          <p>Verificando placa gráfica (NVIDIA) e estado do motor Hi3D Local...</p>
        </div>
      </main>
    );
  }

  const { config, environment, installState } = hi3d.status;

  return (
    <main className="hi3d-workspace" aria-label="Gerador 3D Local Hi3D">
      <div className="hi3d-container">
        <Hi3dGpuAlert
          environment={environment}
          onRefresh={hi3d.refreshStatus}
          disabled={hi3d.isInstalling || hi3d.isGenerating}
        />

        {hi3d.errorMessage && (
          <div className="hi3d-error-banner" role="alert">
            <div className="hi3d-error-row">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{hi3d.errorMessage}</span>
            </div>
            <button type="button" className="hi3d-btn-secondary" onClick={hi3d.clearError}>
              Fechar
            </button>
          </div>
        )}

        <Hi3dSetupCard
          status={hi3d.status}
          isInstalling={hi3d.isInstalling}
          installProgress={hi3d.installProgress}
          logs={hi3d.logs}
          onChooseRuntimeDir={hi3d.chooseRuntimeDir}
          onStartInstall={hi3d.startInstall}
          onCancelInstall={hi3d.cancelInstall}
        />

        <Hi3dGeneratorCard
          config={config}
          environment={environment}
          isInstalled={installState.isInstalled}
          isBusyInstalling={hi3d.isInstalling}
          isGenerating={hi3d.isGenerating}
          genProgress={hi3d.genProgress}
          imagePath={hi3d.imagePath}
          imagePreviewUrl={hi3d.imagePreviewUrl}
          modelName={hi3d.modelName}
          seed={hi3d.seed}
          lastResult={hi3d.lastResult}
          onChooseImage={hi3d.chooseImage}
          onModelNameChange={hi3d.setModelName}
          onSeedChange={hi3d.setSeed}
          onUpdateConfig={hi3d.updateConfig}
          onStartGeneration={hi3d.startGeneration}
          onCancelGeneration={hi3d.cancelGeneration}
          onOpenLibrary={onOpenLibrary}
        />

        <footer className="hi3d-footer">
          <span>
            Powered by{' '}
            <a href="https://github.com/hi3d-official/Hi3Dv1.0" target="_blank" rel="noreferrer">
              Hi3D 1.0
            </a>{' '}
            (Sparc3D) + Hunyuan3D-2 mini · Execução 100% local (na 1ª geração os pesos ~14 GB são baixados para a pasta do motor).
          </span>
        </footer>
      </div>
    </main>
  );
};
