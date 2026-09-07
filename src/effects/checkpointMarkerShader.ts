/** Analytic ground light and particles share one quad; no per-particle CPU state. */
export const CHECKPOINT_SHADER_NAME = 'FragdachseCheckpointMarker';
// Burst travel <= 26 px, plus its soft halo. Also included in Phaser's camera culling bounds.
export const CHECKPOINT_PADDING = 36;
export const CHECKPOINT_ACTIVATION_MS = 1_000;

export const CHECKPOINT_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
uniform float uSize;
uniform float uRadius;
uniform float uTime;
uniform float uSeed;
uniform float uPixelSize;
uniform float uNext;
uniform float uExtraction;
uniform float uOpacity;
uniform float uActivationAge;
uniform float uAmbientCount;
uniform float uBurstCount;
uniform vec3 uColor;
uniform vec3 uActivationColor;
const float TAU = 6.28318530718;

// Same small hash family as livingFieldShader; each angular cell owns one light point.
vec3 checkpointHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}

float stroke(float distanceToLine, float halfWidth, float aa) {
    return 1.0 - smoothstep(halfWidth, halfWidth + aa, abs(distanceToLine));
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    return length(p - a - ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 0.001), 0.0, 1.0));
}

// Normal blending expects premultiplied output, including the glow's transparent edges.
void over(inout vec4 result, vec3 color, float opacity) {
    float a = clamp(opacity, 0.0, 1.0);
    result = vec4(color * a, a) + result * (1.0 - a);
}

void mote(inout vec4 result, vec2 p, vec2 center, float size, float opacity, vec3 color, float aa) {
    float d = length(p - center);
    float halo = 1.0 - smoothstep(0.0, size * 3.0 + aa, d);
    over(result, color, halo * halo * opacity * 0.25);
    over(result, mix(color, vec3(1.0, 0.98, 0.9), 0.65),
        (1.0 - smoothstep(size * 0.3, size + aa, d)) * opacity);
}

