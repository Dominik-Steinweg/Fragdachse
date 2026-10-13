import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import type { FireControlSnapshot } from '../../src/systems/fireControl/FireControlSnapshot';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';

/** Real bridge/room/bootstrap composition from TimeBubbleNetwork; no fabricated fc wire API. */
async function fixture() {
  const network = new FakeNetwork();
  const rooms: TestRoom[] = [];
  // FakeTransport implements message delivery; native WebRTC diagnostic fields are not used here.
  const use = (room: TestRoom) => setActiveSession({ room: room.room,
    transport: room.transport as unknown as Parameters<typeof setActiveSession>[0]['transport'], roomCode: 'FIRE-CONTROL' });
  const connect = (room: TestRoom) => { use(room); const bridge = new NetworkBridge(); bridge.activate(); return bridge; };
  const destroy = () => { clearActiveSession(); for (const room of [...rooms].reverse()) room.room.destroy(); };
  try {
    const hostRoom = await createHostRoom(network); rooms.push(hostRoom);
    const host = connect(hostRoom);
    const world = { worldRevision: 1, definitionId: 'world:lobby', seed: 1,
      generatorVersion: 3, layoutFingerprint: 'fire-control-test' };
    host.publishLobbySync(); host.publishWorldAndActivity(world, null);
    const join = async () => {
      const room = await addClientRoom(network); rooms.push(room);
      return { room, bridge: connect(room) };
    };
    const client = await join();
    const state: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime: 0, players: {}, projectiles: null, enemies: null, rocks: null,
      placeableRocks: [], reinforcementMatrices: [], energyInjectorEffects: [], energyInjectorFocus: [],
      remoteControlTurrets: [], decoys: [], smokes: [], fires: [], powerups: null, pedestals: null,
      nukes: [], mortarStrikes: [], airstrikes: [], meteors: [], tunnels: [], train: null, bases: [], captureTheBeer: null,
      coopDefenseCarry: [], stinkClouds: [], timeBubbles: [], teslaDomes: [], energyShields: [],
      guardianSpirits: [], repairDrones: [], slimeTrail: { cells: [], affectedEnemies: [] },
      targetVulnerabilities: [], ak47StrategicTargets: [], burningGround: { cells: [] },
    };
    return { host, hostRoom, client, state, world, join, use, destroy,
      publish(next = state, full = false) {
        use(hostRoom); host.publishGameState(next, full); hostRoom.room.update(); use(client.room);
      },
      changeWorld() { use(hostRoom); host.publishWorldAndActivity({ ...world, worldRevision: world.worldRevision + 1 }, null); },
    };
  } catch (error) { destroy(); throw error; }
}

// Synthetic snapshot facts, not authored tuning. Mutable replacement objects allow delta cases.
function snapshot(): FireControlSnapshot {
  return { deployments: [
    { id: 1, kind: 'copies', ownerId: 'inspector', ownerColor: 0xffffff, x: 300, y: 100,
      startedAt: 1000, expiresAt: 9000, parallel: false, copies: [
        { sourceId: 'fc-copy:1:0', originalId: 7, constructionId: 'machine_gun_turret', weaponId: 'TURRET_MG',
          x: 300, y: 100, angle: 0.3, status: 'materializing', materializedAt: 1400, originalPaused: true },
      ] },
    { id: 2, kind: 'portal', ownerId: 'inspector', ownerColor: 0xffffff, x: 700, y: 100,
      startedAt: 1100, expiresAt: 6000, localFireRelease: true, entries: [
        { sourceId: 8, identityId: 8, mode: 'portal', x: 20, y: 0, angle: 0.3, lastTransportAt: 1200 },
      ] },
  ] };
}

