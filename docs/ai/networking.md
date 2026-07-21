# Networking

Netzwerkänderungen immer gegen `src/network/NetworkBridge.ts`, `src/network/GameplayTransportChannel.ts`, die Codecs und passende Tests prüfen. Wire-Keys und Merge-Semantik sind interne Verträge und dürfen nicht beiläufig geändert werden.

## Bibliothek und Verbindungsmodell

Das Projekt verwendet `playroomkit` exakt in Version 0.0.97. Nur `src/network/NetworkBridge.ts` importiert es direkt. `NetworkBridge.initializeLobby()` ruft `insertCoin({ maxPlayersPerRoom: 12, skipLobby: true })` auf: Playroom stellt Raum/Teilnehmer bereit, während `LobbyOverlay` die eigene Vorspiel-UI übernimmt. `activate()` registriert den einmaligen Join-Listener; Scene-Callbacks erhalten bereits verbundene Spieler per Replay.

PlayroomKit abstrahiert die konkrete Verbindung und wirbt mit automatischem Wechsel zwischen WebRTC und WebSockets. Der Projektcode konfiguriert keine nativen PeerConnections oder DataChannels selbst. Direkte Verbindungen sind besonders für schnelles Gameplay und LAN-Runden das Ziel, aber nicht als garantiertes Transportdetail anzunehmen; Fallbacks müssen funktionsfähig bleiben.

## Host und Ownership

Ein Playroom-Spieler ist Host. Der Host besitzt die autoritative Simulation: Positionen, Treffer, Schaden, Ressourcen, Spawns, Gegner, Rundenzustand, Arena-Layout und Ergebnisse. Clients senden Input oder Aktionsanforderungen. Lokale Prediction verbessert das Feedback, entscheidet aber keine autoritativen Folgen.

Der Bridge-Layer verwendet zwei zentrale RPC-Kanäle:

- `rpc_host`: Client → Host für fachliche Commands und Requests.
- `rpc_all`: Broadcast für kurzlebige Ereignisse und Fallbacks.

`RpcCoordinator` bindet Gameplay-Handler an die fachliche Bridge-API. Neue direkte `RPC.register`-/`RPC.call`-Nutzung außerhalb der Bridge vermeiden.

## Zuverlässig und unzuverlässig

`setState(key, value, true)` ist für seltene, ordnungs- oder startkritische Daten vorgesehen, darunter Spielphase, Modus/Map, Arena-Layout, Zeitbasen, Lobby-Snapshot, committed Loadouts, Teams und Rundenergebnisse.

Häufige oder ersetzbare Daten verwenden `reliable = false`: lokaler Input, Ping, der kompakte Game-State und der schnelle Command/Event-Kanal. Kurzlebige visuelle Ereignisse laufen je nach Pfad als RPC/Broadcast oder über den schnellen Kanal. Keine großen, schnell wechselnden Daten ohne Prüfung in zuverlässige Einzelzustände verschieben.

## Gameplay-Transportmodi

Der Host wählt in der Lobby zuverlässig `fast` oder `rpc`; Default ist `fast`.

- `rpc`: Commands wie Loadout-Nutzung, Pickup, Dash und Burrow gehen direkt über Host-RPCs.
- `fast`: `GameplayTransportChannel` veröffentlicht sequenzierte Batches über unzuverlässige Player-/Global-States. Epochs verhindern Verwechslungen über Resets, Acks und deduplizierte Sequenzen liefern geordnete Verarbeitung. Unbestätigte Batches werden nach 50 ms erneut publiziert und nach 180 ms zusätzlich über RPC zugestellt; Nachrichten altern nach 2 s aus. Der RPC-Fallback ist Bestandteil des Designs, kein optionaler Debugpfad.

Der Transport wird bei Phasenwechseln zurückgesetzt. Änderungen an Sequenz-, Ack-, Epoch- oder Fallbacklogik zusammen mit `tests/GameplayTransportChannel.test.ts` prüfen.

## Zustandsreplikation

Der Host veröffentlicht bei `NET_TICK_RATE_HZ = 20` einen einzelnen kompakten `KEY_GAME_STATE`-Payload. `playerStateCodec.ts` komprimiert Spielerzustände. Gegner verwenden `enemySnapshotCodec.ts` und `SyncedEnemySnapshot` mit Full-/Delta-Upserts und sticky Removals. Weitere Slices lassen leere/unveränderte Daten aus und werden clientseitig gegen den letzten Stand gemerged; Felsen, Power-ups, Pedestals und brennender Boden besitzen eigene Delta-/Full-Resync-Regeln.

Clients erkennen neue Payloads über eine monotone Sequenz, mergen Slices, extrapolieren Projektile und glätten Entity-Ziele (`NET_SMOOTH_TIME_MS = 80`). Beim Arena-Aufbau muss der Merge-Cache zurückgesetzt werden. Fehlend bedeutet bei Delta-Slices häufig „unverändert“, nicht automatisch „leer“.

Treffer- und Zeitgefühl werden zusätzlich durch synchronisierte Host-Zeit, Ping-/Raumqualitätsmessung und begrenztes Favor-the-shooter-Hitscan-Verhalten unterstützt. Niedrige Reaktionszeit ist ein Kernziel; Bandbreite, Garbage-Erzeugung und zusätzliche zuverlässige Roundtrips bei Änderungen bewusst bewerten.

## Referenzen

- Grenze und Wire-Formate: `src/network/NetworkBridge.ts`
- Schneller Kanal: `src/network/GameplayTransportChannel.ts`
- Ping/Zeitsynchronisation: `src/network/NetworkPingController.ts`
- Raumqualität: `src/network/RoomQualityMonitor.ts`
- Codecs: `src/network/playerStateCodec.ts`, `src/network/enemySnapshotCodec.ts`
- Host-Publikation: `src/scenes/arena/HostUpdateCoordinator.ts`
- Client-Merge/Interpolation: `src/scenes/arena/ClientUpdateCoordinator.ts`
