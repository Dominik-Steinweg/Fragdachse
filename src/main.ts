import * as Phaser from 'phaser';
import { bridge }         from './network/bridge';
import { NetworkBridge }  from './network/NetworkBridge';
import { PeerNetworkError } from './network/peer';
import { rejoinCurrentRoom, restartWithNewRoom }  from './utils/roomQuality';
import { ArenaScene }     from './scenes/ArenaScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';

/**
 * Zeigt einen Verbindungsfehler an, statt ein Spiel zu starten, das nicht spielbar waere.
 * Bewusst reines DOM: zu diesem Zeitpunkt laeuft noch kein Phaser.
 */
function showBootError(message: string, canRejoin: boolean): void {
  const container = document.getElementById('game-container');
  if (!container) return;
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:16px', 'padding:32px',
    'font-family:monospace', 'color:#e8e2d4', 'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Verbindung fehlgeschlagen';
  title.style.cssText = 'font-size:24px;font-weight:bold;color:#d98d3a';

  const detail = document.createElement('div');
  detail.textContent = message;
  detail.style.cssText = 'font-size:16px;max-width:560px;line-height:1.5';

  panel.append(title, detail);

  // Ausdruecklicher Weg zurueck zu einem frischen Raum – ein blosser Reload wuerde bei einem
  // Client denselben, nicht mehr existierenden Raum erneut anwaehlen.
  if (canRejoin) {
    const rejoin = document.createElement('button');
    rejoin.textContent = 'ERNEUT BEITRETEN';
    rejoin.style.cssText = [
      'padding:10px 18px', 'font-family:monospace', 'font-size:15px', 'font-weight:bold',
      'cursor:pointer', 'color:#e8e2d4', 'background:#31506a', 'border:1px solid #6389a8',
    ].join(';');
    rejoin.onclick = () => rejoinCurrentRoom();
    panel.appendChild(rejoin);
  }

  const restart = document.createElement('button');
  restart.textContent = 'NEUEN RAUM ERÖFFNEN';
  restart.style.cssText = [
    'padding:10px 18px', 'font-family:monospace', 'font-size:15px', 'font-weight:bold',
    'cursor:pointer', 'color:#e8e2d4', 'background:#3c5a3c', 'border:1px solid #6f9a6f',
  ].join(';');
  restart.onclick = () => restartWithNewRoom();
  panel.appendChild(restart);

  const hint = document.createElement('div');
  hint.textContent = 'Zum erneuten Beitreten die Einladung noch einmal öffnen.';
  hint.style.cssText = 'font-size:14px;color:#8d8778';
  panel.appendChild(hint);

  container.appendChild(panel);
}

function installReconnectNotice(): void {
  const container = document.getElementById('game-container');
  if (!container) return;
  const notice = document.createElement('div');
  notice.textContent = 'Verbindung wird wiederhergestellt…';
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

async function boot(): Promise<void> {
  // 1. Raum eroeffnen oder dem Raum aus dem URL-Hash beitreten. Blockiert, bis die direkte
  //    WebRTC-Verbindung steht bzw. endgueltig gescheitert ist – es gibt keinen Fallback.
  await NetworkBridge.connect();

  // 2. Bridge aktivieren (einmalig – registriert Roster-Listener und RPC-Namen)
  bridge.activate();
  installReconnectNotice();

  // 3. Phaser-Spiel starten – ERST nach stehender Verbindung
  new Phaser.Game({
    type:            Phaser.AUTO,
    width:           GAME_WIDTH,
    height:          GAME_HEIGHT,
    parent:          'game-container',
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
    },
    dom: {
      createContainer: true
    }
  });
}

boot().catch((error: unknown) => {
  console.error(error);
  showBootError(
    error instanceof PeerNetworkError
      ? error.message
      : 'Unerwarteter Fehler beim Verbindungsaufbau.',
    window.location.hash.startsWith('#r=')
      && (!(error instanceof PeerNetworkError) || error.kind !== 'invalid-room-code'),
  );
});
