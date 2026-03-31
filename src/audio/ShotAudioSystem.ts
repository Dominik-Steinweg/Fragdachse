import Phaser from 'phaser';
import { SHOT_AUDIO_PAN_RANGE, SHOT_AUDIO_REMOTE_MAX_DISTANCE, SOUND_ENABLED } from '../config';
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

  playShot(soundKey: ShotAudioKey | undefined, emitterX: number, emitterY: number, shooterId?: string): void {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    const isLocalShot = shooterId !== undefined && shooterId === this.getLocalPlayerId();
    const { volume, pan } = isLocalShot
      ? { volume: 1, pan: 0 }
      : this.resolveSpatialPlayback(emitterX, emitterY);

    if (volume <= 0.001) return;

    this.scene.sound.play(soundKey, {
      volume: Phaser.Math.Clamp(volume, 0, 1),
      pan: Phaser.Math.Clamp(pan, -1, 1),
    });
  }

  playFailure(soundKey: ShotAudioKey | undefined): void {
    if (!SOUND_ENABLED || !soundKey || !this.scene.cache.audio.exists(soundKey)) return;

    this.scene.sound.play(soundKey, {
      volume: 1,
      pan: 0,
    });
  }

  private resolveSpatialPlayback(emitterX: number, emitterY: number): { volume: number; pan: number } {
    const listener = this.getListenerPosition();
    if (!listener) {
      return { volume: 1, pan: 0 };
    }

    const distance = Phaser.Math.Distance.Between(listener.x, listener.y, emitterX, emitterY);
    const volume = Phaser.Math.Clamp(1 - (distance / Math.max(1, SHOT_AUDIO_REMOTE_MAX_DISTANCE)), 0, 1);
    const pan = Phaser.Math.Clamp((emitterX - listener.x) / Math.max(1, SHOT_AUDIO_PAN_RANGE), -1, 1);
    return { volume, pan };
  }
}
