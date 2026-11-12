import fs from 'fs';
import path from 'path';

// Helper de upload direto para GitHub Releases em caso de instabilidade de rede
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;
const token = process.env.GH_TOKEN;
const repo = 'diegodedi/View-3DPrint';
const tag = `v${version}`;

if (!token) {
  console.error('[Upload] Erro: GH_TOKEN não encontrado no ambiente.');
  process.exit(1);
}

async function uploadAsset(releaseId, filePath, assetName, contentType) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[Upload] Arquivo não encontrado: ${filePath}`);
    return;
  }
  const fileData = fs.readFileSync(filePath);
  console.log(`[Upload] Subindo ${assetName} (${(fileData.length / 1024 / 1024).toFixed(1)} MB)...`);
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${assetName}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'Content-Length': fileData.length,
      'User-Agent': 'View3DPrint-Uploader',
    },
    body: fileData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Falha no upload de ${assetName}: ${res.statusText} - ${err}`);
  }
  console.log(`[Upload] ✓ ${assetName} enviado com sucesso!`);
}

async function main() {
  console.log(`[Upload] Buscando Release ${tag} em ${repo}...`);
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'View3DPrint-Uploader' },
  });
  if (!res.ok) throw new Error(`Release ${tag} não encontrada no GitHub.`);
  const release = await res.json();
  const releaseId = release.id;

  const distDir = path.resolve('release');
  const exeName = `View 3DPrint Setup ${version}.exe`;
  const exePath = path.join(distDir, exeName);
  const ymlPath = path.join(distDir, 'latest.yml');

  await uploadAsset(releaseId, ymlPath, 'latest.yml', 'application/x-yaml');
  await uploadAsset(releaseId, exePath, exeName, 'application/octet-stream');
  console.log('[Upload] Concluído com sucesso!');
}

main().catch(console.error);

