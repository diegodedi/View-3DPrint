const fs = require('fs');
const path = require('path');
const { protocol } = require('electron');

const ALLOWED_IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

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
 * Handles local-asset://thumb?path=... image requests directly with HTTP caching.
 */
function registerLocalAssetProtocol() {
  protocol.handle('local-asset', async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = url.searchParams.get('path');
      if (!filePath) return new Response('Missing path', { status: 400 });
      const mime = ALLOWED_IMAGE_MIME[path.extname(filePath).toLowerCase()];
      if (!mime) return new Response('Unsupported image type', { status: 403 });
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { registerLocalAssetScheme, registerLocalAssetProtocol };

