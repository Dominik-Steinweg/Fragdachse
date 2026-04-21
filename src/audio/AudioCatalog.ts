import type Phaser from 'phaser';

const SHIPPED_AUDIO_FILES = new Set([
  'airstrike2s.wav',
  'ak-47.ogg',
  'asmd-prim.ogg',
  'asmd-sec.ogg',
  'awp.ogg',
  'badger01.mp3',
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
  'sfx_explosion_rocket.ogg',
  'sfx_nuke_countdown.ogg',
  'sfx_nuke_explosion.ogg',
  'sfx_player_death.ogg',
  'sfx_player_move.ogg',
  'sfx_player_spawn.ogg',
  'sfx_train_move.ogg',
  'shotgun.ogg',
  'spore.ogg',
  'throw.ogg',
  'zeus.mp3',
  'zeus.ogg',
  'music_arena.wav',
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
  sfx_explosion_he:             './assets/sounds/sfx_explosion_rocket.ogg',//done (he + rocket getauscht)
  sfx_explosion_smoke:          './assets/sounds/sfx_explosion_smoke.wav',
  sfx_explosion_holy:           './assets/sounds/sfx_explosion_holy.ogg',//done
  sfx_explosion_rocket:         './assets/sounds/sfx_explosion_he.ogg',//done
  // Platzhalter: teilt die Audiodatei mit sfx_explosion_rocket, bis ein eigener Mini-Rocket-Sound geliefert wird.
  sfx_explosion_mini_rocket:    './assets/sounds/sfx_explosion_he.ogg',
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
  sfx_nuke_countdown:       './assets/sounds/sfx_nuke_countdown.ogg', //done
  sfx_nuke_explosion:       './assets/sounds/sfx_nuke_explosion.ogg', //done
  sfx_airstrike_countdown:  './assets/sounds/sfx_airstrike_countdown.ogg', //done
  sfx_airstrike_explosion:  './assets/sounds/sfx_airstrike_explosion.ogg', //done
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
  sfx_player_move:     './assets/sounds/sfx_player_move.ogg', //done
  sfx_dash:            './assets/sounds/sfx_dash.ogg', //done
  sfx_burrowed:        './assets/sounds/sfx_burrowed.ogg',//done
  sfx_player_hit:      './assets/sounds/sfx_player_hit.wav',
  sfx_environment_hit: './assets/sounds/sfx_environment_hit.wav',
  sfx_hit_feedback:    './assets/sounds/sfx_hit_feedback.wav',
  sfx_player_death:    './assets/sounds/sfx_player_death.ogg',
  sfx_player_spawn:    './assets/sounds/sfx_player_spawn.ogg',//done
  sfx_ctb_score:       './assets/sounds/sfx_ctb_score.wav',
  sfx_countdown_3:     './assets/sounds/sfx_countdown_3.ogg', //done
  sfx_countdown_2:     './assets/sounds/sfx_countdown_2.ogg',//done
  sfx_countdown_1:     './assets/sounds/sfx_countdown_1.ogg',//done
  sfx_countdown_go:    './assets/sounds/sfx_countdown_go.ogg',//done
  sfx_options_preview: './assets/sounds/sfx_countdown_go.ogg',
  sfx_train_move:      './assets/sounds/sfx_train_move.ogg',//done
  sfx_train_explode:   './assets/sounds/sfx_train_explode.wav',
} as const;

// ── Music ───────────────────────────────────────────────────────────────────
const MUSIC_ASSETS = {
  music_lobby: './assets/sounds/badger01.mp3', 
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
  // Shot Sounds
  shot_ak47:               0.4,
  shot_asmd_primary:       0.4,
  shot_asmd_secondary:     0.4,
  shot_crossbow:           0.1,
  shot_dry_trigger:        0.3,
  shot_gauss:              0.5,
  shot_glock:              0.15,
  shot_plasma:             0.2,
  shot_shotgun:            0.06, 
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
  sfx_explosion_armageddon:     0.2,

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
  sfx_adrenaline_active:    0.5,
  sfx_pickup_hp:            0.5,
  sfx_pickup_armor:         0.5,
  sfx_pickup_powerup:       0.5,
  sfx_double_damage_active: 0.5,

  // General SFX
  sfx_player_move:     0.5,
  sfx_dash:            0.5,
  sfx_burrowed:        0.5,
  sfx_player_hit:      0.5,
  sfx_environment_hit: 0.5,
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
  sfx_train_explode:   0.1,

  // Music  (Endwert je nach Lied anpassen; Kette: masterVolume × SOUND_MUSIC_VOLUME × dieser Wert)
  music_lobby: 0.2,
  music_arena: 0.2,
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
 * Dateien die nicht existieren werden still uebersprungen (Platzhalter-Support).
 */
export function preloadAllAudio(loader: Phaser.Loader.LoaderPlugin): void {
  for (const [key, assetPath] of Object.entries(AUDIO_ASSETS)) {
    if (!isShippedAudioAsset(assetPath)) continue;
    loader.audio(key, assetPath);
  }
}

/** @deprecated Use preloadAllAudio instead */
export function preloadShotAudio(loader: Phaser.Loader.LoaderPlugin): void {
  preloadAllAudio(loader);
}
