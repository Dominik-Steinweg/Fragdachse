/** Relative form response, not another irradiance/colour pass. A flat upward
 * normal with AO=1 is identity under any sun/cloud/local-light combination. */
export const CHARACTER_MATERIAL_CONFIG = {
  ambient: .2, direct: 1, ao: .65, localHeight: 32,
  // Linear reflectance calibration of the unlit 21c material, not a second sky
  // tint. Fitted to opaque Beauty pixels across all 37 poses and four noon
  // orientations. Keep the form function itself neutral for a flat normal.
  reflectance: [.830, .800, .727],
} as const;
export type CharacterMaterialView = 'material' | 'albedo' | 'normal' | 'lighting';
export const CHARACTER_MATERIAL_VIEWS: readonly CharacterMaterialView[] = ['material','albedo','normal','lighting'];
export function characterLinear(c:number):number { return c<=.04045?c/12.92:((c+.055)/1.055)**2.4; }
export function characterSRGB(c:number):number { return c<=.0031308?c*12.92:1.055*c**(1/2.4)-.055; }
export function characterMaterialColour(albedo:readonly number[], factor:number):number[] {
  return albedo.map((v,c)=>characterSRGB(characterLinear(v)*CHARACTER_MATERIAL_CONFIG.reflectance[c]*factor));
}
export interface CharacterMaterialLight { x: number; y: number; height: number; weight: number }
export function createCharacterMaterialLights(): CharacterMaterialLight[] {
  return Array.from({ length: 2 }, () => ({ x: 0, y: 0, height: CHARACTER_MATERIAL_CONFIG.localHeight, weight: 0 }));
}

/** Asset X right, Y south, Z up; inverse clockwise Sprite rotation, then flip.
 * Nonuniform scale is applied to normals by inverse transpose in the shader. */
export function characterLocalVector(x: number, y: number, z: number, rotation: number,
  flipX: boolean, flipY: boolean, out: number[]): void {
  const c = Math.cos(rotation), s = Math.sin(rotation), length = Math.hypot(x, y, z) || 1;
  out[0] = (c * x + s * y) * (flipX ? -1 : 1) / length;
  out[1] = (-s * x + c * y) * (flipY ? -1 : 1) / length;
  out[2] = z / length;
}
export function characterFormFactor(normal: readonly number[], sun: readonly number[], strength: number,
  ao: number, locals: readonly (readonly number[])[] = []): number {
  const length = Math.hypot(...normal), n = length > .00001 ? normal.map(v => v / length) : [0, 0, 1];
  const weight = Math.max(0, strength) * CHARACTER_MATERIAL_CONFIG.direct;
  let numerator = CHARACTER_MATERIAL_CONFIG.ambient + weight * Math.max(0, n[0]*sun[0]+n[1]*sun[1]+n[2]*sun[2]);
  let denominator = CHARACTER_MATERIAL_CONFIG.ambient + weight * Math.max(0, sun[2]);
  let active = Math.max(0, strength);
  for (const light of locals) {
    const w = Math.max(0, light[3]);
    numerator += w * Math.max(0, n[0]*light[0]+n[1]*light[1]+n[2]*light[2]);
    denominator += w * Math.max(0, light[2]); active += w;
  }
  // AO attenuates ambient only. No light -> flat night albedo; the lightmap owns darkness.
  numerator -= CHARACTER_MATERIAL_CONFIG.ambient * CHARACTER_MATERIAL_CONFIG.ao *
    (1-Math.max(0,Math.min(1,ao))) * Math.min(1,active);
  return numerator / denominator;
}

export function characterLightWeight(light: { x:number; y:number; radiusPx:number; effectiveIntensity:number;
  shape:string; angle:number; coneAngle:number }, x:number, y:number): number {
  const dx=x-light.x, dy=y-light.y, distance=Math.hypot(dx,dy);
  if (!(light.radiusPx>0) || distance>=light.radiusPx) return 0;
  let weight=(1-distance/light.radiusPx)**2*Math.max(0,light.effectiveIntensity);
  if(light.shape==='cone' && distance>.0001) {
    const delta=Math.abs(Math.atan2(Math.sin(Math.atan2(dy,dx)-light.angle),Math.cos(Math.atan2(dy,dx)-light.angle)));
    const half=light.coneAngle*.5;
    if(delta>=half)return 0;
    weight*=Math.min(1,(half-delta)/Math.max(.0001,half*.3));
  }
  return weight;
}
/** Segment excludes its origin, matching light-shadow geometry for an emitter
 * inside a caster. Includes the receiver so light cannot pass through walls. */
export function characterLightBlockedRect(x:number,y:number,tx:number,ty:number,l:number,t:number,r:number,b:number):boolean {
  if(x>=l&&x<=r&&y>=t&&y<=b)return false;
  let lo=0,hi=1;
  for(let axis=0;axis<2;axis++) {
    const origin=axis===0?x:y,delta=axis===0?tx-x:ty-y,min=axis===0?l:t,max=axis===0?r:b;
    if(Math.abs(delta)<1e-8) {if(origin<min||origin>max)return false;continue;}
    const a=(min-origin)/delta,c=(max-origin)/delta;
    lo=Math.max(lo,Math.min(a,c));hi=Math.min(hi,Math.max(a,c));if(lo>hi)return false;
  }
  return hi>0&&lo<=1;
}
