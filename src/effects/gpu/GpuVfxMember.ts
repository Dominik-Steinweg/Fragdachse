import type * as Phaser from 'phaser';
import { GPU_VFX_EASE_NAMES, GpuVfxEase, isLinearGpuVfxEase } from './GpuVfxEase';
import type { GpuVfxFrameAnimationSpec } from './GpuVfxFrameAnimations';
import type { GpuVfxSpawnSpec } from './GpuVfxSpawnSpec';

/**
 * GpuVfxMember – die einzige Stelle, an der aus einem neutralen Spawn-Auftrag ein
 * Phaser-`SpriteGPULayer.Member` wird.
 *
 * Alles, was hier steht, kennt ausser dieser Datei kein Effektcontroller mehr: `MemberAnimation`,
 * `loop`/`yoyo`, `gravityFactor`/`velocity`, die Tint-Verteilung auf vier Ecken und die
 * Basis-Korrektur nicht-linearer Eases.
 */

type PhaserGpuVfxMember = Phaser.Types.GameObjects.SpriteGPULayer.Member;
export type GpuVfxMemberAnimation = Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation;
type GpuVfxFrameMemberAnimation = Omit<GpuVfxMemberAnimation, 'base'> & {
  base: string | number;
};
export type GpuVfxMember = Omit<Partial<PhaserGpuVfxMember>, 'animation'> & {
  /** Phaser akzeptiert hier zusaetzlich das dokumentierte MemberAnimation-Objekt. */
  animation?: string | number | GpuVfxFrameMemberAnimation;
};

/** Gleiche Auswahl wie Phasers `EmitterOp.randomStaticValueEmit` fuer Tint-Arrays. */
export function pickGpuVfxTint(tints: readonly number[]): number {
  return tints[Math.floor(Math.random() * tints.length)];
}

/**
 * Basiswert fuer eine **nicht-lineare** Ease mit `loop: false`.
 *
 * Der Shader addiert dort ueber die gesamte Laufzeit `floor(amplitude) * amplitude`
 * (`SpriteGPULayer.vert`: `repeats = loop ? 0.0 : floor(a)`). Der Term ist fuer die
 * Frame-Index-Animation gedacht, wo `amplitude` die Anzahl der Frames ist, und stoert bei jeder
 * anderen Groesse. Bei negativen Amplituden greift `floor` bereits ab -1: eine Alpha-Kurve
 * 0.95 -> 0 kaeme ohne Korrektur als 1.9 -> 0.95 heraus.
 *
 * Diese Funktion nimmt den Term vorweg, sodass am Ende exakt `base + amplitude * ease(t)`
 * herauskommt. Lineare Animationen brauchen sie nicht: `Linear` rechnet mit `timeContinuous`
 * und ohne `repeats`.
 */
export function gpuVfxEasedBase(base: number, amplitude: number): number {
  return base - Math.floor(amplitude) * amplitude;
}

/**
 * Setzt alle vier Ecken auf denselben Tint. Zusammen mit `tintBlend: 1` und dem Default
 * `tintMode: 0` entspricht das dem Multiply-Tint eines klassischen Partikels.
 */
export function setGpuVfxTint(member: GpuVfxMember, tint: number): void {
  member.tintTopLeft     = tint;
  member.tintTopRight    = tint;
  member.tintBottomLeft  = tint;
  member.tintBottomRight = tint;
}

/** Ruhepose: flaechenlos und unsichtbar, bis der Slot bespielt wird. */
export const GPU_VFX_DEAD_MEMBER: GpuVfxMember = { scaleX: 0, scaleY: 0, alpha: 0 };

/* ── Wiederverwendete Vorlage. Jedes Feld wird bei jedem Spawn neu geschrieben, ein Rest aus
      einem frueheren Spawn kann also nicht durchschlagen. `loop`/`yoyo` defaulten in Phaser auf
      `true` und muessen fuer One-Shots ueberall explizit `false` sein. ── */
const animX: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const animYLinear: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
/**
 * `gravityFactor` kommt pro Spawn aus dem Spec: Phaser kodiert ihn in den Nachkommaanteil der
 * Amplitude (`amplitude = floor(velocity) + (factor + 1) / 2`), der Shader liest ihn ueber
 * `v = floor(a)` wieder heraus und beschleunigt mit `uGravity * gravityFactor`. Eine Lane traegt
 * damit mehrere Beschleunigungen; `velocity` ist deshalb oben schon ganzzahlig gerundet.
 */
