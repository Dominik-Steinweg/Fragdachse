/**
 * Globaler Alphafaktor für additive Effektgrafiken.
 *
 * Das Lightmap-Overlay allein löst die Tagesbalance nicht: Explosionen, Spawn- und
 * Teleportblitze liegen auf `DEPTH_FX` **über** dem Overlay und werden vom Ambient
 * überhaupt nicht erfasst; alles darunter wird zur Nacht hin gedämpft, zum Tag hin aber
 * nicht. Über hellem Boden klippt ein ADD-Layer deshalb zu einer weißen Fläche. Dieser
 * Faktor nimmt ihm zum Tag hin genau so viel Alpha, dass er wieder als Effekt liest.
 *
 * Bewusst ein modulweiter Wert und keine Szenen-Map wie bei `GraphicsQuality`: es gibt
 * genau eine Arena, und `MuzzleFlashRenderer`, `TracerRenderer` oder `BulletRenderer`
 * eine `LightingSystem`-Referenz nur für einen Skalar zu geben wäre die schlechtere
 * Kopplung – diese Renderer haben sonst nichts mit Beleuchtung zu tun.
 *
 * Gesetzt wird der Wert beim Rundenaufbau (`ArenaLifecycleCoordinator`) und beim Ziehen
 * des Debug-Reglers. Er wirkt beim **Erzeugen** eines Objekts: kurzlebige Effekte
 * übernehmen ihn also sofort, langlebige (Flammenring, Energieschild, Bodenfeuer) erst
 * bei ihrer Neuerzeugung. Das ist für ein Debug-Werkzeug in Ordnung; die ehrliche
 * Alternative wäre ein Post-Effekt über das gesamte Effekt-Tiefenband.
 */

let emissiveScale = 1;

export function setEmissiveScale(scale: number): void {
  emissiveScale = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 1;
}

export function getEmissiveScale(): number {
  return emissiveScale;
}

/**
 * Dämpft ein Alpha eines additiv geblendeten Objekts.
 *
 * Der Kurzschluss bei 1 ist nicht bloß Optimierung: er garantiert, dass die Nachtoptik
 * bitgenau unverändert bleibt, statt sich auf Fließkomma-Glück zu verlassen.
 */
export function emissiveAlpha(alpha: number): number {
  if (emissiveScale === 1) return alpha;
  return alpha * emissiveScale;
}
