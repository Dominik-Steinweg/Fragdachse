import type * as Phaser from 'phaser';
import { FOG } from './FogConfig';

/**
 * The ground fog's air, lent read-only to presentation that should move with it (GDD
 * Void-Gefahrenzonen V1, E9: the void motes withdraw from explosions and passing figures like the
 * fog does). The fog swaps its simulation textures every step, so a borrower asks for the binding
 * once per frame after the fog has stepped and never keeps it longer. It never destroys anything.
 */
export interface FogAirBinding {
  /** Packed air velocity per fog cell, current step. */
  readonly velocity: Phaser.Textures.Texture;
  /** Density state; its alpha is the disturbance that explosions and motion raise. */
  readonly state: Phaser.Textures.Texture;
  /** Chunk slot lookup of the resident atlas. */
  readonly lookup: Phaser.Textures.Texture;
  /** World x, y of the fog frame. */
  readonly origin: Float32Array;
  /** World width, height of the fog frame. */
  readonly worldSize: Float32Array;
  /** Lookup texture width, height. */
  readonly lookupSize: Float32Array;
}

const cells = FOG.chunkSize / FOG.cellSize;

/**
 * Reads the fog's air: `fogCell` at one cell, `fogAt` bilinear at a world point, both returning
 * x, y air velocity in px/s and z the disturbance (zero outside resident chunks), and `fogStir`,
 * the disturbance alone, cheaper for gradients.
 */
export const FOG_AIR_GLSL = `
uniform sampler2D uFogVelocity,uFogLookup,uFogState;
uniform vec2 uFogOrigin,uFogWorldSize,uFogLookupSize;
const vec2 FOG_ATLAS=vec2(${FOG.atlasCols * cells}.0,${FOG.atlasRows * cells}.0);
// Atlas uv of the cell at a frame-local point; x < 0 outside resident chunks.
vec2 fogCellUv(vec2 local) {
 if(any(lessThan(local,vec2(0)))||any(greaterThanEqual(local,uFogWorldSize)))return vec2(-1.0);
 float slot=floor(texture2D(uFogLookup,(floor(local/${FOG.chunkSize}.0)+.5)/uFogLookupSize).r*255.0-1.0+.5);
 if(slot<0.0)return vec2(-1.0);
 vec2 uv=(vec2(mod(slot,${FOG.atlasCols}.0),floor(slot/${FOG.atlasCols}.0))*${cells}.0+floor(mod(local,${FOG.chunkSize}.0)/${FOG.cellSize}.0)+.5)/FOG_ATLAS;
 return vec2(uv.x,1.0-uv.y);
}
vec3 fogCell(vec2 local) {
 vec2 uv=fogCellUv(local);
 if(uv.x<0.0)return vec3(0.0);
 vec4 v=texture2D(uFogVelocity,uv);
 vec2 air=(vec2(dot(v.rg,vec2(65280.0,255.0)),dot(v.ba,vec2(65280.0,255.0)))/65535.0*2.0-1.0)*${FOG.maxSpeed}.0;
 return vec3(air,texture2D(uFogState,uv).a);
}
float fogStirCell(vec2 local) {
 vec2 uv=fogCellUv(local);
 return uv.x<0.0?0.0:texture2D(uFogState,uv).a;
}
vec3 fogAt(vec2 world) {
 vec2 grid=(world-uFogOrigin)/${FOG.cellSize}.0-.5,base=(floor(grid)+.5)*${FOG.cellSize}.0,w=fract(grid);
 const vec2 X=vec2(${FOG.cellSize}.0,0.0),Y=vec2(0.0,${FOG.cellSize}.0);
 return mix(mix(fogCell(base),fogCell(base+X),w.x),mix(fogCell(base+Y),fogCell(base+X+Y),w.x),w.y);
}
float fogStir(vec2 world) {
 vec2 grid=(world-uFogOrigin)/${FOG.cellSize}.0-.5,base=(floor(grid)+.5)*${FOG.cellSize}.0,w=fract(grid);
 const vec2 X=vec2(${FOG.cellSize}.0,0.0),Y=vec2(0.0,${FOG.cellSize}.0);
 return mix(mix(fogStirCell(base),fogStirCell(base+X),w.x),mix(fogStirCell(base+Y),fogStirCell(base+X+Y),w.x),w.y);
}`;
