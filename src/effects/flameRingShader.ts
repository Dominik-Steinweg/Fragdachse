/**
 * Prozeduraler Flammenring: Flammenzungen, heißer Kern, Rußsaum und Glutfunken entstehen
 * vollständig im Fragment-Shader auf einem Quad je Ring – ohne CPU-Partikelzustand.
 *
 * Koordinaten sind Weltpixel relativ zum Ringzentrum. Das Rauschfeld wird radial nach
 * außen advektiert (`p - dir * t * v`), dadurch lecken die Zungen vom Ring weg und die
 * Naht bei ±π entfällt, weil das Feld kartesisch statt polar abgetastet wird.
 *
 * Ausgabe ist premultiplied für `BlendModes.NORMAL`: RGB trägt die Emission, Alpha nur die
 * Abdunklung (Ruß, Flammenkörper). So bleibt der Ring über hellem Tagesboden lesbar, statt
 * wie ein ADD-Layer zu Weiß zu klippen.
 */
export const FLAME_RING_SHADER_NAME = 'FragdachseFlameRing';
/** Weiteste Ausdehnung außerhalb der Ringlinie (Zungen, Funkenflug, Rußsaum) in Weltpixeln. */
export const FLAME_RING_OUTER_REACH = 58;

export const FLAME_RING_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
uniform float uSize;
uniform float uRadius;
uniform float uBand;
uniform float uTime;
uniform float uSeed;
uniform float uPixelSize;
uniform float uDetail;
uniform float uEmission;
uniform float uIgnite;
uniform float uFade;
uniform float uIgniteAngle;
uniform float uEmberCells;
const float TAU = 6.28318530718;
const float PI = 3.14159265359;

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
vec3 hash31(float n) {
    vec3 p = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.xxy + p.yzz) * p.zyx);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
}
// Rotation zwischen den Oktaven verhindert achsparallele Muster im Top-down-Bild.
float fbm(vec2 p) {
    const mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    float sum = 0.5 * noise(p);
    p = rot * p * 2.03 + 11.7;
    sum += 0.25 * noise(p);
    p = rot * p * 2.01 + 5.3;
    float norm = 0.75;
    if (uDetail > 0.5) { sum += 0.125 * noise(p); norm += 0.125; p = rot * p * 2.02 + 3.1; }
    if (uDetail > 1.5) { sum += 0.0625 * noise(p); norm += 0.0625; }
    return sum / norm;
}

// Schwarzkörper-nahe Rampe: Glut, Orange, Gelb, fast weißer Kern.
vec3 fireRamp(float h) {
    vec3 c = mix(vec3(0.42, 0.04, 0.01), vec3(0.93, 0.20, 0.03), smoothstep(0.0, 0.3, h));
    c = mix(c, vec3(1.0, 0.50, 0.08), smoothstep(0.25, 0.55, h));
    c = mix(c, vec3(1.0, 0.80, 0.30), smoothstep(0.52, 0.8, h));
    return mix(c, vec3(1.0, 0.97, 0.82), smoothstep(0.8, 1.0, h));
}

float angularDistance(float a, float b) {
    return abs(mod(a - b + PI, TAU) - PI);
}

