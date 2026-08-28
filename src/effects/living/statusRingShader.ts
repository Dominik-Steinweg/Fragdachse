import { LIVING_FIELD_GLSL } from './livingFieldShader';

/**
 * Fragment-Shader des lebendigen Anteils am `PlayerStatusRing`.
 *
 * Er ersetzt acht klassische Partikel-Emitter (vier Ressourcen zu je einer Kern- und einer
 * Außenschicht, zusammen rund 350 gleichzeitig lebende Partikel) durch einen einzigen Quad.
 *
 * Das Blob-Feld wird im lokalen Pixelraum des Quads ausgewertet — die früheren Partikel waren
 * runde Blobs in Weltkoordinaten, keine ringförmig verzerrten. Erst danach maskiert ein Polartest
 * auf den gefüllten Winkelsektor und das Radienband; das entspricht exakt der Verwerfung, die die
 * frühere `ArcRingRandomSource` beim Ziehen der Emit-Position vorgenommen hat.
 *
 * Segmentreihenfolge: 0 = HP, 1 = Adrenalin, 2 = Rage, 3 = Armor.
 */

export const STATUS_RING_SHADER_NAME = 'FragdachseStatusRing';
export const STATUS_RING_FILL_SHADER_NAME = 'FragdachseStatusRingFill';
export const STATUS_RING_SEGMENT_COUNT = 4;

// Kern- und Außenschicht, in lokalen Pixeln bzw. Sekunden. Übernommen aus den früheren
// Emitter-Rampen des Rings (Blobtextur 20 px, scale 0.72→0.28 bzw. 1.05→0.5).
const CORE_CELL = 14;
const CORE_LIFE = 1.75;
const CORE_DIAMETER_START = 26;
const CORE_DIAMETER_END = 10;
const CORE_ALPHA_START = 0.09;
const CORE_ALPHA_END = 0.035;
const CORE_DRIFT = 2;

const OUTER_CELL = 22;
const OUTER_LIFE = 2.05;
const OUTER_DIAMETER_START = 38;
const OUTER_DIAMETER_END = 18;
const OUTER_ALPHA_START = 0.14;
const OUTER_ALPHA_END = 0.035;
const OUTER_DRIFT = 1;

// Die alten Blobtexturen wurden nur innerhalb des Bands emittiert, liefen als weiche Sprites
// aber einige Pixel ueber dessen Kanten. Diese kleinen GPU-Feather stellen denselben Spielraum
// wieder her, ohne die Feld- oder GameObject-Struktur zu vergroessern.
const CORE_INNER_FEATHER = 1.2;
const CORE_OUTER_FEATHER = 1.6;
const OUTER_INNER_FEATHER = 4.0;
const OUTER_OUTER_FEATHER = 6.0;
const SEGMENT_END_FEATHER_RAD = 0.08;

/** Schmale analytische Kanten fuer die normale Fuellung, ungefaehr ein sichtbarer Pixel. */
const FILL_EDGE_FEATHER_PX = 0.75;
const FILL_SEGMENT_END_FEATHER_RAD = 0.03;

const RING_MASK_GLSL = [
  'float bandMask(float radius, float inner, float outer, float innerFeather, float outerFeather) {',
  '  float innerFade = smoothstep(inner - innerFeather, inner, radius);',
  '  float outerFade = 1.0 - smoothstep(outer, outer + outerFeather, radius);',
  '  return innerFade * outerFade;',
  '}',
  'float segmentMask(float rel, float width, float edge) {',
  '  float startFade = smoothstep(-edge, 0.0, rel);',
  '  float endFade = 1.0 - smoothstep(width, width + edge, rel);',
  '  return startFade * endFade;',
  '}',
].join('\n');

/**
 * Wie beim Balkenfeld trägt das Hash-Gitter weniger, dafür größere Blobs als die früheren
 * Emitter. Der Faktor gleicht die geringere Überdeckung aus.
 */
const FIELD_GAIN = 2.4;

/** Dichteanhebung im aktiven Zustand — früher die Frequenzumschaltung von 48 ms auf 20 ms. */
const ACTIVE_GAIN = 2.4;

const TAU = '6.28318530718';

