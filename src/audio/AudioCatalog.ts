import type * as Phaser from 'phaser';

const SHIPPED_AUDIO_FILES = new Set([
  'airstrike2s.wav',
  'ak-47.ogg',
  'asmd-prim.ogg',
  'asmd-sec.ogg',
  'awp.ogg',
  'badger02.ogg',
  'bfg.ogg',
  'bite.ogg',
  'crossbow.ogg',
  'dry-trigger.ogg',
  'flame.ogg',
  'Gauss.ogg',
  'glock.ogg',
  'hallelujah.ogg',
  'hydra.ogg',
  'minirocketlauncher.ogg',
  'negev.ogg',
  'p90.ogg',
  'plasma.ogg',
  'rocketlauncher.ogg',
  'sfx_airstrike_countdown.ogg',
  'sfx_airstrike_explosion.ogg',
  'sfx_burrowed.ogg',
  'sfx_countdown_1.ogg',
  'sfx_countdown_2.ogg',
  'sfx_countdown_3.ogg',
  'sfx_countdown_go.ogg',
  'sfx_dash.ogg',
  'sfx_explosion_he.ogg',
  'sfx_explosion_holy.ogg',
  'sfx_explosion_armageddon.ogg',
  'sfx_explosion_mini_rocket.ogg',
  'sfx_explosion_rocket.ogg',
  'sfx_nuke_countdown.ogg',
  'sfx_nuke_explosion.ogg',
  'sfx_player_death.ogg',
  'sfx_player_move.ogg',
  'sfx_player_spawn.ogg',
  'sfx_player_hit.ogg',
  'sfx_hit_feedback.ogg',
  'sfx_environment_hit.ogg',
  'sfx_train_move.ogg',
  'sfx_train_explode.ogg',
  'shotgun.ogg',
  'spore.ogg',
  'throw.ogg',
  'zeus.mp3',
  'zeus.ogg',
  "music_arena.ogg",
  "sfx_menu_hover.ogg",
  "sfx_menu_activate.ogg",
  "sfx_pickup_adrenaline_essence.ogg",
  "sfx_checkpoint_activate.ogg",
  "sfx_objective_complete.ogg",
  "sfx_enemy_death.ogg",
  'sfx_explosion_void_armageddon.ogg',
  'sfx_explosion_crossbow.ogg',
  'sfx_explosion_negev.ogg',
  'sfx_explosion_fireball.ogg',
  'sfx_explosion_turret_fireball.ogg',
  'sfx_explosion_void_turret_fireball.ogg',
  'sfx_explosion_kamikaze.ogg',
  'sfx_explosion_rocket_aftershock.ogg',
  'sfx_explosion_asmd_secondary.ogg',
  'sfx_explosion_plasma_swarm.ogg',
  'sfx_explosion_grave_titan_plasma.ogg',
  'sfx_explosion_alien_plasma.ogg',
  'sfx_explosion_turret_plasma.ogg',
  'sfx_explosion_inferno_rockets.ogg',
  'sfx_explosion_turret_rocket.ogg',
  'sfx_explosion_gravity.ogg',
  'sfx_explosion_void_nuke.ogg',
  'sfx_explosion_decoy.ogg',
  'sfx_explosion_rock_collapse.ogg',
  'sfx_explosion_base_destruction.ogg',
  'sfx_explosion_shotgun_lightning.ogg',
  'sfx_explosion_energy_injector.ogg',
  'sfx_explosion_time_bubble.ogg',
  'sfx_explosion_timebomb.ogg',
]);

function isShippedAudioAsset(assetPath: string): boolean {
  const fileName = assetPath.split('/').pop();
  return fileName !== undefined && SHIPPED_AUDIO_FILES.has(fileName);
}

