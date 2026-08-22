/**
 * Gemeinsamer GLSL-Baustein des "lebendigen" Blob-Feldes.
 *
 * Er ersetzt das Rezept, das `LivingBarEffect` und `PlayerStatusRing` frueher mit klassischen
 * `ParticleEmitter`n nachgebaut haben: viele weiche, additive Blobs, die an zufaelligen Stellen
 * aufblenden, dabei schrumpfen und leicht driften.
 *
 * Statt einer Partikelliste traegt ein Hash-Gitter die Blobs: jede Gitterzelle stellt genau einen
 * Blob, dessen Position, Geburtsphase und Lebensdauer-Jitter aus dem Zellindex gehasht werden.
 * Damit braucht ein Blob weder CPU-Update noch Speicher, und das Feld ist zu jedem Zeitpunkt
 * allein aus `time` reproduzierbar.
 *
 * Zwei Regeln, die beim Anpassen zaehlen:
 * - Der maximale Blobradius darf die Zellgroesse nicht ueberschreiten. Die Auswertung sieht nur
 *   die 3x3-Nachbarschaft; ein groesserer Blob wuerde an der Zellgrenze abgeschnitten.
 * - `wrapCells` macht das Feld in X periodisch. Nur der Hash-Schluessel wird gewickelt, nicht die
 *   Blobposition. Dadurch ist das Feld nach `wrapCells * cell` Einheiten nahtlos identisch und
 *   ein breiter Balken kann aus mehreren Kacheln ohne sichtbare Naht zusammengesetzt werden.
 *   `wrapCells` muss ein ganzzahliger Teiler der Feldbreite sein.
 */
export const LIVING_FIELD_GLSL = `
vec3 livingHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Bildet den vierstufigen Radialverlauf der frueheren '_living_blob'-Canvas-Textur nach:
// 0.8 / 0.4 / 0.1 / 0.0 bei den Radien 0.0 / 0.3 / 0.7 / 1.0.
float livingBlobFalloff(float r) {
  float s0 = mix(0.8, 0.4, clamp(r / 0.3, 0.0, 1.0));
  float s1 = mix(0.4, 0.1, clamp((r - 0.3) / 0.4, 0.0, 1.0));
  float s2 = mix(0.1, 0.0, clamp((r - 0.7) / 0.3, 0.0, 1.0));
  float v = mix(s0, mix(s1, s2, step(0.7, r)), step(0.3, r));
  return v * step(r, 1.0);
}

float livingField(
  vec2 p,
  float timeSec,
  float cell,
  float wrapCells,
  float lifeSec,
  float diameterStart,
  float diameterEnd,
  float alphaStart,
  float alphaEnd,
  float drift,
  float seed
) {
  vec2 base = floor(p / cell);
  float total = 0.0;

  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 id = base + vec2(float(ox), float(oy));
      // Nur der Schluessel wird gewickelt. Die Position bleibt ungewickelt, sonst zerfaellt die
      // Kachelgrenze statt nahtlos zu sein.
      vec2 key = vec2(wrapCells > 0.5 ? mod(id.x, wrapCells) : id.x, id.y);

      vec3 h = livingHash33(vec3(key, seed));
      vec3 g = livingHash33(vec3(key, seed + 19.73));

      float life = lifeSec * (0.75 + 0.5 * g.x);
      float t = fract(timeSec / life + h.z);

      float radius = mix(diameterStart, diameterEnd, t) * 0.5;
      vec2 center = (id + vec2(0.15) + h.xy * 0.7) * cell
                  + vec2(g.y - 0.5, g.z - 0.5) * (2.0 * drift * t * life);

      total += livingBlobFalloff(distance(p, center) / max(radius, 0.001))
             * mix(alphaStart, alphaEnd, t);
    }
  }

  return total;
}
`;

/**
 * Die Feldeinheiten, in denen beide Shader rechnen. Sie sind bewusst von der tatsaechlichen
 * Texturaufloesung entkoppelt: eine niedrigere Qualitaetsstufe rendert dasselbe Feld nur
 * grobkoerniger, sie veraendert nicht die Blobgroesse.
 */
export const LIVING_FIELD_UNIT_WIDTH = 1024;
export const LIVING_FIELD_UNIT_HEIGHT = 128;

/**
 * Eine Balkenhoehe wird auf so viele Feldeinheiten abgebildet. Der Wert stammt aus der frueheren
 * Groessenformel `sf = h / 14` bei einer 20 px grossen Blob-Textur: 64 Feldeinheiten je
 * Balkenhoehe treffen die alten Blobdurchmesser innerhalb weniger Prozent.
 */
export const LIVING_FIELD_UNITS_PER_BAR_HEIGHT = 64;