describe('Ausführbarer Netzwerk-Fixture-Baustein', () => {
  it('Arrange: Host und Client in einer World; Act: Full-State publizieren, spät beitreten und World wechseln; Assert: beide Empfänger erhalten Bootstrap und verwerfen alten World-State', async () => {
    const f = await fixture();
    try {
      f.publish(f.state, true);
      expect(f.client.bridge.getLatestGameState()?.roundStartTime).toBe(f.state.roundStartTime);
      f.client.bridge.flushNetwork();
      const late = await f.join();
      expect(late.bridge.getLatestGameState()?.roundStartTime).toBe(f.state.roundStartTime);
      f.changeWorld();
      f.use(f.client.room); expect(f.client.bridge.getLatestGameState()).toBeUndefined();
      f.use(late.room); expect(late.bridge.getLatestGameState()).toBeUndefined();
    } finally { f.destroy(); }
  });
});

describe.skip('Fixture-Entwurf: FireControlSnapshot → fc → FullGameStateBootstrap', () => {
  // M1: fc in GameState/Wire-Schema/Bootstrap/NetworkBridge aufnehmen; keine casts auf erfundene APIs.
  // Dann fixture().publish mit snapshot() als echtem fc-Slice verbinden und Empfänger auslesen.
  // M2: aktive Kopien sowie portal/waiting/local und turretVisualId in denselben Harness aufnehmen.
  // fixture() und snapshot() sind bereits getrennte, ausführbare Bausteine.
  it.todo('Arrange: fixture() mit snapshot() und vergangener Materialisierung; Act: fc über den echten Bridge-Pfad publizieren; Assert: Client liest alle bestätigten Fakten und absolute Zeiten unverändert');
});

describe('Entfernen von Quellen, Einsatzende, Besitzerentfernung und World-Wechsel hinterlassen weder Portale noch Pausen; Clients und Late Join sehen den richtigen Zustand', () => {
  // M1: echter fc-Slice inklusive Pflichtfeld im Full-Snapshot fehlt.
  it.todo('Arrange: Host mit materialisierender Kopie und pausiertem Original; Act: vollständigen State senden; Assert: Client erhält identische Einsatz-ID, Original-ID, Winkel, Status, originalPaused und absolutes expiresAt');
  it.todo('Arrange: bestätigter Kopienzustand; Act: Materialisierung und Winkeländerung als Delta senden; Assert: Client aktualisiert dieselbe Quelle ohne duplizierte Kopie oder neue Laufzeit');
  it.todo('Arrange: bereits laufender Einsatz und spätere synchronisierte Host-Zeit; Act: Late Join ohne erneute Aktivierung; Assert: Bootstrap enthält fc und Restlaufzeit ist expiresAt minus Host-Zeit statt voller Einsatzdauer');
  it.todo('Arrange: leere Feuerleitung; Act: FullGameStateBootstrap senden; Assert: fc ist als expliziter leerer Snapshot vorhanden und braucht keine rekonstruierte Konfiguration');
  it.todo('Arrange: Einsätze zweier Besitzer auf Host, Client und Late Join; Act: Quelle entfernen, Einsatz auslaufen lassen und Besitzer entfernen; Assert: alle drei sehen dieselben verbleibenden Einsätze ohne verwaiste Pausen');
  it.todo('Arrange: replizierte aktive Einsätze; Act: Activity-Bindings leeren und leeren fc-State publizieren; Assert: bestehende Clients und danach beitretender Client sehen keine Einsätze oder Pausen');
  it.todo('Arrange: replizierte aktive Einsätze; Act: World wechseln und altes World-Paket nachliefern; Assert: kein Empfänger reaktiviert alte Kopien, Eingänge oder Pausen');
  it.todo('Arrange: Client mit bestätigtem fc-State; Act: lokal einen abweichenden Zustand anbieten ohne Host-Aktivierung; Assert: Host-Zustand und spätere Replikation bleiben unverändert');
  // M2: Portal-Owner, Modi und Projektil-Darstellungsfelder fehlen.
  it.todo('Arrange: Portalquellen in portal, waiting und local; Act: Full-State und Moduswechsel senden; Assert: Client und Late Join übernehmen Modi, Eingangswinkel und lastTransportAt exakt');
  it.todo('Arrange: parallele Kopie und Original mit verschiedenen visualIds; Act: Schüsse replizieren; Assert: sourceTurretId bleibt Original, turretVisualId und flameStreamKey bleiben quellenspezifisch');
});
