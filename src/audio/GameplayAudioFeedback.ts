import type { AudioAssetKey } from './AudioCatalog';

/** Pickup identity is the authored definition, not its effect or its visual disappearance. */
export const PICKUP_AUDIO: Readonly<Record<string, AudioAssetKey>> = {
  HEALTH_PACK: 'sfx_pickup_hp',
  ARMOR: 'sfx_pickup_armor',
  RAGE: 'sfx_pickup_rage',
  ADRENALINE: 'sfx_pickup_adrenaline',
  DOUBLE_DAMAGE: 'sfx_pickup_double_damage',
  NUKE: 'sfx_pickup_nuke',
  HOLY_HAND_GRENADE: 'sfx_pickup_holy_hand_grenade',
  BFG: 'sfx_pickup_bfg',
};

const NETWORK_SOUND_KEYS = new Set<string>([
  ...Object.values(PICKUP_AUDIO), 'sfx_player_death', 'sfx_enemy_death',
  'sfx_wave_start', 'sfx_boss_announce', 'sfx_objective_complete', 'sfx_checkpoint_activate',
]);

export interface GameplayAudioCue {
  readonly key: AudioAssetKey;
  /** Stable identity of the confirmed occurrence, independent of packet sequence. */
  readonly eventId: string;
  readonly recipientId?: string;
  readonly position?: { readonly x: number; readonly y: number; readonly emitterId?: string };
  readonly activityRevision?: number;
}

export interface GameplayAudioEvent extends GameplayAudioCue {
  readonly wr: number;
  readonly sequence: number;
}

export function isGameplayAudioEvent(value: unknown): value is GameplayAudioEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as GameplayAudioEvent;
  return Number.isSafeInteger(e.wr) && Number.isSafeInteger(e.sequence) && e.sequence > 0
    && NETWORK_SOUND_KEYS.has(e.key) && typeof e.eventId === 'string' && e.eventId.length > 0
    && e.eventId.length <= 512
    && (e.recipientId === undefined || typeof e.recipientId === 'string')
    && (e.activityRevision === undefined || Number.isSafeInteger(e.activityRevision))
    && (e.position === undefined || (e.position !== null && typeof e.position === 'object'
      && Number.isFinite(e.position.x) && Number.isFinite(e.position.y)
      && (e.position.emitterId === undefined || typeof e.position.emitterId === 'string')));
}

/** Reliable, ordered events are consumed even when their sound is missing, muted or invisible. */
export class GameplayAudioCursor {
  private worldRevision: number | null = null;
  private sequence = 0;
  private readonly recent = new Set<string>();

  accept(event: GameplayAudioEvent, worldRevision: number | null, activityRevision: number | null,
    localPlayerId: string): boolean {
    if (this.worldRevision !== worldRevision) {
      this.worldRevision = worldRevision;
      this.sequence = 0;
      this.recent.clear();
    }
    if (event.wr !== worldRevision || event.sequence <= this.sequence) return false;
    this.sequence = event.sequence;
    const identity = `${event.activityRevision ?? 'world'}:${event.key}:${event.eventId}`;
    if (this.recent.has(identity)) return false;
    this.recent.add(identity);
    if (this.recent.size > 4096) this.recent.delete(this.recent.values().next().value!);
    return (event.activityRevision === undefined || event.activityRevision === activityRevision)
      && (event.recipientId === undefined || event.recipientId === localPlayerId);
  }
}

/** Baselines never announce readiness. Only an observed resource threshold crossing does. */
export class UltimateReadyFeedback {
  private previous: { identity: string; rage: number; required: number } | null = null;

  update(identity: string, rage: number, required: number): boolean {
    const previous = this.previous;
    this.previous = { identity, rage, required };
    return !!previous && previous.identity === identity && previous.required === required
      && Number.isFinite(rage) && required > 0 && previous.rage < required && rage >= required;
  }

  reset(): void { this.previous = null; }
}