// ── Shot Sounds (bestehend) ─────────────────────────────────────────────────
const SHOT_ASSETS = {
  shot_ak47:              './assets/sounds/ak-47.ogg', //done
  shot_asmd_primary:      './assets/sounds/asmd-prim.ogg', //done
  shot_asmd_secondary:    './assets/sounds/asmd-sec.ogg',//done
  shot_crossbow:          './assets/sounds/crossbow.ogg',//done
  shot_dry_trigger:       './assets/sounds/dry-trigger.ogg',//done
  shot_gauss:             './assets/sounds/Gauss.ogg',//done
  shot_glock:             './assets/sounds/glock.ogg',//done
  shot_plasma:            './assets/sounds/plasma.ogg',//done
  shot_shotgun:           './assets/sounds/shotgun.ogg',//done
  shot_bite:              './assets/sounds/bite.ogg',//done
  shot_zeus:              './assets/sounds/zeus.ogg',//done
  shot_hydra:             './assets/sounds/hydra.ogg',//done
  shot_awp:               './assets/sounds/awp.ogg',//done
  shot_p90:               './assets/sounds/p90.ogg',//done
  shot_flame:             './assets/sounds/flame.ogg',//done
  shot_rocketlauncher:    './assets/sounds/rocketlauncher.ogg',//done
  shot_minirocketlauncher:'./assets/sounds/minirocketlauncher.ogg',//done
  shot_spore:             './assets/sounds/spore.ogg',//done
  shot_negev:             './assets/sounds/negev.ogg',//done
  shot_throw:             './assets/sounds/throw.ogg',//done
  shot_bfg:               './assets/sounds/bfg.ogg',//done
  shot_hallelujah:        './assets/sounds/hallelujah.ogg',//done
} as const;

// ── Explosions ──────────────────────────────────────────────────────────────
const EXPLOSION_ASSETS = {
  sfx_explosion_turret_fireball: './assets/sounds/sfx_explosion_turret_fireball.ogg',
  sfx_explosion_void_turret_fireball: './assets/sounds/sfx_explosion_void_turret_fireball.ogg',
  sfx_explosion_void_armageddon: './assets/sounds/sfx_explosion_void_armageddon.ogg',
  sfx_explosion_crossbow: './assets/sounds/sfx_explosion_crossbow.ogg',
  sfx_explosion_negev: './assets/sounds/sfx_explosion_negev.ogg',
  sfx_explosion_fireball: './assets/sounds/sfx_explosion_fireball.ogg',
  sfx_explosion_kamikaze: './assets/sounds/sfx_explosion_kamikaze.ogg',
  sfx_explosion_rocket_aftershock: './assets/sounds/sfx_explosion_rocket_aftershock.ogg',
  sfx_explosion_plasma_swarm: './assets/sounds/sfx_explosion_plasma_swarm.ogg',
  sfx_explosion_grave_titan_plasma: './assets/sounds/sfx_explosion_grave_titan_plasma.ogg',
  sfx_explosion_alien_plasma: './assets/sounds/sfx_explosion_alien_plasma.ogg',
  sfx_explosion_turret_plasma: './assets/sounds/sfx_explosion_turret_plasma.ogg',
  sfx_explosion_inferno_rockets: './assets/sounds/sfx_explosion_inferno_rockets.ogg',
  sfx_explosion_turret_rocket: './assets/sounds/sfx_explosion_turret_rocket.ogg',
  sfx_explosion_gravity: './assets/sounds/sfx_explosion_gravity.ogg',
  sfx_explosion_void_nuke: './assets/sounds/sfx_explosion_void_nuke.ogg',
  sfx_explosion_decoy: './assets/sounds/sfx_explosion_decoy.ogg',
  sfx_explosion_rock_collapse: './assets/sounds/sfx_explosion_rock_collapse.ogg',
  sfx_explosion_base_destruction: './assets/sounds/sfx_explosion_base_destruction.ogg',
  sfx_explosion_shotgun_lightning: './assets/sounds/sfx_explosion_shotgun_lightning.ogg',
  sfx_explosion_energy_injector: './assets/sounds/sfx_explosion_energy_injector.ogg',
  sfx_explosion_time_bubble: './assets/sounds/sfx_explosion_time_bubble.ogg',
  sfx_explosion_timebomb: './assets/sounds/sfx_explosion_timebomb.ogg',
  sfx_explosion_he:             './assets/sounds/sfx_explosion_rocket.ogg',//done (he + rocket getauscht)
  sfx_explosion_smoke:          './assets/sounds/sfx_explosion_smoke.ogg',
  sfx_explosion_holy:           './assets/sounds/sfx_explosion_holy.ogg',//done
  sfx_explosion_rocket:         './assets/sounds/sfx_explosion_he.ogg',//done
  sfx_explosion_mini_rocket:    './assets/sounds/sfx_explosion_mini_rocket.ogg',
  sfx_explosion_asmd_secondary: './assets/sounds/sfx_explosion_asmd_secondary.ogg',
  // Initial migration keeps the existing byte-identical fallback under an
  // independent target so normal and void Armageddon meteors remain available.
  sfx_explosion_armageddon:     './assets/sounds/sfx_explosion_armageddon.ogg',
} as const;

