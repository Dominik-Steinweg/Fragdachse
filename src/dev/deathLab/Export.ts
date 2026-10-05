import { finite } from './State';

export interface CapturedFrame { timeMs: number; png: string }
export interface LabExport {
  metadata: Record<string, unknown>;
  frames: CapturedFrame[];
  contactSheet: string;
  baseline?: { metadata: Record<string, unknown>; frames: CapturedFrame[]; contactSheet: string };
}
export function frameTimes(frames = 60, stepMs = 25): number[] {
  finite(frames, 1, 181); finite(stepMs, 1, 1500);
  if (!Number.isInteger(frames) || (frames - 1) * stepMs > 1500 + 1e-8) throw new Error('Export muss innerhalb 0–1500 ms bleiben.');
  return Array.from({ length: frames }, (_, i) => Math.min(1500, i * stepMs));
}
export async function decodePng(png: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = png; await image.decode(); return image;
}
export async function contactSheet(frames: readonly CapturedFrame[]): Promise<string> {
  const columns = 6, tileWidth = 240, tileHeight = 180, caption = 24;
  const canvas = document.createElement('canvas');
  canvas.width = columns * tileWidth; canvas.height = Math.ceil(frames.length / columns) * (tileHeight + caption);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111820'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '14px monospace'; ctx.fillStyle = '#d8e3ec';
  for (let i = 0; i < frames.length; i++) {
    const x = i % columns * tileWidth, y = Math.floor(i / columns) * (tileHeight + caption);
    const image = await decodePng(frames[i].png);
    ctx.drawImage(image, x, y, tileWidth, tileHeight);
    ctx.fillText(`${i.toString().padStart(3, '0')} · ${frames[i].timeMs.toFixed(2)} ms`, x + 8, y + tileHeight + 17);
  }
  return canvas.toDataURL('image/png');
}
function download(data: Blob, name: string): void {
  const url = URL.createObjectURL(data), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadExport(result: LabExport, assertActive: () => void): Promise<void> {
  const current = await (await fetch(result.contactSheet)).blob();
  assertActive();
  download(current, 'death-contact-B.png');
  if (result.baseline) {
    const baseline = await (await fetch(result.baseline.contactSheet)).blob();
    assertActive();
    download(baseline, 'death-contact-A.png');
  }
  assertActive();
  // One JSON download includes every full-resolution PNG as a data URL; automation can write them individually.
  download(new Blob([JSON.stringify(result)], { type: 'application/json' }), 'death-sequence.json');
}

export async function sha256(bytes: BufferSource): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
