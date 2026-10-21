/** Pure presentation plan of a bridge collapse. The deck rectangle is in world pixels. */
export interface BridgeDestructionPiece {
  readonly material: 'plank' | 'splinter' | 'iron' | 'dust' | 'splash';
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

export const BRIDGE_DESTRUCTION_PIECE_COUNT = 44;

// Weathered deck wood, wet iron and grey river spray.
const WOOD = [0x75604a, 0x665341, 0x7c674f, 0x5f4e3d];
const IRON = [0x55595b, 0x6a6e70, 0x3b3d3f];
const DUST = [0x8f8577, 0x7c7468, 0xa39886];
const SPRAY = [0xd3dfe2, 0xc2d2d6];
const unit = (index: number, salt: number) => {
  const n = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/**
 * Fixed complexity independent of the span: planks and splinters burst from the charge point,
 * tumble and sink; dust hangs over the gap; splash rings mark where the debris hits the water.
 */
export function buildBridgeDestructionPlan(
  deck: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  horizontal: boolean,
): readonly BridgeDestructionPiece[] {
  const { x, y, width, height } = deck;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
  const cx = x + width / 2, cy = y + height / 2;
  const across = horizontal ? height : width;
  const pieces: BridgeDestructionPiece[] = [];
  for (let i = 0; i < BRIDGE_DESTRUCTION_PIECE_COUNT; i++) {
    const material = i < 12 ? 'plank' : i < 26 ? 'splinter' : i < 30 ? 'iron' : i < 37 ? 'dust' : 'splash';
    const plank = material === 'plank', iron = material === 'iron', dust = material === 'dust', splash = material === 'splash';
    // Start somewhere on the deck, biased towards the charge in the middle.
    const along = (unit(i, 1) - 0.5) * (0.35 + unit(i, 2) * 0.65);
    const side = (unit(i, 3) - 0.5) * 0.8;
    const startX = horizontal ? cx + along * width : cx + side * width;
    const startY = horizontal ? cy + side * height : cy + along * height;
    const angle = Math.atan2(startY - cy, startX - cx) + (unit(i, 4) - 0.5) * 1.2;
    const travel = splash ? 0 : across * (dust ? 0.35 : 0.45 + unit(i, 5) * 0.9);
    pieces.push({
      material,
      x: startX,
      y: startY,
      endX: startX + Math.cos(angle) * travel,
      endY: startY + Math.sin(angle) * travel,
      width: splash ? across * (0.45 + unit(i, 6) * 0.35) : dust ? across * 0.75 : plank ? across * 0.5 : iron ? 6 : 9,
      height: splash ? across * (0.45 + unit(i, 6) * 0.35) : dust ? across * 0.75 : plank ? 6 : iron ? 4 : 2,
      rotation: splash ? 0 : horizontal ? Math.PI / 2 + (unit(i, 7) - 0.5) * 0.5 : (unit(i, 7) - 0.5) * 0.5,
      spin: splash || dust ? 0 : (unit(i, 8) - 0.5) * (iron ? 6 : plank ? 2.2 : 4),
      delayMs: splash ? 180 + unit(i, 9) * 420 : dust ? 60 + unit(i, 9) * 120 : unit(i, 9) * 90,
      flightMs: splash ? 520 : dust ? 900 : 300 + unit(i, 10) * 220,
      lifeMs: splash ? 620 : dust ? 1500 : 900 + unit(i, 11) * 500,
      tint: splash ? SPRAY[i % SPRAY.length]! : dust ? DUST[i % DUST.length]! : iron ? IRON[i % IRON.length]! : WOOD[i % WOOD.length]!,
    });
  }
  return pieces;
}
