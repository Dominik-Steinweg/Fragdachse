import Phaser from 'phaser';
import {
  SHOT_AUDIO_PAN_RANGE,
  SHOT_AUDIO_REMOTE_CLOSE_VOLUME,
  SHOT_AUDIO_REMOTE_DISTANCE_EXPONENT,
  SHOT_AUDIO_REMOTE_FAR_VOLUME,
  SHOT_AUDIO_REMOTE_MAX_DISTANCE,
  SOUND_ENABLED,
  SOUND_MASTER_VOLUME,
} from '../config';
import type { ShotAudioKey } from '../types';

interface ListenerPosition {
  x: number;
  y: number;
}

export class ShotAudioSystem {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalPlayerId: () => string,
    private readonly getListenerPosition: () => ListenerPosition | null,
  ) {}

  playShot(soundKey: ShotAudioKey | undefined, emitterX: number, emitterY: number, shooterId?: string, volumeScale = 1): void {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const isLocalShot = shooterId !== undefined && shooterId === this.getLocalPlayerId();
    const { volume, pan } = isLocalShot
      ? { volume: 1, pan: 0 }
      : this.resolveSpatialPlayback(emitterX, emitterY);
    const finalVolume = SOUND_MASTER_VOLUME * volumeScale * volume;

    if (finalVolume <= 0.001) return;

    this.scene.sound.play(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: Phaser.Math.Clamp(pan, -1, 1),
    });
  }

  playFailure(soundKey: ShotAudioKey | undefined, volumeScale = 1): void {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const finalVolume = SOUND_MASTER_VOLUME * volumeScale;
    if (finalVolume <= 0.001) return;

    this.scene.sound.play(soundKey, {
      volume: Phaser.Math.Clamp(finalVolume, 0, 1),
      pan: 0,
    });
  }

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
