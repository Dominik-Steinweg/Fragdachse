import type Phaser from 'phaser';

// ── Shot Sounds (bestehend) ─────────────────────────────────────────────────
const SHOT_ASSETS = {
  shot_ak47:              './assets/sounds/ak-47.wav', //done
  shot_asmd_primary:      './assets/sounds/asmd-prim.wav', //done
  shot_asmd_secondary:    './assets/sounds/asmd-sec.wav',//done
  shot_crossbow:          './assets/sounds/crossbow.flac',//done
  shot_dry_trigger:       './assets/sounds/dry-trigger.wav',//done
  shot_gauss:             './assets/sounds/Gauss.wav',//done
  shot_glock:             './assets/sounds/glock.wav',//done
  shot_plasma:            './assets/sounds/plasma.wav',//done
  shot_shotgun:           './assets/sounds/shotgun.wav',//done
  shot_bite:              './assets/sounds/bite.wav',//done
  shot_zeus:              './assets/sounds/zeus.wav',//done
  shot_hydra:             './assets/sounds/hydra.wav',//done
  shot_awp:               './assets/sounds/awp.wav',//done
  shot_p90:               './assets/sounds/p90.wav',//done
  shot_flame:             './assets/sounds/flame.wav',//done
  shot_rocketlauncher:    './assets/sounds/rocketlauncher.wav',//done
  shot_minirocketlauncher:'./assets/sounds/minirocketlauncher.wav',//done
  shot_spore:             './assets/sounds/spore.wav',//done
  shot_negev:             './assets/sounds/negev.wav',//done
  shot_throw:             './assets/sounds/throw.wav',//done
  shot_bfg:               './assets/sounds/bfg.wav',//done
  shot_hallelujah:        './assets/sounds/hallelujah.wav',//done
} as const;

// ── Explosions ──────────────────────────────────────────────────────────────
const EXPLOSION_ASSETS = {
  sfx_explosion_he:             './assets/sounds/sfx_explosion_he.wav',//done
  sfx_explosion_smoke:          './assets/sounds/sfx_explosion_smoke.wav',
  sfx_explosion_holy:           './assets/sounds/sfx_explosion_holy.wav',//done
  sfx_explosion_rocket:         './assets/sounds/sfx_explosion_rocket.wav',//done
  sfx_explosion_asmd_secondary: './assets/sounds/sfx_explosion_asmd_secondary.wav',
  sfx_explosion_armageddon:     './assets/sounds/sfx_explosion_armageddon.wav',
} as const;

// ── Loadout Activations ─────────────────────────────────────────────────────
const LOADOUT_ASSETS = {
  sfx_tesla_activate:       './assets/sounds/sfx_tesla_activate.wav',
  sfx_tesla_active_targets: './assets/sounds/sfx_tesla_active_targets.wav',
  sfx_shield_activate:      './assets/sounds/sfx_shield_activate.wav',
  sfx_shield_active:        './assets/sounds/sfx_shield_active.wav',
  sfx_bfg_charge:           './assets/sounds/sfx_bfg_charge.wav',
  sfx_bfg_fly:              './assets/sounds/sfx_bfg_fly.wav',
  sfx_bfg_laser:            './assets/sounds/sfx_bfg_laser.wav',
  sfx_nuke_countdown:       './assets/sounds/sfx_nuke_countdown.wav', //done
  sfx_nuke_explosion:       './assets/sounds/sfx_nuke_explosion.wav', //done
  sfx_airstrike_countdown:  './assets/sounds/sfx_airstrike_countdown.wav', //done
  sfx_airstrike_explosion:  './assets/sounds/sfx_airstrike_explosion.wav', //done
  sfx_translocator_teleport:'./assets/sounds/sfx_translocator_teleport.wav',
  sfx_place_rock:           './assets/sounds/sfx_place_rock.wav',
  sfx_place_fliegenpilz:    './assets/sounds/sfx_place_fliegenpilz.wav',
  sfx_place_decoy:          './assets/sounds/sfx_place_decoy.wav',
  sfx_decoy_reveal:         './assets/sounds/sfx_decoy_reveal.wav',
  sfx_gauss_charge:         './assets/sounds/sfx_gauss_charge.wav',
  sfx_honey_badger_rage:    './assets/sounds/sfx_honey_badger_rage.wav',
  sfx_place_dachstunnel:    './assets/sounds/sfx_place_dachstunnel.wav',
  sfx_use_dachstunnel:      './assets/sounds/sfx_use_dachstunnel.wav',
} as const;

// ── Power-Ups ───────────────────────────────────────────────────────────────
const POWERUP_ASSETS = {
  sfx_adrenaline_active:   './assets/sounds/sfx_adrenaline_active.wav',
  sfx_pickup_hp:           './assets/sounds/sfx_pickup_hp.wav',
  sfx_pickup_armor:        './assets/sounds/sfx_pickup_armor.wav',
  sfx_pickup_powerup:      './assets/sounds/sfx_pickup_powerup.wav',
  sfx_double_damage_active:'./assets/sounds/sfx_double_damage_active.wav',
} as const;

// ── General SFX ─────────────────────────────────────────────────────────────
const GENERAL_ASSETS = {
  sfx_player_move:     './assets/sounds/sfx_player_move.wav', //done
  sfx_dash:            './assets/sounds/sfx_dash.wav', //done
  sfx_burrowed:        './assets/sounds/sfx_burrowed.wav',//done
  sfx_player_hit:      './assets/sounds/sfx_player_hit.wav',
  sfx_environment_hit: './assets/sounds/sfx_environment_hit.wav',
  sfx_hit_feedback:    './assets/sounds/sfx_hit_feedback.wav',
  sfx_player_death:    './assets/sounds/sfx_player_death.wav',
  sfx_player_spawn:    './assets/sounds/sfx_player_spawn.wav',//done
  sfx_ctb_score:       './assets/sounds/sfx_ctb_score.wav',
  sfx_countdown_3:     './assets/sounds/sfx_countdown_3.wav', //done
  sfx_countdown_2:     './assets/sounds/sfx_countdown_2.wav',//done
  sfx_countdown_1:     './assets/sounds/sfx_countdown_1.wav',//done
  sfx_countdown_go:    './assets/sounds/sfx_countdown_go.wav',//done
  sfx_train_move:      './assets/sounds/sfx_train_move.wav',//done
  sfx_train_explode:   './assets/sounds/sfx_train_explode.wav',
} as const;

// ── Music ───────────────────────────────────────────────────────────────────
const MUSIC_ASSETS = {
  music_lobby: './assets/sounds/music_lobby.wav',
  music_arena: './assets/sounds/music_arena.wav',
} as const;

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

/** Backward-compatible re-exports */
export const SHOT_AUDIO_ASSETS = SHOT_ASSETS;
export type ShotAudioAssetKey = keyof typeof SHOT_ASSETS;

/**
 * Laedt alle Audio-Assets in den Phaser-Loader.
 * Dateien die nicht existieren werden still uebersprungen (Platzhalter-Support).
 */
export function preloadAllAudio(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, assetPath] of Object.entries(AUDIO_ASSETS)) {
    loader.audio(key, assetPath);
  }
}

/** @deprecated Use preloadAllAudio instead */
export function preloadShotAudio(loader: Phaser.Loader.LoaderPlugin): void {
  preloadAllAudio(loader);
}
