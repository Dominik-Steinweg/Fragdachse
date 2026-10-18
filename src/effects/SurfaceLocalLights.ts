/**
 * Lamps and moon as relative form for materials below the light map (GDD Nachtsicht N-4).
 *
 * The light map stays the only owner of irradiance: these ports only bend the response of a
 * tilted surface against a flat one. A flat surface, or one without a dominant lamp, keeps
 * exactly the factor 1, so darkness, shadows and budgets remain where they are.
 */

/** Upper bound of lamps per material draw; quality tiers pass fewer. */
export const MAX_SURFACE_LIGHTS = 4;
/** Lamp height for the relief vector; grows with distance so grazing light stays readable. */
export const SURFACE_LIGHT_HEIGHT_PX = 44;
export const SURFACE_LIGHT_HEIGHT_PER_DISTANCE = .5;
/** How far tilted faces deviate from the flat response, 0..1. */
export const SURFACE_LIGHT_RELIEF = .8;

export interface SurfaceLightFrame {
  count: number;
  /** Per lamp: x, y, radius, intensity (effective intensity times colour luminance). */
  readonly position: Float32Array;
  /** Per lamp: direction x, y, half cone angle (0 = radial), start of the soft cone edge. */
  readonly cone: Float32Array;
  /** Per lamp: falloff exponent of `(1 - d/r)^n`, then reserved. */
  readonly profile: Float32Array;
  /** Luminance of the ambient the lamps add to, 0..1. */
  ambient: number;
}

export function createSurfaceLightFrame(): SurfaceLightFrame {
  return {
    count: 0,
    position: new Float32Array(MAX_SURFACE_LIGHTS * 4),
    cone: new Float32Array(MAX_SURFACE_LIGHTS * 4),
    profile: new Float32Array(MAX_SURFACE_LIGHTS * 4),
    ambient: 0,
  };
}

/** Light-map amount of one lamp at a point; the same curve and soft cone edge as its texture. */
export function surfaceLightAmount(frame: SurfaceLightFrame, index: number, x: number, y: number): number {
  const p = index * 4, dx = x - frame.position[p], dy = y - frame.position[p + 1];
  const radius = frame.position[p + 2], distance = Math.hypot(dx, dy);
  if (!(radius > 0) || distance >= radius) return 0;
  let amount = frame.position[p + 3] * (1 - distance / radius) ** frame.profile[p];
  const half = frame.cone[p + 2], edge = frame.cone[p + 3];
  if (half > 0 && distance > .001) {
    const delta = Math.acos(Math.max(-1, Math.min(1, (dx * frame.cone[p] + dy * frame.cone[p + 1]) / distance)));
    if (delta >= half) return 0;
    if (delta > edge) amount *= 1 - (delta - edge) / Math.max(.0001, half - edge);
  }
  return amount;
}

/** CPU twin of `surfaceLightResponse`: linear response of normal n relative to a flat surface. */
export function surfaceLightResponse(frame: SurfaceLightFrame, nx: number, ny: number, nz: number, x: number, y: number): number {
  let lit = frame.ambient, flat = frame.ambient;
  for (let i = 0; i < frame.count; i++) {
    const amount = surfaceLightAmount(frame, i, x, y);
    if (amount <= 0) continue;
    const p = i * 4, dx = frame.position[p] - x, dy = frame.position[p + 1] - y;
    const height = Math.max(SURFACE_LIGHT_HEIGHT_PX, Math.hypot(dx, dy) * SURFACE_LIGHT_HEIGHT_PER_DISTANCE);
    const length = Math.hypot(dx, dy, height), lz = height / length;
    const facing = Math.max(0, (nx * dx + ny * dy) / length + nz * lz);
    lit += amount * (1 + (facing / lz - 1) * SURFACE_LIGHT_RELIEF);
    flat += amount;
  }
  return flat > 0 ? lit / flat : 1;
}

/** CPU twin of `surfaceMoonResponse`; `moon` is the direction xyz plus relief strength. */
export function surfaceMoonResponse(moon: ArrayLike<number>, nx: number, ny: number, nz: number): number {
  if (!(moon[3] > 0) || !(moon[2] > 0)) return 1;
  const facing = Math.max(0, nx * moon[0] + ny * moon[1] + nz * moon[2]);
  return 1 + (facing / moon[2] - 1) * Math.min(1, moon[3]);
}

