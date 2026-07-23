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
import {
  getMusicAssetPath,
  getSoundVolume,
  isMusicAudioKey,
  LAZY_MUSIC_ASSET_KEY,
  type MusicAssetKey,
} from './AudioCatalog';
import { getHitFeedbackVolumeScale } from './HitFeedbackAudio';

const HIT_FEEDBACK_MERGE_WINDOW_MS = 30;

interface ListenerPosition {
  x: number;
  y: number;
}

interface ActiveLoop {
  sound: Phaser.Sound.BaseSound;
  soundKey: string;
  volumeScale: number;
  spatialVolume: number;
  pan: number;
}

export type MusicLoadStatus = 'loading' | 'complete' | 'error';

export interface MusicLoadState {
  readonly key: MusicAssetKey;
  readonly progress: number;
  readonly status: MusicLoadStatus;
}

type MusicLoadStateListener = (state: MusicLoadState | null) => void;

/**
 * Zentrales Audio-System fuer alle Spielsounds: One-Shot SFX (spatial + lokal),
 * Loop-Sounds und Musik. Ersetzt das bisherige ShotAudioSystem.
 *
 * Volume-Kanaele:
 * - SFX:   masterVolume × effectsVolume × perSoundVolume × volumeScale × spatial
 * - Music: masterVolume × musicVolume × perSoundVolume
 *
 * `perSoundVolume` stammt aus AudioCatalog.SOUND_VOLUMES und erlaubt eine
 * Feinjustierung einzelner Sounds ohne erneutes Abmischen der Audiodateien.
 */
