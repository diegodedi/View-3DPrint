/**
 * Formats byte count into human-readable KB or MB string.
 * @param bytes File size in bytes
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

/**
 * Formats a dimension in millimeters with 1 decimal place.
 * @param valueMm Dimension in mm
 */
export function formatMillimeters(valueMm: number): string {
  if (!Number.isFinite(valueMm)) return '0.0 mm';
  return `${valueMm.toFixed(1)} mm`;
}

