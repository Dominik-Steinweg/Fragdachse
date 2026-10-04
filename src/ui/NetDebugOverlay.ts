import { t } from '../i18n';
/**
 * Transportdiagnose als einblendbares Overlay (Taste P).
 *
 * Bewusst reines DOM statt Phaser: das Overlay soll auch dann noch etwas anzeigen, wenn im
 * Spiel selbst etwas klemmt, und Text ist hier billiger als Canvas-Objekte.
 *
 * Die angezeigten Werte sind Messwerte, keine Bewertung. Grenzwerte werden erst festgelegt,
 * wenn reale Zahlen mit den üblichen Mitspielern vorliegen.
 */
import { COLORS, toCssColor } from '../config';
import { getOverlayRoot } from './fullscreen';
import type { LinkDiagnostics } from '../network/peer';

const REFRESH_INTERVAL_MS = 500;

function formatMs(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Aggregat aus `NetworkBridge.getProjectileSyncMetrics()`; nur auf dem Host und nur mit Debug-Flag. */
interface ProjectileSyncMetrics {
  avgCharsPerTick: number;
  maxCharsPerTick: number;
  avgActiveCount: number;
  estimatedKbPerSec: number;
}

function describePath(diagnostics: LinkDiagnostics): string {
  const local = diagnostics.localCandidateType ?? '?';
  const remote = diagnostics.remoteCandidateType ?? '?';
  if (diagnostics.usesRelay) return t('ui.netDebug.relay', { local: local, remote: remote });
  if (diagnostics.localCandidateType === null) return t('ui.netDebug.detecting');
  return t('ui.netDebug.direct', { local: local, remote: remote });
}

export class NetDebugOverlay {
  private panel: HTMLDivElement | null = null;
  private timer: number | null = null;

  constructor(
    private readonly getDiagnostics: () => LinkDiagnostics[],
    private readonly getRoomCode: () => string,
    private readonly getLocalRole: () => string,
    private readonly getProjectileSyncMetrics: () => ProjectileSyncMetrics | null = () => null,
  ) {}

  toggle(): void {
    if (this.panel) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.panel !== null;
  }

  show(): void {
    if (this.panel || typeof document === 'undefined') return;

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      maxWidth: '560px',
      maxHeight: 'calc(100vh - 24px)',
      overflowY: 'auto',
      padding: '12px 14px',
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: 'rgba(12, 12, 12, 0.88)',
      color: toCssColor(COLORS.GREY_1),
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.5',
      whiteSpace: 'pre',
      zIndex: '4000',
      pointerEvents: 'none',
    });
    getOverlayRoot().appendChild(panel);
    this.panel = panel;

    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_INTERVAL_MS);
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.panel?.remove();
    this.panel = null;
  }

  destroy(): void {
    this.hide();
  }

  private render(): void {
    const panel = this.panel;
    if (!panel) return;

    const diagnostics = this.getDiagnostics();
    const lines: string[] = [
      t('ui.netDebug.header', { room: this.getRoomCode(), role: this.getLocalRole(), connections: diagnostics.length }),
      t('ui.netDebug.pingHint'),
      '',
    ];

    const projectileSync = this.getProjectileSyncMetrics();
    if (projectileSync) {
      lines.push(
        t('ui.netDebug.projectiles', { active: projectileSync.avgActiveCount.toFixed(1) })
          + t('ui.netDebug.charsPerTick', { chars: projectileSync.avgCharsPerTick.toFixed(0) })
          + t('ui.netDebug.maxChars', { chars: projectileSync.maxCharsPerTick })
          + t('ui.netDebug.bandwidth', { rate: projectileSync.estimatedKbPerSec.toFixed(1) }),
        '',
      );
    }

    if (diagnostics.length === 0) {
      lines.push(t('ui.netDebug.noPeers'));
    }

    for (const link of diagnostics) {
      const name = link.playerId.length > 0 ? link.playerId : `(Handshake ${link.peerId.slice(0, 12)})`;
      lines.push(
        `── ${name} ──`,
        t('ui.netDebug.path', { path: describePath(link) }),
        t('ui.netDebug.state', { pc: link.connectionState, ice: link.iceConnectionState }),
        t('ui.netDebug.channels', { reliable: link.reliableChannelState, fast: link.fastChannelState }),
        t('ui.netDebug.ping', { median: formatMs(link.medianRttMs), max: formatMs(link.maxRttMs), jitter: formatMs(link.jitterRttMs), count: link.rttSampleCount }),
        t('ui.netDebug.response', { median: formatMs(link.medianAppPingMs), max: formatMs(link.maxAppPingMs), jitter: formatMs(link.jitterAppPingMs), count: link.appPingSampleCount }),
        t('ui.netDebug.connect', { duration: formatMs(link.connectDurationMs), disconnects: link.disconnectCount }),
        t('ui.netDebug.volume', { sent: formatBytes(link.bytesSent), received: formatBytes(link.bytesReceived) }),
        t('ui.netDebug.buffer', { reliable: formatBytes(link.reliableBufferedBytes), fast: formatBytes(link.fastBufferedBytes) })
          + t('ui.netDebug.dropped', { backpressure: link.backpressure ? t('ui.netDebug.backpressure') : '', count: link.droppedFastMessages }),
        '',
      );
    }

    panel.textContent = lines.join('\n');
  }
}
