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

function describePath(diagnostics: LinkDiagnostics): string {
  const local = diagnostics.localCandidateType ?? '?';
  const remote = diagnostics.remoteCandidateType ?? '?';
  if (diagnostics.usesRelay) return `RELAY (${local}/${remote}) – Konfigurationsfehler`;
  if (diagnostics.localCandidateType === null) return 'wird ermittelt…';
  return `direkt (${local}/${remote})`;
}

export class NetDebugOverlay {
  private panel: HTMLDivElement | null = null;
  private timer: number | null = null;

  constructor(
    private readonly getDiagnostics: () => LinkDiagnostics[],
    private readonly getRoomCode: () => string,
    private readonly getLocalRole: () => string,
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
    document.body.appendChild(panel);
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
      `NETZ  Raum ${this.getRoomCode()}  Rolle ${this.getLocalRole()}  Verbindungen ${diagnostics.length}`,
      'Ping = Netzwerk-RTT (STUN, bildratenunabhängig) · Reaktion = Umlauf durch beide Spielschleifen',
      '',
    ];

    if (diagnostics.length === 0) {
      lines.push('Keine Mitspieler verbunden.');
    }

    for (const link of diagnostics) {
      const name = link.playerId.length > 0 ? link.playerId : `(Handshake ${link.peerId.slice(0, 12)})`;
      lines.push(
        `── ${name} ──`,
        `  Pfad        ${describePath(link)}`,
        `  Zustand     pc=${link.connectionState}  ice=${link.iceConnectionState}`,
        `  Kanäle      rel=${link.reliableChannelState}  fast=${link.fastChannelState}`,
        `  Ping (Netz) Median ${formatMs(link.medianRttMs)}  Max ${formatMs(link.maxRttMs)}  Jitter ${formatMs(link.jitterRttMs)}  (n=${link.rttSampleCount})`,
        `  Reaktion    Median ${formatMs(link.medianAppPingMs)}  Max ${formatMs(link.maxAppPingMs)}  Jitter ${formatMs(link.jitterAppPingMs)}  (n=${link.appPingSampleCount})`,
        `  Aufbau      ${formatMs(link.connectDurationMs)}  Abbrüche ${link.disconnectCount}`,
        `  Volumen     ↑${formatBytes(link.bytesSent)}  ↓${formatBytes(link.bytesReceived)}`,
        `  Puffer      rel=${formatBytes(link.reliableBufferedBytes)}  fast=${formatBytes(link.fastBufferedBytes)}`
          + `${link.backpressure ? '  RÜCKSTAU' : ''}  verworfen ${link.droppedFastMessages}`,
        '',
      );
    }

    panel.textContent = lines.join('\n');
  }
}
