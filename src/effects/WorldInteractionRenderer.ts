import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import type { WorldInteractionCandidate } from '../systems/WorldInteractionCandidate';
import { registerGraphicsObject } from './EffectUtils';
import { LobbyWorldPlaque } from '../ui/LobbyWorldPlaque';

/** One shared world-space selection marker. Input consumes the exact candidate shown here. */
export class WorldInteractionRenderer {
  private marker: Phaser.GameObjects.Graphics | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private lobbyPlaque: LobbyWorldPlaque | null = null;
  private readonly outlines = [
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new Phaser.Math.Vector2(x * (CELL_SIZE / 2 - 3), y * (CELL_SIZE / 2 - 3))),
    Array.from({ length: 16 }, (_, index) => new Phaser.Math.Vector2(Math.cos(index * Math.PI / 8) * 30, Math.sin(index * Math.PI / 8) * 30)),
  ];
  constructor(private readonly scene: Phaser.Scene) {}
  sync(candidate: WorldInteractionCandidate | null, player?: { x: number; y: number } | null): void {
    this.lobbyPlaque?.setAlpha(0);
    if (candidate?.kind === 'lobby-menu') {
      this.marker?.setVisible(false); this.label?.setVisible(false);
      this.lobbyPlaque ??= new LobbyWorldPlaque(this.scene, true);
      this.lobbyPlaque.setText(candidate.label.replace(/^\[Shift\]\s*/, ''))
        .setPosition(player?.x ?? candidate.x, (player?.y ?? candidate.y) + 30).setAlpha(1);
      return;
    }
    if (!candidate) { this.marker?.setVisible(false); this.label?.setVisible(false); return; }
    if (!this.marker) {
      this.marker = this.scene.add.graphics().setDepth(DEPTH.LOCAL_UI);
      registerGraphicsObject(this.scene, 'weaponTelegraphs', this.marker);
      this.label = this.scene.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: '16px', color: '#ffffff',
        backgroundColor: '#13262c', padding: { x: 7, y: 4 } }).setOrigin(0.5, 0).setDepth(DEPTH.LOCAL_UI + 1);
    }
    const radius = candidate.kind === 'turret' ? 30 : CELL_SIZE / 2;
    const outline = this.outlines[candidate.kind === 'turret' ? 1 : 0];
    this.marker.clear().setPosition(candidate.x, candidate.y).setVisible(true)
      .lineStyle(6, 0x102128, 0.9).strokePoints(outline, true, true)
      .lineStyle(3, 0x86f6ff).strokePoints(outline, true, true);
    this.label!.setText(candidate.label).setPosition(candidate.x, candidate.y + radius + 8).setVisible(true);
  }
  clear(): void {
    this.marker?.destroy(); this.label?.destroy(); this.lobbyPlaque?.destroy();
    this.marker = null; this.label = null; this.lobbyPlaque = null;
  }
}
