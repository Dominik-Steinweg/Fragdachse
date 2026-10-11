/** Pure presentation plan. x/y are the footprint centre, dimensions are world pixels. */
export interface WatchtowerDestructionPiece {
  readonly material: 'plank' | 'splinter' | 'iron' | 'dust' | 'impact';
  readonly x: number;
  readonly y: number;
  readonly endX: number;
  readonly endY: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly spin: number;
  readonly delayMs: number;
  readonly flightMs: number;
  readonly lifeMs: number;
  readonly tint: number;
}

// Sampled visually from the imported watchtower-v1 wood, iron caps and stone footings.
const WOOD = [0xa98048, 0x94703f, 0xbe985e];
const IRON = [0x53554f, 0x72746b, 0x3b403d];
const DUST = [0xb3a088, 0x978a73, 0xc3b49a];
const TAU = Math.PI * 2;
const unit = (index: number, salt: number) => {
  const n = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** Fixed complexity independent of footprint area; no gameplay or random global state. */
export function buildWatchtowerDestructionPlan(
  x: number, y: number, width: number, height: number,
): readonly WatchtowerDestructionPiece[] {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
  const pieces: WatchtowerDestructionPiece[] = [];
  const size = Math.min(width, height);
  for (let i = 0; i < 28; i++) {
    const material = i < 6 ? 'plank' : i < 16 ? 'splinter' : i < 19 ? 'iron' : i < 27 ? 'dust' : 'impact';
    const dust = material === 'dust', impact = material === 'impact';
    const plank = material === 'plank', iron = material === 'iron';
    const angle = i * 2.399963 + unit(i, 4) * .4;
    const radius = impact ? 0 : .12 + unit(i, 2) * .28;
    const startX = x + Math.cos(angle) * width * radius;
    const startY = y + Math.sin(angle) * height * radius;
    const travel = impact ? 0 : size * (dust ? .28 : .22 + unit(i, 3) * .38);
    pieces.push({
      material, x: startX, y: startY,
      endX: startX + Math.cos(angle) * travel,
      endY: startY + Math.sin(angle) * travel,
      width: impact ? width * 1.25 : dust ? size * .55 : size * (plank ? .34 : iron ? .09 : .15),
      height: impact ? height * 1.25 : dust ? size * .55 : size * (plank ? .105 : iron ? .075 : .027),
      rotation: impact ? 0 : plank ? (unit(i, 8) - .5) * .3 : unit(i, 8) * TAU,
      spin: impact ? 0 : (unit(i, 9) - .5) * (iron ? 5 : 2.8),
      delayMs: impact ? 130 : dust ? 110 + unit(i, 5) * 90 : unit(i, 5) * 75,
      flightMs: impact ? 220 : dust ? 600 : 250 + unit(i, 6) * 160,
      lifeMs: impact ? 300 : dust ? 850 : 800 + unit(i, 7) * 220,
      tint: impact ? 0x97856c : dust ? DUST[i % DUST.length] : iron ? IRON[i % IRON.length] : WOOD[i % WOOD.length],
    });
  }
  return pieces;
}
