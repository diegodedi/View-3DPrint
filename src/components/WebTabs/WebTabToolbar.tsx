import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  LogOut,
  Repeat,
  RotateCcw,
  Globe,
  Power,
  Check,
  X,
} from 'lucide-react';
import {
  DEFAULT_GEN3D_URL,
  type ExternalWebTabId,
  type WebTabRuntimeState,
} from '../../types/webTabs';

interface WebTabToolbarProps {
  activeTab: ExternalWebTabId;
  configuredUrl: string | null;
  runtimeState: WebTabRuntimeState;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onChangeUrl: (url: string) => Promise<boolean>;
  onResetGen3d: () => Promise<void>;
  onSwitchChat: () => Promise<void>;
  onLogoutChat: () => Promise<void>;
  onCloseView: () => Promise<void>;
}

/**
 * Compact top toolbar for external web tabs (navigation, URL change, reset default, switch/logout AI, close view).
 */
export const WebTabToolbar: React.FC<WebTabToolbarProps> = ({
  activeTab,
  configuredUrl,
  runtimeState,
  onBack,
  onForward,
  onReload,
  onChangeUrl,
  onResetGen3d,
  onSwitchChat,
  onLogoutChat,
  onCloseView,
}) => {
  const [isEditingUrl, setIsEditingUrl] = useState<boolean>(false);
  const [draftUrl, setDraftUrl] = useState<string>('');

  useEffect(() => {
    setIsEditingUrl(false);
    setDraftUrl(configuredUrl || '');
  }, [activeTab, configuredUrl]);

  const handleOpenEditor = () => {
    setDraftUrl(runtimeState.currentUrl || configuredUrl || '');
    setIsEditingUrl(true);
  };

  const handleSubmitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftUrl.trim()) return;
    const ok = await onChangeUrl(draftUrl);
    if (ok) setIsEditingUrl(false);
  };

  const isGen3dDefault =
    activeTab === 'gen3d' &&
    (configuredUrl || DEFAULT_GEN3D_URL).replace(/\/+$/, '') === DEFAULT_GEN3D_URL.replace(/\/+$/, '');

  return (
    <div className="webtab-toolbar" role="toolbar" aria-label="Controles da aba externa">
      <div className="webtab-toolbar-left">
        <button
          type="button"
          className="webtab-icon-btn"
          onClick={onBack}
          disabled={!runtimeState.canGoBack}
          title="Voltar"
          aria-label="Voltar página"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="webtab-icon-btn"
          onClick={onForward}
          disabled={!runtimeState.canGoForward}
          title="Avançar"
          aria-label="Avançar página"
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="webtab-icon-btn"
          onClick={onReload}
          disabled={!runtimeState.isLoaded}
          title="Recarregar página"
          aria-label="Recarregar página"
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>

        {isEditingUrl ? (
          <form className="webtab-inline-url-form" onSubmit={handleSubmitUrl}>
            <input
              type="text"
              className="webtab-url-input webtab-url-input-sm"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="https://..."
              aria-label="Endereço do site"
              autoFocus
            />
            <button type="submit" className="webtab-action-btn webtab-action-primary" title="Salvar e abrir">
              <Check size={15} aria-hidden="true" />
              <span>Abrir</span>
            </button>
            <button
              type="button"
              className="webtab-icon-btn"
              onClick={() => setIsEditingUrl(false)}
              title="Cancelar"
              aria-label="Cancelar edição"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <div className="webtab-address-pill" title={runtimeState.currentUrl || configuredUrl || ''}>
            <Globe size={14} aria-hidden="true" />
            <span className="webtab-address-text">
              {runtimeState.isLoading
                ? 'Carregando...'
                : runtimeState.currentUrl || configuredUrl || 'Nenhuma IA selecionada'}
            </span>
          </div>
        )}
      </div>

      <div className="webtab-toolbar-right">
        {activeTab === 'chat' && configuredUrl && (
          <>
            <button
              type="button"
              className="webtab-action-btn"
              onClick={onSwitchChat}
              title="Escolher outra IA (mantém sessão salva)"
            >
              <Repeat size={15} aria-hidden="true" />
              <span>Trocar IA</span>
            </button>
            <button
              type="button"
              className="webtab-action-btn webtab-action-danger"
              onClick={onLogoutChat}
              title="Limpar login/cookies e escolher outra IA"
            >
              <LogOut size={15} aria-hidden="true" />
              <span>Sair da conta</span>
            </button>
          </>
        )}

        {activeTab === 'gen3d' && (
          <>
            {!isEditingUrl && (
              <button
                type="button"
                className="webtab-action-btn"
                onClick={handleOpenEditor}
                title="Usar outro site de geração 3D"
              >
                <Globe size={15} aria-hidden="true" />
                <span>Alterar site</span>
              </button>
            )}
            <button
              type="button"
              className="webtab-action-btn"
              onClick={onResetGen3d}
              disabled={isGen3dDefault && runtimeState.isLoaded}
              title={`Restaurar padrão (${DEFAULT_GEN3D_URL})`}
            >
              <RotateCcw size={15} aria-hidden="true" />
              <span>Restaurar padrão</span>
            </button>
          </>
        )}

        {runtimeState.isLoaded && (
          <button
            type="button"
            className="webtab-icon-btn"
            onClick={onCloseView}
            title="Encerrar aba para liberar memória RAM/GPU"
            aria-label="Encerrar aba para liberar memória"
          >
            <Power size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};
