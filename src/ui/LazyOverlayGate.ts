import type * as Phaser from 'phaser';
import { t } from '../i18n';
import { getOverlayRoot } from './fullscreen';
import { getOverlayAssets, type OverlayAssetGroup } from './OverlayAssets';

/** What a gated view waits for: its deferred images, or other preparation such as a World. */
export interface LazyOverlaySource {
  ready(): boolean;
  ensure(): Promise<void>;
  /** Waiting text; the deferred-content text by default. */
  readonly label?: string;
  /** Spinner and text at once, for preparation that blocks the main thread right away. The
   * spinner is a compositor animation, so it keeps turning while that work runs. */
  readonly immediate?: boolean;
  /** Read every frame while waiting: what is being done now, and the share of counted work done. */
  status?(): LazyOverlayStatus | null;
}

export interface LazyOverlayStatus {
  readonly label?: string;
  /** 0 … 1 of work that is counted, never an estimated time. */
  readonly progress?: number;
}

/** A pending request is already modal. Cancellation invalidates only the opening,
 * not shared downloads; a later opening may reuse their completed textures.
 */
export class LazyOverlayGate {
  private generation = 0;
  private pending = false;
  private panel: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private previousFocus: HTMLElement | null = null;
  private spinner: Animation | null = null;
  private label: HTMLParagraphElement | null = null;
  private bar: HTMLDivElement | null = null;
  private barFill: HTMLDivElement | null = null;
  private status: (() => LazyOverlayStatus | null) | null = null;
  private revealed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private bound = false;
  private close: (() => void) | null = null;
  private padPressed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly source: OverlayAssetGroup | LazyOverlaySource,
    private readonly canOpen: () => boolean) {}

  isPending(): boolean { return this.pending; }

  open(show: () => void, close: () => void, unavailable?: () => void): void {
    if (this.disposed || !this.canOpen()) { unavailable?.(); return; }
    if (!this.bound) {
      this.bound = true;
      this.scene.events.once('shutdown', () => { this.disposed = true; this.cancel(); });
    }
    this.cancel();
    const source = this.resolveSource();
    if (source.ready()) { show(); return; }
    const waiting = source.label ?? t('ui.lobby.deferredLoading');
    const generation = this.generation;
    this.pending = true;
    this.close = close;
    this.unavailable = unavailable ?? null;
    this.padPressed = this.readPadCancel();
    window.addEventListener('keydown', this.onKey, true);
    this.scene.events.on('update', this.checkContext, this);
    // DOM overlays share the fullscreen root. Native focus and a modal keyboard
    // boundary work while none of the expensive Phaser views exist yet.
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.panel = document.createElement('div');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', waiting);
    this.panel.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:16px;background:#101610aa;color:#fff;font:16px sans-serif';
    this.label = document.createElement('p');
    this.label.setAttribute('role', 'status');
    this.label.style.cssText = 'margin:0;max-width:32em;text-align:center';
    const spinner = document.createElement('span');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.cssText = 'width:20px;height:20px;border:2px solid #ffffff40;border-top-color:white;'
      + 'border-radius:50%;visibility:hidden';
    this.button = document.createElement('button');
    this.button.textContent = t('ui.common.cancel');
    this.button.style.cssText = 'padding:10px 20px;border:1px solid #aec49b;border-radius:6px;'
      + 'background:#293027;color:white;font:inherit;cursor:pointer';
    this.button.addEventListener('click', () => this.close?.());
    // The bar sits between text and button (flex order), after them in the DOM.
    this.button.style.order = '2';
    this.bar = document.createElement('div');
    this.bar.setAttribute('aria-hidden', 'true');
    this.bar.style.cssText = 'order:1;width:260px;height:4px;border-radius:2px;background:#ffffff26;overflow:hidden;visibility:hidden';
    this.barFill = document.createElement('div');
    this.barFill.style.cssText = 'height:100%;width:0%;background:#d6e9a2;transition:width .2s linear';
    this.bar.append(this.barFill);
    this.status = source.status ? () => source.status!() : null;
    this.panel.append(spinner, this.label, this.button, this.bar);
    getOverlayRoot().appendChild(this.panel);
    this.button.focus({ preventScroll: true });
    const reveal = () => {
      if (this.label) this.label.textContent = waiting;
      this.revealed = true;
      this.syncStatus();
      spinner.style.visibility = 'visible';
      this.spinner = spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { duration: 900, iterations: Infinity });
    };
    if (source.immediate) reveal();
    else this.timer = setTimeout(() => { this.timer = null; reveal(); }, 150);
    void source.ensure().then(() => {
      if (!this.pending || this.generation !== generation) return;
      const allowed = this.canOpen(); this.cancel();
      if (allowed && !this.disposed) show();
      else unavailable?.();
    }, () => {
      if (!this.pending || this.generation !== generation) return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.spinner?.cancel(); this.spinner = null;
      this.status = null;
      if (this.bar) this.bar.style.visibility = 'hidden';
      if (this.label) this.label.textContent = t('ui.lobby.deferredFailed');
      // Cancel remains available; reopening retries without exposing fallback icons.
    });
  }

  cancel(): void {
    this.generation++; this.pending = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.close = null;
    this.unavailable = null;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKey, true);
    this.scene.events.off('update', this.checkContext, this);
    this.spinner?.cancel(); this.spinner = null;
    const restoreFocus = this.panel?.contains(document.activeElement) ?? false;
    this.panel?.remove(); this.panel = null; this.label = null; this.button = null;
    this.bar = null; this.barFill = null; this.status = null; this.revealed = false;
    if (restoreFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.previousFocus = null;
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.pending || event.key === 'F11') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Tab') this.button?.focus({ preventScroll: true });
    if (!event.repeat && (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ')) this.close?.();
  };

  private readPadCancel(): boolean {
    // Standard A confirms the only action (Cancel); B goes back. Edge-triggering
    // prevents the button held while opening from immediately dismissing the gate.
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    try {
      return Array.from(navigator.getGamepads()).some(pad => pad?.mapping === 'standard'
        && (pad.buttons[0]?.pressed || pad.buttons[1]?.pressed));
    } catch { return false; } // Browser policy may disable Gamepad access.
  }

  private unavailable: (() => void) | null = null;

  private resolveSource(): LazyOverlaySource {
    if (typeof this.source !== 'string') return this.source;
    const assets = getOverlayAssets(this.scene), group = this.source;
    return { ready: () => assets.ready(group), ensure: () => assets.ensure(group) };
  }

  /** The source's current step and counted progress, once the panel shows its text. */
  private syncStatus(): void {
    const status = this.revealed ? this.status?.() : null;
    if (!status) return;
    if (status.label && this.label && this.label.textContent !== status.label) {
      this.label.textContent = status.label;
      this.panel?.setAttribute('aria-label', status.label);
    }
    if (status.progress !== undefined && this.bar && this.barFill) {
      this.bar.style.visibility = 'visible';
      this.barFill.style.width = `${Math.round(Math.max(0, Math.min(1, status.progress)) * 100)}%`;
    }
  }

  private checkContext(): void {
    if (!this.canOpen()) { const unavailable = this.unavailable; this.cancel(); unavailable?.(); return; }
    this.syncStatus();
    const pressed = this.readPadCancel();
    if (pressed && !this.padPressed) this.close?.();
    this.padPressed = pressed;
  }
}
