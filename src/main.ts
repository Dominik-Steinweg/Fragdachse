import * as Phaser from 'phaser';
import { bridge }         from './network/bridge';
import { NetworkBridge }  from './network/NetworkBridge';
import { PeerNetworkError } from './network/peer';
import { rejoinCurrentRoom, restartWithNewRoom }  from './utils/roomQuality';
import { ArenaScene }     from './scenes/ArenaScene';
import { initialRenderSize, installRenderResolution } from './graphics/RenderResolution';
import { FULLSCREEN_TARGET_ID, installFullscreenSupport } from './ui/fullscreen';
import { loadUiFonts } from './ui/uiFonts';
import { validateGameContentReferences } from './loadout/content/GameContentValidation';
import { BootScreen }     from './ui/BootScreen';
import { t } from './i18n';

/**
 * Zeigt einen Verbindungsfehler an, statt ein Spiel zu starten, das nicht spielbar waere.
 * Bewusst reines DOM: zu diesem Zeitpunkt laeuft noch kein Phaser.
 */
interface BootErrorOptions {
  readonly title?: string;
  readonly showRecoveryActions?: boolean;
}

function showBootError(message: string, canRejoin: boolean, options: BootErrorOptions = {}): void {
  BootScreen.dismissImmediate();
  const container = document.getElementById('game-container');
  if (!container) return;
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:16px', 'padding:32px',
    'font-family:monospace', 'color:#e8e2d4', 'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = options.title ?? t('ui.boot.connectionFailed');
  title.style.cssText = 'font-size:24px;font-weight:bold;color:#d98d3a';
  const detail = document.createElement('div');
  detail.textContent = message;
  detail.style.cssText = 'font-size:16px;max-width:560px;line-height:1.5';

  panel.append(title, detail);

  if (options.showRecoveryActions !== false) {
    // Ausdruecklicher Weg zurueck zu einem frischen Raum – ein blosser Reload wuerde bei einem
    // Client denselben, nicht mehr existierenden Raum erneut anwaehlen.
    if (canRejoin) {
      const rejoin = document.createElement('button');
      rejoin.textContent = t('ui.boot.rejoin');
      rejoin.style.cssText = [
        'padding:10px 18px', 'font-family:monospace', 'font-size:15px', 'font-weight:bold',
        'cursor:pointer', 'color:#e8e2d4', 'background:#31506a', 'border:1px solid #6389a8',
      ].join(';');
      rejoin.onclick = () => rejoinCurrentRoom();
      panel.appendChild(rejoin);
    }

    const restart = document.createElement('button');
    restart.textContent = t('ui.boot.newRoom');
    restart.style.cssText = [
      'padding:10px 18px', 'font-family:monospace', 'font-size:15px', 'font-weight:bold',
      'cursor:pointer', 'color:#e8e2d4', 'background:#3c5a3c', 'border:1px solid #6f9a6f',
    ].join(';');
    restart.onclick = () => restartWithNewRoom();
    panel.appendChild(restart);

    const hint = document.createElement('div');
    hint.textContent = t('ui.boot.rejoinHint');
    hint.style.cssText = 'font-size:14px;color:#8d8778';
    panel.appendChild(hint);
  }

  container.appendChild(panel);
}

function hasWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function isWebGLStartupError(error: unknown): boolean {
  return error instanceof Error && /webgl/i.test(error.message);
}

function installReconnectNotice(): void {
  const container = document.getElementById('game-container');
  if (!container) return;
  const notice = document.createElement('div');
  notice.textContent = t('ui.boot.reconnecting');
  notice.style.cssText = [
    'display:none', 'position:absolute', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
    'z-index:20', 'padding:10px 16px', 'font-family:monospace', 'font-size:15px',
    'font-weight:bold', 'color:#e8e2d4', 'background:rgba(30,24,18,.94)',
    'border:1px solid #d98d3a', 'pointer-events:none',
  ].join(';');
  container.appendChild(notice);
  bridge.onReconnectStatus((status) => {
    if (status.state === 'reconnecting') notice.style.display = 'block';
    else if (status.state === 'resumed' || status.state === 'failed') notice.style.display = 'none';
  });
}

function installPageLeave(): void {
  window.addEventListener('pagehide', () => bridge.leaveRoom(), { once: true });
}

async function boot(): Promise<void> {
  if (!hasWebGLSupport()) {
    showBootError(
      t('ui.boot.webglRequiredDetail'),
      false,
      { title: t('ui.boot.webglRequired'), showRecoveryActions: false },
    );
    return;
  }

  // Ausgelieferter Content muss vollständig konsistent sein, bevor Netzwerk oder Phaser starten.
  validateGameContentReferences();

  // Initialer Status während Verbindungsaufbau (Phase 1).
  BootScreen.setStatus(t('ui.boot.connecting'));
  BootScreen.setIndeterminate(true);

  // Die UI-Schriften starten *vor* dem Verbindungsaufbau und werden erst danach abgewartet:
  // beides laeuft dann nebeneinander, und der Start kostet keine zusaetzliche Zeit. Das
  // Warten ist zeitlich begrenzt und schlaegt nie fehl (siehe `ui/uiFonts`).
  const fontsReady = loadUiFonts();

  // 1. Raum eroeffnen oder dem Raum aus dem URL-Hash beitreten. Blockiert, bis die direkte
  //    WebRTC-Verbindung steht bzw. endgueltig gescheitert ist – es gibt keinen Fallback.
  await NetworkBridge.connect();

  // 2. Bridge aktivieren (einmalig – registriert Roster-Listener und RPC-Namen)
  bridge.activate();
  installReconnectNotice();
  installPageLeave();

  // 3. Phaser-Spiel starten – ERST nach stehender Verbindung und geladenen Schriften.
  BootScreen.setStatus(t('ui.boot.loadingData'));
  await fontsReady;
  const renderSize = initialRenderSize();
  const game = new Phaser.Game({
    type:            Phaser.WEBGL,
    width:           renderSize.width,
    height:          renderSize.height,
    parent:          FULLSCREEN_TARGET_ID,
    backgroundColor: '#000000',
    smoothPixelArt: true,
    physics: {
      default: 'arcade',
      arcade:  { gravity: { x: 0, y: 0 }, debug: false, fps: 120 },
    },
    scene: [ArenaScene],   // Einzige Szene – Lobby läuft als Overlay
    scale: {
      mode:       Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      // Der gesamte Container statt nur der Canvas – sonst bleiben alle DOM-Overlays im
      // Vollbild unsichtbar. Begruendung: `ui/fullscreen`.
      fullscreenTarget: FULLSCREEN_TARGET_ID,
    },
    dom: {
      createContainer: true
    }
  });

  // 4. Renderauflösung an die dargestellte Fläche binden und dort halten (Fenstergröße,
  //    Vollbild, Zoomstufe des Browsers). Erst ab READY – vorher hat der ScaleManager weder
  //    Canvas noch vermessene Eltern-Box, seine Anzeigegröße wäre also 0.
  game.events.once(Phaser.Core.Events.READY, () => {
    installRenderResolution(game);
    installFullscreenSupport(game);
  });
}

boot().catch((error: unknown) => {
  console.error(error);
  if (isWebGLStartupError(error)) {
    showBootError(
      t('ui.boot.webglRequiredDetail'),
      false,
      { title: t('ui.boot.webglRequired'), showRecoveryActions: false },
    );
    return;
  }
  showBootError(
    error instanceof PeerNetworkError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unerwarteter Fehler beim Start.',
    window.location.hash.startsWith('#r=')
      && (!(error instanceof PeerNetworkError) || error.kind !== 'invalid-room-code'),
  );
});
