import { describe, expect, it } from 'vitest';

import {
  getRockGpuPageSize,
  getRockRendererMode,
  setRockRendererMode,
} from '../src/arena/rocks/RockRendererSettings';

describe('RockRendererSettings', () => {
  it('defaults to spriteGpu with 512 px pages and keeps manual mode switching', () => {
    expect(getRockRendererMode()).toBe('spriteGpu');
    expect(getRockGpuPageSize()).toBe(512);

    setRockRendererMode('classic');
    expect(getRockRendererMode()).toBe('classic');

    setRockRendererMode('spriteGpu');
    expect(getRockRendererMode()).toBe('spriteGpu');
  });
});
