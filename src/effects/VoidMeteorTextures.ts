import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const VOID_METEOR_ROCK = '__void_meteor_intro_rock';
/** 512px canvas, exactly aligned to ROCK; use the rock's scale and rotation. */
export const VOID_METEOR_CRACKS = '__void_meteor_intro_cracks';
/** 512px canvas, hot leading edge faces +X; rotate with travel direction, not rock spin. */
export const VOID_METEOR_HEAT_LIP = '__void_meteor_intro_heat_lip';
export const VOID_METEOR_CORONA = '__void_meteor_intro_corona';
export const VOID_METEOR_FLAME = '__void_meteor_intro_flame';
export const VOID_METEOR_SMOKE = '__void_meteor_intro_smoke';

function randomSequence(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

interface RockPoint { readonly x: number; readonly y: number; readonly z: number }
type RockFace = readonly [number, number, number];

// Chipped asymmetrical outline; every point remains in the overhead image plane.
const ROCK_OUTLINE: readonly RockPoint[] = [
  [56, 160, 8], [98, 86, 11], [151, 59, 14], [183, 81, 12], [250, 41, 15],
  [311, 75, 13], [342, 106, 18], [330, 132, 20], [401, 156, 10], [451, 219, 6],
  [424, 260, 12], [450, 309, 8], [391, 338, 11], [372, 401, 8], [306, 419, 14],
  [279, 455, 6], [214, 417, 15], [159, 431, 9], [131, 366, 16], [80, 342, 7],
  [99, 291, 11], [53, 254, 9], [78, 210, 17],
].map(([x, y, z]) => ({ x, y, z }));

function rockOutline(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ROCK_OUTLINE.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
}

/** Small static triangulation gives top-facing convex facets with one shared light direction. */
function rockFaces(points: readonly RockPoint[]): RockFace[] {
  const count = points.length;
  const vertices = [...points, { x: -2000, y: -1000, z: 0 }, { x: 3000, y: -1000, z: 0 }, { x: 256, y: 3000, z: 0 }];
  let faces: RockFace[] = [[count, count + 1, count + 2]];
  for (let index = 0; index < count; index++) {
    const p = vertices[index];
    const edges = new Map<string, readonly [number, number]>();
    faces = faces.filter(([ia, ib, ic]) => {
      const a = vertices[ia], b = vertices[ib], c = vertices[ic];
      const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      if (Math.abs(d) < 0.001) return true;
      const aa = a.x * a.x + a.y * a.y, bb = b.x * b.x + b.y * b.y, cc = c.x * c.x + c.y * c.y;
      const cx = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
      const cy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 > (a.x - cx) ** 2 + (a.y - cy) ** 2) return true;
      for (const edge of [[ia, ib], [ib, ic], [ic, ia]] as const) {
        const key = `${Math.min(...edge)}:${Math.max(...edge)}`;
        if (edges.has(key)) edges.delete(key); else edges.set(key, edge);
      }
      return false;
    });
    for (const [a, b] of edges.values()) faces.push([a, b, index]);
  }
  return faces.filter(face => face.every(index => index < count));
}

function rockFissures(): readonly (readonly { x: number; y: number }[])[] {
  const random = randomSequence(502);
  // Open-ended fractures with distinct junctions; no closed plate outlines or central star.
  const seams = [
    [[116, 70], [151, 123], [147, 167], [179, 208], [204, 225], [192, 264], [227, 305], [209, 354]],
    [[179, 208], [224, 198], [257, 217], [305, 211], [340, 249], [392, 272], [434, 309]],
    [[305, 211], [296, 168], [315, 145]],
    [[227, 305], [265, 294], [283, 328], [322, 355], [334, 411]],
    [[147, 167], [115, 179], [93, 163]],
    [[340, 249], [366, 224], [409, 227]],
  ];
  return seams.map(points => points.flatMap(([x, y], i) => {
    if (!i) return [{ x, y }];
    const [px, py] = points[i - 1];
    const pieces = Math.max(2, Math.round(Math.hypot(x - px, y - py) / 10));
    return Array.from({ length: pieces }, (_, j) => {
      const t = (j + 1) / pieces, wobble = j === pieces - 1 ? 0 : (random() - 0.5) * 7;
      return { x: px + (x - px) * t + wobble, y: py + (y - py) * t - wobble * 0.7 };
    });
  }));
}

