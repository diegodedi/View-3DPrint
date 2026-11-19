const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_GEN3D_URL = 'https://hy3d.tencent.ai/';
const TAB_PARTITIONS = {
  chat: 'persist:ai-chat',
  gen3d: 'persist:3d-gen',
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'web-tabs-config.json');
}

function getDefaultConfig() {
  return { chatUrl: null, gen3dUrl: DEFAULT_GEN3D_URL };
}

/**
 * Loads saved web tabs URLs from userData.
 * @returns {{ chatUrl: string | null, gen3dUrl: string }}
 */
function loadWebTabsConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return getDefaultConfig();
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      chatUrl: typeof parsed.chatUrl === 'string' && parsed.chatUrl.trim() ? parsed.chatUrl : null,
      gen3dUrl: typeof parsed.gen3dUrl === 'string' && parsed.gen3dUrl.trim()
        ? parsed.gen3dUrl
        : DEFAULT_GEN3D_URL,
    };
  } catch {
    return getDefaultConfig();
  }
}

/**
 * Persists partial web tabs config to userData.
 * @param {Partial<{ chatUrl: string | null, gen3dUrl: string }>} patch
 */
function saveWebTabsConfig(patch) {
  const merged = { ...loadWebTabsConfig(), ...patch };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/**
 * Validates and normalizes an external HTTP/HTTPS URL.
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizeWebUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) throw new Error('Informe um endereço de site válido.');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas endereços HTTP ou HTTPS são permitidos.');
  }
  return parsed.toString();
}

/**
 * Strips Electron identifiers so OAuth/external sites recognize standard Chromium.
 * @param {string} rawUa
 */
function buildChromeUserAgent(rawUa) {
  return String(rawUa || '')
    .replace(/\s*Electron\/[^\s]+/gi, '')
    .replace(/\s*view-3dprint\/[^\s]+/gi, '')
    .trim();
}

/**
 * Sanitizes integer bounds for WebContentsView placement.
 * @param {{ x?: number, y?: number, width?: number, height?: number }} bounds
 */
function sanitizeBounds(bounds) {
  return {
    x: Math.max(0, Math.round(Number(bounds?.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds?.y) || 0)),
    width: Math.max(0, Math.round(Number(bounds?.width) || 0)),
    height: Math.max(0, Math.round(Number(bounds?.height) || 0)),
  };
}

module.exports = {
  DEFAULT_GEN3D_URL,
  TAB_PARTITIONS,
  loadWebTabsConfig,
  saveWebTabsConfig,
  normalizeWebUrl,
  buildChromeUserAgent,
  sanitizeBounds,
};
