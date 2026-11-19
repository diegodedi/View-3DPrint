const fs = require('fs');
const path = require('path');
const { protocol } = require('electron');

const ALLOWED_IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const MAX_THUMB_CACHE_ITEMS = 2500;
const MAX_THUMB_CACHE_BYTES = 64 * 1024 * 1024;
const thumbMemoryCache = new Map();
let cachedThumbBytes = 0;

function evictOldestThumbIfNeeded(incomingBytes) {
  while (
    thumbMemoryCache.size >= MAX_THUMB_CACHE_ITEMS ||
    cachedThumbBytes + incomingBytes > MAX_THUMB_CACHE_BYTES
  ) {
    const oldestKey = thumbMemoryCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = thumbMemoryCache.get(oldestKey);
    cachedThumbBytes -= oldest ? oldest.data.byteLength : 0;
    thumbMemoryCache.delete(oldestKey);
  }
}

/**
 * Stores or updates a thumbnail buffer in the in-memory protocol cache.
 * @param {string} filePath
 * @param {Buffer} data
 * @param {string} [version]
 */
function primeLocalAssetCache(filePath, data, version = '') {
  if (!filePath || !data || data.byteLength > MAX_THUMB_CACHE_BYTES) return;
  const mime = ALLOWED_IMAGE_MIME[path.extname(filePath).toLowerCase()];
  if (!mime) return;
  if (thumbMemoryCache.has(filePath)) {
    const prev = thumbMemoryCache.get(filePath);
    cachedThumbBytes -= prev ? prev.data.byteLength : 0;
    thumbMemoryCache.delete(filePath);
  }
  evictOldestThumbIfNeeded(data.byteLength);
  thumbMemoryCache.set(filePath, { data, mime, version: String(version || '') });
  cachedThumbBytes += data.byteLength;
}

function getCachedThumbEntry(filePath, version) {
  const hit = thumbMemoryCache.get(filePath);
  if (!hit) return null;
  if (version && hit.version && hit.version !== version) return null;
  thumbMemoryCache.delete(filePath);
  thumbMemoryCache.set(filePath, hit);
  return hit;
}

function buildImageResponse(data, mime, isImmutable = false) {
  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    },
  });
}

/**
 * Registers privileged scheme options before app ready.
 */
function registerLocalAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'local-asset',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/**
 * Handles local-asset://thumb?path=... image requests with RAM LRU + HTTP caching.
 */
function registerLocalAssetProtocol() {
  protocol.handle('local-asset', async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = url.searchParams.get('path');
      const version = url.searchParams.get('v') || '';
      if (!filePath) return new Response('Missing path', { status: 400 });
      const mime = ALLOWED_IMAGE_MIME[path.extname(filePath).toLowerCase()];
      if (!mime) return new Response('Unsupported image type', { status: 403 });

      const isImmutable = path.basename(filePath).startsWith('auto-');
      const cached = getCachedThumbEntry(filePath, version);
      if (cached) return buildImageResponse(cached.data, cached.mime, isImmutable);

      const data = await fs.promises.readFile(filePath);
      primeLocalAssetCache(filePath, data, version);
      return buildImageResponse(data, mime, isImmutable);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { registerLocalAssetScheme, registerLocalAssetProtocol, primeLocalAssetCache };