function strokeFissures(ctx: CanvasRenderingContext2D, width: number, color: string): void {
  ctx.lineWidth = width; ctx.lineJoin = 'bevel'; ctx.strokeStyle = color;
  for (const points of rockFissures()) {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
  }
}

/** Overhead surfaces only: an irregular rock plan, planar fractures and radial ablation.
 * There is no side face, perspective taper or baked cast shadow on the rock. */
export function ensureVoidMeteorTextures(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, VOID_METEOR_ROCK, 512, 512, (ctx) => {
    const random = randomSequence(781);
    rockOutline(ctx);
    ctx.fillStyle = '#100d16'; ctx.fill();
    ctx.save(); ctx.clip();
    // A raised upper surface, seen vertically: diffuse shading comes from triangle normals,
    // not arbitrary colours per plate. No wall geometry is projected into the silhouette.
    const points: readonly RockPoint[] = [...ROCK_OUTLINE, ...[
      [161, 133, 65], [239, 116, 98], [304, 148, 80], [125, 222, 55],
      [205, 205, 157], [279, 220, 124], [360, 235, 68], [162, 298, 85],
      [241, 283, 144], [314, 307, 91], [205, 372, 60], [282, 377, 65],
    ].map(([x, y, z]) => ({ x, y, z }))];
    for (const [ia, ib, ic] of rockFaces(points)) {
      const a = points[ia], b = points[ib], c = points[ic];
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const normal = Math.hypot(nx, ny, nz);
      const diffuse = Math.max(0, (-0.53 * nx - 0.61 * ny + 0.59 * nz) / normal);
      const elevation = (a.z + b.z + c.z) / 3;
      const shade = (0.12 + diffuse * 0.88) * (0.7 + Math.min(1, elevation / 130) * 0.3);
      const value = 12 + shade * 99;
      const gradient = ctx.createLinearGradient(a.x - 22, a.y - 22, c.x + 30, c.y + 30);
      gradient.addColorStop(0, 'rgb(' + value + ',' + value * 0.91 + ',' + value * 1.13 + ')');
      gradient.addColorStop(1, 'rgb(' + value * 0.79 + ',' + value * 0.72 + ',' + value * 0.92 + ')');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill();
      // A tiny same-tone overlap closes canvas antialias seams without outlining every facet.
      ctx.strokeStyle = 'rgb(' + value * 0.83 + ',' + value * 0.76 + ',' + value * 0.99 + ')';
      ctx.lineWidth = 0.7; ctx.stroke();
    }
    // Fine roughness follows the raised facets; it cannot replace the large light/dark masses.
    for (let i = 0; i < 4400; i++) {
      const x = random() * 512, y = random() * 512, r = 0.5 + random() * 2.5;
      ctx.fillStyle = random() < 0.5 ? 'rgba(189,175,208,0.1)' : 'rgba(0,0,0,0.21)';
      ctx.fillRect(x, y, r * 1.5, r);
    }
    // Dark fractured edge is part of the top surface, never an extruded sidewall.
    rockOutline(ctx); ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(5,3,10,0.65)'; ctx.stroke();
    rockOutline(ctx); ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(5,3,10,0.7)'; ctx.stroke();
    strokeFissures(ctx, 8, 'rgba(6,2,13,0.9)');
    strokeFissures(ctx, 2.5, 'rgba(67,21,92,0.75)');
    ctx.restore();
  });

  ensureCanvasTexture(textures, VOID_METEOR_CRACKS, 512, 512, (ctx) => {
    rockOutline(ctx); ctx.save(); ctx.clip();
    strokeFissures(ctx, 15, 'rgba(119,37,232,0.16)');
    strokeFissures(ctx, 8, 'rgba(162,60,249,0.32)');
    strokeFissures(ctx, 4, 'rgba(209,132,255,0.9)');
    strokeFissures(ctx, 1.5, 'rgba(255,228,255,1)');
    ctx.restore();
  });

  ensureCanvasTexture(textures, VOID_METEOR_HEAT_LIP, 512, 512, (ctx) => {
    const random = randomSequence(938);
    // Only the forward sector is molten. The centre stays empty to preserve rock volume.
    const leadingPath = (inset: number): void => {
      ctx.beginPath();
      for (let i = 0; i <= 42; i++) {
        const angle = -1.08 + i / 42 * 2.16;
        const radius = 174 + Math.sin(angle * 7 + 0.4) * 8 + Math.sin(angle * 19) * 3 - inset;
        const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [width, color] of [[55, 'rgba(124,43,231,0.14)'], [32, 'rgba(166,65,255,0.32)'],
      [19, 'rgba(222,156,255,0.82)'], [8, 'rgba(255,240,255,1)']] as const) {
      leadingPath(0); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const angle = (random() - 0.5) * 2.1, radius = 173 + Math.sin(angle * 7 + 0.4) * 8;
      const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius;
      const reach = 8 + random() * 24;
      ctx.strokeStyle = 'rgba(243,198,255,' + (0.25 + random() * 0.45) + ')';
      ctx.lineWidth = 1 + random() * 2;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach); ctx.stroke();
    }
  });

  ensureCanvasTexture(textures, VOID_METEOR_CORONA, 512, 512, (ctx) => {
    const random = randomSequence(918);
    // Disconnected clouds of ablation instead of an unbroken circular rim.
    for (let i = 0; i < 24; i++) {
      const angle = random() * Math.PI * 2;
      const front = 0.5 + 0.5 * Math.cos(angle);
      const radius = 135 + random() * 50, reach = 35 + random() * 35;
      const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, reach);
      cloud.addColorStop(0, `rgba(235,188,255,${0.28 + front * 0.32})`);
      cloud.addColorStop(0.3, 'rgba(186,107,255,0.35)');
      cloud.addColorStop(0.65, 'rgba(117,41,224,0.16)');
      cloud.addColorStop(1, 'rgba(92,25,196,0)');
      ctx.fillStyle = cloud; ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
    }
    for (let i = 0; i < 35; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 147 + random() * 43, reach = 10 + random() * 28;
      const front = 0.5 + 0.5 * Math.cos(angle);
      ctx.strokeStyle = `rgba(237,197,255,${0.15 + front * 0.35})`;
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(angle) * radius, 256 + Math.sin(angle) * radius);
      ctx.quadraticCurveTo(256 + Math.cos(angle + 0.05) * (radius + reach * 0.6),
        256 + Math.sin(angle + 0.05) * (radius + reach * 0.6),
        256 + Math.cos(angle + 0.12) * (radius + reach), 256 + Math.sin(angle + 0.12) * (radius + reach));
      ctx.stroke();
    }
  });

  ensureCanvasTexture(textures, VOID_METEOR_FLAME, 256, 128, (ctx) => {
    const random = randomSequence(145);
    // Pointed, turbulent tongues, aligned along +X towards the rock.
    for (let i = 0; i < 28; i++) {
      const y = 28 + random() * 72;
      const head = 176 + random() * 38;
      const tail = 10 + random() * 100;
      const width = 6 + random() * 17;
      const gradient = ctx.createLinearGradient(tail, y, head, y);
      gradient.addColorStop(0, 'rgba(133,43,224,0)');
      gradient.addColorStop(0.35, 'rgba(151,65,244,0.2)');
      gradient.addColorStop(0.8, 'rgba(207,153,255,0.48)');
      gradient.addColorStop(1, 'rgba(249,226,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.moveTo(tail, y + (random() - 0.5) * 34);
      ctx.bezierCurveTo(head * 0.6, y - width, head + 22, y - width, head + 20, y);
      ctx.bezierCurveTo(head, y + width, head * 0.5, y + width, tail, y);
      ctx.fill();
    }
  });

  ensureCanvasTexture(textures, VOID_METEOR_SMOKE, 128, 128, (ctx) => {
    const random = randomSequence(236);
    for (let i = 0; i < 22; i++) {
      const angle = random() * Math.PI * 2, distance = random() * 25;
      const x = 64 + Math.cos(angle) * distance, y = 64 + Math.sin(angle) * distance;
      const radius = 16 + random() * 22;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(49,34,68,0.34)');
      gradient.addColorStop(0.55, 'rgba(36,24,52,0.2)');
      gradient.addColorStop(1, 'rgba(24,17,38,0)');
      ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}
