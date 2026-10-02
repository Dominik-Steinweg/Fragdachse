/** Phaser's displayed GPU member pose supplies atlas bounds and UV distance per screen pixel. */
export const ENEMY_CONTOUR_POSE = {
  name: 'EnemyContourPoseV1',
  additions: {
    vertexHeader: `
varying vec4 contourBounds;
varying vec2 contourPixel;
varying vec2 contourTexel;
uniform vec2 uContourWidths;
`,
    vertexProcess: `
    contourBounds = vec4(uv.x, 1.0 - uv.y - wh.y, uv.x + wh.x, 1.0 - uv.y);
    contourTexel = 1.0 / uDiffuseResolution;
    vec2 screenScale = vec2(
        length((viewMatrix * vec3(cosine, sine, 0.0)).xy) * abs(scaleX),
        length((viewMatrix * vec3(-sine, cosine, 0.0)).xy) * abs(scaleY));
    contourPixel = contourTexel / max(screenScale, vec2(0.0001));
    // Expand the quad as well as its UVs: silhouettes touching a frame edge must not clip.
    vec2 corner = vec2(inVertex >= 2.0 ? 1.0 : -1.0,
        (inVertex == 0.0 || inVertex == 2.0) ? 1.0 : -1.0);
    vec2 pad = (uContourWidths.x + uContourWidths.y + 1.0) / max(screenScale, vec2(0.0001));
    position.xy += (viewMatrix * transformMatrix * vec3(corner * pad * vec2(scaleX, scaleY), 0.0)).xy;
    gl_Position = uProjectionMatrix * vec4(position.xy, 1.0, 1.0);
    outTexCoord += corner * vec2(1.0, -1.0) * pad / uDiffuseResolution;
`,
  },
};

export const ENEMY_CONTOUR_FRAGMENT = `
precision highp float;
uniform sampler2D uMainSampler[1];
uniform vec2 uContourWidths;
uniform vec2 uContourAlphas;
uniform vec3 uContourDark;
uniform vec3 uContourLight;
uniform float uContourBridge;
varying vec2 outTexCoord;
varying vec4 outTint;
varying vec4 contourBounds;
varying vec2 contourPixel;
varying vec2 contourTexel;

float maskAt(vec2 p) {
    // Never sample the neighbouring animation frame, including bilinear filtering at its edge.
    if (p.x < contourBounds.x || p.y < contourBounds.y ||
        p.x > contourBounds.z || p.y > contourBounds.w) return 0.0;
    return texture2D(uMainSampler[0], clamp(p,
        contourBounds.xy + contourTexel * 0.5, contourBounds.zw - contourTexel * 0.5)).a;
}
float silhouetteAt(vec2 p) {
    float a = maskAt(p);
    if (a >= 0.95) return a;
    vec2 size = contourBounds.zw - contourBounds.xy;
    vec2 radial = (p - (contourBounds.xy + contourBounds.zw) * 0.5) / size;
    vec2 tangent = vec2(-radial.y, radial.x) / max(length(radial), 0.0001);
    vec2 bridge = tangent * size * uContourBridge;
    float side = maskAt(p - bridge);
    // Algebraically identical two-sided bridge; skip the second read on empty atlas padding.
    if (side <= a) return a;
    return max(a, min(side, maskAt(p + bridge)));
}
float dilation(vec2 p, float radius) {
    float a = 0.0;
    for (int i = 0; i < 8; i++) {
        float angle = float(i) * 0.7853981633974483;
        a = max(a, silhouetteAt(p + vec2(cos(angle), sin(angle)) * contourPixel * radius));
    }
    return smoothstep(0.02, 0.8, a);
}
void main() {
    vec2 p = outTexCoord;
    float outside = 1.0 - smoothstep(0.02, 0.12, silhouetteAt(p));
    if (outside <= 0.0) { gl_FragColor = vec4(0.0); return; }
    float outer = dilation(p, uContourWidths.x + uContourWidths.y);
    if (outer <= 0.0) { gl_FragColor = vec4(0.0); return; }
    // Fill the radial silhouette towards the centre, closing internal head/paw gaps rather
    // than drawing their borders. The bridge above closes narrow gaps across neighbouring rays.
    vec2 size = contourBounds.zw - contourBounds.xy;
    vec2 radial = (p - (contourBounds.xy + contourBounds.zw) * 0.5) / size;
    float radius = length(radial);
    vec2 ray = radial / max(radius, 0.0001);
    float end = 0.5 / max(max(abs(ray.x), abs(ray.y)), 0.0001);
    for (int i = 1; i <= 32; i++) {
        vec2 sampleUV = p + ray * size * max(0.0, end - radius) * (float(i) / 32.0);
        outside = min(outside, 1.0 - smoothstep(0.02, 0.12, silhouetteAt(sampleUV)));
        if (outside <= 0.0) { gl_FragColor = vec4(0.0); return; }
    }
    float inner = uContourWidths.y > 0.0 ? dilation(p, uContourWidths.y) : 0.0;
    float lightAlpha = inner * uContourAlphas.y * outside * outTint.a;
    float darkAlpha = max(0.0, outer - inner) * uContourAlphas.x * outside * outTint.a;
    // PMA NORMAL: srcA + dstA * (1-srcA) preserves an opaque scene (Phaser ADD needs dstA=1).
    gl_FragColor = vec4(uContourLight * lightAlpha + uContourDark * darkAlpha, lightAlpha + darkAlpha);
}
`;