void main() {
    vec2 p = vec2(outTexCoord.x - 0.5, 0.5 - outTexCoord.y) * uSize;
    float r = length(p);
    float angle = mod(atan(p.y, p.x + 0.00001) + TAU, TAU);
    // Evaluate derivatives before divergent particle branches. The uniform also covers
    // contexts without the GLSL extension, using the actual drawing camera's render scale.
    float aa = uPixelSize;
#if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
    aa = max(aa * 0.65, fwidth(r));
#endif
    float edge = r - uRadius;
    float breath = 0.5 + 0.5 * sin(uTime * TAU / 3.0);
    float activated = step(0.0, uActivationAge) * (1.0 - step(1.0, uActivationAge));
    float release = activated * (1.0 - smoothstep(0.15, 1.0, uActivationAge));
    vec3 color = mix(uColor, uActivationColor, release);
    float strength = mix(uOpacity, 0.86, release);
    strength *= mix(1.0, 0.86 + 0.14 * breath, uNext);
    vec4 result = vec4(0.0);

    // Almost clear center, a soft inward wash, then a fixed, readable boundary at uRadius.
    float inside = 1.0 - smoothstep(-aa, aa, edge);
    float wash = smoothstep(uRadius * 0.48, uRadius, r) * inside;
    over(result, color, (0.014 * inside + 0.07 * wash) * strength);
    float halo = 1.0 - smoothstep(0.0, 13.0, abs(edge));
    over(result, color, halo * halo * strength * 0.28);
    over(result, color, stroke(edge, 1.7, aa) * strength * 0.65);
    over(result, mix(color, vec3(1.0, 0.98, 0.9), 0.5), stroke(edge, 0.48, aa) * strength * 0.8);

    // Two soft travelling glints, distinct from the constant interaction boundary.
    if (uNext > 0.5 && uAmbientCount > 0.0) {
        float sweep = pow(max(0.0, cos(2.0 * (angle - uTime * TAU / 12.0))), 18.0);
        over(result, color, stroke(edge + 4.0, 1.0, aa) * sweep * 0.62);
        over(result, color, halo * sweep * 0.13);
    }

    // Acquisition wave ends at the real boundary instead of suggesting a larger trigger.
    if (activated > 0.5) {
        float t = clamp(uActivationAge / 0.65, 0.0, 1.0);
        float waveRadius = uRadius * (1.0 - (1.0 - t) * (1.0 - t));
        float fade = sin(t * 3.14159265);
        over(result, uActivationColor, stroke(r - waveRadius, 1.1, aa + 2.0) * fade * 0.42 * inside);
    }

    if (uNext > 0.5) {
        float iconSize = min(9.0, uRadius * 0.16);
        float diamond = (abs(p.x) + abs(p.y) - iconSize) * 0.70710678;
        float iconHalo = 1.0 - smoothstep(0.0, 5.0, abs(diamond));
        over(result, color, iconHalo * iconHalo * 0.18);
        over(result, mix(color, vec3(1.0), 0.3), stroke(diamond, 0.8, aa) * (0.68 + 0.14 * breath));
        over(result, color, (1.0 - smoothstep(1.0, 2.0 + aa, r)) * 0.75);
    }

    // Nearest cardinal axis supplies both arms of one inward extraction chevron.
    if (uExtraction > 0.5) {
        float axis = floor(angle / (TAU * 0.25) + 0.5) * TAU * 0.25;
        vec2 direction = vec2(cos(axis), sin(axis));
        vec2 q = vec2(dot(p, direction), abs(dot(p, vec2(-direction.y, direction.x))));
        float reach = min(12.0, uRadius * 0.25);
        float chevron = segmentDistance(q, vec2(uRadius - reach, 0.0), vec2(uRadius - reach * 0.25, reach * 0.42));
        over(result, color, (1.0 - smoothstep(0.0, 4.0, chevron)) * strength * 0.2);
        over(result, mix(color, vec3(1.0), 0.3), stroke(chevron, 0.85, aa) * strength);
    }

    // Only three neighbouring cells are sampled, independent of particle count.
    // The angular jitter remains inside its own cell; wrapping keys closes the ring seam.
    if (uNext > 0.5 && uAmbientCount > 0.0 && abs(edge) < 24.0) {
        float cell = floor(angle / TAU * uAmbientCount);
        for (int neighbor = -1; neighbor <= 1; neighbor++) {
            float id = mod(cell + float(neighbor) + uAmbientCount, uAmbientCount);
            vec3 h = checkpointHash(vec3(id, uSeed, 1.0));
            float life = mix(1.4, 2.4, h.y);
            float clock = uTime / life + h.z;
            float t = fract(clock);
            vec3 g = checkpointHash(vec3(id, uSeed, floor(clock) + 7.0));
            float theta = (id + 0.2 + 0.6 * g.x + 0.12 * (t - 0.5)) * TAU / uAmbientCount;
            float radius = uRadius + mix(-3.0, 14.0, t);
            float opacity = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.45, 1.0, t));
            float size = min(mix(1.0, 1.9, g.z), uRadius * TAU / uAmbientCount * 0.09);
            mote(result, p, vec2(cos(theta), sin(theta)) * radius, size,
                opacity * 0.8, color, aa);
        }
    }

    if (activated > 0.5 && uBurstCount > 0.0 && edge > -12.0 && edge < 35.0) {
        float cell = floor(angle / TAU * uBurstCount);
        for (int neighbor = -1; neighbor <= 1; neighbor++) {
            float id = mod(cell + float(neighbor) + uBurstCount, uBurstCount);
            vec3 h = checkpointHash(vec3(id, uSeed, 43.0));
            float t = clamp(uActivationAge / mix(0.7, 1.0, h.y), 0.0, 1.0);
            float theta = (id + 0.2 + 0.6 * h.x + 0.1 * t) * TAU / uBurstCount;
            float radius = uRadius - 3.0 + mix(18.0, 29.0, h.z) * (1.0 - (1.0 - t) * (1.0 - t));
            float opacity = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.12, 1.0, t));
            float size = min(mix(1.1, 2.0, h.z), uRadius * TAU / uBurstCount * 0.09);
            mote(result, p, vec2(cos(theta), sin(theta)) * radius, size,
                opacity * 0.9, uActivationColor, aa);
        }
    }
    gl_FragColor = result;
}
`;