const glsl = (value: number): string => value.toFixed(6);
/** Uniforms plus `surfaceNightResponse(normal, world)`: lamps and moon as a display gain. */
export const SURFACE_LIGHT_GLSL = `
uniform vec4 uSurfaceLightPos[${MAX_SURFACE_LIGHTS}];
uniform vec4 uSurfaceLightCone[${MAX_SURFACE_LIGHTS}];
uniform vec4 uSurfaceLightProfile[${MAX_SURFACE_LIGHTS}];
uniform float uSurfaceLightCount, uSurfaceAmbient;
uniform vec4 uSurfaceMoon;
// Light-map amount of one lamp; fetch its uniforms inside a loop (constant-index rule of GLSL ES 1.0).
float surfaceLampAmount(vec4 p, vec4 c, vec4 profile, vec2 world) {
  vec2 d=world-p.xy;
  float dist=length(d);
  if (dist>=p.z) return 0.0;
  float amount=p.w*pow(1.0-dist/p.z,profile.x);
  if (c.z>0.0 && dist>.001) {
    float delta=acos(clamp(dot(d/dist,c.xy),-1.0,1.0));
    if (delta>=c.z) return 0.0;
    if (delta>c.w) amount*=1.0-(delta-c.w)/max(.0001,c.z-c.w);
  }
  return amount;
}
float surfaceLightResponse(vec3 normal, vec2 world) {
  float lit=uSurfaceAmbient, level=uSurfaceAmbient;
  for (int i=0; i<${MAX_SURFACE_LIGHTS}; i++) {
    if (float(i)>=uSurfaceLightCount) break;
    vec4 p=uSurfaceLightPos[i];
    float amount=surfaceLampAmount(p,uSurfaceLightCone[i],uSurfaceLightProfile[i],world);
    if (amount<=0.0) continue;
    vec2 d=world-p.xy;
    float dist=length(d);
    float height=max(${glsl(SURFACE_LIGHT_HEIGHT_PX)},dist*${glsl(SURFACE_LIGHT_HEIGHT_PER_DISTANCE)});
    vec3 l=normalize(vec3(-d,height));
    lit+=amount*(1.0+(max(0.0,dot(normal,l))/l.z-1.0)*${glsl(SURFACE_LIGHT_RELIEF)});
    level+=amount;
  }
  return level>0.0 ? lit/level : 1.0;
}
float surfaceMoonResponse(vec3 normal) {
  if (uSurfaceMoon.w<=0.0 || uSurfaceMoon.z<=0.0) return 1.0;
  return 1.0+(max(0.0,dot(normal,uSurfaceMoon.xyz))/uSurfaceMoon.z-1.0)*min(1.0,uSurfaceMoon.w);
}
// Linear response to a display gain with a matte shoulder: no hard white rim on lit facets.
float surfaceNightResponse(vec3 normal, vec2 world) {
  float gain=pow(max(surfaceLightResponse(normal,world)*surfaceMoonResponse(normal),0.0),1.0/2.2);
  return min(gain,1.0)+.55*(1.0-exp(-max(gain-1.0,0.0)/.55));
}
`;

/** Binds a frame and moon to a shader's `setupUniforms`; never allocates. */
export function setSurfaceLightUniforms(set: (name: string, value: unknown) => void,
  frame: SurfaceLightFrame | null, moon: ArrayLike<number> | null, maxLights = MAX_SURFACE_LIGHTS): void {
  set('uSurfaceLightCount', frame ? Math.min(frame.count, maxLights) : 0);
  set('uSurfaceAmbient', frame?.ambient ?? 0);
  if (frame) {
    set('uSurfaceLightPos[0]', frame.position);
    set('uSurfaceLightCone[0]', frame.cone);
    set('uSurfaceLightProfile[0]', frame.profile);
  }
  set('uSurfaceMoon', moon ?? EMPTY_MOON);
}
const EMPTY_MOON = new Float32Array(4);
