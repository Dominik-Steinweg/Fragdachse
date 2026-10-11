import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const MORTAR_TEXTURE = 'mortar-strike-v2';
export const MORTAR_TILE = 192;
export const MORTAR_RING_RADIUS = 80;
export const MORTAR_PROGRESS_STEPS = 64;
export const MORTAR_FRAME = { committed: 65, shade: 66, glow: 67, shell: 68, arrow: 69, wave: 70, contraction: 71, shadow: 72, shadowRim: 73 } as const;

/** Neutral procedural motifs, baked once per scene. Palette is applied by the renderer.
 * Rings' OUTER edge is radius 80; scaling therefore preserves the exact damage boundary. */
export function ensureMortarStrikeTextures(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, MORTAR_TEXTURE, MORTAR_TILE * 8, MORTAR_TILE * 10, (ctx, texture) => {
    for (let frame = 0; frame <= MORTAR_FRAME.shadowRim; frame++) {
      const x = frame % 8 * MORTAR_TILE, y = Math.floor(frame / 8) * MORTAR_TILE;
      texture.add(frame, 0, x, y, MORTAR_TILE, MORTAR_TILE);
      ctx.save(); ctx.translate(x + MORTAR_TILE / 2, y + MORTAR_TILE / 2);
      if (frame <= MORTAR_FRAME.committed || frame === MORTAR_FRAME.wave) {
        const committed = frame >= MORTAR_FRAME.committed;
        if (frame === MORTAR_FRAME.committed) {
          const halo = ctx.createRadialGradient(0, 0, 68, 0, 0, 94);
          halo.addColorStop(0, 'rgba(255,255,255,0)'); halo.addColorStop(0.42, 'rgba(255,255,255,0.42)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = halo; ctx.fillRect(-94, -94, 188, 188);
        }
        ctx.strokeStyle = '#fff';
        if (committed) {
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(0, 0, MORTAR_RING_RADIUS - 3, 0, Math.PI * 2); ctx.stroke();
        } else {
          // A single segmented track: lit length advances clockwise from noon.
          // Both active and inactive segments retain the same permanent gaps.
          ctx.lineWidth = 4;
          const progress = frame / MORTAR_PROGRESS_STEPS;
          for (let segment = 0; segment < 24; segment++) {
            const start = segment / 24, end = (segment + 0.7) / 24;
            const arc = (to: number) => {
              ctx.beginPath(); ctx.arc(0, 0, MORTAR_RING_RADIUS - 2,
                -Math.PI / 2 + start * Math.PI * 2, -Math.PI / 2 + to * Math.PI * 2); ctx.stroke();
            };
            ctx.strokeStyle = '#625070'; ctx.globalAlpha = 0.42; arc(end);
            if (progress > start) {
              ctx.strokeStyle = '#fff'; ctx.globalAlpha = 1; arc(Math.min(end, progress));
            }
          }
        }
        // Inward ticks read as an area warning, not a floating ability halo.
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          ctx.lineWidth = 1.2; ctx.globalAlpha = committed ? 0.72 : 0.32;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * 65, Math.sin(a) * 65);
          ctx.lineTo(Math.cos(a) * 69, Math.sin(a) * 69); ctx.stroke();
        }
      } else if (frame === MORTAR_FRAME.contraction || frame === MORTAR_FRAME.shadowRim) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = frame === MORTAR_FRAME.contraction ? 2.5 : 4;
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(0, 0, 77, 0, Math.PI * 2); ctx.stroke();
        if (frame === MORTAR_FRAME.contraction) { ctx.globalAlpha = 0.08; ctx.fillStyle = '#fff'; ctx.fill(); }
      } else if (frame === MORTAR_FRAME.shadow) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 80);
        g.addColorStop(0, '#fff'); g.addColorStop(0.65, '#fff'); g.addColorStop(0.84, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-80, -80, 160, 160);
      } else if (frame === MORTAR_FRAME.shade || frame === MORTAR_FRAME.glow) {
        const r = 80, g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(frame === MORTAR_FRAME.shade ? 0.7 : 0.12, 'rgba(255,255,255,0.65)');
        g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g;
        ctx.fillRect(-r, -r, r * 2, r * 2);
      } else if (frame === MORTAR_FRAME.shell) {
        // End-on shell: circular metal casing and four fins, viewed along its vertical flight.
        // A side-view ogive would contradict the orthographic overhead camera.
        ctx.fillStyle = '#555d67'; ctx.fillRect(-12, -2, 24, 4); ctx.fillRect(-2, -12, 4, 24);
        ctx.fillStyle = '#181c23'; ctx.strokeStyle = '#959ea8'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 5, -Math.PI * 0.9, -Math.PI * 0.2); ctx.stroke();
        ctx.fillStyle = '#b1b7be'; ctx.beginPath(); ctx.arc(-1, -1, 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#ddd'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-11, -13); ctx.lineTo(-5, 0); ctx.lineTo(-11, 13); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(-2, -2, 12, 4);
      }
      ctx.restore();
    }
  });
}
