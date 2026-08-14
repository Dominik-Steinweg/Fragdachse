/**
 * uiTextures — geteilte Canvas-Texturen fuer einen einheitlichen, modernen UI-Look.
 *
 * Stellt abgerundete Rechteck-Texturen mit Verlauf, Glanz-Highlight und farbiger
 * Kontur bereit. Wird vom Upgrade-Overlay-Stil abgeleitet und in der Lobby sowie
 * den Overlays (Options, Help) verwendet, damit ueberall der gleiche Look entsteht.
 */
import * as Phaser from 'phaser';
import { rgbStr } from './LivingBarEffect';

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export interface RoundedTextureParams {
  key: string;
  w: number;
  h: number;
  radius: number;
  topColor: number;
  bottomColor: number;
  fillAlpha: number;
  strokeColor: number;
  strokeAlpha: number;
  strokeWidth: number;
  highlightAlpha: number;
  /** Optionaler, in die gerundete Flaeche geclippter Farbakzent an der linken Kante. */
  leftAccentColor?: number;
  leftAccentAlpha?: number;
  leftAccentWidth?: number;
}

/** Erzeugt (oder liefert gecacht) eine abgerundete Rechteck-Textur mit Verlauf + Glanz. */
export function ensureRoundedTexture(scene: Phaser.Scene, params: RoundedTextureParams): string {
  if (scene.textures.exists(params.key)) return params.key;

  const w = Math.max(1, Math.round(params.w));
  const h = Math.max(1, Math.round(params.h));
  const ct = scene.textures.createCanvas(params.key, w, h);
  if (!ct) return params.key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, w, h);

  const inset = Math.max(1, params.strokeWidth);
  const rectW = w - inset * 2;
  const rectH = h - inset * 2;

  roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, rgbStr(params.topColor, params.fillAlpha));
  grad.addColorStop(1, rgbStr(params.bottomColor, params.fillAlpha));
  ctx.fillStyle = grad;
  ctx.fill();

  if (params.leftAccentColor !== undefined && (params.leftAccentAlpha ?? 0) > 0) {
    ctx.save();
    roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
    ctx.clip();
    ctx.fillStyle = rgbStr(params.leftAccentColor, params.leftAccentAlpha ?? 1);
    ctx.fillRect(0, 0, inset + Math.max(1, params.leftAccentWidth ?? 4), h);
    ctx.restore();
  }

  if (params.highlightAlpha > 0) {
    ctx.save();
    roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
    ctx.clip();
    const hi = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    hi.addColorStop(0, `rgba(255,255,255,${params.highlightAlpha})`);
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, w, h * 0.55);
    ctx.restore();
  }

  if (params.strokeAlpha > 0) {
    roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
    ctx.lineWidth = params.strokeWidth;
    ctx.strokeStyle = rgbStr(params.strokeColor, params.strokeAlpha);
    ctx.stroke();
  }

  ct.refresh();
  return params.key;
}

/** Weicher, unten deckender Sockel fuer den primaeren Lobby-CTA ohne harte obere Kante. */
export function ensureLobbyFooterTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  color: number,
): string {
  if (scene.textures.exists(key)) return key;

  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const ct = scene.textures.createCanvas(key, iw, ih);
  if (!ct) return key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, iw, ih);

  ctx.save();
  roundRectPath(ctx, 1, 0, iw - 2, ih - 2, 20);
  ctx.clip();
  const fade = ctx.createLinearGradient(0, 0, 0, ih);
  fade.addColorStop(0, rgbStr(color, 0));
  fade.addColorStop(0.42, rgbStr(color, 0.14));
  fade.addColorStop(1, rgbStr(color, 0.58));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, iw, ih);
  ctx.restore();

  ct.refresh();
  return key;
}

/** Modale Hauptflaeche: dunkler Verlauf, dezente Kontur, leichter Glanz oben. */
export function ensureModalPanelTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  baseColor: number, accentColor: number,
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: 22,
    topColor: lerpColor(baseColor, 0xffffff, 0.07),
    bottomColor: lerpColor(baseColor, 0x000000, 0.3),
    fillAlpha: 0.96,
    strokeColor: accentColor,
    strokeAlpha: 0.5,
    strokeWidth: 2,
    highlightAlpha: 0.05,
  });
}

