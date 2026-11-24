export type WorkspaceTabId = 'viewer' | 'chat' | 'gen3d' | 'hi3d';
export type ExternalWebTabId = 'chat' | 'gen3d';

export interface WebTabBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebTabsConfig {
  chatUrl: string | null;
  gen3dUrl: string;
  defaultGen3dUrl: string;
  loadedTabs: ExternalWebTabId[];
}

export interface WebTabRuntimeState {
  isLoaded: boolean;
  isLoading: boolean;
  currentUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
}

export interface WebTabStateEvent {
  tabId: ExternalWebTabId;
  isLoaded?: boolean;
  isLoading?: boolean;
  currentUrl?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: string | null;
}

export interface AiChatPreset {
  id: string;
  name: string;
  url: string;
  description: string;
}

export const DEFAULT_GEN3D_URL = 'https://hy3d.tencent.ai/';

export const AI_CHAT_PRESETS: AiChatPreset[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', description: 'OpenAI' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', description: 'Anthropic' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', description: 'Google' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', description: 'Busca com IA' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', description: 'DeepSeek' },
];

export interface WebTabsBridgeAPI {
  getConfig: () => Promise<WebTabsConfig>;
  activate: (
    tabId: ExternalWebTabId | null,
    bounds?: WebTabBounds
  ) => Promise<{ activeTabId: ExternalWebTabId | null; needsSelection?: boolean; currentUrl?: string }>;
  setBounds: (bounds: WebTabBounds) => Promise<boolean>;
  setSuspended: (suspended: boolean) => Promise<boolean>;
  setUrl: (
    tabId: ExternalWebTabId,
    url: string,
    bounds?: WebTabBounds
  ) => Promise<{ config: { chatUrl: string | null; gen3dUrl: string }; currentUrl: string }>;
  resetGen3d: (
    bounds?: WebTabBounds
  ) => Promise<{ config: { chatUrl: string | null; gen3dUrl: string }; currentUrl: string }>;
  logoutChat: (
    clearSession: boolean
  ) => Promise<{ config: { chatUrl: string | null; gen3dUrl: string } }>;
  reload: (tabId: ExternalWebTabId) => Promise<boolean>;
  navigateHistory: (tabId: ExternalWebTabId, direction: 'back' | 'forward') => Promise<boolean>;
  closeView: (tabId: ExternalWebTabId) => Promise<boolean>;
  onStateChanged: (listener: (event: WebTabStateEvent) => void) => () => void;
}
