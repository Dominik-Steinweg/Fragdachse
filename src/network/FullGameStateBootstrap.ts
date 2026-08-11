/**
 * Keys that make a GameState payload safe as a new-round baseline. A delta payload may omit
 * any of these slices; a latejoiner must only accept a payload that carries every one explicitly.
 */
export const FULL_GAME_STATE_SLICE_KEYS = [
  'p', 'j', 'e', 'r', 'br', 'oc', 'ei', 'fi', 'rc', 'dc', 's', 'f', 'sc', 'tb', 'td',
  'es', 'g', 'rd', 'sl', 'vu', 'fg', 'u', 'pd', 'n', 'ak', 'mt', 'tn', 't', 'b', 'cb', 'cc',
] as const;

export function isCompleteGameStatePayload(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const payload = raw as Record<string, unknown>;
  if (payload._full !== true) return false;
  if (payload.p === null || payload.p === undefined) return false;
  return FULL_GAME_STATE_SLICE_KEYS.every((key) => (
    Object.prototype.hasOwnProperty.call(payload, key)
  ));
}