/**
 * Panelflaeche der Lobby.
 *
 * Bewusst eine eigene Variante statt einer Aenderung an {@link ensureModalPanelTexture}:
 * Hinter dem Lobby-Panel liegt eine Felslandschaft, die durchscheinen soll. Modale Dialoge
 * ueberall sonst brauchen weiterhin ihre volle Deckung.
 */
export function ensureLobbyPanelTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  baseColor: number, accentColor: number,
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: 22,
    topColor: lerpColor(baseColor, 0xffffff, 0.12),
    bottomColor: lerpColor(baseColor, 0x000000, 0.18),
    fillAlpha: 0.81,
    strokeColor: accentColor,
    strokeAlpha: 0.5,
    strokeWidth: 2,
    highlightAlpha: 0.05,
  });
}

/** Glaenzender, drueckbarer Button in der angegebenen Grundfarbe. */
export function ensureGlossyButtonTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  baseColor: number, strokeColor?: number,
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: 11,
    topColor: lerpColor(baseColor, 0xffffff, 0.16),
    bottomColor: lerpColor(baseColor, 0x000000, 0.30),
    fillAlpha: 0.97,
    strokeColor: strokeColor ?? lerpColor(baseColor, 0xffffff, 0.12),
    strokeAlpha: 0.9,
    strokeWidth: 2,
    highlightAlpha: 0.24,
  });
}

/** Flache, eingefasste Sektions-/Listenflaeche (kein Glanz -> wirkt nicht drueckbar). */
export function ensureFlatPanelTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  fillColor: number, strokeColor: number,
  opts?: { radius?: number; fillAlpha?: number; strokeAlpha?: number },
): string {
  return ensureRoundedTexture(scene, {
    key, w, h,
    radius: opts?.radius ?? 12,
    topColor: lerpColor(fillColor, 0xffffff, 0.04),
    bottomColor: lerpColor(fillColor, 0x000000, 0.18),
    fillAlpha: opts?.fillAlpha ?? 0.9,
    strokeColor,
    strokeAlpha: opts?.strokeAlpha ?? 0.5,
    strokeWidth: 1.5,
    highlightAlpha: 0,
  });
}

/**
 * Gezeichnete UI-Symbole.
 *
 * Bewusst Canvas statt Emoji: Farbemoji rastern je nach Betriebssystem unterschiedlich, bringen
 * ihre eigene Farbigkeit mit und brechen damit die Farbhierarchie aus `uiTheme`. Diese Symbole
 * folgen der uebergebenen Farbe.
 *
 * Wie beim Vollbild-Symbol gilt: in doppelter Groesse zeichnen und per `setDisplaySize` auf die
 * Zielgroesse bringen, sonst franst die Kontur bei hoher Renderaufloesung aus.
 */
export type UiIconName =
  | 'check'
  | 'cross'
  | 'chevron-left'
  | 'chevron-right'
  | 'plus'
  | 'info'
  | 'help'
  | 'settings'
  | 'utility-rad'
  | 'lock'
  | 'copy'
  | 'trophy'
  | 'fullscreen-enter'
  | 'fullscreen-exit';