void main() {
    vec2 p = (vec2(outTexCoord.x, 1.0 - outTexCoord.y) - 0.5) * uSize;
    float r = length(p);
    float d = r - uRadius;
    if (d > ${FLAME_RING_OUTER_REACH.toFixed(1)} || d < -uBand - 22.0) { gl_FragColor = vec4(0.0); return; }

    vec2 dir = p / max(r, 0.001);
    float angle = atan(p.y, p.x);
    float aa = max(uPixelSize, 0.5);
    float t = uTime;
    vec2 seed = vec2(uSeed * 0.173, uSeed * 0.091);

    // Zündung läuft von einem Punkt aus in beide Richtungen um den Ring; die Front glüht auf.
    float front = uIgnite * (PI + 0.35);
    float ignDist = angularDistance(angle, uIgniteAngle);
    float lit = 1.0 - smoothstep(front - 0.35, front, ignDist);
    float frontFlare = (1.0 - smoothstep(0.0, 0.3, abs(ignDist - front + 0.18))) * (1.0 - uIgnite);
    float life = lit * uFade;

    // Zwei entgegengesetzt driftende Felder: nach außen leckende Zungen plus langsames Brodeln.
    vec2 flow = p - dir * t * 34.0;
    vec2 warp = vec2(noise(p * 0.045 + seed + t * 0.35), noise(p * 0.045 - seed - t * 0.31)) - 0.5;
    float tongues = fbm(flow * 0.072 + seed + warp * 1.4);
    float boil = fbm(p * 0.11 - seed + vec2(t * 0.9, -t * 0.7) + warp);
    // Kontrastspreizung: fbm streut eng um 0.5, erst gespreizt entstehen klare Zungen und Lücken.
    float n = smoothstep(0.22, 0.78, mix(tongues, boil, 0.3));

    float outward = max(d, 0.0);
    float inward = max(-d, 0.0);
    float falloff = outward / (34.0 * mix(0.35, 1.0, life)) + inward / (uBand + 14.0);
    // Der Kern deckt die Trefferbreite durchgehend ab; die Zungen variieren nur darüber.
    float core = exp(-(d * d) / (uBand * uBand * 0.55));
    float heat = n * 1.35 - falloff + core * 0.3 - 0.3;
    // Glutlinie als Untergrenze: die Trefferzone bleibt auch in Rauschlücken lesbar.
    heat = max(heat, core * (0.26 + 0.12 * boil));
    heat = clamp(heat + frontFlare * 0.6, 0.0, 1.0) * life;

    float body = smoothstep(0.03, 0.03 + 0.12 + aa * 0.02, heat);
    float flicker = 0.9 + 0.1 * sin(t * 13.0 + angle * 3.0 + uSeed) * sin(t * 7.3 - angle * 5.0);
    vec3 emission = fireRamp(heat) * body * (0.45 + 0.95 * heat) * flicker;

    // Warmer Bodenschein und Rußsaum lesen als Hitze, ohne den Ring flächig aufzuhellen.
    // Das Fenster endet vor den Abschneidegrenzen, sonst zeichnet sich der Quad-Rand ab.
    float window = smoothstep(-uBand - 22.0, -uBand - 6.0, d)
        * (1.0 - smoothstep(${(FLAME_RING_OUTER_REACH - 14).toFixed(1)}, ${FLAME_RING_OUTER_REACH.toFixed(1)}, d));
    float groundGlow = exp(-(d * d) / 900.0) * 0.16 * life * window;
    emission += vec3(1.0, 0.36, 0.06) * groundGlow;
    float soot = exp(-((d - 6.0) * (d - 6.0)) / 700.0) * 0.2 * life * window;

    // Glutfunken: je Winkelzelle ein Funke, der nach außen fliegt, glimmt und verlischt.
    float cells = max(uEmberCells, 6.0);
    float cellPos = (angle / TAU + 0.5) * cells;
    float cellIndex = floor(cellPos);
    float sparks = 0.0;
    float layers = uDetail > 1.5 ? 2.0 : 1.0;
    for (int layer = 0; layer < 2; layer++) {
        if (float(layer) >= layers) break;
        for (int k = -1; k <= 1; k++) {
            float c = mod(cellIndex + float(k), cells);
            vec3 h = hash31(c * 1.37 + float(layer) * 91.7 + uSeed * 3.1);
            if (h.x < 0.35) continue;
            float age = fract(t * (0.5 + 0.55 * h.y) + h.z);
            float a = ((c + 0.5 + (h.z - 0.5) * 0.9) / cells) * TAU - PI;
            a += (h.y - 0.5) * age * 0.9 * (40.0 / max(uRadius, 40.0));
            float rad = uRadius + (h.x - 0.5) * uBand + age * (18.0 + 30.0 * h.y);
            vec2 ep = vec2(cos(a), sin(a)) * rad;
            ep += vec2(sin(t * 9.0 + h.z * 20.0), cos(t * 8.0 + h.y * 20.0)) * 1.4 * age;
            float size = mix(1.7, 0.7, age);
            float dd = length(p - ep);
            float glow = exp(-(dd * dd) / (size * size + aa * aa * 0.6));
            float fadeInOut = smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.6);
            sparks += glow * fadeInOut;
        }
    }
    sparks *= life;
    emission += mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.92, 0.6), clamp(sparks, 0.0, 1.0)) * sparks * 1.3;

    emission *= uEmission;
    float alpha = clamp(body * (0.28 + 0.3 * heat) * life + soot + sparks * 0.2, 0.0, 1.0);
    gl_FragColor = vec4(emission, alpha);
}
`;
