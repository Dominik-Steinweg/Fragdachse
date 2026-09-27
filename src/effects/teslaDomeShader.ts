/**
 * Prozedurale Tesla-Kuppel und ihre Zielblitze, vollständig im Fragment-Shader.
 *
 * Die Kuppel ist eine Halbkugel, die aus der orthografischen 90°-Draufsicht betrachtet wird: Sie
 * erscheint als Scheibe, deren Scheitel in der Mitte und deren Bodenkante am Rand liegt. Die
 * räumliche Wirkung entsteht nicht durch Perspektive, sondern durch zwei physikalische Effekte:
 *
 * - Oberflächenmuster werden im Oberflächenraum der Halbkugel abgetastet (azimutal-abstandstreue
 *   Abbildung `dir * asin(rho) * R`). Zum Rand hin staucht sich das Netz deshalb radial, wie es
 *   eine gewölbte Hülle von oben gesehen tut.
 * - Der Blick streift die Hülle am Rand, am Scheitel durchstößt er sie senkrecht. Adernetz,
 *   Fresnel-Glanz und Schleier sammeln sich daher zur Bodenkante hin; die Mitte bleibt frei, damit
 *   Träger, Gegner und Geschosse unter der Kuppel lesbar bleiben.
 *
 * Koordinaten sind Weltpixel relativ zum Kuppelzentrum bzw. im Strahlraum. Ausgabe ist wie beim
 * Flammenring premultiplied für `BlendModes.NORMAL`: RGB trägt die Emission, Alpha nur die Deckung
 * der feinen Linien. So behalten sie auch über hellem Boden ihren Farbton, statt wie ein ADD-Layer
 * zu Weiß oder ins Grüne zu kippen.
 */
export const TESLA_DOME_SHADER_NAME = 'FragdachseTeslaDome';
export const TESLA_BOLT_SHADER_NAME = 'FragdachseTeslaDomeBolt';

/** Reichweite außerhalb der Bodenkante (Bodenschein, Kriechentladungen) in Weltpixeln. */
export const TESLA_DOME_OUTER_REACH = 46;
/** Quad-Reserve hinter dem Strahlursprung in Weltpixeln. */
export const TESLA_BOLT_BACK_PAD = 12;
/** Quad-Reserve hinter dem Ziel für Einschlagblüte und Funken in Weltpixeln. */
export const TESLA_BOLT_FRONT_PAD = 40;
/** Quad-Höhe quer zum Strahl; deckt Zickzack-Ausschlag, Verzweigungen und Glühen ab. */
export const TESLA_BOLT_HEIGHT = 132;
/** Obergrenze des seitlichen Ausschlags, damit Äste und Hof im Quad bleiben. */
export const TESLA_BOLT_MAX_AMPLITUDE = 26;
/** Höchstzahl großer Kriechentladungen auf der Hülle (Schleifengrenze im Shader). */
export const TESLA_DOME_MAX_DISCHARGES = 5;

