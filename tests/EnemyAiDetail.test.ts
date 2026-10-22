import { describe, expect, it } from 'vitest';
import {
  EnemyAiDetailTiers,
  resolveEnemyAiDetailOptions,
  resolveEnemyEngagementReachPx,
  type EnemyAiDetailBounds,
  type EnemyAiDetailSubject,
} from '../src/systems/navigation/EnemyAiDetail';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../src/config/coopDefenseEnemies';

const options = { viewWidthPx: 1920, viewHeightPx: 1080, nearMarginPx: 400, farMarginPx: 600 };
const world: EnemyAiDetailBounds = { left: 0, top: 0, right: 8000, bottom: 4000 };
const subject = (id: string, x: number, y: number, positionRevision = 0): EnemyAiDetailSubject =>
  ({ id, positionRevision, sprite: { x, y } });
/** A player in the middle of the world sees x 3040..4960 and y 1460..2540. */
const CENTER = { x: 4000, y: 2000 };
const RIGHT_EDGE = CENTER.x + options.viewWidthPx / 2;

function frame(tiers: EnemyAiDetailTiers, anchors: readonly { x: number; y: number }[],
  subjects: readonly EnemyAiDetailSubject[], keepFull: (subject: EnemyAiDetailSubject) => boolean = () => false,
  bounds: EnemyAiDetailBounds | null = world): void {
  tiers.beginFrame(bounds);
  for (const anchor of anchors) tiers.addAnchor(anchor.x, anchor.y);
  tiers.classify(subjects, keepFull);
}

describe('Enemy AI detail tiers', () => {
  it('turns far only beyond the far band and full again only inside the near band', () => {
    const tiers = new EnemyAiDetailTiers(options);
    const at = (gap: number) => [subject('e', RIGHT_EDGE + gap, CENTER.y)];
    frame(tiers, [CENTER], at(options.farMarginPx - 1));
    expect(tiers.isFar('e')).toBe(false);
    frame(tiers, [CENTER], at(options.farMarginPx));
    expect(tiers.isFar('e')).toBe(true);
    frame(tiers, [CENTER], at(options.nearMarginPx + 1));
    expect(tiers.isFar('e')).toBe(true);
    frame(tiers, [CENTER], at(options.nearMarginPx));
    expect(tiers.isFar('e')).toBe(false);
    frame(tiers, [CENTER], at(options.farMarginPx - 1));
    expect(tiers.isFar('e')).toBe(false);
  });

  it('keeps full detail without any view and for enemies not classified this frame', () => {
    const tiers = new EnemyAiDetailTiers(options);
    const far = [subject('e', 100, 100)];
    frame(tiers, [CENTER], far);
    expect(tiers.isFar('e')).toBe(true);
    frame(tiers, [], far);
    expect(tiers.isFar('e')).toBe(false);
    frame(tiers, [CENTER], far);
    frame(tiers, [CENTER], []);
    expect(tiers.isFar('e')).toBe(false);
    expect(tiers.getFarCount()).toBe(0);
    expect(tiers.isFar('unknown')).toBe(false);
  });

  it('follows the camera clamp at the world edge and sees a short world axis whole', () => {
    const tiers = new EnemyAiDetailTiers(options);
    // At the west edge the view reaches 1920 px into the world; centred, the same offset is far.
    const offset = 1800;
    frame(tiers, [{ x: 100, y: CENTER.y }], [subject('edge', 100 + offset, CENTER.y)]);
    expect(tiers.isFar('edge')).toBe(false);
    frame(tiers, [CENTER], [subject('center', CENTER.x + offset, CENTER.y)]);
    expect(tiers.isFar('center')).toBe(true);
    // A world lower than the view keeps every height on screen.
    const strip = { left: 0, top: 0, right: 8000, bottom: 900 };
    frame(tiers, [{ x: CENTER.x, y: 0 }], [subject('low', CENTER.x, 899), subject('side', 7000, 450)], () => false, strip);
    expect(tiers.isFar('low')).toBe(false);
    expect(tiers.isFar('side')).toBe(true);
  });

  it('uses the nearest of several views', () => {
    const tiers = new EnemyAiDetailTiers(options);
    const enemies = [subject('e', 7000, 2000)];
    frame(tiers, [CENTER], enemies);
    expect(tiers.isFar('e')).toBe(true);
    frame(tiers, [CENTER, { x: 7500, y: 2000 }], enemies);
    expect(tiers.isFar('e')).toBe(false);
  });

  it('asks the keep-full rule only for would-be far enemies and honours it', () => {
    const tiers = new EnemyAiDetailTiers(options), asked: string[] = [];
    const enemies = [subject('near', CENTER.x, CENTER.y), subject('fighting', 100, 100), subject('idle', 7900, 3900)];
    frame(tiers, [CENTER], enemies, enemy => { asked.push(enemy.id); return enemy.id === 'fighting'; });
    expect(asked).toEqual(['fighting', 'idle']);
    expect(tiers.isFar('fighting')).toBe(false);
    expect(tiers.isFar('idle')).toBe(true);
  });

  it('re-evaluates a far enemy in full detail on the frame of a discontinuous move', () => {
    const tiers = new EnemyAiDetailTiers(options);
    frame(tiers, [CENTER], [subject('e', 100, 100, 1)]);
    expect(tiers.isFar('e')).toBe(true);
    frame(tiers, [CENTER], [subject('e', 200, 100, 2)]);
    expect(tiers.isFar('e')).toBe(false);
    frame(tiers, [CENTER], [subject('e', 200, 100, 2)]);
    expect(tiers.isFar('e')).toBe(true);
  });

  it('keeps every authored engagement reach around a player in full detail', () => {
    for (const config of Object.values(COOP_DEFENSE_ENEMY_CONFIGS)) {
      const reach = resolveEnemyEngagementReachPx([config]);
      if (!reach) continue;
      const tiers = new EnemyAiDetailTiers(resolveEnemyAiDetailOptions(
        resolveEnemyEngagementReachPx(Object.values(COOP_DEFENSE_ENEMY_CONFIGS))));
      // Along the short side of the view, from a player standing far from every world edge.
      frame(tiers, [CENTER], [subject('e', CENTER.x, CENTER.y + reach)], () => false,
        { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 });
      expect(tiers.isFar('e'), config.id).toBe(false);
    }
  });
});
