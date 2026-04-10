import * as Phaser from 'phaser';
import {
  SHOT_AUDIO_PAN_RANGE,
  SHOT_AUDIO_REMOTE_CLOSE_VOLUME,
  SHOT_AUDIO_REMOTE_DISTANCE_EXPONENT,
  SHOT_AUDIO_REMOTE_FAR_VOLUME,
  SHOT_AUDIO_REMOTE_MAX_DISTANCE,
  SOUND_ENABLED,
  SOUND_MASTER_VOLUME,
  SOUND_MUSIC_VOLUME,
  SOUND_SFX_VOLUME,
} from '../config';
import type { AudioKey } from '../types';

interface ListenerPosition {
  x: number;
  y: number;
}

/**
 * Zentrales Audio-System fuer alle Spielsounds: One-Shot SFX (spatial + lokal),
 * Loop-Sounds und Musik. Ersetzt das bisherige ShotAudioSystem.
 *
 * Volume-Kanaele:
 * - SFX:   SOUND_MASTER_VOLUME × SOUND_SFX_VOLUME × per-sound scale
 * - Music: SOUND_MASTER_VOLUME × SOUND_MUSIC_VOLUME × per-sound scale
 */
export class GameAudioSystem {
  private loopCounter = 0;
  private readonly activeLoops = new Map<string, Phaser.Sound.BaseSound>();
  private currentMusic: Phaser.Sound.BaseSound | null = null;
  private currentMusicKey: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalPlayerId: () => string,
    private readonly getListenerPosition: () => ListenerPosition | null,
  ) {
    // Prevent deferred playback bursts after tab blur / refocus.
    this.scene.sound.pauseOnBlur = false;
  }

  // ── One-Shot SFX (spatial) ────────────────────────────────────────────────

  /**
   * Spielt einen raeumlichen One-Shot-Sound.
   * Lautstaerke und Stereo-Panning werden relativ zum Listener berechnet.
   * Ist der Emitter der lokale Spieler, wird volle Lautstaerke ohne Panning verwendet.
   * Fehlende Sound-Keys werden still uebersprungen.
   */
  playSound(
    soundKey: AudioKey | undefined,
    emitterX: number,
    emitterY: number,
    emitterId?: string,
    volumeScale = 1,
  ): void {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const isLocal = emitterId !== undefined && emitterId === this.getLocalPlayerId();
    const { volume, pan } = isLocal
      ? { volume: 1, pan: 0 }
      : this.resolveSpatialPlayback(emitterX, emitterY);
    const finalVolume = SOUND_MASTER_VOLUME * SOUND_SFX_VOLUME * volumeScale * volume;

    if (finalVolume <= 0.001) return;

    this.scene.sound.play(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: Phaser.Math.Clamp(pan, -1, 1),
    });
  }

  // ── One-Shot SFX (lokal, kein Panning) ────────────────────────────────────

  /**
   * Spielt einen nicht-raeumlichen One-Shot-Sound (z.B. UI-Feedback, lokale Actions).
   */
  playLocalSound(soundKey: AudioKey | undefined, volumeScale = 1): void {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const finalVolume = SOUND_MASTER_VOLUME * SOUND_SFX_VOLUME * volumeScale;
    if (finalVolume <= 0.001) return;

    this.scene.sound.play(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: 0,
    });
  }

  // ── Loop-Sounds ───────────────────────────────────────────────────────────

  /**
   * Startet einen Loop-Sound und gibt ein Handle zurueck.
   * Optional raeumlich positioniert (volume/pan via Emitter-Position).
   * Caller ist verantwortlich fuer stopLoop() wenn der Sound nicht mehr benoetigt wird.
   */
  startLoop(
    soundKey: AudioKey | undefined,
    emitterX?: number,
    emitterY?: number,
    emitterId?: string,
    volumeScale = 1,
  ): string | null {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return null;

    const isSpatial = emitterX !== undefined && emitterY !== undefined;
    let volume: number;
    let pan: number;

    if (isSpatial) {
      const isLocal = emitterId !== undefined && emitterId === this.getLocalPlayerId();
      const spatial = isLocal ? { volume: 1, pan: 0 } : this.resolveSpatialPlayback(emitterX, emitterY);
      volume = spatial.volume;
      pan = spatial.pan;
    } else {
      volume = 1;
      pan = 0;
    }

    const finalVolume = SOUND_MASTER_VOLUME * SOUND_SFX_VOLUME * volumeScale * volume;
    if (finalVolume <= 0.001) return null;

    const handle = `loop_${++this.loopCounter}`;
    const sound = this.scene.sound.add(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: Phaser.Math.Clamp(pan, -1, 1),
      loop: true,
    });
    sound.play();
    this.activeLoops.set(handle, sound);
    return handle;
  }

  /**
   * Stoppt einen zuvor gestarteten Loop-Sound.
   */
  stopLoop(handle: string | null): void {
    if (!handle) return;
    const sound = this.activeLoops.get(handle);
    if (!sound) return;
    sound.stop();
    sound.destroy();
    this.activeLoops.delete(handle);
  }

  /**
   * Aktualisiert Lautstaerke und Panning eines raeumlichen Loop-Sounds
   * basierend auf der aktuellen Emitter-Position.
   */
  updateLoopPosition(handle: string | null, emitterX: number, emitterY: number, emitterId?: string): void {
    if (!handle) return;
    const sound = this.activeLoops.get(handle);
    if (!sound || !('volume' in sound)) return;

    const isLocal = emitterId !== undefined && emitterId === this.getLocalPlayerId();
    const { volume, pan } = isLocal
      ? { volume: 1, pan: 0 }
      : this.resolveSpatialPlayback(emitterX, emitterY);
    const finalVolume = SOUND_MASTER_VOLUME * SOUND_SFX_VOLUME * volume;

    // Phaser WebAudioSound / HTML5AudioSound both support these properties
    (sound as Phaser.Sound.WebAudioSound).setVolume(Phaser.Math.Clamp(finalVolume, 0, 1));
    (sound as Phaser.Sound.WebAudioSound).setPan(Phaser.Math.Clamp(pan, -1, 1));
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  /**
   * Startet einen Musik-Loop. Stoppt automatisch vorherige Musik.
   * Idempotent: wenn derselbe Key bereits laeuft, passiert nichts.
   */
  playMusic(soundKey: AudioKey | undefined): void {
    if (!SOUND_ENABLED || !soundKey) return;
    if (this.currentMusicKey === soundKey && this.currentMusic?.isPlaying) return;

    this.stopMusic();

    if (!this.scene.cache.audio.exists(soundKey)) return;

    const finalVolume = SOUND_MASTER_VOLUME * SOUND_MUSIC_VOLUME;
    if (finalVolume <= 0.001) return;

    this.currentMusicKey = soundKey;
    this.currentMusic = this.scene.sound.add(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      loop: true,
    });
    this.currentMusic.play();
  }

  /**
   * Stoppt die aktuelle Musik.
   */
  stopMusic(): void {
    if (this.currentMusic) {
      this.currentMusic.stop();
      this.currentMusic.destroy();
      this.currentMusic = null;
      this.currentMusicKey = null;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Stoppt alle aktiven Loops und Musik. Muss bei Scene-Teardown aufgerufen werden.
   */
  cleanup(): void {
    for (const [handle] of this.activeLoops) {
      this.stopLoop(handle);
    }
    this.activeLoops.clear();
    this.stopMusic();
  }

  // ── Backward-compatible API ───────────────────────────────────────────────

  /** @deprecated Use playSound() instead */
  playShot(soundKey: AudioKey | undefined, emitterX: number, emitterY: number, shooterId?: string, volumeScale = 1): void {
    this.playSound(soundKey, emitterX, emitterY, shooterId, volumeScale);
  }

  /** @deprecated Use playLocalSound() instead */
  playFailure(soundKey: AudioKey | undefined, volumeScale = 1): void {
    this.playLocalSound(soundKey, volumeScale);
  }

  // ── Spatial Audio ─────────────────────────────────────────────────────────

  private resolveSpatialPlayback(emitterX: number, emitterY: number): { volume: number; pan: number } {
    const listener = this.getListenerPosition();
    if (!listener) {
      return { volume: 1, pan: 0 };
    }

    const distance = Phaser.Math.Distance.Between(listener.x, listener.y, emitterX, emitterY);
    const normalizedDistance = Phaser.Math.Clamp(distance / Math.max(1, SHOT_AUDIO_REMOTE_MAX_DISTANCE), 0, 1);
    const falloffT = Math.pow(normalizedDistance, SHOT_AUDIO_REMOTE_DISTANCE_EXPONENT);
    const volume = Phaser.Math.Linear(SHOT_AUDIO_REMOTE_CLOSE_VOLUME, SHOT_AUDIO_REMOTE_FAR_VOLUME, falloffT);
    const pan = Phaser.Math.Clamp((emitterX - listener.x) / Math.max(1, SHOT_AUDIO_PAN_RANGE), -1, 1);
    return { volume, pan };
  }
}
