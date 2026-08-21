/**
 * GpuVfxEase – die Ease-Typen, die das GPU-VFX-Backend kennt.
 *
 * Bewusst klein gehalten: jeder zusaetzliche Ease-Typ muss auf jeder Lane, die ihn benutzen
 * koennte, ueber `setAnimationEnabled()` vorgewaermt werden, sonst baut Phaser Shader und
 * FrameData beim ersten Auftreten *im Spielverlauf* neu. Neue Eases kommen deshalb erst dazu,
 * wenn ein migrierter Effekt sie wirklich braucht.
 *
 * Die Werte sind Indizes in `GPU_VFX_EASE_NAMES`; im Hotpath wird nur mit den Zahlen
 * gearbeitet, die Namen tauchen ausschliesslich an der Phaser-Grenze auf.
 */
export const GpuVfxEase = {
  /** `base + amplitude * t`. Rechnet mit `timeContinuous`, braucht keine Basis-Korrektur. */
  Linear: 0,
  /** `Quadratic.Out(v) = v * (2 - v)`. Nicht-linear, braucht `gpuVfxEasedBase()`. */
  QuadOut: 1,
  /** `0.5 * layer.gravity * gravityFactor * t^2`; nimmt `velocity` statt `amplitude`. */
  Gravity: 2,
} as const;

export type GpuVfxEase = (typeof GpuVfxEase)[keyof typeof GpuVfxEase];

/**
 * Namen exakt aus Phasers Rueckwaertsabbildung `SpriteGPULayer.EASE_CODES`. Mehrere Aliase
 * teilen sich einen Code (`Power0` und `Linear` sind beide 1).
 */
export const GPU_VFX_EASE_NAMES: readonly string[] = ['Linear', 'Quad.easeOut', 'Gravity'];

/** Nur `Linear` rechnet ohne den `repeats`-Term des Shaders (siehe `gpuVfxEasedBase`). */
export function isLinearGpuVfxEase(ease: GpuVfxEase): boolean {
  return ease === GpuVfxEase.Linear;
}
