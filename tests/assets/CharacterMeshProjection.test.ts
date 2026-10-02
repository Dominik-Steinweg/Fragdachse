import { expect, it } from 'vitest';
// Offline pipeline module; deliberately independent of Phaser and WebGL mocks.
// @ts-expect-error The pipeline remains ESM JavaScript, outside the runtime TS graph.
import { meshShadowSelfcheck } from '../../scripts/asset-pipeline/mesh-shadow-selfcheck.mjs';

it('preserves projected grip attachment, union coverage and the mesh binary contract', async () => {
  const result = await meshShadowSelfcheck();
  expect(result.status).toBe('passed');
});
