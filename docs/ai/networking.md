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

Der Host entscheidet Positionen, Treffer, Schaden, Ressourcen, Spawns, Gegner, Rundenzustand und Ergebnisse. Das Arena-Layout wird aus einem host-authored `ArenaDescriptor` (Round-Revision, Modus/Map, Seed, Generatorversion und Fingerprint) auf Host und Clients lokal deterministisch erzeugt; ein vollständiges `ArenaLayout` ist kein Wire-State. Clients senden Input oder Aktionsanforderungen. Prediction ist nur Feedback und darf keine autoritative Folge erzeugen. Clients sprechen nie direkt miteinander.

In Modi mit wählbaren gegnerischen Teams (`hasTeamSelection`) begrenzt `NetworkBridge` jedes Team auf sechs Spieler. Neue Spieler gehen deterministisch ins kleinere Team, bei Gleichstand nach Blau; Teamwechsel in ein volles Zielteam werden hostseitig abgelehnt. Beim Wechsel aus einem Nicht-Team-Modus werden alle Spieler stabil neu verteilt, während TDM und Capture the Beer gültige Zuweisungen untereinander behalten. `PeerRoom` kennt weiterhin nur die globale Raumgrenze von zwölf Spielern.

Fachliche RPCs werden in RpcCoordinator registriert und über Methoden von NetworkBridge gesendet. Neue Nachrichten nicht am Peer-Substrat vorbeischleusen; dort würden Rollenprüfung, Absenderbindung und Relay-Semantik umgangen.

## Store- und Snapshot-Semantik

Der Peer-Store hat globale und per-player Keys. Lokales Schreiben wirkt sofort lokal und wird danach verteilt. Reliable Keys tragen Lobby-/Round-Baseline, den kleinen Arena-Descriptor, Zeitbasis, committed Loadouts, Participation, Ergebnisse und seltene Lebenszyklus-/Präsentationszustände. Fast Keys tragen `KEY_INPUT`, `KEY_PLACEMENT_PREVIEW`, Ping und `KEY_GAME_STATE`; `KEY_INPUT` wird ausschließlich an den Host zugestellt, `KEY_PLACEMENT_PREVIEW` wird als visueller Presence-State an die übrigen Clients relayed. Reliable-/Raw-Sends protokollieren auffällig große Payloads und geschlossene Verbindungen, statt Fehler still zu verschlucken.

Der reliable `RoundState` traegt neben dem Rundenstart nur seltene Zeitanker: Ein erfolgreicher Coop-Boss-Spawn schreibt `coopDefenseBossSpawnedAtMs` genau einmal. Kontinuierliche Arena-Tageszeit wird daraus und aus dem synchronisierten Jetzt lokal rekonstruiert und nie pro Tick repliziert.

Der technische Arena-Ladezustand ist vom Lobby-Ready getrennt. `hostStartRoundParticipants()` friert dafür eine `roundRevision` ein; jeder Peer meldet `ArenaLoadReadyState` zuverlässig pro Spieler und mit dieser Revision gebunden – inklusive stufenweisem `progress`, `stage` und `ready` – nachdem sein lokaler Arena-Working-Set (einschließlich Ground-, RockOverlay- und statischer Schatten-Chunks) vollständig resident und gebacken ist. Der Host baut vor seinem Ready zusätzlich den `ArenaObstacleIndex` sowie die Player-/Goal-Flowfields aus dem tatsächlichen Initialspawn auf; Clients benötigen nur ihr lokales Rendering-Working-Set. Der Host wertet nur die für diese Participation-Revision relevanten, noch verbundenen Teilnehmer aus; Disconnects blockieren die Barriere nicht dauerhaft, und spätere Spectators oder Late Joiner verändern den vorbereiteten Start nicht. Erst wenn Host und alle eingefrorenen Teilnehmer bereit sind, setzt der Host unmittelbar `arenaStartTime = now + ARENA_COUNTDOWN_SEC`; der sichtbare Countdown ist der vollständige Synchronisationsvorlauf. Während des schwarzen Loading-Screens nutzt der Chunk-Scheduler ein eigenes Startup-Budget und kehrt nach dem Start zu den kleinen Runtime-Budgets zurück.

Kumulative Raumstatistiken liegen als ein kompakter reliable globaler Snapshot (`rst`) im Raum. Nur
der Host ändert das In-Memory-Ledger und publiziert es beim Rundenende, beim Lobby-Bootstrap und bei
Roster-Reconnects; Treffer, Heilung und andere Zähler erzeugen keine Einzel-Replikation. Runden- und
Moduswechsel setzen die Werte nicht zurück. Ein Resume behält die hostvergebene Spieler-ID und damit
den bestehenden Eintrag; ein neuer Raum erhält ein neues Ledger.

Die Lobby-Auswahl der Spieler-Loadouts liegt weiterhin in den per-player Slot-States. Für die
Inspector-Anzeige gibt es zusätzlich den kleinen reliable Lobby-Preview-State `llp` mit Klasse
und Tool-Referenzen; er ist nur für die laufende Vorschau bestimmt. `LoadoutCommitSnapshot`
bleibt ausschließlich der beim Ready-Klick eingefrorene Commit-/Round-Snapshot.