const SHARED_HEADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
const float TAU = 6.28318530718;
const float PI = 3.14159265359;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}
float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
vec2 hash22(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
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
// Lineares Wertrauschen: geknickter Polygonzug statt weicher Welle – die Grundform eines Blitzes.
// Liefert Wert in [-1, 1] und Steigung je Einheit.
vec2 jagged(float x, float s) {
    float i = floor(x);
    float a = hash11(i + s) * 2.0 - 1.0;
    float b = hash11(i + 1.0 + s) * 2.0 - 1.0;
    return vec2(mix(a, b, fract(x)), b - a);
}
`;

export const TESLA_DOME_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
${SHARED_HEADER}
uniform float uSize;
uniform float uRadius;
uniform float uTime;
uniform float uSeed;
uniform float uPixelSize;
uniform float uDetail;
uniform float uEmission;
uniform float uAlpha;
uniform float uCharge;
uniform float uActivity;
uniform float uSurge;
uniform float uSurgeFront;
uniform float uAppear;
uniform float uVeil;
uniform float uRim;
uniform float uArcs;
uniform float uWaveSpeed;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uHot;
uniform vec3 uCore;

const float CELL = 30.0;
const float REACH = ${TESLA_DOME_OUTER_REACH.toFixed(1)};

float fbm(vec2 p) {
    const mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    float sum = 0.5 * noise(p);
    p = rot * p * 2.03 + 11.7;
    sum += 0.25 * noise(p);
    float norm = 0.75;
    if (uDetail > 0.5) { p = rot * p * 2.01 + 5.3; sum += 0.125 * noise(p); norm += 0.125; }
    return sum / norm;
}

// Abstand zur nächsten Zellgrenze in Zelleinheiten (F2-F1-Näherung). Die Zellkerne wandern
// langsam, dadurch verschieben sich die Risse der Hülle, ohne zu springen.
float cellEdge(vec2 x, float t) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash22(n + g);
            o = 0.5 + 0.38 * sin(t * 0.7 + TAU * o);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
    }
    return (sqrt(d2) - sqrt(d1)) * 0.5;
}

void main() {
    vec2 p = (vec2(outTexCoord.x, 1.0 - outTexCoord.y) - 0.5) * uSize;
    float r = length(p);
    float grow = 1.0 - pow(1.0 - clamp(uAppear, 0.0, 1.0), 3.0);
    float R = max(uRadius * mix(0.1, 1.0, grow), 4.0);
    float d = r - R;
    if (d > REACH) { gl_FragColor = vec4(0.0); return; }

    float aa = max(uPixelSize, 0.5);
    float T = uTime;
    float seed = mod(uSeed, 61.0);
    float act = clamp(uActivity, 0.0, 1.0);
    float charge = max(uCharge, 1.0);
    float birth = 1.0 - grow;
    // Takt des Knisterns: Formen springen in kurzen Schlägen, wie elektrische Überschläge.
    float snap = floor(T * (10.0 + 4.0 * act));
    vec2 snapOffset = vec2(mod(snap, 29.0) * 1.37, mod(snap, 23.0) * 2.11);

    vec3 emission = vec3(0.0);
    float cover = 0.0;

    // ---------- Hülle ----------
    if (d < 0.0) {
        float rho = r / R;
        float nz = sqrt(max(1.0 - rho * rho, 0.0));
        float fres = pow(1.0 - nz, 2.0);
        float rim = pow(1.0 - nz, 6.0);
        // Die Mitte bleibt frei: Struktur und Schleier sammeln sich zur Bodenkante hin, wo der
        // Blick die Hülle streift. Träger, Gegner und Geschosse unter der Kuppel bleiben lesbar.
        float open = smoothstep(0.3, 0.92, rho);
        // Radiale Stauchung der Oberfläche je Bildschirmpixel; feine Muster blenden am Rand aus,
        // bevor sie flimmern würden.
        float compress = 1.0 / max(nz, 0.04);
        float lod = 1.0 - smoothstep(3.0, 8.0, compress * aa);

        // Oberflächenkoordinate: Bogenlänge vom Scheitel, langsam um die Hochachse rotierend.
        float spin = T * 0.09 + seed;
        float cs = cos(spin);
        float sn = sin(spin);
        vec2 dir = p / max(r, 0.001);
        vec2 rd = vec2(dir.x * cs - dir.y * sn, dir.x * sn + dir.y * cs);
        vec2 uv = rd * asin(clamp(rho, 0.0, 1.0)) * R + seed * 17.0;

        // Wogende Energiewolken, nur als lichter Hauch in der Hülle.
        vec2 warp = vec2(noise(uv * 0.017 + T * 0.32), noise(uv * 0.017 - T * 0.27 + 7.1)) - 0.5;
        float cloud = smoothstep(0.3, 0.85, fbm(uv * 0.021 + warp * 2.2 + vec2(T * 0.22, -T * 0.16)));

        // Zellrisse: Grenzen eines langsam wandernden Zellfelds, durch schnappendes Rauschen
        // gezackt – das feine, verästelte Adernetz der Energiehülle.
        float crack = 0.0;
        float crackGlow = 0.0;
        float crackMask = 0.0;
        if (open > 0.001) {
            vec2 jag = vec2(noise(uv * 0.13 + snapOffset), noise(uv * 0.13 - snapOffset + 5.0)) - 0.5;
            float edge = cellEdge((uv + warp * 22.0 + jag * 4.5 * lod) / CELL, T) * CELL;
            float lineW = 0.42 + aa * 0.5;
            crack = exp(-(edge * edge) / (lineW * lineW));
            crackGlow = exp(-edge / 2.6);
            // Aufflackernde Regionen: nicht alle Adern führen gleichzeitig Strom.
            float flare = noise(uv * 0.04 + snapOffset * 0.6);
            crackMask = smoothstep(0.34, 0.72, flare) * (0.65 + 0.35 * act) * open;
        }

        // Große Kriechentladungen: kurzlebige, gezackte Blitzbögen, die an zufälligen Stellen der
        // Hülle zünden, flackernd die Form wechseln und wieder verlöschen. Sie liegen im
        // Oberflächenraum und drehen sich deshalb mit der Hülle.
        float discharge = 0.0;
        float surfaceMax = R * 1.5707963;
        for (int i = 0; i < ${TESLA_DOME_MAX_DISCHARGES}; i++) {
            float fi = float(i);
            if (fi >= uArcs) break;
            float life = T * (1.5 + 0.35 * fi) + fi * 0.37;
            float id = mod(floor(life), 97.0);
            float age = fract(life);
            vec3 h = hash31(id * 3.7 + fi * 19.1 + seed);
            vec3 h2 = hash31(id * 5.3 + fi * 7.7 + seed * 1.3);
            float anchorAngle = h.y * TAU;
            vec2 anchor = vec2(cos(anchorAngle), sin(anchorAngle)) * surfaceMax * (0.4 + 0.52 * h.x) + seed * 17.0;
            float heading = anchorAngle + PI * 0.5 + (h.z - 0.5) * 2.2;
            vec2 dirA = vec2(cos(heading), sin(heading));
            float len = R * (0.28 + 0.34 * h2.x);
            vec2 q = uv - anchor;
            float u = dot(q, dirA);
            if (u > 0.0 && u < len) {
                float v = dot(q, vec2(-dirA.y, dirA.x));
                float t = u / len;
                float flick = mod(snap, 53.0) * 1.7;
                vec2 j1 = jagged(u / 18.0, h2.y * 50.0 + flick);
                vec2 j2 = jagged(u / 6.0, h2.z * 40.0 + flick * 1.3);
                float off = (j1.x + j2.x * 0.35) * len * 0.09 * sin(PI * t);
                float dist = abs(v - off);
                float envelope = sin(PI * t) * smoothstep(0.0, 0.08, age) * (1.0 - age * age);
                discharge += (exp(-(dist * dist) / (0.28 + aa * aa * 0.8)) + 0.18 * exp(-dist / 2.5)) * envelope;
            }
        }
        discharge *= 0.25 + 0.75 * open;

        // Aufsteigende Energiewellen (Boden → Scheitel) und die Front des Überladungsschlags
        // lassen das Adernetz kurz aufleuchten.
        float wave = 1.0 - fract(T * uWaveSpeed + seed * 0.1);
        float band = exp(-pow((rho - wave) * R / 16.0, 2.0));
        float surgeBand = exp(-pow((rho - uSurgeFront) * R / 20.0, 2.0)) * uSurge;

        float veil = uVeil * (0.06 + 1.6 * fres) * (0.5 + 0.7 * cloud);
        float glow = cloud * (0.02 + 0.42 * fres) + rim * 0.8
            + crackGlow * crackMask * (0.1 + 0.12 * band);
        float hot = crack * crackMask * (0.62 + 0.5 * fres + 0.7 * band + 1.2 * surgeBand) * lod
            + surgeBand * 0.12 * open;
        float core = discharge * (0.65 + 0.35 * act)
            + crack * crackMask * smoothstep(0.55, 0.9, crackMask) * 0.25 * lod;
        float energy = 0.75 + 0.25 * charge;
        glow *= energy;
        hot *= energy * (1.0 + birth * 1.5);
        core *= energy;

        // Scheitelpunkt: der Emitter der Kuppel, klein genug, um den Träger nicht zu überstrahlen.
        float apex = exp(-(r * r) / 22.0) * (0.3 + 0.12 * sin(T * 21.0 + seed)) * (0.4 + 0.6 * act);

        // Adern tragen das satte Elektroblau; nur die Hauptentladungen glühen weiß.
        emission += uDeep * veil * 0.7 + uBody * glow + mix(uBody, uHot, 0.45) * hot * 1.15 + uCore * (core + apex);
        cover += veil + glow * 0.08 + hot * 0.6 + core * 0.55;
    }

    // ---------- Bodenkante ----------
    float angle = atan(p.y, p.x);
    float ringCrackle = 0.7 + 0.6 * noise(p * 0.09 + snapOffset);
    float ringCore = exp(-(d * d) / (0.55 + aa * aa * 0.8)) * ringCrackle;
    float ringGlow = exp(-(d * d) / 26.0);
    float ground = d > 0.0 ? exp(-d / 11.0) : 0.0;
    float appearFlash = birth * exp(-(d * d) / 30.0) * 2.2;

    // Kriechentladungen, die von der Bodenkante über den Boden züngeln.
    float tendrils = 0.0;
    if (d > -4.0) {
        float cells = max(floor(TAU * R / 30.0), 8.0);
        float cellPos = (angle / TAU + 0.5) * cells;
        float cellIndex = floor(cellPos);
        for (int k = -1; k <= 1; k++) {
            float c = mod(cellIndex + float(k), cells);
            vec3 h0 = hash31(c * 1.73 + seed * 3.1);
            float rate = 4.0 + 5.0 * h0.y;
            float cycle = floor(T * rate + h0.z);
            float age = fract(T * rate + h0.z);
            vec3 h = hash31(c * 7.31 + mod(cycle, 97.0) * 11.3 + seed);
            if (h.z > 0.16 + 0.22 * act) continue;
            float a = ((c + 0.15 + 0.7 * h.x) / cells) * TAU - PI;
            float lateral = (mod(angle - a + PI, TAU) - PI) * R;
            float len = (8.0 + 20.0 * h.y) * (0.8 + 0.2 * charge);
            vec2 j = jagged(max(d, 0.0) / 5.0, c * 3.7 + mod(cycle, 53.0) * 5.1);
            vec2 j2 = jagged(max(d, 0.0) / 2.2, c * 1.9 + mod(cycle, 47.0) * 3.3);
            float off = (j.x * 4.5 + j2.x * 1.4) * clamp(d / 5.0, 0.0, 1.0);
            float dist = abs(lateral - off);
            float along = smoothstep(-4.0, 0.0, d) * (1.0 - smoothstep(len * 0.6, len, d));
            float life = 1.0 - age;
            tendrils += (exp(-(dist * dist) / (0.3 + aa * aa * 0.5)) + 0.15 * exp(-dist / 2.5)) * along * life;
        }
    }

    float rimEnergy = uRim * (0.85 + 0.15 * charge) * (1.0 + uSurge * 1.2);
    emission += uCore * (ringCore + tendrils * 0.9 + appearFlash) * rimEnergy
        + uHot * ringGlow * 0.6 * rimEnergy
        + uBody * ground * 0.2 * rimEnergy;
    cover += ringCore * 0.6 + ringGlow * 0.12 + ground * 0.03 + tendrils * 0.45;

    // Fenster zur Quad-Kante, damit der Bodenschein keine Kante zeichnet.
    float window = 1.0 - smoothstep(REACH - 12.0, REACH, d);
    float alpha = clamp(uAlpha, 0.0, 1.0) * window;
    gl_FragColor = vec4(emission * uEmission * alpha, clamp(cover, 0.0, 0.7) * alpha);
}
`;

export const TESLA_BOLT_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
${SHARED_HEADER}
uniform vec2 uSize;
uniform float uBack;
uniform float uLength;
uniform float uTime;
uniform float uSeed;
uniform float uPixelSize;
uniform float uDetail;
uniform float uEmission;
uniform float uAlpha;
uniform float uWidth;
uniform float uAmp;
uniform float uBranch;
uniform float uImpact;
uniform float uSurge;
uniform vec3 uBody;
uniform vec3 uHot;
uniform vec3 uCore;

// Querversatz des Blitzkanals in Pixeln (x) und seine Steigung (y). Drei Oktaven geknickter
// Polygonzüge; die Enden sind an Emitter und Ziel festgenagelt.
vec2 channel(float x, float L, float s, float amp) {
    vec2 o1 = jagged(x / 44.0, s);
    vec2 o2 = jagged(x / 15.0, s + 17.0);
    float v = o1.x + 0.42 * o2.x;
    float dv = o1.y / 44.0 + 0.42 * o2.y / 15.0;
    if (uDetail > 0.5) {
        vec2 o3 = jagged(x / 5.5, s + 41.0);
        v += 0.17 * o3.x;
        dv += 0.17 * o3.y / 5.5;
    }
    float t = clamp(x / L, 0.0, 1.0);
    float env = sin(PI * t);
    float denv = PI / L * cos(PI * t);
    return vec2(v * env, dv * env + v * denv) * amp;
}

float strikeDistance(float x, float y, float L, float s, float amp) {
    vec2 c = channel(x, L, s, amp);
    return abs(y - c.x) / sqrt(1.0 + c.y * c.y);
}

void main() {
    vec2 q = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uSize;
    float L = max(uLength, 1.0);
    float x = q.x - uBack;
    float y = q.y - uSize.y * 0.5;
    float T = uTime;
    float aa = max(uPixelSize, 0.5);
    float seed = mod(uSeed, 53.0);
    float surge = clamp(uSurge, 0.0, 1.0);

    // Jeder Schlag hält nur wenige Frames; danach springt der Kanal in eine neue Form.
    float rate = 17.0 + 6.0 * surge;
    float phase = T * rate + seed * 0.37;
    float k = floor(phase);
    float age = fract(phase);
    float s1 = mod(k, 89.0) * 7.13 + seed;
    float strikeFlash = (0.82 + 0.3 * hash11(k * 1.7 + seed)) * (1.0 - 0.28 * age);
    // Nachleuchtender Zweitkanal, zeitversetzt: er lässt den Blitz dichter und lebendiger wirken.
    float k2 = floor(phase + 0.5);
    float s2 = mod(k2, 83.0) * 5.31 + seed + 31.0;

    float amp = uAmp;
    float w = uWidth * (1.0 + 1.3 * surge);
    float inside = smoothstep(-2.0, 2.0, x) * (1.0 - smoothstep(L - 1.0, L + 2.0, x));

    float core = 0.0;
    float inner = 0.0;
    float glow = 0.0;
    if (x > -4.0 && x < L + 4.0) {
        float d1 = strikeDistance(x, y, L, s1, amp);
        float d2 = strikeDistance(x, y, L, s2, amp * 1.25);
        float cw = w * 0.45 + 0.2 + aa * 0.35;
        float iw = w * 1.9 + 1.3;
        core = exp(-(d1 * d1) / (cw * cw)) * strikeFlash;
        inner = exp(-(d1 * d1) / (iw * iw)) * strikeFlash + exp(-(d2 * d2) / (iw * iw * 0.35)) * 0.32;
        glow = exp(-d1 / (6.0 + 6.0 * surge)) * 0.75 + exp(-d2 / 4.5) * 0.15;
        core *= inside;
        inner *= inside;
        glow *= inside;

        // Verzweigungen: kurze, spitz auslaufende Seitenäste je Schlag.
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            vec3 hb = hash31(mod(k, 97.0) * 3.1 + fi * 11.7 + seed * 1.9);
            if (hb.x > uBranch * (1.0 + surge)) continue;
            float xb = L * (0.16 + 0.62 * hb.y);
            float yb = channel(xb, L, s1, amp).x;
            float side = hb.z > 0.5 ? 1.0 : -1.0;
            float theta = side * (0.35 + 0.55 * hash11(hb.z * 91.0 + fi));
            float lenB = min(L * (0.14 + 0.22 * hash11(hb.y * 57.0 + fi)), 44.0);
            vec2 bd = vec2(cos(theta), sin(theta));
            vec2 bq = vec2(x - xb, y - yb);
            float u = dot(bq, bd);
            float v = dot(bq, vec2(-bd.y, bd.x));
            if (u > -2.0 && u < lenB) {
                float tb = clamp(u / lenB, 0.0, 1.0);
                vec2 bj = jagged(u / 8.0, hb.x * 71.0 + fi * 13.0);
                float off = bj.x * amp * 0.3 * tb;
                float bdist = abs(v - off);
                float taper = 1.0 - tb;
                float bw = cw * (0.35 + 0.5 * taper);
                core += exp(-(bdist * bdist) / (bw * bw)) * taper * strikeFlash * 0.8;
                inner += exp(-(bdist * bdist) / (iw * iw * 0.5)) * taper * 0.35;
                glow += exp(-bdist / 5.0) * taper * 0.25;
            }
        }
    }

    // Emitteransatz: kurzer, heißer Knoten am Kuppelscheitel.
    float origin = exp(-(x * x + y * y) / 26.0) * 0.8;

    // Einschlag: pulsierender Kern, Stoßring je Schadenstick und nach außen springende Funkenbögen.
    vec2 e = vec2(x - L, y);
    float de = length(e);
    float impact = 0.0;
    float impactHalo = 0.0;
    float sparks = 0.0;
    if (de < ${(TESLA_BOLT_FRONT_PAD + 4).toFixed(1)}) {
        float strength = uImpact * (1.0 + surge * 1.2);
        float pulse = fract(T * 10.8 + seed * 0.21);
        impact = exp(-(de * de) / (14.0 + 10.0 * strength)) * (0.85 + 0.45 * (1.0 - pulse)) * strength;
        impactHalo = exp(-(de * de) / (220.0 + 180.0 * surge)) * 0.4 * strength;
        float shock = (de - (3.0 + pulse * (14.0 + 10.0 * surge))) / (1.0 + aa * 0.5);
        impactHalo += exp(-shock * shock) * (1.0 - pulse) * 0.5 * strength;

        float cells = 9.0;
        float ang = atan(e.y, e.x);
        float cidx = floor((ang / TAU + 0.5) * cells);
        for (int j = -1; j <= 1; j++) {
            float c = mod(cidx + float(j), cells);
            vec3 h = hash31(c * 3.17 + mod(k, 61.0) * 1.9 + seed);
            if (h.z < 0.35) continue;
            float a = ((c + 0.2 + 0.6 * h.x) / cells) * TAU - PI;
            vec2 sd = vec2(cos(a), sin(a));
            float along = dot(e, sd);
            float perp = dot(e, vec2(-sd.y, sd.x));
            float len = (7.0 + 14.0 * h.y) * (0.7 + 0.3 * strength);
            vec2 sj = jagged(along / 4.0, c * 5.3 + h.y * 40.0);
            float dist = abs(perp - sj.x * 2.4 * clamp(along / 5.0, 0.0, 1.0));
            float envelope = smoothstep(1.0, 3.0, along) * (1.0 - smoothstep(len * 0.55, len, along));
            sparks += exp(-(dist * dist) / (0.5 + aa * aa * 0.5)) * envelope * (1.0 - age * 0.6);
        }
        sparks *= strength;
    }

    float hotCore = core * 1.3 + origin + impact + sparks * 0.9;
    vec3 emission = uCore * hotCore + uHot * (inner * 0.8 + impactHalo * 0.7) + uBody * (glow * 0.5 + impactHalo * 0.35);
    float cover = hotCore * 0.7 + inner * 0.35 + glow * 0.08 + impactHalo * 0.1;

    // Fenster an den Quad-Rändern.
    float front = uSize.x - uBack - L;
    float window = (1.0 - smoothstep(uSize.y * 0.5 - 10.0, uSize.y * 0.5, abs(y)))
        * smoothstep(-uBack, -uBack + 6.0, x)
        * (1.0 - smoothstep(L + front - 8.0, L + front, x));
    float alpha = clamp(uAlpha, 0.0, 1.0) * window;
    if (alpha * (hotCore + inner + glow + impactHalo) < 0.002) { gl_FragColor = vec4(0.0); return; }
    gl_FragColor = vec4(emission * uEmission * alpha, clamp(cover, 0.0, 0.9) * alpha);
}
`;

export const TESLA_NOVA_SHADER_NAME = 'FragdachseTeslaNova';
/** Reichweite der Überschläge über die Wellenfront hinaus in Weltpixeln. */
export const TESLA_NOVA_OUTER_REACH = 40;

/**
 * Blitznova: eine gezackte Blitzfront läuft vom Kuppelzentrum zum Kuppelrand. Hinter ihr
 * glimmt kurz dasselbe Adernetz wie auf der Kuppelhülle, vor ihr springen radiale Überschläge
 * auf den Boden. Klar begrenzt wie eine Frostnova, aber durchgehend elektrisch.
 */
export const TESLA_NOVA_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
${SHARED_HEADER}
uniform float uSize;
uniform float uRadius;
uniform float uFade;
uniform float uTime;
uniform float uSeed;
uniform float uPixelSize;
uniform float uEmission;
uniform vec3 uBody;
uniform vec3 uHot;
uniform vec3 uCore;

const float REACH = ${TESLA_NOVA_OUTER_REACH.toFixed(1)};

float cellEdge(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 r = g + hash22(n + g) - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
    }
    return (sqrt(d2) - sqrt(d1)) * 0.5;
}

void main() {
    vec2 p = (vec2(outTexCoord.x, 1.0 - outTexCoord.y) - 0.5) * uSize;
    float r = length(p);
    float R = max(uRadius, 1.0);
    if (r > R + REACH || uFade <= 0.001) { gl_FragColor = vec4(0.0); return; }

    float aa = max(uPixelSize, 0.5);
    float T = uTime;
    float seed = mod(uSeed, 61.0);
    float snap = floor(T * 24.0);
    vec2 snapOffset = vec2(mod(snap, 29.0) * 1.37, mod(snap, 23.0) * 2.11);
    vec2 dir = p / max(r, 0.001);

    // Gezackte Front: der Versatz wird auf einem Kreis im Rauschraum abgetastet, deshalb ohne
    // Naht bei ±π; die feine Oktave springt mit dem Knistertakt.
    float off = (noise(dir * R * 0.05 + seed + snapOffset * 0.2) - 0.5) * 9.0
        + (noise(dir * R * 0.16 - seed + snapOffset) - 0.5) * 4.0;
    float d = r - (R + off);
    float frontCore = exp(-(d * d) / (0.45 + aa * aa * 0.8));
    float frontGlow = exp(-(d * d) / 40.0);
    // Schmaler Nachhall hinter der Front, damit die Welle Richtung und Wucht zeigt.
    float behind = max(-d, 0.0);
    float trail = exp(-behind / (10.0 + R * 0.05)) * step(d, 0.0);

    // Adernetz hinter der Front, das mit ihr erlischt.
    float veins = 0.0;
    if (behind > 0.0 && behind < 60.0) {
        vec2 jag = vec2(noise(p * 0.13 + snapOffset), noise(p * 0.13 - snapOffset + 5.0)) - 0.5;
        float edge = cellEdge((p + jag * 5.0) / 26.0 + seed) * 26.0;
        float lineW = 0.4 + aa * 0.5;
        veins = exp(-(edge * edge) / (lineW * lineW)) * exp(-behind / 22.0);
    }

    // Radiale Überschläge vor und auf der Front.
    float spikes = 0.0;
    float angle = atan(p.y, p.x);
    float cells = max(floor(TAU * R / 26.0), 8.0);
    float cellIndex = floor((angle / TAU + 0.5) * cells);
    for (int k = -1; k <= 1; k++) {
        float c = mod(cellIndex + float(k), cells);
        vec3 h = hash31(c * 7.31 + seed * 3.3);
        vec3 hs = hash31(c * 3.17 + mod(floor(T * 14.0 + h.z), 89.0) * 5.3 + seed);
        if (hs.z > 0.55) continue;
        float a = ((c + 0.2 + 0.6 * h.x) / cells) * TAU - PI;
        float lateral = (mod(angle - a + PI, TAU) - PI) * r;
        float s = d + 6.0;
        float len = 12.0 + 22.0 * hs.y;
        vec2 j = jagged(max(s, 0.0) / 5.0, c * 3.7 + hs.x * 40.0);
        vec2 j2 = jagged(max(s, 0.0) / 2.0, c * 1.9 + hs.y * 30.0);
        float dist = abs(lateral - (j.x * 4.0 + j2.x * 1.3) * clamp(s / 6.0, 0.0, 1.0));
        float along = smoothstep(0.0, 3.0, s) * (1.0 - smoothstep(len * 0.6, len, s));
        spikes += (exp(-(dist * dist) / (0.3 + aa * aa * 0.5)) + 0.15 * exp(-dist / 2.5)) * along;
    }

    float fade = clamp(uFade, 0.0, 1.0);
    float coreE = (frontCore * 1.2 + spikes * 0.9 + veins * 0.35) * fade;
    float hotE = (frontGlow * 0.55 + veins * 0.55) * fade;
    float bodyE = (trail * 0.28 + frontGlow * 0.2) * fade;
    vec3 emission = uCore * coreE + uHot * hotE + uBody * bodyE;
    float cover = clamp(coreE * 0.6 + hotE * 0.25 + bodyE * 0.1, 0.0, 0.7);
    float window = 1.0 - smoothstep(R + REACH - 10.0, R + REACH, r);
    gl_FragColor = vec4(emission * uEmission * window, cover * window);
}
`;
