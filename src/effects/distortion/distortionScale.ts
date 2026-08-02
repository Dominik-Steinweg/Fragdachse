export interface DistortionAmounts {
  readonly x: number;
  readonly y: number;
}

/**
 * Phaser skaliert Displacement-X mit der Viewportbreite und Displacement-Y mit der Höhe.
 * Derselbe Shaderwert erzeugt auf 16:9 deshalb einen horizontal gestreckten Sog. Beide Achsen
 * werden auf die kürzere Viewportkante bezogen, damit ein radiales Profil auch in Pixeln rund
 * bleibt und der konfigurierte Betrag auf keiner Achse überschritten wird.
 */
export function resolveIsotropicDistortionAmounts(
  amount: number,
  viewportWidth: number,
  viewportHeight: number,
): DistortionAmounts {
  const safeAmount = Math.max(0, amount);
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: safeAmount, y: safeAmount };
  }

  const referenceSize = Math.min(viewportWidth, viewportHeight);
  return {
    x: safeAmount * referenceSize / viewportWidth,
    y: safeAmount * referenceSize / viewportHeight,
  };
}
