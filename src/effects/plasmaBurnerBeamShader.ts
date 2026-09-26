/**
 * Prozeduraler Plasmabrenner-Strahl: ein Shader-Quad je Strahlsegment, entlang Start→Ende
 * ausgerichtet. Weißglühender Kern, um ihn gewundene Plasmastränge, turbulente grüne Hülle,
 * schwebende Plasmafunken sowie Mündungs- und Einschlagblüte entstehen vollständig im
 * Fragment-Shader – die CPU setzt pro Frame nur Transform und Uniforms.
 *
 * Koordinaten sind Weltpixel im Strahlraum: `x` läuft von der Mündung (0) zum Endpunkt
 * (`uLength`), `y` quer dazu. Das Rauschfeld wird entlang des Strahls advektiert, damit die
 * Energie sichtbar von der Waffe zum Ziel strömt.
 *
 * Ausgabe ist premultiplied für `BlendModes.NORMAL` wie beim Flammenring: RGB trägt die
 * Emission, Alpha eine leichte Deckung. So bleibt das Grün auch über hellem Tagesboden
 * gesättigt, statt wie ein ADD-Layer zu Weiß zu klippen.
 */
export const PLASMA_BURNER_BEAM_SHADER_NAME = 'FragdachsePlasmaBurnerBeam';
/** Quad-Reserve hinter der Mündung für die Mündungsblüte in Weltpixeln. */
export const PLASMA_BURNER_BEAM_BACK_PAD = 26;
/** Quad-Reserve hinter dem Endpunkt für Einschlagblüte und Funkenflug in Weltpixeln. */
export const PLASMA_BURNER_BEAM_FRONT_PAD = 54;
/** Quad-Höhe quer zum Strahl; deckt Hülle, Dunst, Funken und Bewegungsbiegung ab. */
export const PLASMA_BURNER_BEAM_HEIGHT = 104;

export const PLASMA_BURNER_BEAM_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
uniform vec2 uSize;
uniform float uBack;
uniform float uLength;
uniform float uTime;
uniform float uSeed;
uniform float uThickness;
uniform float uBoost;
uniform float uAlpha;
uniform float uBend;
uniform float uImpact;
uniform float uLock;
uniform float uHeal;
uniform float uPixelSize;
uniform float uDetail;
uniform float uEmission;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uHot;
uniform vec3 uCore;
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
float fbm(vec2 p) {
    const mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    float sum = 0.5 * noise(p);
    p = rot * p * 2.03 + 11.7;
    sum += 0.25 * noise(p);
    float norm = 0.75;
    if (uDetail > 0.5) { p = rot * p * 2.01 + 5.3; sum += 0.125 * noise(p); norm += 0.125; }
    return sum / norm;
}

// Tiefgrün → Plasmagrün → Limettenglut → fast weißer Kern.
vec3 plasmaRamp(float h) {
    vec3 c = mix(uDeep, uBody, smoothstep(0.0, 0.38, h));
    c = mix(c, uHot, smoothstep(0.34, 0.72, h));
    return mix(c, uCore, smoothstep(0.7, 1.0, h));
}