Bei Delta-Slices bedeutet ein fehlendes Feld „unverändert“, nicht „leer“. Der Client merged gegen den letzten Stand. NetworkBridge.resetGameStateCache() muss bei jedem Arena-/Rundenwechsel laufen. Ein Latejoiner darf keinen Delta-Payload als neue Baseline akzeptieren; FullGameStateBootstrap verlangt _full und alle definierten Slices für die aktuelle Runde.

Spielerzustände werden vollständig pro Tick durch playerStateCodec.ts kompakt kodiert. Gegner nutzen enemySnapshotCodec.ts mit Full-/Delta-Upserts und Removals. Weitere Slices dürfen eigene Delta-/Full-Regeln haben; neue Daten zuerst auf Häufigkeit und Lebenszyklus prüfen, statt automatisch den heißen Enemy-Codec zu erweitern.

Ein Delta-Slice darf den zuletzt gesendeten Wert nur dann als Host-Baseline cachen, wenn ein Refresh- oder Resend-Zyklus innerhalb der Lebensdauer des Objekts garantiert greift. Sonst hält der Host einen einmaligen Wechsel für zugestellt, den ein verlorenes fast-Paket geschluckt hat, und der Zustand bleibt bis zum Lebensende falsch. Kurzlebige Objekte tragen deshalb ihren veränderlichen Teil vollständig pro Tick; gecacht wird nur, was sich über die Lebensdauer nicht ändert. projectileSnapshotCodec.ts trennt genau danach: Statik einmalig mit Resend, Dynamik jeden Tick vollständig — und weil dadurch jeder Tick alle aktiven Projektile führt, bleibt Despawn ohne Removal-Liste allein über Abwesenheit korrekt.

Zeitlich begrenzte replizierte Zustände tragen einen absoluten Ablaufzeitpunkt, nicht nur eine Restdauer. Clients können zwischen Snapshots lokal herunterzählen, ohne beim Ablauf ein weiteres Netzwerkereignis zu benötigen.

Replizierte Listen je Entität brauchen einen stabilen Identitätsschlüssel, sobald der Client daran Zustand hängt. Position und Typ allein reichen nicht: ein Renderer, der Einträge positionsweise dem Array-Index zuordnet, springt bei jeder Umsortierung sichtbar um. Der Host führt die Identität selbst und schickt sie mit, zusammen mit der fachlichen Slot-Nummer, wenn die Reihenfolge Bedeutung trägt (`SyncedTeslaDomeTarget.targetKey`/`slotIndex`).

Wiederkehrende hostseitige Ereignisse werden über einen monoton steigenden Zähler repliziert, nicht über eine aus der Aktivierungsdauer abgeleitete Stufe. Der Client löst seine Darstellung beim Anstieg des Zählers aus und bleibt damit auch bei Paketverlust und schwankender Snapshot-Rate synchron (`SyncedTeslaDome.pulseSequence`).

Der Host relayt Store-Schreibvorgänge, aber nicht blind jeden Key: `HOST_ONLY_PLAYER_KEYS` bleiben hostlokal. Ein Client darf den per-player-Key `KEY_PLACEMENT_PREVIEW` nur für seine eigene `originLink.playerId` schreiben; der Host darf ihn weiterhin für andere Spieler löschen oder setzen. `KEY_INPUT` und `KEY_PLACEMENT_PREVIEW` fehlen in Welcome-/Resume-Snapshots. Neue Keys zuerst nach Besitzer, Kanal, Änderungsfrequenz und Latejoin-Baseline klassifizieren.

`KEY_PLACEMENT_PREVIEW` ist ein ephemerer Presence-State ohne Revision, Generation oder Reliable-Clear. Aktive Zustände werden bei Änderung sofort und danach ungefähr alle 150 ms über `fast` wiederholt. Ein `null` beendet die Preview best-effort ebenfalls über `fast`; Remote-Clients verwerfen aktive Previews nach 600 ms ohne lokales Empfangsupdate automatisch. Disconnect, Quit, Spectator-Wechsel und Verlust der Handlungsberechtigung löschen die lokale Preview beziehungsweise senden best-effort `null`. Ein Resume führt keine Store-Reconciliation durch: Eine lokal aktive Preview wird beim nächsten Update erneut gesendet, eine inaktive Preview darf über die TTL auslaufen.

Power-up-Pickups laufen als Request/ACK. Ein Client darf aus einer replizierten Definition keinen Effekt lokal anwenden; der Host prüft UID, Reichweite und Spielerzustand und wendet den Effekt im PowerUpSystem an. Temporäre Utility-Overrides werden als reliable UtilityOverrideDescriptor repliziert und beim Default-Loadout, beim Spielerabgang und vor Round-Teardown zentral entfernt.

## Handshake, Rollen und Resume