export class GameAudioSystem {
  private loopCounter = 0;
  private readonly activeLoops = new Map<string, ActiveLoop>();
  private currentMusic: Phaser.Sound.BaseSound | null = null;
  private currentMusicKey: MusicAssetKey | null = null;
  private requestedMusicKey: MusicAssetKey | null = null;
  private musicLoadState: MusicLoadState | null = null;
  private readonly musicLoadStateListeners = new Set<MusicLoadStateListener>();
  private removeMusicLoaderListeners: (() => void) | null = null;
  private pendingHitFeedbackDamage = 0;
  private hitFeedbackTimer: Phaser.Time.TimerEvent | null = null;
  private pendingDamageFeedbackDamage = 0;
  private pendingDamageFeedbackX = 0;
  private pendingDamageFeedbackY = 0;
  private damageFeedbackTimer: Phaser.Time.TimerEvent | null = null;
  private masterVolume: number;
  private effectsVolume: number;
  private musicVolume: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalPlayerId: () => string,
    private readonly getListenerPosition: () => ListenerPosition | null,
    initialMasterVolume = SOUND_MASTER_VOLUME,
    initialEffectsVolume = SOUND_SFX_VOLUME,
    initialMusicVolume = SOUND_MUSIC_VOLUME,
  ) {
    this.masterVolume = Phaser.Math.Clamp(initialMasterVolume, 0, 1);
    this.effectsVolume = Phaser.Math.Clamp(initialEffectsVolume, 0, 1);
    this.musicVolume = Phaser.Math.Clamp(initialMusicVolume, 0, 1);
    // Prevent deferred playback bursts after tab blur / refocus.
    this.scene.sound.pauseOnBlur = false;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Phaser.Math.Clamp(volume, 0, 1);
    this.refreshActiveLoopVolumes();
    this.refreshMusicVolume();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setEffectsVolume(volume: number): void {
    this.effectsVolume = Phaser.Math.Clamp(volume, 0, 1);
    this.refreshActiveLoopVolumes();
  }

  getEffectsVolume(): number {
    return this.effectsVolume;
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Phaser.Math.Clamp(volume, 0, 1);
    this.refreshMusicVolume();
    if (this.musicVolume > 0.001) {
      this.loadLobbyMusic();
      this.startRequestedMusic();
    }
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  subscribeMusicLoadState(listener: MusicLoadStateListener): () => void {
    this.musicLoadStateListeners.add(listener);
    listener(this.musicLoadState ? { ...this.musicLoadState } : null);
    return () => this.musicLoadStateListeners.delete(listener);
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
    if (isMusicAudioKey(soundKey)) return;
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const isLocal = emitterId !== undefined && emitterId === this.getLocalPlayerId();
    const { volume, pan } = isLocal
      ? { volume: 1, pan: 0 }
      : this.resolveSpatialPlayback(emitterX, emitterY);
    const finalVolume = this.getEffectsPlaybackVolume(soundKey, volumeScale, volume);

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
    if (isMusicAudioKey(soundKey)) return;
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const finalVolume = this.getEffectsPlaybackVolume(soundKey, volumeScale);
    if (finalVolume <= 0.001) return;

    this.scene.sound.play(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: 0,
    });
  }

  queueHitFeedback(totalDamage: number): void {
    if (totalDamage <= 0) return;

    this.pendingHitFeedbackDamage += totalDamage;
    if (this.hitFeedbackTimer) return;

    this.hitFeedbackTimer = this.scene.time.delayedCall(HIT_FEEDBACK_MERGE_WINDOW_MS, () => {
      const damage = this.pendingHitFeedbackDamage;
      this.pendingHitFeedbackDamage = 0;
      this.hitFeedbackTimer = null;
      this.playLocalSound('sfx_hit_feedback', getHitFeedbackVolumeScale(damage));
    });
  }

  queueDamageFeedback(totalDamage: number, emitterX: number, emitterY: number): void {
    if (totalDamage <= 0) return;

    const previousDamage = this.pendingDamageFeedbackDamage;
    const combinedDamage = previousDamage + totalDamage;
    this.pendingDamageFeedbackX = previousDamage <= 0
      ? emitterX
      : (this.pendingDamageFeedbackX * previousDamage + emitterX * totalDamage) / combinedDamage;
    this.pendingDamageFeedbackY = previousDamage <= 0
      ? emitterY
      : (this.pendingDamageFeedbackY * previousDamage + emitterY * totalDamage) / combinedDamage;
    this.pendingDamageFeedbackDamage = combinedDamage;
    if (this.damageFeedbackTimer) return;

    this.damageFeedbackTimer = this.scene.time.delayedCall(HIT_FEEDBACK_MERGE_WINDOW_MS, () => {
      const damage = this.pendingDamageFeedbackDamage;
      const emitterX = this.pendingDamageFeedbackX;
      const emitterY = this.pendingDamageFeedbackY;
      this.pendingDamageFeedbackDamage = 0;
      this.pendingDamageFeedbackX = 0;
      this.pendingDamageFeedbackY = 0;
      this.damageFeedbackTimer = null;
      this.playSound('sfx_player_hit', emitterX, emitterY, undefined, getHitFeedbackVolumeScale(damage));
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
    if (isMusicAudioKey(soundKey)) return null;
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

    const finalVolume = this.getEffectsPlaybackVolume(soundKey, volumeScale, volume);
    if (finalVolume <= 0.001) return null;

    const handle = `loop_${++this.loopCounter}`;
    const sound = this.scene.sound.add(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: Phaser.Math.Clamp(pan, -1, 1),
      loop: true,
    });
    sound.play();
    this.activeLoops.set(handle, { sound, soundKey, volumeScale, spatialVolume: volume, pan });
    return handle;
  }

  /**
   * Stoppt einen zuvor gestarteten Loop-Sound.
   */
  stopLoop(handle: string | null): void {
    if (!handle) return;
    const entry = this.activeLoops.get(handle);
    if (!entry) return;
    entry.sound.stop();
    entry.sound.destroy();
    this.activeLoops.delete(handle);
  }

  /**
   * Aktualisiert Lautstaerke und Panning eines raeumlichen Loop-Sounds
   * basierend auf der aktuellen Emitter-Position.
   */
  updateLoopPosition(handle: string | null, emitterX: number, emitterY: number, emitterId?: string): void {
    if (!handle) return;
    const entry = this.activeLoops.get(handle);
    if (!entry || !('volume' in entry.sound)) return;

    const isLocal = emitterId !== undefined && emitterId === this.getLocalPlayerId();
    const { volume, pan } = isLocal
      ? { volume: 1, pan: 0 }
      : this.resolveSpatialPlayback(emitterX, emitterY);
    const finalVolume = this.getEffectsPlaybackVolume(entry.soundKey, entry.volumeScale, volume);
    entry.spatialVolume = volume;
    entry.pan = pan;

    // Phaser WebAudioSound / HTML5AudioSound both support these properties
    (entry.sound as Phaser.Sound.WebAudioSound).setVolume(Phaser.Math.Clamp(finalVolume, 0, 1));
    (entry.sound as Phaser.Sound.WebAudioSound).setPan(Phaser.Math.Clamp(pan, -1, 1));
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  /**
   * Startet einen Musik-Loop. Stoppt automatisch vorherige Musik.
   * Idempotent: wenn derselbe Key bereits laeuft, passiert nichts.
   */
  playMusic(soundKey: AudioKey | undefined): void {
    if (!isMusicAudioKey(soundKey)) return;
    if (!SOUND_ENABLED || !soundKey) return;
    this.requestedMusicKey = soundKey;
    if (this.currentMusicKey !== soundKey) this.stopCurrentMusic();
    this.startRequestedMusic();
  }

  /**
   * Stoppt die aktuelle Musik.
   */
  stopMusic(): void {
    this.requestedMusicKey = null;
    this.stopCurrentMusic();
  }

  private stopCurrentMusic(): void {
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
    this.hitFeedbackTimer?.remove();
    this.hitFeedbackTimer = null;
    this.pendingHitFeedbackDamage = 0;
    this.damageFeedbackTimer?.remove();
    this.damageFeedbackTimer = null;
    this.pendingDamageFeedbackDamage = 0;
    this.pendingDamageFeedbackX = 0;
    this.pendingDamageFeedbackY = 0;
    for (const [handle] of this.activeLoops) {
      this.stopLoop(handle);
    }
    this.activeLoops.clear();
    this.stopMusic();
    this.removeMusicLoaderListeners?.();
    this.removeMusicLoaderListeners = null;
    this.publishMusicLoadState(null);
    this.musicLoadStateListeners.clear();
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

  private refreshActiveLoopVolumes(): void {
    for (const entry of this.activeLoops.values()) {
      const finalVolume = this.getEffectsPlaybackVolume(entry.soundKey, entry.volumeScale, entry.spatialVolume);
      (entry.sound as Phaser.Sound.WebAudioSound).setVolume(Phaser.Math.Clamp(finalVolume, 0, 1));
      (entry.sound as Phaser.Sound.WebAudioSound).setPan(Phaser.Math.Clamp(entry.pan, -1, 1));
    }
  }

  private refreshMusicVolume(): void {
    if (!this.currentMusicKey || !this.currentMusic) return;
    const finalVolume = this.getMusicPlaybackVolume(this.currentMusicKey);
    (this.currentMusic as Phaser.Sound.WebAudioSound).setVolume(Phaser.Math.Clamp(finalVolume, 0, 1));
  }

  private getEffectsPlaybackVolume(soundKey: AudioKey, volumeScale = 1, spatialVolume = 1): number {
    const perSoundVolume = getSoundVolume(soundKey);
    return this.masterVolume * this.effectsVolume * perSoundVolume * volumeScale * spatialVolume;
  }

  private getMusicPlaybackVolume(soundKey: AudioKey): number {
    const perSoundVolume = getSoundVolume(soundKey);
    return this.masterVolume * this.musicVolume * perSoundVolume;
  }

  private startRequestedMusic(): void {
    const soundKey = this.requestedMusicKey;
    if (!soundKey || this.musicVolume <= 0.001) return;
    if (this.currentMusicKey === soundKey && this.currentMusic?.isPlaying) {
      this.refreshMusicVolume();
      return;
    }
    if (!this.scene.cache.audio.exists(soundKey)) {
      if (soundKey === LAZY_MUSIC_ASSET_KEY) this.loadLobbyMusic();
      return;
    }

    this.stopCurrentMusic();
    this.currentMusicKey = soundKey;
    this.currentMusic = this.scene.sound.add(soundKey, {
      volume: Phaser.Math.Clamp(this.getMusicPlaybackVolume(soundKey), 0, 1),
      loop: true,
    });
    this.currentMusic.play();
  }

  private loadLobbyMusic(): void {
    const soundKey = LAZY_MUSIC_ASSET_KEY;
    if (this.scene.cache.audio.exists(soundKey)) {
      this.startRequestedMusic();
      return;
    }
    if (this.musicLoadState?.status === 'loading') return;

    const loader = this.scene.load;
    const onProgress = (file: Phaser.Loader.File, progress: number) => {
      if (file.key !== soundKey) return;
      this.publishMusicLoadState({
        key: soundKey,
        progress: Phaser.Math.Clamp(progress, 0, 1),
        status: 'loading',
      });
    };
    const onComplete = (key: string, type: string) => {
      if (key !== soundKey || type !== 'audio') return;
      this.removeMusicLoaderListeners?.();
      this.removeMusicLoaderListeners = null;
      this.publishTransientMusicLoadState({ key: soundKey, progress: 1, status: 'complete' });
      this.startRequestedMusic();
    };
    const onError = (file: Phaser.Loader.File) => {
      if (file.key !== soundKey) return;
      this.removeMusicLoaderListeners?.();
      this.removeMusicLoaderListeners = null;
      this.publishTransientMusicLoadState({ key: soundKey, progress: 0, status: 'error' });
    };

    loader.on(Phaser.Loader.Events.FILE_PROGRESS, onProgress);
    loader.on(Phaser.Loader.Events.FILE_COMPLETE, onComplete);
    loader.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    this.removeMusicLoaderListeners = () => {
      loader.off(Phaser.Loader.Events.FILE_PROGRESS, onProgress);
      loader.off(Phaser.Loader.Events.FILE_COMPLETE, onComplete);
      loader.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    };

    this.publishMusicLoadState({ key: soundKey, progress: 0, status: 'loading' });
    loader.audio(soundKey, getMusicAssetPath(soundKey));
    if (!loader.isLoading()) loader.start();
  }

  private publishTransientMusicLoadState(state: MusicLoadState): void {
    this.publishMusicLoadState(state);
    this.musicLoadState = null;
  }

  private publishMusicLoadState(state: MusicLoadState | null): void {
    this.musicLoadState = state;
    const snapshot = state ? { ...state } : null;
    for (const listener of this.musicLoadStateListeners) listener(snapshot);
  }
}