export function ensureIconTexture(
  scene: Phaser.Scene, name: UiIconName, size: number, color: number,
): string {
  const s = Math.max(4, Math.round(size));
  const key = `_icon_${name}_${s}_${color.toString(16)}`;
  if (scene.textures.exists(key)) return key;

  const ct = scene.textures.createCanvas(key, s, s);
  if (!ct) return key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, s, s);

  const stroke = rgbStr(color, 1);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (width: number): void => { ctx.lineWidth = Math.max(1, s * width); };
  const path = (points: readonly (readonly [number, number])[]): void => {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(px * s, py * s);
      else ctx.lineTo(px * s, py * s);
    });
    ctx.stroke();
  };

  switch (name) {
    case 'check':
      line(0.13);
      path([[0.22, 0.52], [0.42, 0.72], [0.78, 0.29]]);
      break;

    case 'cross':
      line(0.13);
      path([[0.28, 0.28], [0.72, 0.72]]);
      path([[0.72, 0.28], [0.28, 0.72]]);
      break;

    case 'chevron-left':
      line(0.12);
      path([[0.60, 0.24], [0.36, 0.50], [0.60, 0.76]]);
      break;

    case 'chevron-right':
      line(0.12);
      path([[0.40, 0.24], [0.64, 0.50], [0.40, 0.76]]);
      break;

    case 'plus':
      line(0.13);
      path([[0.26, 0.50], [0.74, 0.50]]);
      path([[0.50, 0.26], [0.50, 0.74]]);
      break;

    case 'info':
      line(0.10);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.31, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
      line(0.11);
      path([[0.50, 0.45], [0.50, 0.70]]);
      break;

    case 'help':
      line(0.12);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      line(0.12);
      ctx.beginPath();
      ctx.moveTo(s * 0.37, s * 0.38);
      ctx.bezierCurveTo(s * 0.37, s * 0.27, s * 0.63, s * 0.27, s * 0.63, s * 0.40);
      ctx.bezierCurveTo(s * 0.63, s * 0.50, s * 0.50, s * 0.50, s * 0.50, s * 0.59);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.71, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'settings': {
      const teeth = 8;
      const outerRadius = 0.39;
      const innerRadius = 0.29;
      ctx.beginPath();
      for (let index = 0; index < teeth * 2; index += 1) {
        const angle = -Math.PI / 2 + (index * Math.PI) / teeth;
        const radius = index % 2 === 0 ? outerRadius : innerRadius;
        const px = 0.5 + Math.cos(angle) * radius;
        const py = 0.5 + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(px * s, py * s);
        else ctx.lineTo(px * s, py * s);
      }
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'utility-rad': {
      line(0.08);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      for (let index = 0; index < 6; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI / 3;
        const inner = 0.23;
        const outer = 0.39;
        path([
          [0.5 + Math.cos(angle) * inner, 0.5 + Math.sin(angle) * inner],
          [0.5 + Math.cos(angle) * outer, 0.5 + Math.sin(angle) * outer],
        ]);
        ctx.beginPath();
        ctx.arc(
          s * (0.5 + Math.cos(angle) * outer),
          s * (0.5 + Math.sin(angle) * outer),
          s * 0.055,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }

    case 'lock': {
      // Buegel zuerst, damit der Koerper seine untere Haelfte verdeckt.
      line(0.10);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.44, s * 0.17, Math.PI, Math.PI * 2);
      ctx.stroke();
      roundRectPath(ctx, s * 0.26, s * 0.44, s * 0.48, s * 0.34, s * 0.07);
      ctx.fill();
      break;
    }

    case 'copy': {
      line(0.09);
      // Hinteres Blatt.
      roundRectPath(ctx, s * 0.36, s * 0.16, s * 0.44, s * 0.44, s * 0.09);
      ctx.stroke();
      // Flaeche des vorderen Blatts freistellen, sonst kreuzen sich beide Konturen.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      roundRectPath(ctx, s * 0.20, s * 0.40, s * 0.44, s * 0.44, s * 0.09);
      ctx.fill();
      ctx.restore();
      roundRectPath(ctx, s * 0.20, s * 0.40, s * 0.44, s * 0.44, s * 0.09);
      ctx.stroke();
      break;
    }

    case 'trophy': {
      line(0.09);
      // Kelch.
      ctx.beginPath();
      ctx.moveTo(s * 0.30, s * 0.18);
      ctx.lineTo(s * 0.70, s * 0.18);
      ctx.lineTo(s * 0.64, s * 0.50);
      ctx.quadraticCurveTo(s * 0.50, s * 0.60, s * 0.36, s * 0.50);
      ctx.closePath();
      ctx.stroke();
      // Henkel.
      ctx.beginPath();
      ctx.arc(s * 0.30, s * 0.28, s * 0.11, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.70, s * 0.28, s * 0.11, Math.PI * 1.5, Math.PI * 0.5);
      ctx.stroke();
      // Fuss.
      path([[0.50, 0.56], [0.50, 0.70]]);
      path([[0.34, 0.82], [0.66, 0.82]]);
      path([[0.40, 0.70], [0.60, 0.70]]);
      break;
    }

    case 'fullscreen-enter':
    case 'fullscreen-exit': {
      // Vier Eckklammern. `enter`: aussen sitzend, Arme zur Mitte. `exit`: nahe der Mitte,
      // Arme zu den Ecken – das uebliche Symmetriepaar eines Vollbild-Umschalters.
      const expand = name === 'fullscreen-enter';
      line(0.1);
      const arm = 0.24;
      const pad = expand ? 0.16 : 0.38;
      const corner = (vx: number, vy: number, ax: number, ay: number): void => {
        path([[vx + ax * arm, vy], [vx, vy], [vx, vy + ay * arm]]);
      };
      const dir = expand ? 1 : -1;
      corner(pad, pad, dir, dir);
      corner(1 - pad, pad, -dir, dir);
      corner(pad, 1 - pad, dir, -dir);
      corner(1 - pad, 1 - pad, -dir, -dir);
      break;
    }
  }

  ct.refresh();
  return key;
}

/**
 * Weiche Glasflaeche hinter den Lobby-Seitenspalten.
 *
 * Ohne sie steht der Text direkt auf dem Gras der Menuevorschau. Bewusst ohne Kontur: den
 * Rahmen bilden die Felszeilen der Vorschau, ein zweiter Rand daneben wirkt doppelt. Die
 * Kante zur Bildmitte laeuft aus, damit die Flaeche nicht als Kasten aufsetzt.
 *
 * `fadeEdge`: `right` blendet zur rechten Kante aus (linke Spalte), `left` umgekehrt.
 */
export function ensureGlassColumnTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  color: number, fadeEdge: 'left' | 'right',
  topAlpha = 0.62, bottomAlpha = 0.46,
  /** Anteil der Breite, ueber den die Innenkante ausblendet. */
  fadeRatio = 0.38,
): string {
  if (scene.textures.exists(key)) return key;

  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const ct = scene.textures.createCanvas(key, iw, ih);
  if (!ct) return key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, iw, ih);

  const vertical = ctx.createLinearGradient(0, 0, 0, ih);
  vertical.addColorStop(0, rgbStr(color, topAlpha));
  vertical.addColorStop(1, rgbStr(color, bottomAlpha));
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, iw, ih);

  // Auslaufende Kante: nimmt der Flaeche zur Bildmitte hin die Deckkraft.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const fadeWidth = Math.max(1, iw * fadeRatio);
  const fade = fadeEdge === 'right'
    ? ctx.createLinearGradient(iw - fadeWidth, 0, iw, 0)
    : ctx.createLinearGradient(fadeWidth, 0, 0, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, iw, ih);
  ctx.restore();

  ct.refresh();
  return key;
}