// ── Loadout Activations ─────────────────────────────────────────────────────
const LOADOUT_ASSETS = {
  sfx_tesla_activate:       './assets/sounds/sfx_tesla_activate.ogg',
  sfx_tesla_active_targets: './assets/sounds/sfx_tesla_active_targets.ogg',
  sfx_shield_activate:      './assets/sounds/sfx_shield_activate.ogg',
  sfx_shield_active:        './assets/sounds/sfx_shield_active.ogg',
  sfx_bfg_charge:           './assets/sounds/sfx_bfg_charge.ogg',
  sfx_bfg_fly:              './assets/sounds/sfx_bfg_fly.ogg',
  sfx_bfg_laser:            './assets/sounds/sfx_bfg_laser.ogg',
  sfx_nuke_countdown:       './assets/sounds/sfx_nuke_countdown.ogg', //done
  sfx_nuke_explosion:       './assets/sounds/sfx_nuke_explosion.ogg', //done
  sfx_airstrike_countdown:  './assets/sounds/sfx_airstrike_countdown.ogg', //done
  sfx_airstrike_explosion:  './assets/sounds/sfx_airstrike_explosion.ogg', //done
  sfx_translocator_teleport:'./assets/sounds/sfx_translocator_teleport.ogg',
  sfx_place_rock:           './assets/sounds/sfx_place_rock.ogg',
  sfx_place_fliegenpilz:    './assets/sounds/sfx_place_fliegenpilz.ogg',
  sfx_place_decoy:          './assets/sounds/sfx_place_decoy.ogg',
  sfx_decoy_reveal:         './assets/sounds/sfx_decoy_reveal.ogg',
  sfx_gauss_charge:         './assets/sounds/sfx_gauss_charge.ogg',
  sfx_honey_badger_rage:    './assets/sounds/sfx_honey_badger_rage.ogg',
  sfx_place_dachstunnel:    './assets/sounds/sfx_place_dachstunnel.ogg',
  sfx_use_dachstunnel:      './assets/sounds/sfx_use_dachstunnel.ogg',
} as const;

// ── Power-Ups ───────────────────────────────────────────────────────────────
const POWERUP_ASSETS = {
  sfx_pickup_adrenaline_essence: './assets/sounds/sfx_pickup_adrenaline_essence.ogg',
  sfx_pickup_rage: './assets/sounds/sfx_pickup_rage.ogg',
  sfx_pickup_adrenaline: './assets/sounds/sfx_pickup_adrenaline.ogg',
  sfx_pickup_double_damage: './assets/sounds/sfx_pickup_double_damage.ogg',
  sfx_pickup_nuke: './assets/sounds/sfx_pickup_nuke.ogg',
  sfx_pickup_holy_hand_grenade: './assets/sounds/sfx_pickup_holy_hand_grenade.ogg',
  sfx_pickup_bfg: './assets/sounds/sfx_pickup_bfg.ogg',
  sfx_adrenaline_active:   './assets/sounds/sfx_adrenaline_active.ogg',
  sfx_pickup_hp:           './assets/sounds/sfx_pickup_hp.ogg',
  sfx_pickup_armor:        './assets/sounds/sfx_pickup_armor.ogg',
  sfx_pickup_powerup:      './assets/sounds/sfx_pickup_powerup.ogg',
  sfx_double_damage_active:'./assets/sounds/sfx_double_damage_active.ogg',
} as const;

