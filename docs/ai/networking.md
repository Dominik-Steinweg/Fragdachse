# Networking

Netzwerkänderungen gegen src/network/NetworkBridge.ts, src/network/peer/, src/types.ts und die passenden Tests prüfen. Wire-Keys, Nachrichtentypen und Merge-Regeln sind Verträge.

## Schichten und Transport

NetworkBridge ist die fachliche Grenze. PeerRoom besitzt Roster, Store und RPC; PeerLink besitzt Kanäle, Parser, Liveness und Backpressure; PeerJsTransport eröffnet Räume und Links. Nur PeerJsTransport.ts importiert peerjs. PeerJS dient für Signaling und ICE, nicht als Spiel-Datenmodell.

Ein Link hat zwei semantisch getrennte Kanäle:

- rel: geordnet und zuverlässig; Handshake, Roster, Commands, Events und start-/ordnungskritische Zustände.
- fast: eigener RTCDataChannel mit ungeordneter Zustellung und ohne Retransmits; Input, Ping und ersetzbare Snapshots. Die monotone Batch-Sequenz verwirft alte oder doppelte Batches.

fast fällt nicht auf rel zurück. Ist er nicht offen oder beendet, werden ersetzbare Nachrichten verworfen. Sein Fehler beendet den Link und nutzt denselben Resume-Pfad wie ein zuverlässiger Linkabbruch. Der Kanal wird negotiated mit fester ID angelegt, damit PeerJS keinen eingehenden zweiten Kanal als eigene DataConnection vereinnahmt.

Die ICE-Konfiguration wird in src/network/peer/PeerSignaling.ts explizit gesetzt. Sie ist STUN-only; es gibt keinen TURN-, WebSocket- oder Spielverkehrs-Fallback. TransportDiagnostics prüft den tatsächlich gewählten Kandidatentyp.

## Host-Autorität

Der Host entscheidet Positionen, Treffer, Schaden, Ressourcen, Spawns, Gegner, Rundenzustand, Arena-Layout und Ergebnisse. Clients senden Input oder Aktionsanforderungen. Prediction ist nur Feedback und darf keine autoritative Folge erzeugen. Clients sprechen nie direkt miteinander.

Fachliche RPCs werden in RpcCoordinator registriert und über Methoden von NetworkBridge gesendet. Neue Nachrichten nicht am Peer-Substrat vorbeischleusen; dort würden Rollenprüfung, Absenderbindung und Relay-Semantik umgangen.

## Store- und Snapshot-Semantik

Der Peer-Store hat globale und per-player Keys. Lokales Schreiben wirkt sofort lokal und wird danach verteilt. Reliable Keys tragen Lobby-/Round-Baseline, Layout, Zeitbasis, committed Loadouts, Participation, Ergebnisse und seltene Lebenszyklus-/Präsentationszustände. Fast Keys tragen Input, Ping und KEY_GAME_STATE.

Bei Delta-Slices bedeutet ein fehlendes Feld „unverändert“, nicht „leer“. Der Client merged gegen den letzten Stand. NetworkBridge.resetGameStateCache() muss bei jedem Arena-/Rundenwechsel laufen. Ein Latejoiner darf keinen Delta-Payload als neue Baseline akzeptieren; FullGameStateBootstrap verlangt _full und alle definierten Slices für die aktuelle Runde.

Spielerzustände werden vollständig pro Tick durch playerStateCodec.ts kompakt kodiert. Gegner nutzen enemySnapshotCodec.ts mit Full-/Delta-Upserts und Removals. Weitere Slices dürfen eigene Delta-/Full-Regeln haben; neue Daten zuerst auf Häufigkeit und Lebenszyklus prüfen, statt automatisch den heißen Enemy-Codec zu erweitern.

Zeitlich begrenzte replizierte Zustände tragen einen absoluten Ablaufzeitpunkt, nicht nur eine Restdauer. Clients können zwischen Snapshots lokal herunterzählen, ohne beim Ablauf ein weiteres Netzwerkereignis zu benötigen.

Der Host relayt Store-Schreibvorgänge, aber nicht blind jeden Key: HOST_ONLY_PLAYER_KEYS bleiben hostlokal. KEY_INPUT ist bewusst kein solcher Key, weil PlacementPreviewRenderer die Vorschau anderer Spieler lesen muss. Neue Keys zuerst nach Besitzer, Kanal, Änderungsfrequenz und Latejoin-Baseline klassifizieren.

Power-up-Pickups laufen als Request/ACK. Ein Client darf aus einer replizierten Definition keinen Effekt lokal anwenden; der Host prüft UID, Reichweite und Spielerzustand und wendet den Effekt im PowerUpSystem an. Temporäre Utility-Overrides werden als reliable UtilityOverrideDescriptor repliziert und beim Default-Loadout, beim Spielerabgang und vor Round-Teardown zentral entfernt.

## Handshake, Rollen und Resume

Der Raumcode aus #r= ist die Host-ID des Peer-Brokers; eine fehlende gültige Join-ID startet einen Host-Raum, eine ungültige Join-ID ist ein Bootfehler. Ein Client gilt erst nach welcome als verbunden. Spieler-IDs werden vom Host vergeben und sind unabhängig von transportinternen Peer-IDs.

Ein kurzer Resume hält denselben Slot nach einem Linkabbruch. Während dieser Karenz wird Input neutralisiert, der Spieler bleibt im Roster und der Client verwirft bei erfolgreicher Wiederaufnahme seine alte Game-State-Baseline. Ein bewusstes leave entfernt den Slot sofort. Es gibt keinen Hostwechsel; ein Hostverlust beendet die Sitzung.

Kick ist ein Lobby-RPC. Der Host prüft Rolle, Phase und Ziel erneut, sendet dem Ziel zuverlässig kicked und entfernt Slot und Resume-Zustand erst im definierten Ablauf. Ein gekickter Client startet keinen Resume-Versuch.

Netzwerk-RTT und Anwendungsreaktion sind getrennte Messgrößen. RTT kommt aus dem gewählten ICE-Kandidatenpaar; die Anwendungs-Ping-Schleife enthält zusätzlich beide Spielschleifen und dient der Zeitsynchronisation. Ein gültiger RTT-Wert von 0 ms darf nicht als „noch nicht gemessen“ verworfen werden. Raumqualitäts- und UI-Code dürfen diese Werte nicht vermischen.

## Referenzen

- Fachliche Grenze und Wire-Keys: src/network/NetworkBridge.ts
- Peer-Schichten: src/network/peer/PeerRoom.ts, PeerLink.ts, PeerJsTransport.ts, PeerSignaling.ts, protocol.ts
- Baseline: src/network/FullGameStateBootstrap.ts
- Codecs: src/network/playerStateCodec.ts, src/network/enemySnapshotCodec.ts
- Host/Client: src/scenes/arena/HostUpdateCoordinator.ts, src/scenes/arena/ClientUpdateCoordinator.ts
- Tests: tests/PeerLink.test.ts, tests/PeerRoom.test.ts, tests/PeerProtocol.test.ts, tests/FullGameStateBootstrap.test.ts
