import React, { useRef } from 'react';
import { Play, AlertCircle } from 'lucide-react';
import { useWebTabs } from '../../hooks/useWebTabs';
import { AiChatPicker } from './AiChatPicker';
import { WebTabToolbar } from './WebTabToolbar';
import type { ExternalWebTabId } from '../../types/webTabs';

interface WebTabWorkspaceProps {
  activeTab: ExternalWebTabId | null;
  isSuspended: boolean;
}

/**
 * Hosts the embedded Chat and 3D Generation tabs inside the app window using Electron WebContentsView.
 */
export const WebTabWorkspace: React.FC<WebTabWorkspaceProps> = ({ activeTab, isSuspended }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const {
    hasElectronWebTabs,
    config,
    tabStates,
    actionError,
    clearActionError,
    setTabUrl,
    resetGen3dDefault,
    logoutChat,
    reloadTab,
    navigateHistory,
    closeTabView,
    reopenTabView,
  } = useWebTabs(activeTab, isSuspended, viewportRef);

  if (!activeTab) return null;

  const configuredUrl = activeTab === 'chat' ? config.chatUrl : config.gen3dUrl;
  const runtimeState = tabStates[activeTab];
  const showChatPicker = activeTab === 'chat' && !config.chatUrl;
  const showReopenPrompt = !showChatPicker && !runtimeState.isLoaded && !runtimeState.isLoading;

  return (
    <main className="webtab-workspace" aria-label={activeTab === 'chat' ? 'Aba Chat IA' : 'Aba 3D Generation'}>
      <WebTabToolbar
        activeTab={activeTab}
        configuredUrl={configuredUrl}
        runtimeState={runtimeState}
        onBack={() => navigateHistory(activeTab, 'back')}
        onForward={() => navigateHistory(activeTab, 'forward')}
        onReload={() => reloadTab(activeTab)}
        onChangeUrl={(url) => setTabUrl(activeTab, url)}
        onResetGen3d={resetGen3dDefault}
        onSwitchChat={() => logoutChat(false)}
        onLogoutChat={() => logoutChat(true)}
        onCloseView={() => closeTabView(activeTab)}
      />

      {(actionError || runtimeState.error) && (
        <div className="webtab-error-bar" role="alert">
          <div className="webtab-error-bar-text">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{actionError || runtimeState.error}</span>
          </div>
          {actionError && (
            <button type="button" className="webtab-action-btn" onClick={clearActionError}>
              Fechar
            </button>
          )}
        </div>
      )}

      <div ref={viewportRef} className="webtab-viewport-slot">
        {!hasElectronWebTabs ? (
          <div className="webtab-empty-state">
            <p>As abas externas integradas estão disponíveis apenas no aplicativo desktop Electron.</p>
          </div>
        ) : showChatPicker ? (
          <AiChatPicker
            onSelectUrl={(url) => setTabUrl('chat', url)}
            errorMessage={actionError}
          />
        ) : showReopenPrompt ? (
          <div className="webtab-empty-state">
            <p className="webtab-empty-title">Aba pausada para economizar memória</p>
            <p className="webtab-empty-subtitle">
              Seu endereço e sessão continuam salvos. Clique abaixo para reabrir.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => reopenTabView(activeTab)}
            >
              <Play size={16} aria-hidden="true" />
              <span>Reabrir página</span>
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
};
