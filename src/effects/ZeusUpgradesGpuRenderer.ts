import type { ZeusSnapshot, ZeusPoint } from '../systems/ZeusRuntime';
import { ZEUS_FX } from '../config/zeusEffects';
import { buildElectricGroundGeometry, electricDisplacement, type ElectricGroundGeometry } from './ZeusElectricGeometry';
import { GpuVfxSystem, createGpuVfxMemberHandle, type GpuVfxMemberHandle } from './gpu/GpuVfxSystem';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxFrameId, getGpuVfxFrame } from './gpu/GpuVfxAtlas';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';

interface AttachedMember { handle: GpuVfxMemberHandle; x: number; y: number; rotation: number }
interface ElectricalBody {
  x: number; y: number; radius: number;
  useId: number; expiresAt: number; source: number; members: AttachedMember[];
  nextStrand: number; nextBed: number;
}
type BodyTarget = (id: string) => ZeusPoint | null;

/** Connected Tesla strands use the same pooled GPU quads as ground fire.
 * Only emission/attachment is CPU work; fades, stretch and particle lifetime run on the GPU. */
export class ZeusUpgradesGpuRenderer {
  private readonly groundCore: GpuVfxSpawnSpec;
  private readonly groundGlow: GpuVfxSpawnSpec;
  private readonly bodyCore: GpuVfxSpawnSpec;
  private readonly bodyGlow: GpuVfxSpawnSpec;
  private groundSource = -1;
  private geometry: ElectricGroundGeometry = { nodes: [], spans: [] };
  private groundSignature = '';
  private readonly bodies = new Map<string, ElectricalBody>();
  private target: BodyTarget | null = null;
  private syncWorldNow = 0;
  private syncGpuNow = 0;
  private nextGroundStrand = 0;
  private nextGroundBed = 0;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.groundCore = gpu.createSpec(GpuVfxEffectId.ElectricGroundCore);
    this.groundGlow = gpu.createSpec(GpuVfxEffectId.ElectricGroundGlow);
    this.bodyCore = gpu.createSpec(GpuVfxEffectId.ElectricBodyCore);
    this.bodyGlow = gpu.createSpec(GpuVfxEffectId.ElectricBodyGlow);
    gpu.registerEmission((_delta, now) => this.emit(now));
  }

  sync(state: ZeusSnapshot, now: number, target: BodyTarget): void {
    this.syncWorldNow = now; this.syncGpuNow = this.gpu.now(); this.target = target;
    const signature = state.ground.filter(g => g.expiresAt > now).map(g =>
      `${g.id}:${g.ownerId}:${g.from.x}:${g.from.y}:${g.from.radius}:${g.to.x}:${g.to.y}:${g.to.radius}:${g.expiresAt}`).join('|');
    if (signature !== this.groundSignature) {
      this.geometry = buildElectricGroundGeometry(state.ground, now);
      if (!this.groundSignature) { this.nextGroundStrand = 0; this.nextGroundBed = 0; }
      this.groundSignature = signature;
      if (!signature) { this.gpu.releaseSource(this.groundSource); this.groundSource = -1; }
    }
    const active = new Set<string>();
    for (const ball of state.balls) {
      const p = target(ball.playerId);
      if (!p || ball.expiresAt <= now) continue;
      active.add(ball.playerId);
      let body = this.bodies.get(ball.playerId);
      // A new use or hitbox resize replaces material, so the bright shell cannot trail an old radius.
      if (body && (body.useId !== ball.useId || Math.abs(body.radius - ball.radius) > 0.1)) {
        this.gpu.releaseSource(body.source); this.bodies.delete(ball.playerId); body = undefined;
      }
      if (!body) {
        body = { x: p.x, y: p.y, radius: ball.radius, useId: ball.useId, expiresAt: ball.expiresAt,
          source: this.gpu.createSource(GpuVfxEffectId.ElectricBodyCore), members: [], nextStrand: 0, nextBed: 0 };
        this.bodies.set(ball.playerId, body);
      }
      body.x = p.x; body.y = p.y; body.expiresAt = ball.expiresAt;
    }
    for (const [id, body] of this.bodies) if (!active.has(id)) {
      this.gpu.releaseSource(body.source); this.bodies.delete(id);
    }
  }

  private emit(gpuNow: number): void {
    const now = this.syncWorldNow + Math.max(0, gpuNow - this.syncGpuNow);
    const p = ZEUS_FX.palette;
    if (this.geometry.nodes.some(n => n.expiresAt > now)) {
      if (this.groundSource < 0) this.groundSource = this.gpu.createSource(GpuVfxEffectId.ElectricGroundCore);
      if (this.groundSource >= 0 && gpuNow >= this.nextGroundStrand) {
        this.nextGroundStrand = gpuNow + ZEUS_FX.strandIntervalMs;
        // Cores get first admission. Decorative glow never consumes their reserved slots.
        for (const glow of [false, true]) for (const span of this.geometry.spans) {
          const remaining = Math.min(span.from.expiresAt, span.to.expiresAt) - now;
          if (remaining <= 0) continue;
          const wave = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin((span.from.x + span.from.y) * 0.045 - now / 180), 4);
          this.emitStrand(span.from, span.to, now, remaining, wave, glow, gpuNow);
        }
      }
      if (this.groundSource >= 0 && gpuNow >= this.nextGroundBed) {
        this.nextGroundBed = gpuNow + ZEUS_FX.bedIntervalMs;
        const detail = this.gpu.quality.getFactor('standard');
        for (let i = 0; i < this.geometry.nodes.length; i++) {
          const n = this.geometry.nodes[i], remaining = n.expiresAt - now;
          if (remaining <= 0) continue;
          this.glow(n.x, n.y, n.radius * 2.6, p.bed, 0.32, remaining, gpuNow);
          this.glow(n.x, n.y, n.radius * 1.7, p.glow, 0.18, remaining, gpuNow);
          if (detail > 0 && i % ZEUS_FX.branchEvery === 0) {
            const angle = n.x * 1.73 + n.y * 0.37 + Math.floor(now / 180);
            const end = { ...n, x: n.x + Math.cos(angle) * n.radius * 0.7, y: n.y + Math.sin(angle) * n.radius * 0.7 };
            this.emitStrand(n, end, now, remaining, 0.45 * detail, true, gpuNow);
            this.glow(end.x, end.y, 3, p.core, 0.9 * detail, Math.min(remaining, 130), gpuNow);
          }
        }
      }
    } else if (this.groundSource >= 0) {
      this.gpu.releaseSource(this.groundSource); this.groundSource = -1;
      this.geometry = { nodes: [], spans: [] }; this.groundSignature = '';
    }

    for (const [id, body] of this.bodies) {
      const position = this.target?.(id), remaining = body.expiresAt - now;
      if (!position || remaining <= 0) { this.gpu.releaseSource(body.source); this.bodies.delete(id); continue; }
      body.x = position.x; body.y = position.y;
      let live = 0;
      for (const member of body.members) if (this.gpu.isMemberLive(member.handle)) {
        this.gpu.updateTransform(member.handle, body.x + member.x, body.y + member.y, 0, 0, member.rotation);
        body.members[live++] = member;
      }
      body.members.length = live;
      if (body.source < 0) continue;
      if (gpuNow >= body.nextStrand) {
        body.nextStrand = gpuNow + ZEUS_FX.strandIntervalMs;
        const radius = body.radius, phase = now / 1000 + body.useId * 0.71;
        const shell = (i: number) => {
          const angle = i * Math.PI * 2 / ZEUS_FX.shellPoints;
          const r = radius * (0.9 + 0.035 * Math.sin(angle * 5 + phase * 4));
          return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, radius: radius * 0.18 };
        };
        for (const glow of [false, true]) {
          for (let i = 0; i < ZEUS_FX.shellPoints; i++) this.emitStrand(shell(i), shell(i + 1), now, remaining, 0.75, glow, gpuNow, body);
          for (let i = 0; i < 3; i++) {
            const a = phase * 0.7 + i * Math.PI * 2 / 3;
            this.emitStrand({ x: -Math.cos(a) * radius * 0.25, y: -Math.sin(a) * radius * 0.25, radius },
              { x: Math.cos(a) * radius * 0.82, y: Math.sin(a) * radius * 0.82, radius },
              now, remaining, 0.7, glow, gpuNow, body);
          }
        }
      }
      if (gpuNow >= body.nextBed) {
        body.nextBed = gpuNow + ZEUS_FX.bedIntervalMs;
        this.glow(0, 0, body.radius * 3.2, p.bed, 0.3, remaining, gpuNow, body);
        this.glow(0, 0, body.radius * 2.0, p.glow, 0.2, remaining, gpuNow, body);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + now / 340 + body.useId;
          this.glow(Math.cos(a) * body.radius * 0.86, Math.sin(a) * body.radius * 0.86,
            3.5, p.core, 0.85, Math.min(remaining, 150), gpuNow, body);
        }
      }
    }
  }

  private emitStrand(a: ZeusPoint, b: ZeusPoint, now: number, remaining: number, alpha: number,
    glow: boolean, gpuNow: number, body?: ElectricalBody): void {
    const factor = glow ? this.gpu.quality.getFactor('standard') : 1;
    if (factor <= 0) return;
    const da = electricDisplacement(a.x, a.y, now, a.radius), db = electricDisplacement(b.x, b.y, now, b.radius);
    const ax = a.x + da[0], ay = a.y + da[1], bx = b.x + db[0], by = b.y + db[1];
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    if (length < 0.01) return;
    const jitter = Math.sin((a.x + b.y) * 0.7 + now / 110) * Math.min(2, length * 0.18);
    const mx = (ax + bx) / 2 - dy / length * jitter, my = (ay + by) / 2 + dx / length * jitter;
    const spec = body ? (glow ? this.bodyGlow : this.bodyCore) : (glow ? this.groundGlow : this.groundCore);
    for (const [x1, y1, x2, y2] of [[ax, ay, mx, my], [mx, my, bx, by]]) {
      this.line(spec, x1, y1, x2, y2, glow ? 6 : 2,
        glow ? ZEUS_FX.palette.glow : ZEUS_FX.palette.filament, alpha * (glow ? 0.23 : 0.85) * factor, remaining, gpuNow, body);
      if (!glow) this.line(spec, x1, y1, x2, y2, 0.7, ZEUS_FX.palette.core, alpha, remaining, gpuNow, body);
    }
  }

  private line(spec: GpuVfxSpawnSpec, ax: number, ay: number, bx: number, by: number, width: number,
    color: number, alpha: number, remaining: number, now: number, body?: ElectricalBody): void {
    spec.frame = width > 2 ? GpuVfxFrameId.FlightWakeStrip : GpuVfxFrameId.FlightCoreStrip;
    const frame = getGpuVfxFrame(spec.frame);
    spec.x = (ax + bx) / 2; spec.y = (ay + by) / 2; spec.rotation = Math.atan2(by - ay, bx - ax);
    spec.scaleStart = spec.scaleEnd = width / frame.height;
    spec.stretchStart = spec.stretchEnd = (Math.hypot(bx - ax, by - ay) + 0.4) / (frame.width * spec.scaleStart);
    spec.lifeMs = Math.min(ZEUS_FX.strandLifeMs, remaining);
    spec.tint = color; spec.alphaStart = alpha * Math.min(1, remaining / ZEUS_FX.fadeOutMs); spec.alphaEnd = 0;
    this.spawn(spec, now, body);
  }

  private glow(x: number, y: number, diameter: number, color: number, alpha: number, remaining: number,
    now: number, body?: ElectricalBody): void {
    const spec = body ? this.bodyGlow : this.groundGlow;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.x = x; spec.y = y; spec.rotation = 0;
    spec.scaleStart = spec.scaleEnd = diameter / getGpuVfxFrame(spec.frame).width;
    spec.stretchStart = spec.stretchEnd = 1;
    spec.lifeMs = Math.min(ZEUS_FX.bedLifeMs, remaining);
    spec.tint = color; spec.alphaStart = alpha * Math.min(1, remaining / ZEUS_FX.fadeOutMs); spec.alphaEnd = 0;
    this.spawn(spec, now, body);
  }

  private spawn(spec: GpuVfxSpawnSpec, now: number, body?: ElectricalBody): void {
    if (body) {
      const member = { handle: createGpuVfxMemberHandle(), x: spec.x, y: spec.y, rotation: spec.rotation };
      spec.x += body.x; spec.y += body.y;
      if (this.gpu.spawn(spec, body.source, now, 0, member.handle)) body.members.push(member);
    } else this.gpu.spawn(spec, this.groundSource, now);
  }

  clear(): void {
    this.gpu.releaseSource(this.groundSource); this.groundSource = -1;
    for (const body of this.bodies.values()) this.gpu.releaseSource(body.source);
    this.bodies.clear(); this.geometry = { nodes: [], spans: [] }; this.groundSignature = ''; this.target = null;
    this.nextGroundStrand = this.nextGroundBed = 0;
  }
}
