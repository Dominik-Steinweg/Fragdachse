import type * as Phaser from 'phaser';
import { KRAKEN_RISE_INTRO, type KrakenBossIntroState } from '../../config/bossIntros';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../../graphics/cameraFocusOverride';
import type { CameraFeedbackController } from '../camera/CameraFeedbackController';
import { impactLight } from '../camera/cameraFeedbackPresets';
import { KrakenEffects, KrakenSpriteView, krakenClip, krakenDrain, krakenRiseTiming, sampleKrakenClip,
  krakenClamp, type KrakenPresentationAsset } from './KrakenRenderer';

const I = KRAKEN_RISE_INTRO;
const smooth = (n: number): number => { const t = krakenClamp(n); return t * t * (3 - 2 * t); };
export function krakenIntroCameraWeight(elapsed: number): number {
  if (elapsed < 0 || elapsed >= I.durationMs) return 0;
  return smooth(elapsed / I.camera.panInMs)
    * (1 - smooth((elapsed - I.emergeAtMs - I.camera.holdAfterEmergeMs) / I.camera.panOutMs));
}

/** Only the intro silhouette/choreography and local camera. BossSystem owns reservation/spawn.
 * The intro view hands off exactly at emergeAtMs; it never creates an Enemy or advances a phase. */
export class KrakenIntroRenderer {
  private readonly body: KrakenSpriteView | null;
  private readonly effects: KrakenEffects;
  private key = '';
  private lastNow: number | null = null;
  private ownsFocus = false;
  private destroyed = false;
  private feedback: CameraFeedbackController | null = null;
  constructor(private readonly scene: Phaser.Scene, private readonly asset: KrakenPresentationAsset | null,
    waterAt: (x: number, y: number) => number, diagnostic: (message: string) => void,
    private readonly angle = 0) {
    this.body = asset ? new KrakenSpriteView(scene, asset, waterAt, diagnostic) : null;
    this.effects = new KrakenEffects(scene, waterAt);
  }
  setCameraFeedback(feedback: CameraFeedbackController | null): void { this.feedback = feedback; }
  sync(state: KrakenBossIntroState | null, now: number): void {
    if (this.destroyed) return;
    const elapsed = state ? now - state.startedAtMs : -1;
    if (!state || elapsed < 0 || elapsed >= I.durationMs) { this.clear(); return; }
    const key = JSON.stringify([state.habitatId, state.waterAnchorId, state.startedAtMs, state.seed]);
    if (key !== this.key) { this.clear(); this.key = key; }
    const start = state.startedAtMs, end = start + I.emergeAtMs;
    // The reviewed lead-in gives the rising shadow time to announce the body.
    if (!this.asset) {
      const weight = krakenIntroCameraWeight(elapsed);
      setCameraFocusOverride(this.scene, state.x, state.y, weight, I.camera.zoom);
      this.ownsFocus = weight > 0;
      return;
    }
    const timing = krakenRiseTiming(this.asset.metadata, 'intro-rise', start, start + 600, end);
    const pose = { x: state.x, y: state.y, angle: this.angle };
    this.effects.begin();
    this.effects.rise(pose, timing, now, true);
    if (now >= timing.clipStartedAt && now < end) {
      const clip = krakenClip(this.asset.metadata, I.clip);
      this.body?.show(sampleKrakenClip(clip, now, [[timing.clipStartedAt, 0], [end, clip.frames.length - 1]]), pose, now,
        { drain: krakenDrain(timing, now, true) });
    } else this.body?.hide();
    const weight = krakenIntroCameraWeight(elapsed);
    setCameraFocusOverride(this.scene, state.x, state.y, weight, I.camera.zoom);
    this.ownsFocus = weight > 0;
    // Joining/seeking beyond a marker samples the aftermath, without replaying camera impulses.
    if (this.lastNow !== null && now - this.lastNow < 150
      && this.lastNow < timing.roarAt && now >= timing.roarAt && now - timing.roarAt < 150) {
      const impulse = impactLight({ sourceX: state.x, sourceY: state.y });
      this.feedback?.request({ ...impulse, id: 'kraken-intro-roar', amplitudePx: impulse.amplitudePx * .35 });
    }
    this.lastNow = now;
  }
  clear(): void {
    this.body?.hide(); this.effects.clear(); this.lastNow = null;
    if (this.ownsFocus) clearCameraFocusOverride(this.scene);
    if (this.key) this.feedback?.cancel('kraken-intro-roar');
    this.ownsFocus = false; this.key = '';
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.destroyed = true; this.body?.destroy(); this.effects.destroy(); this.feedback = null;
  }
}
