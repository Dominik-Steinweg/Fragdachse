/**
 * Kanonische JSON-Form und Hash fuer Dawn-Vertraege.
 *
 * Plaene und Content-Registries werden ueber Peers hinweg verglichen. Die Form ist deshalb
 * unabhaengig von der Schluesselreihenfolge; `undefined`-Felder entfallen wie in JSON.
 */
export function toCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`[dawnCanonicalJson] Non-finite number cannot be serialized: ${value}`);
    }
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(toCanonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${toCanonicalJson(entry)}`).join(',')}}`;
}

/**
 * 64-Bit-FNV-1a (zwei unabhaengige 32-Bit-Laeufe) ueber die kanonische Form. Erkennt Drift
 * zwischen Peers; ist keine kryptografische Integritaetspruefung.
 */
export function hashCanonicalJson(value: unknown): string {
  const text = toCanonicalJson(value);
  return `${fnv1a32(text, 0x811c9dc5)}${fnv1a32(text, 0x01000193)}`;
}

function fnv1a32(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
