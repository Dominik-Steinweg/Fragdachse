import { KRAKEN_BOSS_DEFAULTS as C } from '../../config/krakenBoss';
import { krakenExitDistance, krakenExitRoarAt, type KrakenExitPhase } from '../../systems/CoopDefenseKrakenMotion';
import { sampleKrakenClip } from '../../effects/kraken/KrakenClipTimeline';
import type { EnemyAreaClawAttack } from '../../systems/EnemyClawAttack';
import type { ReviewClip } from './KrakenReviewAssets';

export const isLandEffect = (effect: string): boolean => ['ashore', 'land-move', 'land-claw'].includes(effect);
export const reviewExit: KrakenExitPhase = { kind: 'ashore', corridorId: 'review', startedAt: 0,
  moveAt: C.exit.warningMs, gripAt: C.exit.warningMs + C.exit.gripAfterMs,
  heaveAt: C.exit.warningMs + C.exit.heaveAfterMs, endsAt: C.exit.warningMs + C.exit.durationMs,
  recoveryEndsAt: C.exit.warningMs + C.exit.durationMs + C.exit.recoveryMs, blocked: false };

/** The review seeks the production host curve/anchors, including backward seeks. */
export function sampleReviewLand(effect: string, now: number, center: { x: number; y: number },
  shore: { x: number; y: number }, angle: number, water: ReviewClip[], land: ReviewClip[]) {
  const origin = { x: shore.x, y: shore.y + C.bodyRadiusPx + 60 };
  let pose = { ...origin, angle }, asset: 'water' | 'land' = 'land', name = 'idle', age = now;
  let attack: EnemyAreaClawAttack | null = null;
  if (effect === 'ashore') {
    const start = { x: center.x, y: shore.y - 110 };
    const end = { x: shore.x, y: shore.y + 220 }, total = Math.hypot(end.x - start.x, end.y - start.y);
    const distance = krakenExitDistance(reviewExit, now, C.exit) * total;
    angle = Math.atan2(end.y - start.y, end.x - start.x);
    pose = { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance, angle };
    asset = now < reviewExit.gripAt ? 'water' : 'land';
    name = now < reviewExit.moveAt ? 'idle' : now < reviewExit.gripAt ? 'move' : 'ashore';
  } else if (effect === 'land-move') {
    age = Math.min(now, 2200); name = now < 2200 ? 'move' : 'idle';
    pose = { x: origin.x + Math.cos(angle) * C.landMoveSpeedPxPerSec * age / 1000,
      y: origin.y + Math.sin(angle) * C.landMoveSpeedPxPerSec * age / 1000, angle };
  } else {
    const strikeAt = C.slam.windupMs, hitAt = strikeAt + C.slam.strikeMs, endsAt = hitAt + C.slam.recoveryMs;
    attack = { attackId: 'review-land-claw', weaponId: 'kraken-slam', presentation: 'slam', startedAt: 0, strikeAt, hitAt, endsAt,
      pose: { originX: origin.x + Math.cos(angle) * C.bodyRadiusPx, originY: origin.y + Math.sin(angle) * C.bodyRadiusPx,
        angle, geometry: { kind: 'lane', length: C.slam.length, width: C.slam.width } } };
    const distance = C.slam.lungeDistancePx * Math.max(0, Math.min(1, (now - strikeAt) / C.slam.strikeMs));
    pose = { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance, angle };
    name = now < endsAt ? 'slam' : 'idle';
  }
  const clip = (asset === 'water' ? water : land).find(c => c.name === name);
  if (!clip) throw Error(`Missing ${asset}/${name} for ${effect}`);
  const marker = (key: string) => { const frame = clip.markers?.[key]; if (frame === undefined) throw Error(`Missing ${name}.${key}`); return frame; };
  const sample = name === 'ashore' ? sampleKrakenClip(clip, now, [[reviewExit.gripAt, marker('grip')],
    [reviewExit.gripAt + C.exit.gripHoldMs, marker('grip')],
    [reviewExit.heaveAt, marker('heave')], [reviewExit.endsAt, clip.frames.length - 1]])
    : name === 'slam' && attack ? sampleKrakenClip(clip, now, [[0, 0], [attack.strikeAt, marker('strike')],
      [attack.hitAt, marker('impact')], [attack.endsAt, clip.frames.length - 1]])
    : { clip: name, frame: Math.floor(age / 1000 * clip.frameRate) % clip.frames.length };
  return { pose, asset, sample, attack, phase: reviewExit, roarAt: krakenExitRoarAt(reviewExit, C.exit) };
}
