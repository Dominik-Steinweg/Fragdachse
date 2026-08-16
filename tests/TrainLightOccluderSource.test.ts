import { describe, expect, it } from 'vitest';
import type { SyncedTrainState } from '../src/types';
import { ALL_EDGES_EXPOSED } from '../src/effects/lightShadowGeometry';
import { TRAIN } from '../src/train/TrainConfig';
import { TrainLightOccluderSource } from '../src/train/TrainLightOccluderSource';

const SYNCED_TRAIN: SyncedTrainState = {
  alive: true,
  x: 300,
  y: 500,
  dir: 1,
  hp: 300,
  maxHp: 300,
};

describe('TrainLightOccluderSource', () => {
  it('filters synchronized train hitboxes exactly against the light circle', () => {
    const source = new TrainLightOccluderSource();
    source.setTrain(null, SYNCED_TRAIN);
    const hits: number[][] = [];

    const tested = source.queryCircle(300, 500, 20, (...rect) => hits.push(rect));

    expect(tested).toBe(TRAIN.WAGON_COUNT + 1);
    expect(hits).toEqual([[
      300 - TRAIN.HITBOX_WIDTH * 0.5,
      500 - TRAIN.LOCO_HEIGHT * 0.5,
      300 + TRAIN.HITBOX_WIDTH * 0.5,
      500 + TRAIN.LOCO_HEIGHT * 0.5,
      ALL_EDGES_EXPOSED,
    ]]);
  });

  it('rejects a rectangle inside the circle bounding square but outside the circle', () => {
    const source = new TrainLightOccluderSource();
    source.setTrain([{
      active: true,
      x: 0,
      y: 0,
      displayWidth: 20,
      displayHeight: 20,
      body: { enable: true },
    }], SYNCED_TRAIN);
    let hits = 0;

    expect(source.queryCircle(20, 20, 12, () => { hits += 1; })).toBe(1);
    expect(hits).toBe(0);

    source.queryCircle(20, 20, Math.sqrt(200), () => { hits += 1; });
    expect(hits).toBe(1);
  });

  it('prefers current host rectangles and skips disabled physics segments', () => {
    const source = new TrainLightOccluderSource();
    source.setTrain([
      {
        active: true,
        x: 40,
        y: 60,
        displayWidth: 44,
        displayHeight: 128,
        body: { enable: true },
      },
      {
        active: true,
        x: 40,
        y: 260,
        displayWidth: 44,
        displayHeight: 256,
        body: { enable: false },
      },
    ], SYNCED_TRAIN);
    const hits: number[][] = [];

    const tested = source.queryCircle(40, 60, 8, (...rect) => hits.push(rect));

    expect(tested).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0].slice(0, 4)).toEqual([18, -4, 62, 124]);
  });

  it('places wagons behind either synchronized travel direction', () => {
    const source = new TrainLightOccluderSource();
    const firstWagonGap = TRAIN.LOCO_HEIGHT * 0.5
      + TRAIN.SEGMENT_GAP
      + TRAIN.WAGON_HEIGHT * 0.5;
    source.setTrain(null, { ...SYNCED_TRAIN, dir: -1 });
    let wagonTop = Number.NaN;

    source.queryCircle(300, 500 + firstWagonGap, 4, (_left, top) => { wagonTop = top; });

    expect(wagonTop).toBe(500 + firstWagonGap - TRAIN.WAGON_HEIGHT * 0.5);
    source.clear();
    expect(source.hasOccluders()).toBe(false);
    expect(source.queryCircle(300, 500, 500, () => undefined)).toBe(0);
  });
});
