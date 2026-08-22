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
  `uniform vec3 uSegmentTintMid[${STATUS_RING_SEGMENT_COUNT}];`,
  `uniform vec3 uSegmentTintDark[${STATUS_RING_SEGMENT_COUNT}];`,
  LIVING_FIELD_GLSL,
  'float bandMask(float radius, float inner, float outer) {',
  '  return step(inner, radius) * step(radius, outer);',
  '}',
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
  '    if (rel > width) continue;',
  `    float activity = 1.0 + band.z * ${(ACTIVE_GAIN - 1).toFixed(3)};`,
  `    float gain = ${FIELD_GAIN.toFixed(3)} * activity * band.w;`,
  '    float coreValue = core * bandMask(radius, arc.z, arc.w) * gain;',
  '    float outerValue = outerLayer * bandMask(radius, band.x, band.y) * gain;',
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
