import { findWeaponConfig } from '../../loadout/LoadoutConfig';
import type { WeaponShotFeedbackEvent } from '../../loadout/WeaponShotFeedbackEvent';
import { WEAPON_FEEDBACK_PROFILES, type WeaponFeedbackProfile } from '../../config/weaponFeedback';
import type { WeaponSlot } from '../../types';
import type { CameraFeedbackRequest } from '../camera/CameraFeedbackModel';
import { directionalKick } from '../camera/cameraFeedbackPresets';

export interface WeaponFeedbackPlayer {
  playHeldWeaponShot(itemId: string, profile: WeaponFeedbackProfile): 'started' | 'refreshed' | null;
  resetHeldWeaponFeedback(): void;
  stopHeldWeaponSustain(): void;
  updateHeldWeaponFeedback(): void;
}

export interface WeaponFireFeedbackDeps {
  getPlayer(id: string): WeaponFeedbackPlayer | undefined;
  getLocalPlayerId(): string;
  getWorldRevision(): number | null;
  isLocalTriggerHeld(slot: WeaponSlot): boolean;
  requestCamera(request: CameraFeedbackRequest): void;
  cancelCamera(): void;
}

/** Routes presentation only. Prediction watermarks and sequence baselines end with the World. */
export class WeaponFireFeedbackController {
  private worldRevision: number | null = null;
  private readonly sequences = new Map<string, number>();
  private readonly predicted: Record<WeaponSlot, number> = { weapon1: 0, weapon2: 0 };
  private readonly active = new Map<string, { player: WeaponFeedbackPlayer; slot: WeaponSlot }>();

  constructor(private readonly deps: WeaponFireFeedbackDeps) {}

  predict(event: Omit<WeaponShotFeedbackEvent, 'sequence'> & { predictionId: number }): void {
    if (!this.ensureWorld() || event.predictionId <= this.predicted[event.slot]) return;
    this.predicted[event.slot] = event.predictionId;
    this.play(event);
  }

  confirm(event: WeaponShotFeedbackEvent): void {
    if (!this.ensureWorld() || event.sequence <= (this.sequences.get(event.shooterId) ?? 0)) return;
    this.sequences.set(event.shooterId, event.sequence);
    if (event.shooterId === this.deps.getLocalPlayerId() && event.predictionId !== undefined
      && event.predictionId <= this.predicted[event.slot]) return;
    this.play(event);
  }

  update(): void {
    if (!this.ensureWorld()) return;
    for (const [id, binding] of this.active) {
      if (this.deps.getPlayer(id) !== binding.player) { this.active.delete(id); continue; }
      if (id === this.deps.getLocalPlayerId() && !this.deps.isLocalTriggerHeld(binding.slot)) {
        binding.player.stopHeldWeaponSustain();
      }
      binding.player.updateHeldWeaponFeedback();
    }
  }

  reset(): void {
    for (const { player } of this.active.values()) player.resetHeldWeaponFeedback();
    this.active.clear();
    this.sequences.clear();
    this.predicted.weapon1 = this.predicted.weapon2 = 0;
    this.deps.cancelCamera();
  }

  private ensureWorld(): boolean {
    const revision = this.deps.getWorldRevision();
    if (revision !== this.worldRevision) { this.reset(); this.worldRevision = revision; }
    return revision !== null;
  }

  private play(event: Omit<WeaponShotFeedbackEvent, 'sequence'>): void {
    const config = findWeaponConfig(event.weaponId);
    const profile = config?.shotFeedbackProfile && WEAPON_FEEDBACK_PROFILES[config.shotFeedbackProfile];
    const player = this.deps.getPlayer(event.shooterId);
    if (!profile || !player) return;
    const result = player.playHeldWeaponShot(event.weaponId, profile);
    if (!result) return;
    this.active.set(event.shooterId, { player, slot: event.slot });
    if (event.shooterId !== this.deps.getLocalPlayerId()
      || (profile.mode === 'sustained' && result === 'refreshed')) return;
    this.deps.requestCamera({
      ...directionalKick(-Math.cos(event.angle), -Math.sin(event.angle), profile.cameraPx, profile.cameraMs),
      id: 'weapon:local-shot',
    });
  }
}