const animYGravity: GpuVfxMemberAnimation = {
  base: 0, velocity: 0, gravityFactor: 1, duration: 0, ease: 'Gravity', loop: false, yoyo: false,
};
const animScale: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
/** Nur belegt, wenn ein Spawn wirklich streckt; sonst tragen beide Achsen `animScale`. */
const animScaleX: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const animAlpha: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const animRotation: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const animFrame: GpuVfxFrameMemberAnimation = {
  base: 0, amplitude: 0, duration: 0, delay: 0, ease: 'Linear', loop: false, yoyo: false,
};
/** Farbverlauf ueber die Lebenszeit; die vier Eckfarben selbst sind statisch. */
const animTintBlend: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };

const MEMBER: GpuVfxMember = {
  x: animX,
  y: animYLinear,
  scaleX: animScale,
  scaleY: animScale,
  alpha: animAlpha,
  rotation: 0,
  tintBlend: 1,
  tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff,
};

/**
 * Fuellt die geteilte Member-Vorlage aus einem Spawn-Auftrag und liefert sie zurueck. Der
 * Aufrufer reicht sie synchron an `editMember` weiter – `SpriteGPULayer` liest sie sofort aus,
 * eine Kopie waere eine Allokation pro Partikel.
 */
export function writeGpuVfxMember(
  spec: GpuVfxSpawnSpec,
  frame: Phaser.Textures.Frame,
  frameAnimation: GpuVfxFrameAnimationSpec | null = null,
): GpuVfxMember {
  const life  = spec.lifeMs;
  const lifeS = life / 1000;
  const positionEase = spec.positionEase ?? GpuVfxEase.Linear;

  writeCurve(animX, spec.x, spec.x + spec.vx * lifeS, positionEase, life);

  if (spec.yMode === GpuVfxEase.Gravity) {
    animYGravity.base = spec.y;
    // Phaser kodiert `velocity` ganzzahlig (`Math.floor`); die Rundung kostet < 0,5 px/s.
    animYGravity.velocity = Math.round(spec.vy);
    animYGravity.gravityFactor = spec.gravityFactor;
    animYGravity.duration = life;
    MEMBER.y = animYGravity;
  } else {
    writeCurve(animYLinear, spec.y, spec.y + spec.vy * lifeS, positionEase, life);
    MEMBER.y = animYLinear;
  }

  writeCurve(animScale, spec.scaleStart, spec.scaleEnd, spec.scaleEase, life);
  if (spec.stretchStart === 1 && spec.stretchEnd === 1) {
    // Der uniforme Normalfall: *ein* Kurvenobjekt fuer beide Achsen, wie vor der Streckung.
    MEMBER.scaleX = animScale;
  } else {
    writeCurve(
      animScaleX,
      spec.scaleStart * spec.stretchStart,
      spec.scaleEnd * spec.stretchEnd,
      spec.scaleEase,
      life,
    );
    MEMBER.scaleX = animScaleX;
  }
  writeCurve(animAlpha, spec.alphaStart, spec.alphaEnd, spec.alphaEase, life);

  if (spec.tintBlendStart === 1 && spec.tintBlendEnd === 1) {
    MEMBER.tintBlend = 1;
  } else {
    writeCurve(animTintBlend, spec.tintBlendStart, spec.tintBlendEnd, GpuVfxEase.Linear, life);
    MEMBER.tintBlend = animTintBlend;
  }

  if (spec.angularVelocity === 0) {
    MEMBER.rotation = spec.rotation;
  } else {
    writeCurve(
      animRotation,
      spec.rotation,
      spec.rotation + spec.angularVelocity * lifeS,
      spec.rotationEase,
      life,
    );
    MEMBER.rotation = animRotation;
  }

  MEMBER.frame = frame;
  if (frameAnimation) {
    animFrame.base = frameAnimation.name;
    animFrame.amplitude = frameAnimation.frames.length;
    // Phaser 4.2.1 laesst `loop` bei seiner internen Frame-Animation leider fallen. Ein um 1 ms
    // laengerer GPU-Zyklus als der Pool-Member macht den One-Shot trotzdem sichtbar strikt
    // vorwaerts: der Slot wird stillgelegt, bevor der Shader den Anfang wieder erreichen kann.
    animFrame.duration = life + 1;
    MEMBER.animation = animFrame;
  } else {
    MEMBER.animation = undefined;
  }
  setGpuVfxTint(MEMBER, spec.tint);
  return MEMBER;
}

function writeCurve(
  anim: GpuVfxMemberAnimation,
  start: number,
  end: number,
  ease: GpuVfxEase,
  durationMs: number,
): void {
  const amplitude = end - start;
  anim.amplitude = amplitude;
  anim.duration  = durationMs;
  anim.ease      = GPU_VFX_EASE_NAMES[ease];
  anim.base      = isLinearGpuVfxEase(ease) ? start : gpuVfxEasedBase(start, amplitude);
}
