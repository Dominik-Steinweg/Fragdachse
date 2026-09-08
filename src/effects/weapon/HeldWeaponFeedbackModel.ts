import {
  WEAPON_FEEDBACK_ATTACK_MS, WEAPON_FEEDBACK_HOLD_MS, WEAPON_FEEDBACK_MAX_STACK,
  WEAPON_FEEDBACK_STREAM_ATTACK_MS, WEAPON_FEEDBACK_STREAM_TIMEOUT_MS,
  type WeaponFeedbackProfile,
} from '../../config/weaponFeedback';

export interface HeldWeaponFeedbackPose { recoilPx: number; rotationRad: number; }
const cubicOut = (t: number): number => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

/** One bounded animation, sampled by absolute presentation time. No gameplay state or Phaser. */
export class HeldWeaponFeedbackModel {
  private profile: WeaponFeedbackProfile | null = null;
  private startedAt = 0;
  private sustainUntil = 0;
  private releaseAt: number | null = null;
  private fromPx = 0;
  private fromRad = 0;
  private peakPx = 0;
  private peakRad = 0;
  private readonly scratch: HeldWeaponFeedbackPose = { recoilPx: 0, rotationRad: 0 };

  /** Returns true for a new firing episode, false for a sustained refresh. */
  fire(profile: WeaponFeedbackProfile, now: number): boolean {
    if (profile.mode === 'sustained' && this.profile === profile
      && this.releaseAt === null && now < this.sustainUntil) {
      this.sustainUntil = now + WEAPON_FEEDBACK_STREAM_TIMEOUT_MS;
      return false;
    }
    this.sample(now, this.scratch);
    this.fromPx = this.scratch.recoilPx;
    this.fromRad = this.scratch.rotationRad;
    this.profile = profile;
    this.startedAt = now;
    this.releaseAt = null;
    this.sustainUntil = now + WEAPON_FEEDBACK_STREAM_TIMEOUT_MS;
    this.peakPx = profile.mode === 'sustained' ? profile.kickPx
      : Math.min(this.fromPx + profile.kickPx, profile.kickPx * WEAPON_FEEDBACK_MAX_STACK);
    const angle = profile.rotationDeg * Math.PI / 180;
    this.peakRad = Math.min(this.fromRad + angle, angle * WEAPON_FEEDBACK_MAX_STACK);
    return true;
  }

  stopSustained(now: number): void {
    if (this.profile?.mode !== 'sustained' || this.releaseAt !== null || now >= this.sustainUntil) return;
    this.sample(now, this.scratch);
    this.fromPx = this.scratch.recoilPx;
    this.fromRad = this.scratch.rotationRad;
    this.releaseAt = now;
  }

  isActive(now: number): boolean {
    if (!this.profile) return false;
    const end = this.profile.mode === 'sustained'
      ? (this.releaseAt ?? this.sustainUntil) + this.profile.returnMs
      : this.startedAt + WEAPON_FEEDBACK_ATTACK_MS + WEAPON_FEEDBACK_HOLD_MS + this.profile.returnMs;
    return now < end;
  }

  sample(now: number, out: HeldWeaponFeedbackPose): void {
    out.recoilPx = 0;
    out.rotationRad = 0;
    const p = this.profile;
    if (!p || !this.isActive(now)) return;
    const age = Math.max(0, now - this.startedAt);
    if (p.mode === 'sustained') {
      const release = this.releaseAt ?? this.sustainUntil;
      if (now >= release) {
        const gain = 1 - cubicOut((now - release) / p.returnMs);
        const phase = (release - this.startedAt) / 1000 * 18 * Math.PI * 2;
        out.recoilPx = (this.releaseAt === null ? p.kickPx + Math.sin(phase) * 0.2 : this.fromPx) * gain;
        out.rotationRad = (this.releaseAt === null ? Math.sin(phase + 0.7) * 0.25 * Math.PI / 180 : this.fromRad) * gain;
      } else {
        const gain = cubicOut(age / WEAPON_FEEDBACK_STREAM_ATTACK_MS);
        const phase = age / 1000 * 18 * Math.PI * 2;
        out.recoilPx = this.fromPx + (p.kickPx + Math.sin(phase) * 0.2 - this.fromPx) * gain;
        out.rotationRad = this.fromRad + (Math.sin(phase + 0.7) * 0.25 * Math.PI / 180 - this.fromRad) * gain;
      }
      return;
    }
    if (age < WEAPON_FEEDBACK_ATTACK_MS) {
      const gain = cubicOut(age / WEAPON_FEEDBACK_ATTACK_MS);
      out.recoilPx = this.fromPx + (this.peakPx - this.fromPx) * gain;
      out.rotationRad = this.fromRad + (this.peakRad - this.fromRad) * gain;
    } else {
      const gain = 1 - cubicOut((age - WEAPON_FEEDBACK_ATTACK_MS - WEAPON_FEEDBACK_HOLD_MS) / p.returnMs);
      out.recoilPx = this.peakPx * gain;
      out.rotationRad = this.peakRad * gain;
    }
  }

  reset(): void { this.profile = null; this.releaseAt = null; }
}
