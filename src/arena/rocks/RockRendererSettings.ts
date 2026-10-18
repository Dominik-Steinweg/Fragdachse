export type RockRendererMode = 'classic' | 'spriteGpu';
export type RockGpuPageSize = 512 | 1024 | 2048 | 'global';

let rockRenderer: RockRendererMode = 'spriteGpu';
// Each visible page is one instanced draw with its own layer setup. 512 px pages put ~24 of them
// on screen (with prefetch margin); 2048 px needs 4-6. Off-screen instances are cheap on the GPU,
// and rock edits still upload only the touched buffer segments.
let rockGpuPageSize: RockGpuPageSize = 2048;

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
