import type * as Phaser from 'phaser';

export interface UiAudioPort {
  playLocalSound(key: 'sfx_menu_hover' | 'sfx_menu_activate'): void;
}

const ports = new WeakMap<Phaser.Scene, UiAudioPort>();

/** The scene owns the audio lifetime; controls never import the game runtime. */
export function bindUiAudio(scene: Phaser.Scene, port: UiAudioPort): () => void {
  ports.set(scene, port);
  return () => { if (ports.get(scene) === port) ports.delete(scene); };
}

export function playUiHover(scene: Phaser.Scene): void {
  ports.get(scene)?.playLocalSound('sfx_menu_hover');
}

export function playUiActivation(scene: Phaser.Scene): void {
  ports.get(scene)?.playLocalSound('sfx_menu_activate');
}

/** A rejected action can return false. Semantic purchase/reward sounds bypass this helper. */
export function activateUi<T>(scene: Phaser.Scene, action: () => T): T {
  const result = action();
  if (result !== false) playUiActivation(scene);
  return result;
}
