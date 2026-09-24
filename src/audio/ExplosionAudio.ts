import type { AudioAssetKey } from './AudioCatalog';
import { resonanceReleaseStrength } from '../effects/timeBubbleResonanceVisual';

// The source is independent of the visual style. Missing recordings use an explicit
// temporary substitute, never a second sound layered over the dedicated recording.
export const EXPLOSION_AUDIO = {
  HE_GRENADE: 'sfx_explosion_he',
  HOLY_HAND_GRENADE: 'sfx_explosion_holy',
  ARMAGEDDON: 'sfx_explosion_armageddon',
  'enemy.void_meteor': 'sfx_explosion_void_armageddon',
  ROCKET_LAUNCHER: 'sfx_explosion_rocket',
  MINI_ROCKET_LAUNCHER: 'sfx_explosion_mini_rocket',
  XBOW: 'sfx_explosion_crossbow',
  NEGEV: 'sfx_explosion_negev',
  FLAMETHROWER: 'sfx_explosion_fireball',
  TURRET_FLAME: 'sfx_explosion_turret_fireball',
  TURRET_VOID_FLAME: 'sfx_explosion_void_turret_fireball',
  'ground_fire.kamikaze_napalm': 'sfx_explosion_kamikaze',
  'ROCKET_LAUNCHER.aftershock': 'sfx_explosion_rocket_aftershock',
  ASMD_SEC: 'sfx_explosion_asmd_secondary',
  'PLASMA:swarm-explosion': 'sfx_explosion_plasma_swarm',
  'GRAVE_TITAN_VOID_PLASMA:swarm-explosion': 'sfx_explosion_grave_titan_plasma',
  'ALIEN_BADGER_PLASMA:swarm-explosion': 'sfx_explosion_alien_plasma',
  'SPORE_TURRET_PLASMA:swarm-explosion': 'sfx_explosion_turret_plasma',
  INFERNO_COLOSSUS_VOID_ROCKETS: 'sfx_explosion_inferno_rockets',
  TURRET_ROCKET_BURST: 'sfx_explosion_turret_rocket',
  TURRET_GRAVITY: 'sfx_explosion_gravity',
  'environment.nuke': 'sfx_nuke_explosion',
  'enemy.void_nuke': 'sfx_explosion_void_nuke',
  'environment.airstrike': 'sfx_airstrike_explosion',
  'environment.decoy_explosion': 'sfx_explosion_decoy',
  'environment.rock_collapse': 'sfx_explosion_rock_collapse',
  'environment.base_destruction': 'sfx_explosion_base_destruction',
  'weapon.shotgun_lightning': 'sfx_explosion_shotgun_lightning',
  ENERGY_INJECTOR: 'sfx_explosion_energy_injector',
  TIME_BUBBLE: 'sfx_explosion_time_bubble',
  'enemy.timebomb': 'sfx_explosion_timebomb',
  'environment.train': 'sfx_train_explode',
} as const satisfies Record<string, AudioAssetKey>;

export const EXPLOSION_AUDIO_SUBSTITUTES: Partial<Record<AudioAssetKey, AudioAssetKey>> = {
  sfx_explosion_void_armageddon: 'sfx_explosion_armageddon',
  sfx_explosion_crossbow: 'sfx_explosion_mini_rocket',
  sfx_explosion_negev: 'sfx_explosion_he',
  sfx_explosion_fireball: 'sfx_explosion_he',
  sfx_explosion_turret_fireball: 'sfx_explosion_he',
  sfx_explosion_void_turret_fireball: 'sfx_explosion_he',
  sfx_explosion_kamikaze: 'sfx_explosion_he',
  sfx_explosion_rocket_aftershock: 'sfx_explosion_rocket',
  sfx_explosion_asmd_secondary: 'sfx_explosion_he',
  sfx_explosion_plasma_swarm: 'sfx_explosion_he',
  sfx_explosion_grave_titan_plasma: 'sfx_explosion_he',
  sfx_explosion_alien_plasma: 'sfx_explosion_he',
  sfx_explosion_turret_plasma: 'sfx_explosion_he',
  sfx_explosion_inferno_rockets: 'sfx_explosion_mini_rocket',
  sfx_explosion_turret_rocket: 'sfx_explosion_rocket',
  sfx_explosion_gravity: 'sfx_explosion_he',
  sfx_explosion_void_nuke: 'sfx_nuke_explosion',
  sfx_explosion_decoy: 'sfx_explosion_he',
  sfx_explosion_rock_collapse: 'sfx_explosion_he',
  sfx_explosion_base_destruction: 'sfx_explosion_he',
  sfx_explosion_shotgun_lightning: 'sfx_explosion_he',
  sfx_explosion_energy_injector: 'sfx_explosion_he',
  sfx_explosion_time_bubble: 'sfx_explosion_he',
  sfx_explosion_timebomb: 'sfx_explosion_he',
};

export function resolveExplosionAudio(sourceId: string, chargeDamage?: number): { key: AudioAssetKey; scale: number } | undefined {
  if (sourceId === 'silent') return undefined;
  // Carpet attacks deliberately share existing small-impact recordings at restrained gain.
  if (sourceId === 'ATTACK_DRONE_BOMB') return { key: 'sfx_explosion_mini_rocket', scale: .45 };
  if (sourceId === 'ATTACK_DRONE_CHUNK') return { key: 'sfx_explosion_rocket_aftershock', scale: .15 };
  if (sourceId === 'brood_hatch') return { key: 'shot_throw', scale: 1 };
  const key = EXPLOSION_AUDIO[sourceId as keyof typeof EXPLOSION_AUDIO] ?? 'sfx_explosion_he';
  const closeBoost = 1 / 0.58;
  if (sourceId === 'TIME_BUBBLE') {
    const strength = resonanceReleaseStrength(chargeDamage);
    return strength > 0 ? { key, scale: closeBoost * (0.2 + strength * 0.45) } : undefined;
  }
  // Preserve the meteor recording's existing gain when removing the extra HE layer.
  if (sourceId === 'ARMAGEDDON' || sourceId === 'enemy.void_meteor') return { key, scale: 1 };
  return { key, scale: closeBoost * (sourceId === 'weapon.shotgun_lightning' ? 0.82 : 1) };
}

export function resolveAvailableExplosionKey(key: AudioAssetKey, exists: (key: string) => boolean): AudioAssetKey {
  return exists(key) ? key : EXPLOSION_AUDIO_SUBSTITUTES[key] ?? key;
}
