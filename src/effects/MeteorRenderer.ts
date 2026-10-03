import type * as Phaser from 'phaser';
import type { SyncedMeteorStrike } from '../types';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx } from './camera/cameraFeedbackPresets';
import { MeteorGpuLayer } from './gpu/MeteorGpuLayer';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

/** Snapshot presentation only. Explosions, local light and burning chunks are already driven
 * by the authoritative explosion RPC / FireChunkSystem; disappearing IDs never duplicate them. */
export class MeteorRenderer {
  private readonly layer: MeteorGpuLayer;
  private readonly previous = new Map<number, SyncedMeteorStrike>();
  private readonly craters: { meteor: SyncedMeteorStrike; born: number }[] = [];
  private cameraFeedback: CameraFeedbackController | null = null;
  private gpuVfx: GpuVfxSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) { this.layer = new MeteorGpuLayer(scene); }
  registerGpuVfx(system: GpuVfxSystem): void { this.gpuVfx = system; }
  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }

  sync(meteors: SyncedMeteorStrike[]): void {
    const now = Date.now();
    const active = new Set(meteors.map(m => m.id));
    for (const [id, meteor] of this.previous) {
      if (active.has(id)) continue;
      this.previous.delete(id);
      // Cancellation before impact (e.g. killed Void caster) leaves no fictitious crater.
      if (now < meteor.impactAt) continue;
      if (this.craters.length === 64) this.craters.shift();
      this.craters.push({ meteor, born: this.scene.time.now });
      this.cameraFeedback?.request({channel:'impact', amplitudePx:legacyShakeAmplitudePx(Math.min(.006,.002*Math.sqrt(meteor.radius/60))),
        durationMs:260, priority:CAMERA_FEEDBACK_PRIORITY.mediumImpact, decay:'impulse',sourceX:meteor.x,sourceY:meteor.y});
    }
    this.layer.begin();
    // Warnings have priority over decorative residue; offscreen strikes need no GPU slots.
    const camera = this.scene.cameras.main;
    const visible = (m: SyncedMeteorStrike) => camera.worldView.contains(m.x, m.y)
      || (m.x + m.radius*4 >= camera.worldView.x && m.x - m.radius*4 <= camera.worldView.right
        && m.y + m.radius*4 >= camera.worldView.y && m.y - m.radius*4 <= camera.worldView.bottom);
    const suppressed = this.gpuVfx?.isSuppressed() ?? false;
    for (const meteor of meteors) {
      this.previous.set(meteor.id, meteor);
      if (suppressed || !visible(meteor)) continue;
      const progress = Math.max(0,Math.min(1,(now-meteor.spawnedAt)/Math.max(1,meteor.impactAt-meteor.spawnedAt)));
      this.layer.add({x:meteor.x,y:meteor.y,radius:meteor.radius,progress,
        seed:(Math.imul(meteor.id+1,2654435761)>>>0)%997,void:meteor.variant==='void',age:-1});
    }
    for(let i=this.craters.length-1;i>=0;i--) {
      const crater=this.craters[i], age=(this.scene.time.now-crater.born)/1000;
      if(age>=7) {this.craters.splice(i,1);continue;}
      const m=crater.meteor;
      if(suppressed || !visible(m))continue;
      this.layer.add({x:m.x,y:m.y,radius:m.radius,progress:1,
        seed:(Math.imul(m.id+1,2654435761)>>>0)%997,void:m.variant==='void',age});
    }
    this.layer.flush();
  }
  clear(): void { this.previous.clear(); this.craters.length=0; this.layer.clear(); }
  destroy(): void { this.clear(); this.layer.destroy(); }
}