Der Raumcode aus #r= ist die Host-ID des Peer-Brokers; eine fehlende gültige Join-ID startet einen Host-Raum, eine ungültige Join-ID ist ein Bootfehler. Ein Client gilt erst nach welcome als verbunden. Spieler-IDs werden vom Host vergeben und sind unabhängig von transportinternen Peer-IDs.

Ein kurzer Resume hält denselben Slot nach einem Linkabbruch. Während dieser Karenz wird Input neutralisiert, der Spieler bleibt im Roster und der Client verwirft bei erfolgreicher Wiederaufnahme seine alte Game-State-Baseline. Ein bewusstes leave entfernt den Slot sofort. Es gibt keinen Hostwechsel; ein Hostverlust beendet die Sitzung.

Kick ist ein Lobby-RPC. Der Host prüft Rolle, Phase und Ziel erneut, sendet dem Ziel zuverlässig kicked und entfernt Slot und Resume-Zustand erst im definierten Ablauf. Ein gekickter Client startet keinen Resume-Versuch.

Netzwerk-RTT und Anwendungsreaktion sind getrennte Messgrößen. RTT kommt aus dem gewählten ICE-Kandidatenpaar; die Anwendungs-Ping-Schleife enthält zusätzlich beide Spielschleifen und dient der Zeitsynchronisation. Ein gültiger RTT-Wert von 0 ms darf nicht als „noch nicht gemessen“ verworfen werden. Raumqualitäts- und UI-Code dürfen diese Werte nicht vermischen.

## World- und Activity-Identität

Die kanonischen Replikationsverträge der World-Schicht liegen unter src/world/. `WorldDescriptor` trägt ausschließlich World-Identität und -Konfiguration (worldRevision, definitionId, seed, generatorVersion, layoutFingerprint, parameters); `ActivityDescriptor` trägt activityRevision, worldRevision, kind und definitionId und dupliziert die World-Identität nicht. Objective, Rolle, Siegbedingung, Respawn-Budget und GameMode gehören nie in den WorldDescriptor. `definitionId` ist dieselbe ID wie im Authoring (src/config/authoring/), damit World-Identität über Authoring und Replikation hinweg eindeutig bleibt.

`worldRevision` und `activityRevision` dürfen aus derselben monotonen Quelle stammen (`nextMonotonicRevision`), sind aber verschiedene Identitäten. Eine Nachricht der World-Revision N darf niemals auf eine andere angewendet werden; die Regel steht zentral in `acceptWorldScoped`/`isCurrentWorldRevision`, nicht an den Aufrufstellen. Die Ladestufen (`isWorldLoadStage`, `normalizeWorldLoadProgress`) gehören zur World-Ladebarriere und sind dort die einzige Quelle.

Auf dem Draht gibt es genau einen World-Kanal: `wld` traegt `WorldDescriptor | null`, `act` daneben `ActivityDescriptor | null`. Beide sind host-autoritativ (`publishWorldAndActivity`, `clearWorldAndActivity`) und werden gemeinsam gesetzt, damit nie eine Activity ohne ihre World steht; `activity: null` ist ein regulaerer Zustand. Eine Activity, die auf eine andere World-Revision zeigt, verwirft `getActivityDescriptor()` zentral. Die World endet mit der Runde – Rundenabschluss, Diagnose-Abbruch und technischer Abbruch raeumen den Kanal ab.

`getArenaDescriptor()` ist nur noch eine abgeleitete Kompatibilitaetssicht auf beide Kanaele, kein eigener Wire-Key. Der persistente Basisradius steht als `WorldDescriptor.parameters.persistentBaseRadiusCells` im World-Kanal und nicht mehr im `RoundState`. Die Ladebarriere `wlr` traegt `WorldLoadReadyState` mit `worldRevision`.

## Referenzen

- Fachliche Grenze und Wire-Keys: src/network/NetworkBridge.ts
- Peer-Schichten: src/network/peer/PeerRoom.ts, PeerLink.ts, PeerJsTransport.ts, PeerSignaling.ts, protocol.ts
- Baseline: src/network/FullGameStateBootstrap.ts
- Codecs: src/network/playerStateCodec.ts, src/network/enemySnapshotCodec.ts, src/network/projectileSnapshotCodec.ts
- Host/Client: src/scenes/arena/HostUpdateCoordinator.ts, src/scenes/arena/ClientUpdateCoordinator.ts
- World-/Activity-Identität: src/world/WorldDescriptor.ts, ActivityDescriptor.ts, WorldRevision.ts, WorldLoadReady.ts, arenaDescriptorAdapter.ts
- Tests: tests/PeerLink.test.ts, tests/PeerRoom.test.ts, tests/PeerProtocol.test.ts, tests/FullGameStateBootstrap.test.ts, tests/ProjectileSnapshotCodec.test.ts, tests/MissionLifecycleContracts.test.ts, tests/WorldDescriptorContracts.test.ts, tests/WorldChannelContracts.test.ts
- Test-Harness: tests/fakePeerNetwork.ts verdrahtet mehrere PeerRoom-Instanzen ohne WebRTC durch echte Kodierung und Validierung. Multiplayer-Contract-Tests bauen darauf auf, statt einen zweiten In-Memory-Transport anzulegen.