// ── General SFX ─────────────────────────────────────────────────────────────
const GENERAL_ASSETS = {
  sfx_enemy_death: './assets/sounds/sfx_enemy_death.ogg',
  sfx_menu_hover: './assets/sounds/sfx_menu_hover.ogg',
  sfx_menu_activate: './assets/sounds/sfx_menu_activate.ogg',
  sfx_round_victory: './assets/sounds/sfx_round_victory.ogg',
  sfx_round_defeat: './assets/sounds/sfx_round_defeat.ogg',
  sfx_wave_start: './assets/sounds/sfx_wave_start.ogg',
  sfx_boss_announce: './assets/sounds/sfx_boss_announce.ogg',
  sfx_objective_complete: './assets/sounds/sfx_objective_complete.ogg',
  sfx_checkpoint_activate: './assets/sounds/sfx_checkpoint_activate.ogg',
  sfx_ultimate_ready: './assets/sounds/sfx_ultimate_ready.ogg',
  sfx_level_up: './assets/sounds/sfx_level_up.ogg',
  sfx_upgrade_purchased: './assets/sounds/sfx_upgrade_purchased.ogg',
  sfx_item_selected: './assets/sounds/sfx_item_selected.ogg',
  sfx_player_move:     './assets/sounds/sfx_player_move.ogg', //done
  sfx_dash:            './assets/sounds/sfx_dash.ogg', //done
  sfx_burrowed:        './assets/sounds/sfx_burrowed.ogg',//done
  sfx_player_hit:      './assets/sounds/sfx_player_hit.ogg', //done
  sfx_environment_hit: './assets/sounds/sfx_environment_hit.ogg', // funktioniert noch nicht, noch nicht verdrahtet?!
  sfx_hit_feedback:    './assets/sounds/sfx_hit_feedback.ogg', //done
  sfx_player_death:    './assets/sounds/sfx_player_death.ogg',//done
  sfx_player_spawn:    './assets/sounds/sfx_player_spawn.ogg',//done
  sfx_ctb_score:       './assets/sounds/sfx_ctb_score.ogg',
  sfx_countdown_3:     './assets/sounds/sfx_countdown_3.ogg', //done
  sfx_countdown_2:     './assets/sounds/sfx_countdown_2.ogg',//done
  sfx_countdown_1:     './assets/sounds/sfx_countdown_1.ogg',//done
  sfx_countdown_go:    './assets/sounds/sfx_countdown_go.ogg',//done
  sfx_options_preview: './assets/sounds/sfx_countdown_go.ogg',
  sfx_train_move:      './assets/sounds/sfx_train_move.ogg',//done
  sfx_train_explode:   './assets/sounds/sfx_train_explode.ogg',
} as const;

// ── Music ───────────────────────────────────────────────────────────────────
const MUSIC_ASSETS = {
  music_lobby: './assets/sounds/badger02.ogg', 
  music_arena: './assets/sounds/music_arena.ogg',
} as const;

export type MusicAssetKey = keyof typeof MUSIC_ASSETS;

// ── Combined Catalog ────────────────────────────────────────────────────────
export const AUDIO_ASSETS = {
  ...SHOT_ASSETS,
  ...EXPLOSION_ASSETS,
  ...LOADOUT_ASSETS,
  ...POWERUP_ASSETS,
  ...GENERAL_ASSETS,
  ...MUSIC_ASSETS,
} as const;

