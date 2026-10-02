import type * as Phaser from 'phaser';

/** Temporary render resources owned by one Scene's loading warmup, never a global ready flag. */
export interface ShaderWarmupProbe {
  readonly name: string;
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean;
  destroy(): void;
}
