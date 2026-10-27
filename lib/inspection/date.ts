// A fresh geolocation result must be close to the time its callback is received.
// Some location providers return nonzero but incorrect timestamps; truthiness
// alone does not make those timestamps safe to use as a business date.
export function getInspectionGpsCapturedAt(timestamp: number, receivedAt = Date.now()): string {
  const isFresh = Number.isFinite(timestamp) && timestamp > 0
    && Math.abs(timestamp - receivedAt) <= 5 * 60 * 1000;
  return new Date(isFresh ? timestamp : receivedAt).toISOString();
}

// Compare saved GPS data with its own record, not today, so historical drafts
// remain historical. Only discard invalid or grossly inconsistent timestamps.
export function hasSuspiciousInspectionGpsTime(capturedAt: string | undefined, savedAt: string): boolean {
  if (!capturedAt) return false; // Older drafts did not store GPS timestamps.
  const captured = Date.parse(capturedAt);
  const saved = Date.parse(savedAt);
  return !Number.isFinite(captured) || (Number.isFinite(saved)
    && Math.abs(captured - saved) > 366 * 24 * 60 * 60 * 1000);
}