export type AudioAssetKey = keyof typeof AUDIO_ASSETS;

export function isMusicAudioKey(key: string | undefined): key is MusicAssetKey {
  return key === 'music_lobby' || key === 'music_arena';
}

export function getMusicAssetPath(key: MusicAssetKey): string {
  return MUSIC_ASSETS[key];
}

// ── Per-Sound Volume Registry ───────────────────────────────────────────────
/**
 * Pro-Sound Lautstaerke-Faktor (0..1). Wird multiplikativ zusaetzlich zu
 * MASTER/SFX/MUSIC und etwaigem call-site `volumeScale` angewendet.
 *
 * So laesst sich jeder einzelne Sound feinjustieren, ohne die Audiodatei neu
 * abmischen zu muessen. Default fuer alle bisher hinterlegten Sounds ist 0.5,
 * d.h. halb so laut wie bisher.
 */
export const SOUND_VOLUMES: Record<AudioAssetKey, number> = {
  sfx_explosion_turret_fireball: 0.5,
  sfx_explosion_void_turret_fireball: 0.5,
  sfx_explosion_void_armageddon: 0.5,
  sfx_explosion_crossbow: 0.15,
  sfx_explosion_negev: 0.5,
  sfx_explosion_fireball: 0.5,
  sfx_explosion_kamikaze: 0.5,
  sfx_explosion_rocket_aftershock: 0.5,
  sfx_explosion_plasma_swarm: 0.5,
  sfx_explosion_grave_titan_plasma: 0.5,
  sfx_explosion_alien_plasma: 0.5,
  sfx_explosion_turret_plasma: 0.5,
  sfx_explosion_inferno_rockets: 0.15,
  sfx_explosion_turret_rocket: 0.5,
  sfx_explosion_gravity: 0.5,
  sfx_explosion_void_nuke: 0.9,
  sfx_explosion_decoy: 0.5,
  sfx_explosion_rock_collapse: 0.5,
  sfx_explosion_base_destruction: 0.5,
  sfx_explosion_shotgun_lightning: 0.5,
  sfx_explosion_energy_injector: 0.5,
  sfx_explosion_time_bubble: 1.0,
  sfx_explosion_timebomb: 0.5,
  // Shot Sounds
  shot_ak47:               0.4,
  shot_asmd_primary:       0.4,
  shot_asmd_secondary:     0.4,
  shot_crossbow:           0.1,
  shot_dry_trigger:        0.3,
  shot_gauss:              0.5,
  shot_glock:              0.15,
  shot_plasma:             0.2,
  shot_shotgun:            0.36, 
  shot_bite:               0.4,
  shot_zeus:               0.5,
  shot_hydra:              0.3,
  shot_awp:                0.4,
  shot_p90:                0.3,
  shot_flame:              0.2,
  shot_rocketlauncher:     0.5,
  shot_minirocketlauncher: 0.3,
  shot_spore:              0.5,
  shot_negev:              0.2,
  shot_throw:              0.5,
  shot_bfg:                0.5,
  shot_hallelujah:         0.8,

  // Explosions
  sfx_explosion_he:             0.5,
  sfx_explosion_smoke:          0.5,
  sfx_explosion_holy:           0.8,
  sfx_explosion_rocket:         0.5,
  sfx_explosion_mini_rocket:    0.15,
  sfx_explosion_asmd_secondary: 0.5,
  sfx_explosion_armageddon:     0.5,

  // Loadout Activations
  sfx_tesla_activate:        0.5,
  sfx_tesla_active_targets:  0.5,
  sfx_shield_activate:       0.5,
  sfx_shield_active:         0.5,
  sfx_bfg_charge:            0.5,
  sfx_bfg_fly:               0.5,
  sfx_bfg_laser:             0.5,
  sfx_nuke_countdown:        0.5,
  sfx_nuke_explosion:        0.9,
  sfx_airstrike_countdown:   0.5,
  sfx_airstrike_explosion:   0.5,
  sfx_translocator_teleport: 0.5,
  sfx_place_rock:            0.5,
  sfx_place_fliegenpilz:     0.5,
  sfx_place_decoy:           0.5,
  sfx_decoy_reveal:          0.5,
  sfx_gauss_charge:          0.5,
  sfx_honey_badger_rage:     0.5,
  sfx_place_dachstunnel:     0.5,
  sfx_use_dachstunnel:       0.5,

  // Power-Ups
  sfx_pickup_adrenaline_essence: 0.45,
  sfx_pickup_rage: 0.5,
  sfx_pickup_adrenaline: 0.5,
  sfx_pickup_double_damage: 0.5,
  sfx_pickup_nuke: 0.5,
  sfx_pickup_holy_hand_grenade: 0.5,
  sfx_pickup_bfg: 0.5,
  sfx_adrenaline_active:    0.5,
  sfx_pickup_hp:            0.5,
  sfx_pickup_armor:         0.5,
  sfx_pickup_powerup:       0.5,
  sfx_double_damage_active: 0.5,

  // General SFX
  sfx_enemy_death: 0.45,
  sfx_menu_hover: 0.1,
  sfx_menu_activate: 0.3,
  sfx_round_victory: 0.5,
  sfx_round_defeat: 0.5,
  sfx_wave_start: 0.5,
  sfx_boss_announce: 0.5,
  sfx_objective_complete: 0.7,
  sfx_checkpoint_activate: 0.5,
  sfx_ultimate_ready: 0.5,
  sfx_level_up: 0.5,
  sfx_upgrade_purchased: 0.5,
  sfx_item_selected: 0.5,
  sfx_player_move:     0.25,
  sfx_dash:            0.5,
  sfx_burrowed:        0.5,
  sfx_player_hit:      0.3,
  sfx_environment_hit: 0.9,
  sfx_hit_feedback:    0.5,
  sfx_player_death:    0.9,
  sfx_player_spawn:    0.7,
  sfx_ctb_score:       0.5,
  sfx_countdown_3:     0.5,
  sfx_countdown_2:     0.5,
  sfx_countdown_1:     0.5,
  sfx_countdown_go:    0.5,
  sfx_options_preview: 0.5,
  sfx_train_move:      0.8,
  sfx_train_explode:   0.2,

  // Music  (Endwert je nach Lied anpassen; Kette: masterVolume × SOUND_MUSIC_VOLUME × dieser Wert)
  music_lobby: 0.8,
  music_arena: 0.8,
};

