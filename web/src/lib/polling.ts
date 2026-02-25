export const MIN_POLLING_INTERVAL_SECONDS = 5;
export const MAX_POLLING_INTERVAL_SECONDS = 300;
export const DEFAULT_POLLING_INTERVAL_SECONDS = 15;

export const parsePollingIntervalSeconds = (raw: unknown): number | undefined => {
  const parsed = typeof raw === 'number' ? raw : Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  const floored = Math.floor(parsed);
  return Math.min(MAX_POLLING_INTERVAL_SECONDS, Math.max(MIN_POLLING_INTERVAL_SECONDS, floored));
};