/** Sektions-Panel mit dezenter Farb-Toenung + farbigem Rand (wie der Upgrade-Inhaltsbereich). */
export function ensureTintedSectionTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  color: number, baseDark: number,
): string {
  if (scene.textures.exists(key)) return key;

  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const ct = scene.textures.createCanvas(key, iw, ih);
  if (!ct) return key;
  const ctx = ct.context;
  ctx.clearRect(0, 0, iw, ih);

  const radius = 16;
  const inset = 1.5;
  const rectW = iw - inset * 2;
  const rectH = ih - inset * 2;

  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  const grad = ctx.createLinearGradient(0, 0, 0, ih);
  grad.addColorStop(0, rgbStr(lerpColor(baseDark, color, 0.22), 0.92));
  grad.addColorStop(1, rgbStr(lerpColor(baseDark, color, 0.06), 0.96));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  ctx.clip();
  const rad = ctx.createRadialGradient(iw / 2, ih * 0.02, 0, iw / 2, ih * 0.02, iw * 0.62);
  rad.addColorStop(0, rgbStr(color, 0.16));
  rad.addColorStop(1, rgbStr(color, 0));
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, iw, ih);
  ctx.restore();

  roundRectPath(ctx, inset, inset, rectW, rectH, radius);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgbStr(color, 0.4);
  ctx.stroke();

  ct.refresh();
  return key;
}
