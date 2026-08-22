export type RockRendererMode = 'classic' | 'spriteGpu';
export type RockGpuPageSize = 512 | 1024 | 2048 | 'global';

let rockRenderer: RockRendererMode = 'spriteGpu';
let rockGpuPageSize: RockGpuPageSize = 512;

/** Feature-Flag-Quelle fuer den naechsten Rundenaufbau und das Trace-Menue. */
export function getRockRendererMode(): RockRendererMode {
  return rockRenderer;
}

export function setRockRendererMode(mode: RockRendererMode): void {
  rockRenderer = mode;
}

export function getRockGpuPageSize(): RockGpuPageSize {
  return rockGpuPageSize;
}

export function setRockGpuPageSize(size: RockGpuPageSize): void {
  rockGpuPageSize = size;
}
