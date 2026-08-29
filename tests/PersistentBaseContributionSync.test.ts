import { afterEach, describe, expect, it } from 'vitest';
import { NetworkBridge } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { mergePersistentBaseComposite } from '../src/persistentBase/PersistentBaseComposite';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import type {
  PersistentConstruction,
  PersistentPlayerBaseContribution,
} from '../src/persistentBase/PersistentBaseTypes';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from './fakePeerNetwork';

/**
 * Phase 3B – der persoenliche Beitrag reist ueber die Raumgrenze.
 *
 * Abgesicherter Pflichtzustand: Ein Spieler bietet seinen Beitrag an, der Host validiert ihn und
 * entscheidet allein, was davon in seiner Welt steht. Ein Gast kann den Beitrag eines anderen
 * weder schreiben noch dessen Materialisierung erzwingen, und ein Konflikt beim Host aendert am
 * Besitz des Gastes nichts.
 */

const anchor = { gridX: 20, gridY: 20 };
const buildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA;

function bridgeFor(room: TestRoom): NetworkBridge {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PB3B' });
  const bridge = new NetworkBridge();
  bridge.activate();
  return bridge;
}

function useRoom(room: TestRoom): void {
  setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PB3B' });
}

function blueprint(persistentId: string, relativeGridX: number, relativeGridY = 0): PersistentConstruction {
  return {
    persistentId,
    tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX,
    relativeGridY,
    angle: 0,
    placementOrder: 0,
  };
}

function contribution(
  ownerId: string,
  constructions: readonly PersistentConstruction[],
  revision = 1,
): PersistentPlayerBaseContribution {
  return {
    schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
    ownerId,
    revision,
    constructions,
  };
}

afterEach(() => {
  clearActiveSession();
});

describe('Persoenlicher Basisbeitrag – Angebot ueber die Raumgrenze', () => {
  it('traegt den Beitrag eines Gastes zum Host und laesst dort den Host gewinnen', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();

      // A bietet seinen persoenlichen Beitrag an - mehr kann ein Gast nicht tun.
      useRoom(clientRoom);
      const guestContribution = contribution('owner-a', [blueprint('a-x', 0, 0)], 7);
      client.offerPersistentBaseContribution(guestContribution);

      useRoom(hostRoom);
      const received = host.getPlayerPersistentBaseContribution(clientId);
      expect(received).toEqual(guestContribution);

      // B validiert und mischt. Auf derselben Zelle steht bereits ein eigenes Objekt.
      const store = new PersistentBaseContributionStore();
      store.offerContribution(contribution('owner-b', [blueprint('b-own', 0, 0)], 2));
      store.offerContribution(received!);

      const result = mergePersistentBaseComposite({
        anchor,
        buildArea,
        hostContribution: store.getContribution('owner-b'),
        guestContributions: [store.getContribution('owner-a')!],
        resolveTool: () => ({ footprint: [{ dx: 0, dy: 0 }], capacityCost: 1 }),
      });

      // Bs Objekt gewinnt, X erscheint nicht ...
      expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['b-own']);
      expect(result.conflicts).toEqual([
        { ownerId: 'owner-a', persistentId: 'a-x', toolId: 'rock_barrier', reason: 'collision' },
      ]);
      // ... bleibt aber unveraendert in As Beitrag stehen.
      expect(store.getContribution('owner-a')?.constructions.map((entry) => entry.persistentId))
        .toEqual(['a-x']);
      useRoom(clientRoom);
      expect(client.getConfirmedPersistentBaseContribution()).toBeNull();
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('erscheint im Composite, sobald die Zelle frei ist', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();

      useRoom(clientRoom);
      client.offerPersistentBaseContribution(contribution('owner-a', [blueprint('a-x', 1, 1)], 7));

      useRoom(hostRoom);
      const store = new PersistentBaseContributionStore();
      store.offerContribution(contribution('owner-b', [blueprint('b-own', 0, 0)], 2));
      store.offerContribution(host.getPlayerPersistentBaseContribution(clientId)!);

      const result = mergePersistentBaseComposite({
        anchor,
        buildArea,
        hostContribution: store.getContribution('owner-b'),
        guestContributions: [store.getContribution('owner-a')!],
        resolveTool: () => ({ footprint: [{ dx: 0, dy: 0 }], capacityCost: 1 }),
      });

      expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['b-own', 'a-x']);
      expect(result.conflicts).toEqual([]);
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('verwirft eine ungueltige Nutzlast vollstaendig statt sie halb zu uebernehmen', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();

      // Ein manipulierter Client schreibt direkt in seinen per-player State.
      useRoom(clientRoom);
      clientRoom.room.getPlayerHandle(clientId)!.setState('pbo', {
        schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
        ownerId: 'owner-a',
        revision: -5,
        constructions: [],
      }, true);

      useRoom(hostRoom);
      expect(host.getPlayerPersistentBaseContribution(clientId)).toBeNull();
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });
});

describe('Persoenlicher Basisbeitrag – host-bestaetigter Commit', () => {
  it('stellt jedem Besitzer genau seinen eigenen bestaetigten Stand zu', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();

      useRoom(hostRoom);
      const confirmed = contribution('owner-a', [blueprint('a-x', 1, 1)], 8);
      host.hostConfirmPersistentBaseContribution(clientId, confirmed);

      useRoom(clientRoom);
      // Nur ein host-bestaetigter Stand darf lokal fortgeschrieben werden.
      expect(client.getConfirmedPersistentBaseContribution()).toEqual(confirmed);
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('haelt host-bestaetigte Zustandsuebertragung als per-player State fuer spaete Clients vor', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);
      const clientId = client.getLocalPlayerId();
      const confirmed = contribution('owner-a', [blueprint('late-join', 2, 1)], 11);

      useRoom(hostRoom);
      host.hostConfirmPersistentBaseContribution(clientId, confirmed);

      // Das ist ein Zustand statt eines einmaligen Events: ein erneuter Bridge-Aufbau kann die
      // Bestaetigung weiterhin lesen und damit den lokalen Save monoton fortschreiben.
      useRoom(clientRoom);
      expect(client.getConfirmedPersistentBaseContribution()).toEqual(confirmed);
      expect(client.getConfirmedPersistentBaseContribution()).toEqual(confirmed);
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });

  it('laesst einen Gast keine Bestaetigung fuer sich selbst aussprechen', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    const clientRoom = await addClientRoom(network);
    try {
      bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);

      useRoom(clientRoom);
      // Der Aufruf ist host-only; beim Gast passiert schlicht nichts.
      client.hostConfirmPersistentBaseContribution(
        client.getLocalPlayerId(),
        contribution('owner-a', [blueprint('self-granted', 1, 1)], 99),
      );
      expect(client.getConfirmedPersistentBaseContribution()).toBeNull();
    } finally {
      hostRoom.room.leave();
      clientRoom.room.leave();
    }
  });
});
