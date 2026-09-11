import type * as Phaser from 'phaser';
import { combatTargetInstanceKey, type CombatTargetRef } from '../combat/CombatScope';
import type { MgAttritionSnapshot, MgTransfer } from '../systems/MgAttritionRuntime';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';
import type { MgTargetVisual } from './MgAttritionVisualTarget';


interface Entry { source: number; flow: ParticleFlowScheduler; blood: ParticleFlowScheduler }

/** One scene-long GPU emission callback; World state and GPU sources are explicitly cleared. */
export class MgAttritionRenderer {
  private readonly entries = new Map<string, Entry>();
  private targets: MgAttritionSnapshot['targets'] = [];
  private lookup: (ref: CombatTargetRef) => MgTargetVisual | null = () => null;
  private pending: MgTransfer[] = [];
  private impulses: { source: number; end: number }[] = [];
  private sequence: number | null = null;
  private now = 0;
  private readonly mote;
  private readonly blood;
  private readonly transfer;

  constructor(private readonly scene: Phaser.Scene, private readonly gpu: GpuVfxSystem) {
    this.mote = gpu.createSpec(GpuVfxEffectId.MgAttrition);
    Object.assign(this.mote, { lifeMs: 360, scaleStart: .24, scaleEnd: .04, alphaStart: .48, alphaEnd: 0, tint: 0x94b6c0 });
    this.blood = gpu.createSpec(GpuVfxEffectId.MgBleed);
    Object.assign(this.blood, { lifeMs: 300, scaleStart: .25, scaleEnd: .07, alphaStart: .75, alphaEnd: 0, tint: 0xac2439 });
    this.transfer = gpu.createSpec(GpuVfxEffectId.MgTransfer);
    Object.assign(this.transfer, { lifeMs: 180, scaleStart: .18, scaleEnd: .08, stretchStart: 1.8,
      stretchEnd: .5, alphaStart: .65, alphaEnd: 0, tint: 0xb3dfeb });
    gpu.registerEmission((delta, now) => this.emit(delta, now));
  }

  sync(snapshot: MgAttritionSnapshot, now: number, lookup: typeof this.lookup): void {
    this.targets = snapshot.targets; this.now = now; this.lookup = lookup;
    if (this.sequence !== null) {
      this.pending.push(...snapshot.transfers.filter(e => e.sequence > this.sequence! && now - e.createdAt < 400));
    }
    this.sequence = Math.max(this.sequence ?? 0, snapshot.transferSequence);
    const active = new Set(snapshot.targets.filter(t => t.expiresAt > now).map(t => combatTargetInstanceKey(t.target)));
    for (const [key, entry] of this.entries) if (!active.has(key)) { this.gpu.releaseSource(entry.source); this.entries.delete(key); }
  }

  clear(): void {
    for (const entry of this.entries.values()) this.gpu.releaseSource(entry.source);
    for (const impulse of this.impulses) this.gpu.releaseSource(impulse.source);
    this.entries.clear(); this.targets = []; this.pending = []; this.impulses = []; this.sequence = null; this.lookup = () => null;
  }

  private emit(delta: number, gpuNow: number): void {
    this.now += Math.max(0, delta);
    const view = this.scene.cameras.main.worldView;
    const inView = (x: number, y: number, radius = 0) => x + radius >= view.x && x - radius <= view.right && y + radius >= view.y && y - radius <= view.bottom;
    const visible = new Set<string>();
    if (!this.gpu.isSuppressed()) for (const state of this.targets) {
      if (state.expiresAt <= this.now) continue;
      const target = this.lookup(state.target);
      if (!target || !inView(target.x, target.y, Math.max(target.width, target.height) / 2)) continue;
      const key = combatTargetInstanceKey(state.target);
      visible.add(key);
      let entry = this.entries.get(key);
      if (!entry) {
        const source = this.gpu.createSource(GpuVfxEffectId.MgAttrition);
        if (source < 0) continue;
        entry = { source, flow: new ParticleFlowScheduler(140), blood: new ParticleFlowScheduler(330) };
        this.entries.set(key, entry);
      }
      const frequency = this.gpu.quality.scaleFrequency(140, GpuVfxEffectId.MgAttrition);
      if (frequency > 0) {
        entry.flow.setFrequency(frequency);
        for (let i = 0, count = Math.min(3, entry.flow.tick(delta)); i < count; i++) {
          const angle = this.now * .007 + i * 2.4 + target.x;
          this.mote.x = target.x + Math.cos(angle) * target.width * .34;
          this.mote.y = target.y + Math.sin(angle) * target.height * .34;
          this.mote.vx = Math.cos(angle) * 8; this.mote.vy = Math.sin(angle) * 8;
          this.mote.rotation = angle;
          this.gpu.spawn(this.mote, entry.source, gpuNow);
        }
      }
      const bleedFrequency = this.gpu.quality.scaleFrequency(330, GpuVfxEffectId.MgBleed);
      if (state.bleedUntil > this.now && bleedFrequency > 0) {
        entry.blood.setFrequency(bleedFrequency);
        for (let i = 0, count = Math.min(2, entry.blood.tick(delta)); i < count; i++) {
          const angle = this.now * .011 + target.y;
          this.blood.x = target.x + Math.cos(angle) * target.width * .23;
          this.blood.y = target.y + Math.sin(angle) * target.height * .23;
          this.blood.vx = Math.cos(angle) * 20; this.blood.vy = Math.sin(angle) * 20;
          this.blood.rotation = angle;
          this.gpu.spawn(this.blood, entry.source, gpuNow);
        }
      }
    }
    for (const [key, entry] of this.entries) if (!visible.has(key)) { this.gpu.releaseSource(entry.source); this.entries.delete(key); }
    for (const event of this.pending) {
      if (this.gpu.isSuppressed() || (!inView(event.fromX, event.fromY) && !inView(event.toX, event.toY))) continue;
      if (this.gpu.quality.scaleBurst(GpuVfxEffectId.MgTransfer, 1) < 1) continue;
      const source = this.gpu.createSource(GpuVfxEffectId.MgTransfer);
      if (source < 0) continue;
      Object.assign(this.transfer, { x: event.fromX, y: event.fromY,
        vx: (event.toX - event.fromX) / .18, vy: (event.toY - event.fromY) / .18,
        rotation: Math.atan2(event.toY - event.fromY, event.toX - event.fromX) });
      this.gpu.spawn(this.transfer, source, gpuNow);
      this.impulses.push({ source, end: gpuNow + this.transfer.lifeMs });
    }
    this.pending = [];
    this.impulses = this.impulses.filter(impulse => {
      if (gpuNow < impulse.end && !this.gpu.isSuppressed()) return true;
      this.gpu.releaseSource(impulse.source); return false;
    });
  }
}