export const STATUS_RING_FRAGMENT_SOURCE = [
  '#pragma phaserTemplate(shaderName)',
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'varying vec2 outTexCoord;',
  'uniform float uTime;',
  'uniform float uAlpha;',
  'uniform vec2 uSize;',
  // x = Startwinkel des Sektors (Bogenmass, von oben im Uhrzeigersinn), y = vorzeichenbehaftete
  // Sektorbreite, zw = Innen-/Aussenradius der Kernschicht.
  `uniform vec4 uSegmentArc[${STATUS_RING_SEGMENT_COUNT}];`,
  // xy = Innen-/Aussenradius der Aussenschicht, z = Aktivitaet (0 oder 1), w = Alphaskalierung.
  // w == 0 schaltet das Segment vollstaendig ab.
  `uniform vec4 uSegmentBand[${STATUS_RING_SEGMENT_COUNT}];`,
  // xy = normale Fill-Radien, z = Haupt-Alpha, w = Alpha des inneren Akzents.
  `uniform vec4 uSegmentFill[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintMid[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintLight[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintDark[${STATUS_RING_SEGMENT_COUNT}];`,
  LIVING_FIELD_GLSL,
  'uniform float uAmbientPulse;',
  RING_MASK_GLSL,
  'void main () {',
  // ShaderQuad uses WebGL texture coordinates (y=1 at the visual top). Convert them to the
  // same screen-space axes as `degToRadFromTop` in PlayerStatusRing (x right, y down).
  '  vec2 local = vec2(outTexCoord.x - 0.5, 0.5 - outTexCoord.y) * uSize;',
  '  float radius = length(local);',
  // Winkel von oben im Uhrzeigersinn — dieselbe Konvention wie `degToRadFromTop` auf der
  // TypeScript-Seite. `atan` liefert [-PI, PI], die Ringwinkel liegen aber in [0, TAU).
  `  float angle = mod(atan(local.x, -local.y) + ${TAU}, ${TAU});`,
  '  float core = livingField(',
  `    local, uTime, ${CORE_CELL.toFixed(1)}, 0.0, ${CORE_LIFE.toFixed(4)},`,
  `    ${CORE_DIAMETER_START.toFixed(1)}, ${CORE_DIAMETER_END.toFixed(1)},`,
  `    ${CORE_ALPHA_START.toFixed(4)}, ${CORE_ALPHA_END.toFixed(4)}, ${CORE_DRIFT.toFixed(1)}, 5.23`,
  '  );',
  '  float outerLayer = livingField(',
  `    local, uTime, ${OUTER_CELL.toFixed(1)}, 0.0, ${OUTER_LIFE.toFixed(4)},`,
  `    ${OUTER_DIAMETER_START.toFixed(1)}, ${OUTER_DIAMETER_END.toFixed(1)},`,
  `    ${OUTER_ALPHA_START.toFixed(4)}, ${OUTER_ALPHA_END.toFixed(4)}, ${OUTER_DRIFT.toFixed(1)}, 17.89`,
  '  );',
  '  vec3 accum = vec3(0.0);',
  '  float coverage = 0.0;',
  `  for (int i = 0; i < ${STATUS_RING_SEGMENT_COUNT}; i++) {`,
  '    vec4 arc = uSegmentArc[i];',
  '    vec4 band = uSegmentBand[i];',
  '    float width = abs(arc.y);',
  '    if (band.w <= 0.0 || width < 0.0001) continue;',
  // `arc.y` is the signed TypeScript delta from `getFilledSection`: preserve its direction and
  // compare both angles in the same normalized domain as `angle`.
  `    float start = mod(arc.x + ${TAU}, ${TAU});`,
  `    float rel = arc.y >= 0.0 ? mod(angle - start + ${TAU}, ${TAU}) : mod(start - angle + ${TAU}, ${TAU});`,
  // Auch knapp vor dem Startwinkel kann noch der weiche Blobrand liegen. In den signierten
  // Bereich zurueckfalten, damit segmentMask() beide Enden symmetrisch auslaufen laesst.
  '    float signedRel = rel > 3.14159265359 ? rel - ' + TAU + ' : rel;',
  `    float sectorValue = segmentMask(signedRel, width, ${SEGMENT_END_FEATHER_RAD.toFixed(4)});`,
  '    if (sectorValue <= 0.0) continue;',
  `    float activity = 1.0 + band.z * ${(ACTIVE_GAIN - 1).toFixed(3)};`,
  `    float gain = ${FIELD_GAIN.toFixed(3)} * activity * band.w;`,
  '    vec4 fill = uSegmentFill[i];',
  // Der permanente Glow nutzt dieselben analytischen Radial- und Winkelmasken wie die Blobs.
  '    float glowWide = i == 3',
  '      ? bandMask(radius, fill.x - 2.4, fill.y + 3.2, 1.8, 2.2)',
  '      : bandMask(radius, fill.x - 4.2, fill.y + 4.2, 2.4, 2.4);',
  '    float glowMid = i == 3',
  '      ? bandMask(radius, fill.x - 0.8, fill.y + 1.8, 1.2, 1.5)',
  '      : bandMask(radius, fill.x - 2.4, fill.y + 2.4, 1.8, 1.8);',
  '    float glowNear = i == 3',
  '      ? 0.0',
  '      : bandMask(radius, fill.x - 0.8, fill.y + 1.2, 1.0, 1.2);',
  '    float glowWideAlpha = i == 3 ? 0.07 : 0.055;',
  '    float glowMidAlpha = i == 3 ? 0.11 : 0.075;',
  `    float glowSector = segmentMask(signedRel, width, ${SEGMENT_END_FEATHER_RAD.toFixed(4)});`,
  '    float glowCoverage = (glowWide * glowWideAlpha + glowMid * glowMidAlpha + glowNear * 0.1)',
  '      * glowSector * uAmbientPulse;',
  '    accum += (uSegmentTintMid[i] * glowWide * glowWideAlpha',
  '      + uSegmentTintLight[i] * (glowMid * glowMidAlpha + glowNear * 0.1))',
  '      * glowSector * uAmbientPulse;',
  '    coverage += glowCoverage;',
  `    float coreValue = core * bandMask(radius, arc.z, arc.w, ${CORE_INNER_FEATHER.toFixed(1)}, ${CORE_OUTER_FEATHER.toFixed(1)}) * gain * sectorValue;`,
  `    float outerValue = outerLayer * bandMask(radius, band.x, band.y, ${OUTER_INNER_FEATHER.toFixed(1)}, ${OUTER_OUTER_FEATHER.toFixed(1)}) * gain * sectorValue;`,
  // Die frueheren Tint-Listen waren [mid, dark, mid] fuer die Kern- und [dark, dark, mid] fuer
  // die Aussenschicht — im Mittel zwei Drittel mid bzw. zwei Drittel dark.
  '    accum += mix(uSegmentTintDark[i], uSegmentTintMid[i], 0.67) * coreValue;',
  '    accum += mix(uSegmentTintMid[i], uSegmentTintDark[i], 0.67) * outerValue;',
  '    coverage += coreValue + outerValue;',
  '  }',
  // Vormultipliziert: `accum` ist bereits Farbe mal Deckung.
  '  gl_FragColor = vec4(clamp(accum, 0.0, 1.0) * uAlpha, clamp(coverage, 0.0, 1.0) * uAlpha);',
  '}',
].join('\n');

