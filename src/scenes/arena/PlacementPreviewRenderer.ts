import type Phaser from 'phaser';
import { bridge }                from '../../network/bridge';
import { ULTIMATE_CONFIGS, UTILITY_CONFIGS }       from '../../loadout/LoadoutConfig';
import type { PlaceableRockUtilityConfig, PlaceableTurretUtilityConfig, PlaceableUtilityConfig, TunnelUltimateConfig } from '../../loadout/LoadoutConfig';
import { GAME_WIDTH, ARENA_OFFSET_Y, CELL_SIZE, COLORS, DEPTH, PLAYER_COLORS } from '../../config';
import type { ArenaContext }             from './ArenaContext';
import type { PlacementPreviewNetState, UtilityPlacementPreviewState } from '../../types';
import { TUNNEL_HOLE_DIAMETER, TUNNEL_VISUAL_DEPTH, TunnelEndpointVisual } from './TunnelEndpointVisual';
import { getCoopDefenseConstructionDefinition } from '../../config/coopDefenseConstructions';
import { getTurretVisualSpec } from '../../config/turretVisuals';

interface TunnelPreviewVisualState {
  keyBase: string;
  line: Phaser.GameObjects.Graphics;
  anchor: TunnelEndpointVisual | null;
  target: TunnelEndpointVisual | null;
}

/**
 * Manages all placement-preview GameObjects and hint containers.
 *
 * Handles the local player's placement ghost (rock / turret) and the
 * semi-transparent previews of other players' pending placements.
 * Also manages the utility-targeting hint and placeable-utility hint overlays.
 */
export class PlacementPreviewRenderer {
  private localPlacementPreviewImage: Phaser.GameObjects.Image | null = null;
  private localTurretPreviewImage: Phaser.GameObjects.Image | null = null;
  private readonly remotePlacementPreviewImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly remoteTurretPreviewImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly localTunnelPreview: TunnelPreviewVisualState;
  private readonly remoteTunnelPreviews = new Map<string, TunnelPreviewVisualState>();

