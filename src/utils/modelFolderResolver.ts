/**
 * Utilitário para identificação e resolução da pasta/local de trabalho de modelos 3D.
 * Determina o caminho canônico do objeto no disco para direcionamento do salvamento de peças.
 */

/**
 * Normaliza separadores de caminho e remove barras finais redundantes.
 */
export function normalizeFolderPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return '';
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  // Substitui barras múltiplas mantendo padrão de plataforma
  const normalized = trimmed.replace(/[/\\]+/g, '\\');
  // Se for raiz de unidade Windows (ex: C:\), preserva
  if (/^[a-zA-Z]:\\?$/.test(normalized)) {
    return normalized.endsWith('\\') ? normalized : `${normalized}\\`;
  }
  return normalized.endsWith('\\') ? normalized.slice(0, -1) : normalized;
}

/**
 * Extrai o diretório pai a partir do caminho de um arquivo de modelo.
 */
export function extractDirectoryFromPath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  const lastSlashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (lastSlashIndex <= 0) return '';
  return normalizeFolderPath(trimmed.slice(0, lastSlashIndex));
}

export interface ResolveObjectFolderOptions {
  folderPath?: string | null;
  modelPath?: string | null;
  fallbackPath?: string | null;
}

/**
 * Identifica o local ou pasta no disco do objeto 3D que está sendo trabalhado.
 * Prioridade: 1) folderPath do objeto -> 2) diretório pai do modelPath -> 3) fallbackPath.
 */
export function resolveWorkingObjectFolder(options: ResolveObjectFolderOptions): string {
  if (options.folderPath && options.folderPath.trim().length > 0) {
    const normalized = normalizeFolderPath(options.folderPath);
    if (normalized) return normalized;
  }

  if (options.modelPath && options.modelPath.trim().length > 0) {
    const fromModel = extractDirectoryFromPath(options.modelPath);
    if (fromModel) return fromModel;
  }

  if (options.fallbackPath && options.fallbackPath.trim().length > 0) {
    return normalizeFolderPath(options.fallbackPath);
  }

  return '';
}

/**
 * Retorna o nome amigável da pasta (último segmento) para exibição na UI.
 */
export function getFolderDisplayName(folderPath: string): string {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return '';
  const parts = normalized.split('\\').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

