import type * as Phaser from 'phaser';
import type { DawnNightModifierId } from '../../dawn/contracts/DawnContentIds';
import type { DawnPhaseId } from '../../config/dawn/dawnContent';
import { createDawnNightFilter, type DawnNightFilter } from './DawnNightFilter';
import { NIGHT_MODIFIER_ATMOSPHERE } from './DawnNightAtmosphereConfig';

/** Screen-space presentation only. No gameplay, fog authority or timers; missing art keeps it off. */
export class NightModifierAtmosphere {
  private filter: DawnNightFilter | null = null;
  private visibleSince: number | null = null;
  constructor(private readonly scene: Phaser.Scene) {}

  sync(id: DawnNightModifierId | undefined, phase: DawnPhaseId, elapsedMs: number): void {
    const visible = NIGHT_MODIFIER_ATMOSPHERE.enabled && !!id && (phase === 'night' || (phase === 'dusk' && id === 'bombers'));
    if (!visible || !id) { this.clear(); return; }
    const camera = this.scene.cameras?.main;
    const renderer = this.scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (!camera || !renderer?.gl) return;
    if (!this.filter) {
      this.filter = createDawnNightFilter(camera);
      camera.filters.external.add(this.filter);
    }
    const style = NIGHT_MODIFIER_ATMOSPHERE.styles[id];
    const now = this.scene.time.now;
    this.visibleSince ??= now;
    const pulse = style.pulseMs
      ? (0.5 + 0.5 * Math.cos(elapsedMs / style.pulseMs * Math.PI * 2)) ** (id === 'bombers' ? 8 : 1) : 1;
    const edgeAmount = style.edgeAmount * (id === 'fire' ? 0.7 + pulse * 0.3 : id === 'bombers' ? 0.35 + pulse * 0.65 : 1);
    this.filter.params = { ...style, edgeAmount };
    this.filter.time = (elapsedMs / 1000) % 3600;
    this.filter.strength = Math.min(1, (now - this.visibleSince) / NIGHT_MODIFIER_ATMOSPHERE.fadeInMs);
    this.filter.setActive(this.filter.ready());
  }

  clear(): void {
    this.visibleSince = null;
    this.filter?.setActive(false);
  }

  destroy(): void {
    if (this.filter) this.scene.cameras?.main?.filters.external.remove(this.filter);
    this.filter = null;
    this.visibleSince = null;
  }
}