  private readonly rangeGraphics:   Phaser.GameObjects.Graphics;
  private readonly invalidGraphics: Phaser.GameObjects.Graphics;
  private readonly errorText:       Phaser.GameObjects.Text;
  private readonly utilityTargetingHint:   Phaser.GameObjects.Container;
  private readonly placeableUtilityHint:   Phaser.GameObjects.Container;
  private readonly airstrikeTargetingHint: Phaser.GameObjects.Container;
  private placeableUtilityHintTitle!: Phaser.GameObjects.Text;
  private placeableUtilityHintSubtitle!: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
  ) {
    this.rangeGraphics   = scene.add.graphics().setDepth(DEPTH.OVERLAY - 2);
    this.invalidGraphics = scene.add.graphics().setDepth(DEPTH.OVERLAY - 1);
    this.localTunnelPreview = this.createTunnelPreviewState('local');

    this.errorText = scene.add.text(
      GAME_WIDTH * 0.5,
      ARENA_OFFSET_Y + 96,
      '',
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#ffd38c',
        stroke: '#241527',
        strokeThickness: 5,
      },
    ).setOrigin(0.5).setDepth(DEPTH.OVERLAY).setScrollFactor(0).setVisible(false);

    this.utilityTargetingHint   = this.createUtilityTargetingHint();
    this.placeableUtilityHint   = this.createPlaceableUtilityHint();
    this.airstrikeTargetingHint = this.createAirstrikeTargetingHint();
  }

  renderPlacementPreview(inArena: boolean, preview: UtilityPlacementPreviewState | undefined, localPlayerAlive: boolean, localPlayerBurrowed: boolean): void {
    this.rangeGraphics.clear();
    this.invalidGraphics.clear();
    this.localTunnelPreview.line.clear();

    if (!inArena || !preview || !localPlayerAlive || localPlayerBurrowed) {
      this.localPlacementPreviewImage?.setVisible(false);
      this.localTurretPreviewImage?.setVisible(false);
      this.hideTunnelPreview(this.localTunnelPreview);
      return;
    }

    const localPlayer = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
    if (!localPlayer) {
      this.localPlacementPreviewImage?.setVisible(false);
      this.localTurretPreviewImage?.setVisible(false);
      this.hideTunnelPreview(this.localTunnelPreview);
      return;
    }

    const ownerColor = bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0];
    if (preview.mode === 'dismantle') {
      // Rueckbau zeigt kein Bau-Ghost, sondern markiert das anvisierte eigene Konstrukt.
      this.localPlacementPreviewImage?.setVisible(false);
      this.localTurretPreviewImage?.setVisible(false);
      this.hideTunnelPreview(this.localTunnelPreview);
      this.drawDismantleMarker(preview);
      this.rangeGraphics.lineStyle(2, ownerColor, 0.5);
      this.rangeGraphics.strokeCircle(localPlayer.sprite.x, localPlayer.sprite.y, preview.range);
      return;
    }
    if (preview.kind === 'tunnel') {
      this.localPlacementPreviewImage?.setVisible(false);
      this.localTurretPreviewImage?.setVisible(false);
      this.drawTunnelPreview(this.localTunnelPreview, preview, ownerColor, this.getPlacementPreviewAlpha(preview.kind), true);
    } else {
      this.hideTunnelPreview(this.localTunnelPreview);
      const image = this.ensurePlacementPreviewImage(undefined, preview.kind, preview.constructionId, preview.powerUpDefId);
      image
        .setPosition(preview.targetX, preview.targetY)
        .setTint(ownerColor)
        .setAlpha(preview.isValid ? this.getPlacementPreviewAlpha(preview.kind) : 0.25)
        .setVisible(true);
      if (preview.kind === 'rock') {
        image.setFrame(preview.frame);
      }
      if (preview.kind === 'turret') {
        image.setFrame(preview.frame);
        this.ensureTurretPreviewImage(undefined, preview.constructionId)
          .setPosition(preview.targetX, preview.targetY)
          .setRotation(preview.angle + this.getTurretPreviewSpec(preview.constructionId).rotationOffset)
          .setAlpha(preview.isValid ? this.getPlacementPreviewAlpha(preview.kind) : 0.25)
          .setVisible(true);
      } else {
        this.localTurretPreviewImage?.setVisible(false);
      }
    }

    this.rangeGraphics.lineStyle(2, ownerColor, 0.5);
    this.rangeGraphics.strokeCircle(localPlayer.sprite.x, localPlayer.sprite.y, preview.range);

    if (!preview.isValid) {
      const radius = CELL_SIZE * 0.36;
      this.invalidGraphics.lineStyle(4, COLORS.RED_2, 0.95);
      this.invalidGraphics.strokeCircle(preview.targetX, preview.targetY, radius);
      this.invalidGraphics.beginPath();
      this.invalidGraphics.moveTo(preview.targetX - radius * 0.7, preview.targetY - radius * 0.7);
      this.invalidGraphics.lineTo(preview.targetX + radius * 0.7, preview.targetY + radius * 0.7);
      this.invalidGraphics.strokePath();
    }
  }

  /** Eckenrahmen um die anvisierte Zelle: gruen = eigenes Konstrukt, rot = nichts abbaubar. */
  private drawDismantleMarker(preview: UtilityPlacementPreviewState): void {
    const half = CELL_SIZE * 0.46;
    const arm = CELL_SIZE * 0.22;
    const color = preview.isValid ? COLORS.GREEN_2 : COLORS.RED_2;
    const pulse = 0.72 + 0.28 * Math.sin(this.scene.time.now / 140);
    this.invalidGraphics.lineStyle(3, color, pulse);
    for (const signX of [-1, 1]) {
      for (const signY of [-1, 1]) {
        const cornerX = preview.targetX + signX * half;
        const cornerY = preview.targetY + signY * half;
        this.invalidGraphics.beginPath();
        this.invalidGraphics.moveTo(cornerX - signX * arm, cornerY);
        this.invalidGraphics.lineTo(cornerX, cornerY);
        this.invalidGraphics.lineTo(cornerX, cornerY - signY * arm);
        this.invalidGraphics.strokePath();
      }
    }
  }

  renderRemotePlacementPreviews(inArena: boolean): void {
    if (!inArena) {
      for (const preview of this.remotePlacementPreviewImages.values()) {
        preview.setVisible(false);
      }
      for (const preview of this.remoteTurretPreviewImages.values()) {
        preview.setVisible(false);
      }
      for (const preview of this.remoteTunnelPreviews.values()) {
        this.hideTunnelPreview(preview);
      }
      return;
    }

    const activeIds = new Set<string>();
    for (const playerId of bridge.getConnectedPlayerIds()) {
      if (playerId === bridge.getLocalPlayerId()) continue;
      const preview = bridge.getPlayerInput(playerId)?.placementPreview as PlacementPreviewNetState | undefined;
      if (!preview?.active) continue;
      activeIds.add(playerId);
      const ownerColor = bridge.getPlayerColor(playerId) ?? COLORS.GREY_3;
      if (preview.kind === 'tunnel') {
        this.remotePlacementPreviewImages.get(playerId)?.setVisible(false);
        this.remoteTurretPreviewImages.get(playerId)?.setVisible(false);
        const tunnelPreview = this.ensureRemoteTunnelPreview(playerId);
        this.drawTunnelPreview(tunnelPreview, {
          angle: 0,
          targetX: preview.x,
          targetY: preview.y,
          gridX: preview.gridX,
          gridY: preview.gridY,
          isValid: preview.isValid,
          frame: preview.frame,
          range: 0,
          kind: 'tunnel',
          stage: preview.stage,
          anchorX: preview.anchorX,
          anchorY: preview.anchorY,
          anchorGridX: preview.anchorGridX,
          anchorGridY: preview.anchorGridY,
        }, ownerColor, 0.38, false);
      } else {
        const image = this.ensurePlacementPreviewImage(
          playerId,
          preview.kind,
          preview.constructionId,
          preview.powerUpDefId,
        );
        image
          .setPosition(preview.x, preview.y)
          .setTint(ownerColor)
          .setAlpha(preview.isValid ? 0.38 : 0.18)
          .setVisible(true);
        if (preview.kind === 'rock' || preview.kind === 'turret') {
          image.setFrame(preview.frame);
        }
        if (preview.kind === 'turret') {
          const spec = this.getTurretPreviewSpec(preview.constructionId);
          this.ensureTurretPreviewImage(playerId, preview.constructionId)
            .setPosition(preview.x, preview.y)
            .setRotation(spec.rotationOffset)
            .setAlpha(preview.isValid ? 0.38 : 0.18)
            .setVisible(true);
        } else {
          this.remoteTurretPreviewImages.get(playerId)?.setVisible(false);
        }
        const tunnelPreview = this.remoteTunnelPreviews.get(playerId);
        if (tunnelPreview) {
          this.hideTunnelPreview(tunnelPreview);
        }
      }
    }

    for (const [playerId, image] of this.remotePlacementPreviewImages) {
      if (activeIds.has(playerId)) continue;
      image.setVisible(false);
    }
    for (const [playerId, image] of this.remoteTurretPreviewImages) {
      if (activeIds.has(playerId)) continue;
      image.setVisible(false);
    }
    for (const [playerId, tunnelPreview] of this.remoteTunnelPreviews) {
      if (activeIds.has(playerId)) continue;
      this.hideTunnelPreview(tunnelPreview);
    }
  }

  syncUtilityTargetingHint(inArena: boolean, isTargeting: boolean, alive: boolean, burrowed: boolean): void {
    const visible = inArena && isTargeting && alive && !burrowed;
    this.utilityTargetingHint.setVisible(visible);
    if (!visible) return;
    this.utilityTargetingHint.alpha = 0.9 + 0.1 * Math.sin(this.scene.time.now / 160);
  }

  syncAirstrikeTargetingHint(inArena: boolean, isTargeting: boolean, alive: boolean, burrowed: boolean): void {
    const visible = inArena && isTargeting && alive && !burrowed;
    this.airstrikeTargetingHint.setVisible(visible);
    if (!visible) return;
    this.airstrikeTargetingHint.alpha = 0.9 + 0.1 * Math.sin(this.scene.time.now / 160);
  }

  syncPlaceableUtilityHint(inArena: boolean, preview: UtilityPlacementPreviewState | undefined, alive: boolean, burrowed: boolean): void {
    const visible = inArena && preview !== undefined && alive && !burrowed;
    this.placeableUtilityHint.setVisible(visible);
    if (!visible) return;
    if (preview?.mode === 'dismantle') {
      this.placeableUtilityHintTitle.setText('RÜCKBAU');
      this.placeableUtilityHintSubtitle.setText('E oder Linksklick: abbauen   Rechtsklick: abbrechen');
    } else if (preview?.kind === 'tunnel') {
      this.placeableUtilityHintTitle.setText(`DACHS-TUNNEL ${preview.stage ?? 1}/2`);
      this.placeableUtilityHintSubtitle.setText('E oder Linksklick: setzen   Rechtsklick oder Q: abbrechen');
    } else if (preview?.kind === 'pedestal') {
      this.placeableUtilityHintTitle.setText('MISSIONS-PODEST');
      this.placeableUtilityHintSubtitle.setText('E oder Linksklick: setzen   Rechtsklick: abbrechen');
    } else {
      this.placeableUtilityHintTitle.setText('BAUMODUS');
      this.placeableUtilityHintSubtitle.setText('E oder Linksklick: bauen   Rechtsklick: abbrechen');
    }
    this.placeableUtilityHint.alpha = 0.9 + 0.1 * Math.sin(this.scene.time.now / 160);
  }

  showPlacementError(message: string): void {
    this.errorText.setText(message);
    this.errorText.setAlpha(1);
    this.errorText.setVisible(true);
    this.scene.tweens.killTweensOf(this.errorText);
    this.scene.tweens.add({
      targets: this.errorText,
      alpha: 0,
      duration: 1100,
      ease: 'Quad.easeOut',
      onComplete: () => this.errorText.setVisible(false),
    });
  }

  clearForTeardown(): void {
    this.rangeGraphics.clear();
    this.invalidGraphics.clear();
    this.localPlacementPreviewImage?.setVisible(false);
    this.localTurretPreviewImage?.setVisible(false);
    this.destroyTunnelPreview(this.localTunnelPreview);
    this.placeableUtilityHint.setVisible(false);
    this.airstrikeTargetingHint.setVisible(false);
    this.errorText.setVisible(false);
    for (const preview of this.remotePlacementPreviewImages.values()) {
      preview.destroy();
    }
    this.remotePlacementPreviewImages.clear();
    for (const preview of this.remoteTurretPreviewImages.values()) {
      preview.destroy();
    }
    this.remoteTurretPreviewImages.clear();
    for (const preview of this.remoteTunnelPreviews.values()) {
      this.destroyTunnelPreview(preview);
    }
    this.remoteTunnelPreviews.clear();
  }

  private ensurePlacementPreviewImage(
    playerId: string | undefined,
    kind: PlacementPreviewNetState['kind'],
    constructionId?: PlacementPreviewNetState['constructionId'],
    powerUpDefId?: string,
  ): Phaser.GameObjects.Image {
    const texture = this.getPlaceableTextureKey(kind, constructionId, powerUpDefId);
    if (playerId === undefined) {
      if (!this.localPlacementPreviewImage) {
        this.localPlacementPreviewImage = this.scene.add.image(0, 0, texture, 0)
          .setDisplaySize(CELL_SIZE, CELL_SIZE)
          .setDepth(DEPTH.OVERLAY - 2)
          .setVisible(false);
      }
      this.localPlacementPreviewImage.setTexture(texture, 0);
      return this.localPlacementPreviewImage;
    }

    const existing = this.remotePlacementPreviewImages.get(playerId);
    if (existing) {
      existing.setTexture(texture, 0);
      return existing;
    }
    const created = this.scene.add.image(0, 0, texture, 0)
      .setDisplaySize(CELL_SIZE, CELL_SIZE)
      .setDepth(DEPTH.OVERLAY - 3)
      .setVisible(false);
    this.remotePlacementPreviewImages.set(playerId, created);
    created.setTexture(texture, 0);
    return created;
  }

  private getPlacementPreviewAlpha(kind: PlacementPreviewNetState['kind']): number {
    if (kind === 'tunnel') {
      return (ULTIMATE_CONFIGS.DACHS_TUNNEL as TunnelUltimateConfig).placement.previewAlpha;
    }
    return kind === 'turret' || kind === 'pedestal'
      ? (UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig).placeable.previewAlpha
      : (UTILITY_CONFIGS.FELSBAU as PlaceableRockUtilityConfig).placeable.previewAlpha;
  }

  private getPlaceableTextureKey(
    kind: PlacementPreviewNetState['kind'],
    constructionId?: PlacementPreviewNetState['constructionId'],
    powerUpDefId?: string,
  ): string {
    if (powerUpDefId === 'HOLY_HAND_GRENADE') return 'powerup_hhg';
    if (constructionId === 'medic_pedestal') return 'powerup_hp';
    if (constructionId === 'armor_pedestal') return 'powerup_arm';
    if (constructionId) return kind === 'turret' ? 'rocks' : `construction_${constructionId}`;
    return kind === 'turret' ? 'rocks' : kind === 'pedestal' ? 'placeable_turret' : 'rocks';
  }

  private getTurretPreviewSpec(constructionId?: PlacementPreviewNetState['constructionId']) {
    if (constructionId) {
      const definition = getCoopDefenseConstructionDefinition(constructionId);
      if (definition.kind === 'turret') return getTurretVisualSpec(definition.weaponId);
    }
    return getTurretVisualSpec('SPOREN');
  }

  private ensureTurretPreviewImage(
    playerId: string | undefined,
    constructionId?: PlacementPreviewNetState['constructionId'],
  ): Phaser.GameObjects.Image {
    const spec = this.getTurretPreviewSpec(constructionId);
    if (playerId === undefined) {
      if (!this.localTurretPreviewImage) {
        this.localTurretPreviewImage = this.scene.add.image(0, 0, spec.textureKey)
          .setDepth(DEPTH.OVERLAY - 1)
          .setVisible(false);
      }
      return this.localTurretPreviewImage
        .setTexture(spec.textureKey)
        .setDisplaySize(spec.displaySize, spec.displaySize)
        .clearTint();
    }

    let image = this.remoteTurretPreviewImages.get(playerId);
    if (!image) {
      image = this.scene.add.image(0, 0, spec.textureKey)
        .setDepth(DEPTH.OVERLAY - 2)
        .setVisible(false);
      this.remoteTurretPreviewImages.set(playerId, image);
    }
    return image
      .setTexture(spec.textureKey)
      .setDisplaySize(spec.displaySize, spec.displaySize)
      .clearTint();
  }

  private ensureRemoteTunnelPreview(playerId: string): TunnelPreviewVisualState {
    const existing = this.remoteTunnelPreviews.get(playerId);
    if (existing) {
      return existing;
    }
    const created = this.createTunnelPreviewState(`remote:${playerId}`);
    this.remoteTunnelPreviews.set(playerId, created);
    return created;
  }

  private drawTunnelPreview(
    previewVisual: TunnelPreviewVisualState,
    preview: UtilityPlacementPreviewState,
    ownerColor: number,
    alpha: number,
    isLocal: boolean,
  ): void {
    const graphics = previewVisual.line;
    graphics.clear();
    graphics.setVisible(true);
    const fillAlpha = preview.isValid ? alpha : 0.2;
    const lineAlpha = preview.isValid ? 0.65 : 0.28;
    const particleIntensity = preview.isValid ? (isLocal ? 0.75 : 0.6) : 0.35;

    const target = this.ensureTunnelEndpointVisual(previewVisual, 'target', ownerColor, `${previewVisual.keyBase}:target`);
    target.sync({
      x: preview.targetX,
      y: preview.targetY,
      ownerColor,
      alpha: fillAlpha,
      particleIntensity,
      sizePx: TUNNEL_HOLE_DIAMETER,
    }, this.scene.time.now);

    if (preview.anchorX !== undefined && preview.anchorY !== undefined) {
      const anchor = this.ensureTunnelEndpointVisual(previewVisual, 'anchor', ownerColor, `${previewVisual.keyBase}:anchor`);
      anchor.sync({
        x: preview.anchorX,
        y: preview.anchorY,
        ownerColor,
        alpha: fillAlpha * 0.9,
        particleIntensity: particleIntensity * 0.9,
        sizePx: TUNNEL_HOLE_DIAMETER,
      }, this.scene.time.now);

      graphics.lineStyle(5, 0x160d08, lineAlpha * 0.22);
      graphics.beginPath();
      graphics.moveTo(preview.anchorX, preview.anchorY);
      graphics.lineTo(preview.targetX, preview.targetY);
      graphics.strokePath();

      graphics.lineStyle(2, 0x6a4321, lineAlpha * (isLocal ? 0.62 : 0.48));
      graphics.beginPath();
      graphics.moveTo(preview.anchorX, preview.anchorY);
      graphics.lineTo(preview.targetX, preview.targetY);
      graphics.strokePath();
    } else if (previewVisual.anchor) {
      previewVisual.anchor.setVisible(false);
    }

    if (preview.anchorX === undefined || preview.anchorY === undefined) {
      previewVisual.anchor?.setVisible(false);
    }
  }

  private createTunnelPreviewState(keyBase: string): TunnelPreviewVisualState {
    return {
      keyBase,
      line: this.scene.add.graphics().setDepth(TUNNEL_VISUAL_DEPTH + 0.025).setVisible(false),
      anchor: null,
      target: null,
    };
  }

  private hideTunnelPreview(preview: TunnelPreviewVisualState): void {
    preview.line.clear();
    preview.line.setVisible(false);
    preview.anchor?.setVisible(false);
    preview.target?.setVisible(false);
  }

  private destroyTunnelPreview(preview: TunnelPreviewVisualState): void {
    preview.line.destroy();
    preview.anchor?.destroy();
    preview.target?.destroy();
    preview.anchor = null;
    preview.target = null;
  }

  private ensureTunnelEndpointVisual(
    preview: TunnelPreviewVisualState,
    slot: 'anchor' | 'target',
    ownerColor: number,
    key: string,
  ): TunnelEndpointVisual {
    const existing = preview[slot];
    if (existing) {
      existing.setVisible(true);
      return existing;
    }

    const created = new TunnelEndpointVisual(this.scene, key, {
      x: 0,
      y: 0,
      ownerColor,
      alpha: 0,
      particleIntensity: 0.5,
      sizePx: TUNNEL_HOLE_DIAMETER,
    }, TUNNEL_VISUAL_DEPTH + 0.01);
    preview[slot] = created;
    return created;
  }

  private createUtilityTargetingHint(): Phaser.GameObjects.Container {
    const x = GAME_WIDTH * 0.5;
    const y = ARENA_OFFSET_Y + 136;
    const panel = this.scene.add.rectangle(0, 0, 500, 64, COLORS.GREY_10, 0.72);
    panel.setStrokeStyle(2, COLORS.RED_2, 0.9);
    const title = this.scene.add.text(0, -11, 'ATOMBOMBE: ZIELMODUS', {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#fff1cf',
      stroke: '#241527',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const subtitle = this.scene.add.text(0, 15, 'Linksklick: platzieren   Rechtsklick oder E: abbrechen', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#ebede9',
      stroke: '#241527',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const container = this.scene.add.container(x, y, [panel, title, subtitle]);
    container.setDepth(DEPTH.OVERLAY - 1);
    container.setScrollFactor(0);
    container.setVisible(false);
    return container;
  }

  private createAirstrikeTargetingHint(): Phaser.GameObjects.Container {
    const x = GAME_WIDTH * 0.5;
    const y = ARENA_OFFSET_Y + 136;
    const panel = this.scene.add.rectangle(0, 0, 560, 64, COLORS.GREY_10, 0.72);
    panel.setStrokeStyle(2, 0xff6600, 0.9);
    const title = this.scene.add.text(0, -11, 'LUFTANGRIFF: ZIELMODUS', {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#ffcc66',
      stroke: '#241527',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const subtitle = this.scene.add.text(0, 15, 'Linksklick: Ziel markieren   Rechtsklick oder Q: abbrechen', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#ebede9',
      stroke: '#241527',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const container = this.scene.add.container(x, y, [panel, title, subtitle]);
    container.setDepth(DEPTH.OVERLAY - 1);
    container.setScrollFactor(0);
    container.setVisible(false);
    return container;
  }

  private createPlaceableUtilityHint(): Phaser.GameObjects.Container {
    const x = GAME_WIDTH * 0.5;
    const y = ARENA_OFFSET_Y + 54;
    const panel = this.scene.add.rectangle(0, 0, 560, 64, COLORS.GREY_10, 0.72);
    panel.setStrokeStyle(2, COLORS.BROWN_2, 0.9);
    const title = this.scene.add.text(0, -11, 'BAUMODUS', {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#fff1cf',
      stroke: '#241527',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const subtitle = this.scene.add.text(0, 15, 'E oder Linksklick: bauen   Rechtsklick: abbrechen', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#ebede9',
      stroke: '#241527',
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.placeableUtilityHintTitle = title;
    this.placeableUtilityHintSubtitle = subtitle;

    const container = this.scene.add.container(x, y, [panel, title, subtitle]);
    container.setDepth(DEPTH.OVERLAY - 1);
    container.setScrollFactor(0);
    container.setVisible(false);
    return container;
  }
}
