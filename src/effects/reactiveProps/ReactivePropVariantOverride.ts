/**
 * Lokale Dev-Übersteuerung der Fass-Variante für den A/B-Vergleich. Rein optisch: Sie wirkt nur
 * auf diesem Peer und geht nie über den Draht. `?barrelVariant=toxic` setzt sie beim Laden.
 */
let override: string | null = readUrlOverride();

function readUrlOverride(): string | null {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const value = new URLSearchParams(search).get('barrelVariant');
    return value && /^[a-z0-9_-]+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function getReactivePropVariantOverride(): string | null {
  return override;
}

export function setReactivePropVariantOverride(variant: string | null): void {
  override = variant;
}
