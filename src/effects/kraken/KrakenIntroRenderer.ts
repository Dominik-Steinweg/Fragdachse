import type { ShadowSystem } from '../ShadowSystem';
import type * as Phaser from 'phaser';
import { KRAKEN_RISE_INTRO, type KrakenBossIntroState } from '../../config/bossIntros';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../../graphics/cameraFocusOverride';
import type { CameraFeedbackController } from '../camera/CameraFeedbackController';
import { impactLight } from '../camera/cameraFeedbackPresets';
import { krakenIntroEyeDrive, KRAKEN_GLOW } from './KrakenGlowTimeline';
import { KrakenGlowLayer } from './KrakenGlowLayer';
import { KrakenLightRig } from './KrakenLightRig';
import { paintKrakenEyes, paintKrakenRoar } from './KrakenGlowPresentation';
import type { LightingSystem } from '../LightingSystem';
import { KrakenEffects, KrakenSpineOverlay, KrakenSpriteView, krakenClip, krakenDrain, krakenRiseTiming, sampleKrakenClip,
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
  private body: KrakenSpriteView | null;
  private readonly effects: KrakenEffects;
  private readonly glow: KrakenGlowLayer;
  private readonly lights: KrakenLightRig;
  /** The dorsal spines rise with the body instead of popping in when the fight view takes over. */
  private readonly spines: KrakenSpineOverlay;
  private key = '';
  private lastNow: number | null = null;
  private ownsFocus = false;
  private destroyed = false;
  private feedback: CameraFeedbackController | null = null;
  private postFx: ((event: 'krakenRoar') => void) | null = null;
  constructor(private readonly scene: Phaser.Scene, private readonly asset: KrakenPresentationAsset | null,
    private readonly waterAt: (x: number, y: number) => number, private readonly diagnostic: (message: string) => void,
    private readonly angle = 0, private readonly shadows?: ShadowSystem, spine?: KrakenPresentationAsset | null,
    lighting?: LightingSystem | null) {
    this.body = null;
    this.effects = new KrakenEffects(scene, waterAt);
    this.glow = new KrakenGlowLayer(scene);
    this.lights = new KrakenLightRig(lighting);
    this.spines = new KrakenSpineOverlay(scene, spine ?? undefined, waterAt, diagnostic, shadows);
  }
  setCameraFeedback(feedback: CameraFeedbackController | null, postFx?: (event: 'krakenRoar') => void): void {
    this.feedback = feedback; this.postFx = postFx ?? null;
  }
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
    this.body ??= new KrakenSpriteView(this.scene, this.asset, this.waterAt, this.diagnostic, false, undefined, undefined, this.shadows);
    const timing = krakenRiseTiming(this.asset.metadata, 'intro-rise', start, start + 600, end);
    const pose = { x: state.x, y: state.y, angle: this.angle };
    this.effects.begin(); this.glow.begin(); this.lights.begin();
    this.effects.rise(pose, timing, now, true);
    if (now >= timing.clipStartedAt && now < end) {
      const clip = krakenClip(this.asset.metadata, I.clip), eye = krakenIntroEyeDrive(timing, now);
      const shown = this.body?.show(sampleKrakenClip(clip, now, [[timing.clipStartedAt, 0], [end, clip.frames.length - 1]]), pose, now,
        { drain: krakenDrain(timing, now, true), requireClip: true, eye });
      if (shown) { this.spines.sync(this.body, [], null, now); paintKrakenEyes(this.body!, eye, this.glow, this.lights); }
      else this.spines.hide();
    } else { this.body?.hide(); this.spines.hide(); }
    // The roar floods the pond with violet light (the pond's own pulse follows with the void bloom).
    paintKrakenRoar(state.x, state.y, Math.exp(-(((now - timing.roarAt) / KRAKEN_GLOW.eye.roarWidthMs) ** 2)), this.glow, this.lights);
    this.glow.flush(); this.lights.commit();
    const weight = krakenIntroCameraWeight(elapsed);
    setCameraFocusOverride(this.scene, state.x, state.y, weight, I.camera.zoom);
    this.ownsFocus = weight > 0;
    // Joining/seeking beyond a marker samples the aftermath, without replaying camera impulses.
    if (this.lastNow !== null && now - this.lastNow < 150
      && this.lastNow < timing.roarAt && now >= timing.roarAt && now - timing.roarAt < 150) {
      const impulse = impactLight({ sourceX: state.x, sourceY: state.y });
      this.feedback?.request({ ...impulse, id: 'kraken-intro-roar', amplitudePx: impulse.amplitudePx * .35 });
      this.postFx?.('krakenRoar');
    }
    this.lastNow = now;
  }
  get gpuBytes(): number { return (this.body?.gpuBytes ?? 0) + this.effects.gpuBytes + this.spines.gpuBytes; }
  clear(): void {
    this.body?.destroy(); this.body = null; this.spines.clear(); this.effects.clear(); this.glow.clear(); this.lights.clear(); this.lastNow = null;
    if (this.ownsFocus) clearCameraFocusOverride(this.scene);
    if (this.key) this.feedback?.cancel('kraken-intro-roar');
    this.ownsFocus = false; this.key = '';
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.destroyed = true; this.body?.destroy(); this.effects.destroy(); this.glow.destroy(); this.feedback = null; this.postFx = null;
  }
}
