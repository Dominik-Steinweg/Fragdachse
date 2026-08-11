/**
 * Zusammenfassung der Offscreen-Randpfeile für Nebenmissionsziele.
 *
 * Grundsatz: Jedes offene Ziel bekommt seinen eigenen Pfeil – auch das einer Mission im
 * Hintergrund. Erst wenn zwei Pfeile am Bildschirmrand so dicht beieinander lägen, dass sie
 * ineinander laufen, werden sie zu einem Pfeil mit Anzahl zusammengefasst. Phaser-frei, damit
 * die Regel ohne Szene testbar bleibt.
 *
 * Weil damit mehrere Pfeile gleichzeitig am Rand stehen, trägt jeder Kandidat seine Kategorie:
 * Sie bestimmt die Leitfarbe des Pfeils. **Nur Kandidaten derselben Kategorie dürfen
 * zusammengefasst werden** – ein gemischter Pfeil hätte keine gültige Farbe mehr und würde
 * seine Zugehörigkeit falsch behaupten.
 */

export interface EdgeMarkerCandidate {
  /** Bereits auf die Bildschirmkante projizierter Punkt. */
  readonly screenX: number;
  readonly screenY: number;
  /** Weltwinkel zum Ziel; der Pfeil zeigt entlang dieser Richtung. */
  readonly angle: number;
  readonly distancePx: number;
  /** Farbkategorie des Ziels; nur Gleiches wird zu einem Pfeil zusammengefasst. */
  readonly category: string;
}

export interface EdgeMarkerCluster extends EdgeMarkerCandidate {
  /** Anzahl zusammengefasster Ziele; 1 bedeutet ein einzelnes Ziel. */
  readonly count: number;
}

/**
 * Fasst Kandidaten derselben Kategorie zusammen, deren projizierte Punkte näher als
 * `minSeparationPx` beieinander liegen. Position, Winkel und Distanz stammen dabei immer vom
 * **nächstgelegenen** Ziel der Gruppe: Der Pfeil soll auf das zeigen, was das Team zuerst erreicht.
 */
export function clusterEdgeMarkers(
  candidates: readonly EdgeMarkerCandidate[],
  minSeparationPx: number,
  maxClusters: number,
): EdgeMarkerCluster[] {
  if (candidates.length === 0 || maxClusters <= 0) return [];
  const separationSq = Math.max(0, minSeparationPx) ** 2;
  // Nächstes Ziel zuerst: Es bestimmt damit die Lage seiner Gruppe, und bei Überlauf fallen
  // die entferntesten Gruppen weg statt der relevantesten.
  const ordered = [...candidates].sort((left, right) => left.distancePx - right.distancePx);

  const clusters: { entry: EdgeMarkerCandidate; count: number }[] = [];
  for (const candidate of ordered) {
    const host = clusters.find((cluster) => {
      if (cluster.entry.category !== candidate.category) return false;
      const dx = cluster.entry.screenX - candidate.screenX;
      const dy = cluster.entry.screenY - candidate.screenY;
      return dx * dx + dy * dy <= separationSq;
    });
    if (host) {
      host.count += 1;
      continue;
    }
    if (clusters.length >= maxClusters) continue;
    clusters.push({ entry: candidate, count: 1 });
  }

  return clusters.map((cluster) => ({
    screenX: cluster.entry.screenX,
    screenY: cluster.entry.screenY,
    angle: cluster.entry.angle,
    distancePx: cluster.entry.distancePx,
    category: cluster.entry.category,
    count: cluster.count,
  }));
}

/** Beschriftung eines Randpfeils; `cellSize` rechnet Weltpixel in ganze Meter um. */
export function formatEdgeMarkerLabel(cluster: EdgeMarkerCluster, cellSize: number): string {
  const meters = Math.max(1, Math.round(cluster.distancePx / Math.max(1, cellSize)));
  return cluster.count > 1 ? `${cluster.count}× · ${meters} m` : `${meters} m`;
}
