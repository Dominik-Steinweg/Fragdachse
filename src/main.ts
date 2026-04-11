import * as Phaser from 'phaser';
import { bridge }         from './network/bridge';
import { NetworkBridge }  from './network/NetworkBridge';
import { ArenaScene }     from './scenes/ArenaScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';

async function boot(): Promise<void> {
  // 1. insertCoin() blockiert bis der Spieler die Playroom-Lobby bestätigt
  await NetworkBridge.initializeLobby();

  // 2. Bridge aktivieren (einmalig – registriert onPlayerJoin-Listener)
  bridge.activate();

  // 3. Phaser-Spiel starten – ERST nach abgeschlossenem insertCoin()
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

boot().catch(console.error);