/**
 * Liefert den pro-Sound Lautstaerke-Faktor fuer einen Key.
 * Unbekannte Keys (z.B. dynamisch generierte) erhalten den Fallback 0.5,
 * sodass neu hinzugefuegte Sounds automatisch auf dem halbierten Niveau
 * starten und danach feinjustiert werden koennen.
 */
export function getSoundVolume(key: string | undefined): number {
  if (!key) return 0;
  const registered = (SOUND_VOLUMES as Record<string, number | undefined>)[key];
  return registered ?? 0.5;
}

/** Backward-compatible re-exports */
export const SHOT_AUDIO_ASSETS = SHOT_ASSETS;
export type ShotAudioAssetKey = keyof typeof SHOT_ASSETS;

/**
 * Laedt alle Audio-Assets in den Phaser-Loader.
 * Geplante Sounds bleiben ohne Ladeanfrage, bis Audio Studio ihre Datei veroeffentlicht.
 */
export function preloadAllAudio(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, assetPath] of Object.entries(AUDIO_ASSETS)) {
    if (isMusicAudioKey(key)) continue;
    if (!isShippedAudioAsset(assetPath)) continue;
    loader.audio(key, assetPath);
  }
}

/** @deprecated Use preloadAllAudio instead */
export function preloadShotAudio(loader: Phaser.Loader.LoaderPlugin): void {
  preloadAllAudio(loader);
}
