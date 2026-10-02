import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { EnemyEntity } from '../../entities/EnemyEntity';
import { FogGpuTimer } from '../../effects/groundFog/FogGpuTimer';

/** Isolated dev-scenario fixture. The production renderer reads these actual displayed frames.
 * Hooks and pinned entities are removed by the existing scenario/world lifecycle. */
export class EnemyMeshReview {
  private readonly enemies: EnemyEntity[] = [];
  private restore: (() => void) | null = null;
  private stopMeasurement: (() => void) | null = null;
  private pose = -1;
  measurement: unknown = null;
  get count(): number { return this.enemies.length; }
  constructor(private readonly scene: Phaser.Scene, private readonly runtime: ArenaRuntime) {}
  arrange(count: number, pose = -1): void {
    this.destroy(); this.pose = pose;
    const targets = this.runtime.getScenarioLightingTargets(), player = this.runtime.navigationLabPort.getPlayerPosition();
    if (!targets.enemyShadows || !player) throw Error('Enemy mesh review requires an interactive world');
    this.runtime.navigationLabPort.removeEnemies();
    const cols = count <= 8 ? 2 : Math.ceil(Math.sqrt(count * 1.6));
    const spacing = count <= 8 ? 95 : 36;
    const rows = Math.ceil(count / cols), cx = player.x + (count <= 8 ? 190 : 0), cy = player.y;
    for (let i = 0; i < count; i++) {
      const id = this.runtime.navigationLabPort.spawnEnemy(player.x + 120, player.y, i % 2 ? 'rabid-badger' : 'zombie-badger', false);
      if (!id) throw Error('Enemy fixture spawn failed');
      this.runtime.devScenarioPort.setEnemyHp(id, 1000000);
    }
    targets.enemyShadows.forEachEnemy(e => {
      const i = this.enemies.length;
      this.enemies.push(e);
      e.setPosition(cx + (i % cols - (cols - 1) / 2) * spacing, cy + (Math.floor(i / cols) - (rows - 1) / 2) * spacing);
      e.setStationary(true);
      for (const attack of e.getAttackWeapons()) e.lockWeaponUntil(attack.weapon, Infinity);
    });
    const shadow = targets.shadow, original = shadow.syncDynamicShadows;
    shadow.syncDynamicShadows = (...args) => {
      for (const [i, enemy] of this.enemies.entries()) {
        const s = enemy.sprite;
        s.anims.stop(); s.setFrame(this.pose < 0 ? 1 + Math.floor(this.scene.game.loop.frame / 4 + i) % 12 : this.pose);
        s.setRotation(count <= 8 ? (i < 2 ? 0 : Math.PI / 2) : i * .618);
      }
      original.apply(shadow, args);
      targets.enemyReadability.sync(this.enemies);
    };
    this.restore = () => { shadow.syncDynamicShadows = original; shadow.setEnemyMeshShadowsSuppressed(false); };
  }
  setPose(pose: number): void { this.pose = pose; }
  inspect() {
    return this.enemies.slice(0, 4).map(e => ({ kind: e.kind, frame: e.sprite.frame.name,
      x: e.sprite.x, y: e.sprite.y, rotation: e.sprite.rotation, scale: [e.sprite.scaleX, e.sprite.scaleY],
      displaySize: [e.sprite.displayWidth, e.sprite.displayHeight], texture: e.sprite.texture.key }));
  }
  measure(mesh: boolean): void {
    this.stopMeasurement?.();
    const shadow = this.runtime.getScenarioLightingTargets().shadow;
    shadow.setEnemyMeshShadowsSuppressed(!mesh);
    const renderer = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const timer = new FogGpuTimer(renderer.gl), events = this.scene.game.events;
    let previous = performance.now(), frames = 0, lastSample = 0;
    const intervals: number[] = [], gpu: number[] = [], cpu: number[] = [];
    this.measurement = { status: 'warming', mesh, count: this.enemies.length };
    const before = () => timer.begin();
    const after = () => {
      timer.end(); timer.poll(); const now = performance.now(), delta = now - previous; previous = now;
      if (++frames <= 300) return;
      intervals.push(delta);
      if (timer.sample !== lastSample && timer.ms !== null) { gpu.push(timer.ms); lastSample = timer.sample; }
      const status = shadow.getEnemyShadowsStatus();
      if ('costs' in status && status.costs) cpu.push(status.costs.cpuMs);
      this.measurement = { status: 'recording', mesh, count: this.enemies.length, frames: intervals.length };
      if (intervals.length < 180) return;
      const summary = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b);
        return sorted.length ? { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted[sorted.length - 1] } : null; };
      this.measurement = { status: 'complete', mesh, count: this.enemies.length, samples: intervals.length,
        frameMs: summary(intervals), gpuMs: summary(gpu), gpuSupported: timer.supported,
        enemyShadowCpuMs: mesh ? summary(cpu) : null, enemyShadows: status,
        distinctPositions: new Set(this.enemies.map(e => `${e.sprite.x}:${e.sprite.y}`)).size,
        note: 'Same stationary runtime enemies, weapon cooldowns locked, displayed walk frames cycling; total-frame asynchronous GPU query; allocated VRAM estimated by renderer diagnostics, not vendor process VRAM.' };
      this.stopMeasurement?.();
    };
    events.on('prestep', before); events.on('postrender', after);
    this.stopMeasurement = () => { events.off('prestep', before); events.off('postrender', after); timer.destroy(); this.stopMeasurement = null; };
  }
  destroy(): void { this.stopMeasurement?.(); this.restore?.(); this.restore = null; this.enemies.length = 0; }
}