/**
 * Analytische Basisfuellung des Rings. Der Quad teilt sich die Winkelpuffer mit dem Living-Quad,
 * bleibt aber unabhaengig von der Qualitaetsstufe des lebendigen Feldes aktiv.
 */
export const STATUS_RING_FILL_FRAGMENT_SOURCE = [
  '#pragma phaserTemplate(shaderName)',
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'varying vec2 outTexCoord;',
  'uniform float uAlpha;',
  'uniform vec2 uSize;',
  `uniform vec4 uSegmentArc[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec4 uSegmentFill[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintMid[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintLight[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintDark[${STATUS_RING_SEGMENT_COUNT}];`,
  RING_MASK_GLSL,
  'vec4 over(vec4 under, vec3 color, float alpha) {',
  '  alpha = clamp(alpha, 0.0, 1.0);',
  '  float remaining = 1.0 - under.a;',
  '  return vec4(under.rgb + color * alpha * remaining, under.a + alpha * remaining);',
  '}',
  'void main () {',
  // ShaderQuad uses WebGL texture coordinates (y=1 at the visual top). Keep the ring's
  // screen-space convention identical to the living shader.
  '  vec2 local = vec2(outTexCoord.x - 0.5, 0.5 - outTexCoord.y) * uSize;',
  '  float radius = length(local);',
  `  float angle = mod(atan(local.x, -local.y) + ${TAU}, ${TAU});`,
  '  vec4 accum = vec4(0.0);',
  `  for (int i = 0; i < ${STATUS_RING_SEGMENT_COUNT}; i++) {`,
  '    vec4 arc = uSegmentArc[i];',
  '    vec4 fill = uSegmentFill[i];',
  '    float width = abs(arc.y);',
  '    if (fill.z <= 0.0 || width < 0.0001) continue;',
  `    float start = mod(arc.x + ${TAU}, ${TAU});`,
  `    float rel = arc.y >= 0.0 ? mod(angle - start + ${TAU}, ${TAU}) : mod(start - angle + ${TAU}, ${TAU});`,
  '    float signedRel = rel > 3.14159265359 ? rel - ' + TAU + ' : rel;',
  `    float sector = segmentMask(signedRel, width, ${FILL_SEGMENT_END_FEATHER_RAD.toFixed(4)});`,
  '    if (sector <= 0.0) continue;',
  // The small radial feather is deliberately close to one pixel: it removes polygon stair-steps
  // while keeping the authored six-pixel ring crisp.
  `    float ring = bandMask(radius, fill.x, fill.y, ${FILL_EDGE_FEATHER_PX.toFixed(2)}, ${FILL_EDGE_FEATHER_PX.toFixed(2)}) * sector;`,
  `    float highlight = bandMask(radius, fill.x + 0.9, min(fill.x + 3.3, fill.y), ${FILL_EDGE_FEATHER_PX.toFixed(2)}, ${FILL_EDGE_FEATHER_PX.toFixed(2)}) * sector;`,
  `    float darkEdge = bandMask(radius, fill.y - 1.4, fill.y, ${FILL_EDGE_FEATHER_PX.toFixed(2)}, ${FILL_EDGE_FEATHER_PX.toFixed(2)}) * sector;`,
  '    accum = over(accum, uSegmentTintMid[i], ring * fill.z);',
  '    accum = over(accum, uSegmentTintLight[i], highlight * fill.w);',
  '    accum = over(accum, uSegmentTintDark[i], darkEdge * 0.24);',
  '  }',
  // Phaser's NORMAL blend uses ONE as source factor; keep the accumulated color premultiplied.
  '  gl_FragColor = vec4(clamp(accum.rgb, 0.0, 1.0) * uAlpha, clamp(accum.a, 0.0, 1.0) * uAlpha);',
  '}',
].join('\n');
