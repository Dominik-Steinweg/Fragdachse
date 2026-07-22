import * as Phaser from 'phaser';
import { bridge }         from './network/bridge';
import { NetworkBridge }  from './network/NetworkBridge';
import { PeerNetworkError } from './network/peer';
import { ArenaScene }     from './scenes/ArenaScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';

/**
 * Zeigt einen Verbindungsfehler an, statt ein Spiel zu starten, das nicht spielbar waere.
 * Bewusst reines DOM: zu diesem Zeitpunkt laeuft noch kein Phaser.
 */
function showBootError(message: string): void {
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

  const hint = document.createElement('div');
  hint.textContent = 'Seite neu laden, um es erneut zu versuchen.';
  hint.style.cssText = 'font-size:14px;color:#8d8778';

  panel.append(title, detail, hint);
  container.appendChild(panel);
}

async function boot(): Promise<void> {
  // 1. Raum eroeffnen oder dem Raum aus dem URL-Hash beitreten. Blockiert, bis die direkte
  //    WebRTC-Verbindung steht bzw. endgueltig gescheitert ist – es gibt keinen Fallback.
  await NetworkBridge.connect();

  // 2. Bridge aktivieren (einmalig – registriert Roster-Listener und RPC-Namen)
  bridge.activate();

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
  showBootError(error instanceof PeerNetworkError
    ? error.message
    : 'Unerwarteter Fehler beim Verbindungsaufbau.');
});
