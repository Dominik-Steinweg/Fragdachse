import { BaseFortFx } from '../arena/baseStructures/BaseFortFx';
import type { GpuVfxSystem } from '../effects/gpu/GpuVfxSystem';
import type { LightingSystem } from '../effects/LightingSystem';
import type { ShadowSystem } from '../effects/ShadowSystem';
import type { BaseManager } from '../entities/BaseManager';

export interface BaseFortPresentationSystems {
  readonly lighting: LightingSystem;
  readonly shadow: ShadowSystem | null;
  readonly gpuVfx: GpuVfxSystem | null;
}

/**
 * How a World presents its bases: lights, fort shadows and the fire of torches and fire bowls.
 *
 * Every World that shows bases binds them here, the match World as well as the base editor's local
 * World, so the fort looks the same in both. The sun reaches the fort through the World's sunlight
 * presentation (`structures` target, see {@link BaseManager.setFortSunlight}).
 */
export function bindBaseFortPresentation(bases: BaseManager, systems: BaseFortPresentationSystems): void {
  bases.setLightingSystem(systems.lighting);
  const gpuVfx = systems.gpuVfx;
  bases.setFortPresentation(systems.shadow, gpuVfx ? emitters => new BaseFortFx(gpuVfx, emitters) : null);
}