void main() {
    vec2 q = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uSize;
    float L = max(uLength, 1.0);
    float x = q.x - uBack;
    float y = q.y - uSize.y * 0.5;
    float front = uSize.x - uBack - L;
    float T = uTime;
    float s = uSeed;
    float aa = max(uPixelSize, 0.5);
    float th = clamp(uThickness, 1.0, 6.0);
    float tb = clamp(x / L, 0.0, 1.0);
    float impact = step(0.5, uImpact);
    float freeTip = 1.0 - impact;

    // Mittellinie: an Mündung und Endpunkt fixiert, dazwischen langsames Schlängeln plus
    // Trägheitsbiegung aus der Schützenbewegung.
    float pin = smoothstep(0.0, 36.0, x) * (1.0 - smoothstep(L - 30.0, L, x));
    float wave = (noise(vec2(x * 0.016 - T * 1.9, s)) - 0.5) * 2.0 * (2.0 + th * 0.5)
        + sin(x * 0.045 - T * 11.0 + s) * 0.7;
    float bend = uBend * sin(PI * tb) * pow(1.0 - tb, 1.45);
    float yc = y - bend - wave * pin;

    // Freies Strahlende läuft spitz aus statt mit flacher Kappe zu enden.
    float tipLen = min(L * 0.4, 28.0);
    float taper = mix(1.0, clamp((L - x) / tipLen, 0.0, 1.0), freeTip);
    float body = smoothstep(-3.0, 4.0, x) * (1.0 - smoothstep(L - 1.0, L + 3.0, x));
    float grow = 0.55 + 0.45 * smoothstep(0.0, 70.0, x);
    float breath = 0.88 + 0.24 * noise(vec2(x * 0.02 - T * 3.0, s + 7.0));
    float sheathW = (7.0 + th * 2.1) * grow * breath * (0.3 + 0.7 * taper);
    float coreW = max((0.85 + th * 0.3) * (0.35 + 0.65 * taper), aa * 0.6);

    float core = 0.0;
    float inner = 0.0;
    float sheath = 0.0;
    float tendrils = 0.0;
    float strands = 0.0;
    float haze = 0.0;
    float motes = 0.0;
    if (x > -4.0 && x < L + 4.0) {
        float cd = yc / coreW;
        core = exp(-cd * cd) * body;
        float id = yc / (coreW * 3.4 + 1.5);
        inner = exp(-id * id) * body;
        float hd = yc / (sheathW * 1.55 + 4.0);
        haze = exp(-hd * hd) * body;

        // Turbulente Hülle: vom Strahl mitgerissenes, domänenverzerrtes Rauschen, längs
        // gestreckt, damit die Plasmazungen in Schussrichtung ausfransen.
        vec2 flow = vec2(x * 0.028 - T * 5.2, yc * 0.085);
        vec2 warp = vec2(noise(flow * 1.7 + s), noise(flow * 1.7 - s + 3.1)) - 0.5;
        float n = smoothstep(0.3, 0.78, fbm(flow + warp * 1.2 + vec2(s * 0.37, 0.0)));
        float sd = yc / sheathW;
        sheath = n * exp(-sd * sd * 1.3) * body;

        // Dünne leuchtende Adern als Höhenlinien eines zweiten, schneller strömenden Felds.
        float rn = noise(vec2(x * 0.022 - T * 4.4, yc * 0.16 + s) + warp * 0.8);
        float ridge = 1.0 - abs(rn * 2.0 - 1.0);
        ridge *= ridge; ridge *= ridge * ridge;
        float td = yc / (sheathW * 1.25);
        tendrils = ridge * exp(-td * td) * body;

        // Um den Kern gewundene Plasmastränge; Rauschen reißt sie in Abschnitte auf.
        float strandCount = uDetail > 1.5 ? 3.0 : 2.0;
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            if (fi >= strandCount) break;
            float amp = sheathW * (0.32 + 0.38 * noise(vec2(x * 0.012 - T * 1.3 + fi * 5.0, s)));
            float off = sin(x * (0.05 + fi * 0.013) - T * (9.0 + fi * 2.5) + s * 0.7 + fi * 2.094) * amp;
            float d = (yc - off) / (0.7 + th * 0.12 + aa * 0.5);
            float breakup = smoothstep(0.32, 0.7, noise(vec2(x * 0.03 - T * 6.0, fi * 13.0 + s)));
            strands += exp(-d * d) * breakup;
        }
        strands *= body * smoothstep(0.0, 18.0, x) * (0.4 + 0.6 * taper);

        // Schwebende Plasmafunken: je Zelle höchstens ein Funke, der vom Strahl wegtreibt.
        float cell = 18.0;
        float ci = floor(x / cell);
        float moteLayers = uDetail > 0.5 ? 2.0 : 1.0;
        for (int layer = 0; layer < 2; layer++) {
            if (float(layer) >= moteLayers) break;
            for (int k = -1; k <= 1; k++) {
                float c = ci + float(k);
                vec3 h = hash31(c * 1.91 + float(layer) * 57.3 + s * 3.7);
                if (h.x < 0.42) continue;
                float age = fract(T * (0.9 + 0.8 * h.y) + h.z);
                float side = h.x > 0.71 ? 1.0 : -1.0;
                float mx = (c + 0.5 * h.y) * cell + age * (6.0 + 8.0 * h.z);
                float my = side * (sheathW * (0.35 + 0.5 * h.z) + age * (8.0 + 12.0 * h.y));
                vec2 dv = vec2(x - mx, yc - my);
                float size = mix(1.5, 0.6, age) + th * 0.08;
                float g = exp(-dot(dv, dv) / (size * size + aa * aa * 0.5));
                float life = smoothstep(0.0, 0.12, age) * pow(1.0 - age, 1.5);
                motes += g * life * step(0.0, mx) * step(mx, L);
            }
        }
    }

    // Mündung: heißer Ball, weicher Hof und kurzer Vorwärtsstrahl.
    float mPulse = 0.85 + 0.15 * sin(T * 31.0 + s);
    vec2 m = vec2(x * 0.8, y);
    float dm2 = dot(m, m);
    float muzzle = exp(-dm2 / (50.0 + th * 12.0)) * mPulse;
    float muzzleHalo = exp(-dm2 / 420.0);
    float fx = (x - 7.0) / 11.0;
    float fy = y / (1.2 + th * 0.25);
    float flare = exp(-fx * fx - fy * fy) * mPulse;

    // Endpunkt: Einschlagblüte mit nach außen leckendem Plasma und Funkenflug oder freie Spitze.
    vec2 e = vec2(x - L, y);
    float de = length(e);
    float ePulse = 0.85 + 0.15 * sin(T * 27.0 + s * 1.3);
    float impactCore = 0.0;
    float impactHalo = 0.0;
    float splash = 0.0;
    float sparks = 0.0;
    if (impact > 0.5 && de < ${(PLASMA_BURNER_BEAM_FRONT_PAD + 6).toFixed(1)}) {
        float splashR = (13.0 + th * 2.0) * mix(1.0, 0.82, step(1.5, uImpact)) * ePulse;
        vec2 dir = e / max(de, 0.001);
        float sn = smoothstep(0.28, 0.8, fbm((e - dir * T * 40.0) * 0.09 + s + 17.0));
        float sr = de / splashR;
        splash = sn * exp(-sr * sr);
        impactCore = exp(-de * de / (18.0 + th * 6.0)) * ePulse;
        impactHalo = exp(-sr * sr * 0.32);

        float cells = 14.0;
        float ang = atan(e.y, e.x);
        float cidx = floor((ang / TAU + 0.5) * cells);
        for (int k = -1; k <= 1; k++) {
            float c = mod(cidx + float(k), cells);
            vec3 h0 = hash31(c * 3.17 + s * 1.3);
            float rate = 2.2 + 1.6 * h0.y;
            float cycle = floor(T * rate + h0.z);
            float age = fract(T * rate + h0.z);
            vec3 h = hash31(c * 7.31 + cycle * 11.3 + s);
            if (h.z < 0.3) continue;
            float a = ((c + 0.2 + 0.6 * h.x) / cells) * TAU - PI;
            vec2 sdir = vec2(cos(a), sin(a));
            // Funken sprühen bevorzugt zurück zur Schussquelle statt in die Wand hinein.
            float weight = mix(0.35, 1.0, smoothstep(0.3, -0.5, sdir.x));
            float rad = 3.0 + age * (16.0 + 22.0 * h.y);
            float len = 2.5 + 5.0 * (1.0 - age);
            float along = dot(e, sdir);
            float perp = dot(e, vec2(-sdir.y, sdir.x));
            float dAlong = max(0.0, abs(along - (rad - len * 0.5)) - len * 0.5);
            float g = exp(-(dAlong * dAlong + perp * perp) / (0.8 + aa * aa * 0.5));
            sparks += g * weight * smoothstep(0.0, 0.1, age) * pow(1.0 - age, 1.3);
        }
    }
    float tip = exp(-de * de / (6.0 + th * 2.0)) * freeTip;
    float ringD = (de - 8.0) / (0.8 + aa * 0.5);
    float ring = exp(-ringD * ringD) * uLock;
    float pw = 0.7 + aa * 0.4;
    float plusA = exp(-(e.y * e.y) / (pw * pw)) * step(abs(e.x), 3.5);
    float plusB = exp(-(e.x * e.x) / (pw * pw)) * step(abs(e.y), 3.5);
    float plus = max(plusA, plusB) * uHeal;

    float flick = 0.9 + 0.1 * sin(T * 23.0 + x * 0.05 + s);
    float heat = core * 1.05 + inner * 0.45 + strands * 0.55 + tendrils * 0.5 + sheath * 0.34
        + haze * 0.13 + motes * 0.85
        + muzzle * 1.0 + muzzleHalo * 0.3 + flare * 0.75
        + impactCore * 1.0 + splash * 0.55 + impactHalo * 0.22 + sparks * 0.9
        + tip * 0.85 + ring * 0.6 + plus * 0.9;
    heat *= flick * uBoost;

    // Fenster an den Quad-Rändern, damit abgeschnittener Dunst keine Kante zeichnet.
    float window = (1.0 - smoothstep(uSize.y * 0.5 - 10.0, uSize.y * 0.5, abs(y)))
        * smoothstep(-uBack, -uBack + 8.0, x)
        * (1.0 - smoothstep(L + front - 8.0, L + front, x));
    heat *= window * uAlpha;
    if (heat < 0.002) { gl_FragColor = vec4(0.0); return; }

    vec3 emission = plasmaRamp(clamp(heat, 0.0, 1.0)) * min(heat * 1.1, 1.5) * uEmission;
    float alpha = clamp(heat * 0.55, 0.0, 0.88);
    gl_FragColor = vec4(emission, alpha);
}
`;
