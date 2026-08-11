# Networking

Netzwerkänderungen immer gegen `src/network/NetworkBridge.ts`, `src/network/peer/` und die passenden Tests prüfen. Wire-Keys, Nachrichtentypen und Merge-Semantik sind interne Verträge und dürfen nicht beiläufig geändert werden.

## Transport

Client und Host sprechen ausschließlich über **direkte WebRTC-DataChannels**. `peerjs` wird nur als Signaling-Broker verwendet – für Rendezvous, Offer/Answer und ICE. Über den Broker laufen niemals Spieldaten; fällt er aus, betrifft das nur den Verbindungsaufbau, nicht eine laufende Partie.

Die Datenebene gehört dem Projekt selbst. Zwei Kanäle je Verbindung:

- **`rel`** – die PeerJS-DataConnection (`reliable: true`, `serialization: 'raw'`): geordnet und zuverlässig. Handshake, Roster, Commands, Events und alle ordnungs- oder startkritischen Zustände.
- **`fast`** – ein eigener Kanal mit `{negotiated: true, id: PEER_FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0}`: echte „neuester Stand gewinnt"-Semantik für Snapshots, Input und Ping.

`fast` fällt niemals auf `rel` zurück: Solange der Zusatzkanal noch nicht offen oder bereits geschlossen ist, werden ersetzbare Nachrichten verworfen. Fast-Batches tragen eine monotone Sequenz pro Link; ältere und doppelte Batches werden ignoriert. `close`/`error` eines Fast-Kanals beendet deshalb den gesamten Link und startet denselben Resume-Pfad wie ein Abbruch des zuverlässigen Kanals.

Zwei nicht offensichtliche Zwänge dahinter:

1. PeerJS erzeugt seinen Kanal mit `{ordered: !!reliable}` und setzt **nie** `maxRetransmits`. `reliable: false` ist dort ungeordnet, aber weiterhin retransmittierend – ein echter unzuverlässiger Kanal ist über die PeerJS-API nicht ausdrückbar.
2. Der Zusatzkanal muss `negotiated: true` sein. Ein normal ausgehandelter zweiter Kanal löst auf der Gegenseite `ondatachannel` aus, und PeerJS' interner Handler behandelt jeden eingehenden Kanal als seinen eigenen – die zuverlässige Verbindung wäre gekapert.

## STUN-only, kein Relay

`PEER_ICE_SERVERS` in `src/config.ts` enthält ausschließlich STUN und muss immer explizit an `new Peer({ config })` übergeben werden: **PeerJS' Default `util.defaultConfig` enthält TURN-Server.** Ohne das Override wäre „keine Relay-Verbindungen" still verletzt.

`TransportDiagnostics` prüft den gewählten ICE-Kandidatentyp. Ein `relay`-Kandidat kann ohne konfiguriertes TURN nicht legitim auftreten; erscheint er doch, ist die ICE-Konfiguration kaputt – die Verbindung wird geschlossen und als Konfigurationsfehler gemeldet. Es gibt keinen WebSocket-, TURN- oder RPC-Fallback für Spielverkehr: Scheitert der direkte Weg, endet die Partie mit einer konkreten Meldung.

## Raumcode, Rollen, Abbruch

Der Raumcode (`#r=ABC123`, Crockford-Base32 ohne I/L/O/U) ist zugleich die Broker-ID des Hosts. Ohne Code in der URL wird gehostet; die Host-URL bleibt hashfrei und Einladungslink sowie sichtbarer Code werden aus dem aktiven Raum erzeugt. Mit gültigem Code wird beigetreten, ein ungültiger Code ist ein konkreter Boot-Fehler. Kollisionen auf dem geteilten öffentlichen Broker melden sich als `unavailable-id` und führen zu einem neuen Code.

Der Host vergibt kurze Spieler-IDs (`p0`…`pb`). Broker-Peer-IDs bleiben transportintern – sie stünden sonst bei 20 Hz in jedem Snapshot-Key.

Ein Client-Boot gilt erst nach einem gültigen `welcome` als erfolgreich. Ab dem offenen Link läuft dafür ein Timeout von fünf Sekunden; `room-full` und `protocol-mismatch` werden als zuverlässige `reject`-Nachricht beantwortet. Ein fehlerhafter zusätzlicher Join betrifft ausschließlich diesen Link und beendet keine bestehende Partie.

Nach einem Client-Linkabbruch hält der Host dessen Spieler-ID und Zustand zehn Sekunden anhand eines zufälligen, pro Raum in `sessionStorage` gespeicherten Tokens. Der Input wird sofort neutralisiert; die Figur bleibt stehen, verwundbar und im Roster. Der Client verbindet sofort und danach mit bis zu zwei Sekunden Backoff neu. Kommt dasselbe Token rechtzeitig zurück, erhält der neue Link den vorhandenen Slot und einen vollständigen Store; der Client verwirft seine Game-State-/Delta-Baseline. Erst nach Ablauf wird der Spieler genau einmal entfernt und `quit` verteilt.

Ein bewusster Client-Ausstieg verwendet dagegen die zuverlässige `leave`-Nachricht ohne Spieler-ID. Der Host nimmt die ID ausschließlich vom zugehörigen Link, entfernt Spielerzustand und Resume-Slot sofort und verteilt danach genau ein `quit` an die übrigen Clients. Navigation über den regulären Raumwechsel sowie `pagehide` lösen diesen Best-Effort-Pfad aus; eine kurze Sendepause lässt die Leave-Nachricht vor dem Schließen des Links abfließen.

Für die Abbrucherkennung überwacht `PeerLink` zusätzlich `RTCPeerConnection.connectionState`: `failed` und `closed` schließen sofort, `disconnected` erst nach drei Sekunden. Ein kleiner zuverlässiger Heartbeat läuft alle zwei Sekunden und beendet einen stillen Link nach sieben Sekunden; erst danach gilt weiterhin die zehnsekündige Resume-Karenz.

**Es gibt keinen Hostwechsel.** Scheitert Resume oder verlässt der Host den Raum, endet Runde bzw. Lobby mit einer Meldung sowie den Wegen „erneut beitreten" und „neuen Raum eröffnen".

Ein Host-Kick ist nur in `LOBBY` gueltig und wird im `NetworkBridge`-RPC erneut gegen Hostrolle, Phase und Zielspieler geprueft. `PeerRoom.kickPlayer()` entfernt den Slot samt Zustands- und Resume-Eintraegen vor dem normalen `quit` an die verbleibenden Clients; der Ziel-Link erhaelt zuvor auf `rel` genau eine `kicked`-Nachricht und wird erst danach geschlossen. Der Client markiert den Kick als terminal, startet keinen Resume-Versuch und kann spaeter ueber den Raumlink neu beitreten.

## Host und Ownership

Ein Spieler ist Host und besitzt die autoritative Simulation: Positionen, Treffer, Schaden, Ressourcen, Spawns, Gegner, Rundenzustand, Arena-Layout und Ergebnisse. Clients senden Input oder Aktionsanforderungen. Lokale Prediction verbessert das Feedback, entscheidet aber keine autoritativen Folgen.

`RpcCoordinator` bindet Gameplay-Handler an die fachliche Bridge-API. Neue Nachrichtennamen immer über `NetworkBridge` registrieren, nie direkt am Substrat.

## Replizierter Zustand

Der globale `CoopDefenseSurvivalState`-Snapshot (`csv`) ist ebenfalls reliable. Er ändert sich nur bei Initial-/Respawn-/Todes-Lifecycle und versorgt lokale HUD-/Observer-Darstellung sowie die Eliminierungs-Sperre; er gehört nicht in den hochfrequenten `KEY_GAME_STATE`-Pfad.

`PeerRoom` bietet einen Key-Value-Store, global und pro Spieler. Verträge:

- **Lokale Schreibvorgänge wirken sofort lokal** und werden danach verteilt. `setLocalReady(true)` gefolgt von `getPlayerReady(localId)` liefert ohne Roundtrip `true`.
- **Zuverlässig** (`reliable = true`, Kanal `rel`, sofortiger Versand): Spielphase, Modus/Map, Arena-Layout, Zeitbasen, Lobby-Snapshot, committed Loadouts, Teams, Rundenergebnisse, Farbpool, der `RoundParticipationState`-Snapshot und der kompakte `CoopDefenseEncounterPresentationState`-Snapshot (`cep`).
- `cep` ist ausschließlich host-autoritatives Präsentationswissen für Latejoiner und Zuschauer: Encounter-ID/Sequenz, Phase (`incoming`, `active`, `cleared`, `rest`, `complete`), absolute Phasenzeiten, die aktuell relevanten Spawnfronten und optional die Gegnerbilanz (`enemiesDefeated`/`enemiesTotal`). Er entscheidet weder Spawns noch Sieg/Niederlage und wird nur bei einer Zustandsänderung geschrieben, nie pro Frame — die Bilanz ändert sich dabei pro erledigtem Gegner, nicht pro Frame. Fehlende Frontfelder älterer Snapshots werden clientseitig als west interpretiert.
- `active` beginnt mit dem tatsächlich autoritativ registrierten ersten Gruppenspawn und hat immer `phaseEndsAtMs: null`; `incoming` endet nicht bloß nach einer UI-Frist. `spawnComplete` ist optionales Präsentationswissen für das Ausblenden des Anmarsch-Telegraphs nach der letzten ausgespielten Gruppe und bleibt ohne Gameplay-Bedeutung.
- Die Bilanz zählt über `EncounterExecutionState.progressEnemyIds`, eine **von `encounterEnemyIds` getrennte** Menge. Sie nimmt zusätzlich die per Death-Spawn geerbten Gegner auf, die keine Encounter-Registrierung tragen; in `encounterEnemyIds` aufgenommen verschöben sie dagegen die Clear-Bedingung. Der Nenner ist das Maximum aus autorierter Gruppenstärke und tatsächlich gesehenen Gegnern, damit weder verzögerte Gruppen den Balken zurückspringen lassen noch Death-Spawns ihn über sein Ziel füllen. Ohne `isEnemyActive` oder ohne registrierte Gegner fehlen beide Felder bewusst, statt geraten zu werden.
- **Ersetzbar** (Default, Kanal `fast`): Input, Ping, `KEY_GAME_STATE`. Diese Schreibvorgänge werden pro Key gesammelt und einmal je Frame verschickt – pro Key gewinnt der letzte Wert.
- Der Host ist die einzige Instanz, die weiterreicht; Clients sprechen nie miteinander. `HOST_ONLY_PLAYER_KEYS` hält Keys vom Relay fern, die ausschließlich der Host liest. `KEY_INPUT` gehört bewusst nicht dazu: `PlacementPreviewRenderer` liest `placementPreview` fremder Spieler und läuft auch auf Clients.
- Beim Join erhält ein Client den vollständigen Store, bevor Join-Callbacks feuern.

Power-up-Pickups verwenden für alle Definitionen denselben Request-/ACK-Pfad: Der Client dedupliziert nur die UID bis zur Host-Antwort und erzeugt keinen Gameplay-Effekt aus `defId`. Der Host validiert Reichweite und Spielerzustand und wendet den Effekt in `PowerUpSystem` an. Temporäre Utility-Overrides werden als reliable per-player `UtilityOverrideDescriptor` repliziert (`utility` mit Utility-ID oder `objective-placement` mit Missionsdaten); der Client rekonstruiert `clientUtilityOverride` ausschließlich daraus. `LoadoutManager` löscht Descriptor, Name, Ammo und Cooldowns beim Default-Loadout, beim Entfernen eines Spielers und zentral vor dem Round-Teardown.

Committed Loadouts tragen bei `coop_defense` die konkreten Utility-IDs `FELSBAU_COOP` bzw. `FLIEGENPILZ_COOP`; normale Modi tragen die Basis-IDs. Die Inspector-Profile und Kataloge bleiben bei Basis-IDs für Unlocks, UI und Kapazitätskosten. Platzierte Utility-Objekte führen zusätzlich im bestehenden optionalen `SyncedPlaceableRock.toolRef` die konkrete Utility-ID mit, damit Host und Client dieselbe geerbte Runtime-Konfiguration für Visuals, Cooldowns und Effekte auflösen.

Der Host veröffentlicht bei `NET_TICK_RATE_HZ = 20` einen einzelnen kompakten `KEY_GAME_STATE`-Payload. `playerStateCodec.ts` komprimiert Spielerzustände, Gegner nutzen `enemySnapshotCodec.ts` mit Full-/Delta-Upserts und sticky Removals. Weitere Slices lassen leere oder unveränderte Daten aus und werden clientseitig gegen den letzten Stand gemerged; Felsen, Power-ups, Pedestals und brennender Boden besitzen eigene Delta-/Full-Resync-Regeln. Clients erkennen neue Payloads über eine monotone Sequenz, extrapolieren Projektile und glätten Entity-Ziele (`NET_SMOOTH_TIME_MS = 80`). Beim Arena-Aufbau muss der Merge-Cache zurückgesetzt werden. **Fehlend bedeutet bei Delta-Slices „unverändert", nicht „leer".** Ein Latejoiner darf deshalb keinen Delta-Payload als neue Baseline verwenden: Der Host setzt beim Join den zuverlässigen `gsi`-Bootstrap mit `_full` und allen Slices, der Client akzeptiert ihn nur für die aktuelle `roundStartTime` und wartet andernfalls.

Nutzlast ist JSON. Ein Binärformat lohnt erst, wenn die Slice-Metriken (`NET_DEBUG_ENEMY_SYNC_METRICS`) es belegen.

Hindernisschaden ist host-autoritär: `ProjectileManager` meldet Flammen- und andere Projektiltreffer über den zentralen Rock-Hit-Callback an `RockVisualHelper`; Clients wenden keinen parallelen Schaden an. Flammen führen pro Projektil eine Hindernis-ID-Menge, bleiben nach einem Felskontakt bis zum Lifetime-Ende aktiv und unterscheiden gebaute/statische Felsen von Türmen ausschließlich über das replizierte `kind`-Feld, nicht über eine Loadout-ID.

**Ein neuer Gegner-Zustand gehört nicht automatisch in den Enemy-Codec.** Ein zusätzliches Feld dort kostet sechs Änderungsstellen im Gleichschritt (beide Interfaces, `getNetSnapshot`, `buildDeltaState`, Encode, Decode, Skip-Walker, beide Zweige von `applyRemoteSnapshot`) und liegt in einem heißen Pfad. Für einen Zustand, der nur wenige Gegner gleichzeitig betrifft, ist der **Seitenkanal** günstiger: ein eigener `GameState`-Key, der beim Bauen der Nutzlast komplett entfällt, solange die Liste leer ist – Vorbilder sind `slimeTrail.affectedEnemies` und `vulnerableEnemies`. Er kostet dann exakt nichts, während ein Codec-Bit immer im Maskenvergleich mitläuft. Umgekehrt gewinnt der Codec, sobald der Zustand gleichzeitig auf sehr vielen Gegnern liegt, weil der Seitenkanal keine Deltas kennt. Zeitlich begrenzte Zustände replizieren dabei einen **absoluten Ablaufzeitpunkt** statt einer Restdauer; der Client zählt dann zwischen zwei Snapshots selbst herunter und braucht kein Update beim Ablauf.

## Zwei Latenzen, die nicht verwechselt werden dürfen

**Ping (Netzwerk-RTT).** `RTCIceCandidatePairStats.currentRoundTripTime` des gewählten Kandidatenpaars. Der ICE-Stack misst sie per STUN **außerhalb unseres Main-Threads**, sie ist daher bildratenunabhängig und mit der Ping-Anzeige üblicher Shooter vergleichbar: auf einem Rechner bzw. im LAN einstellig. `KEY_PING` veröffentlicht Messwert und monotonen Sample-Zähler; der Messwert erscheint in Lobby und Leaderboard, beide Felder speisen den Raumtest.

Zwei Fallstricke:

- **0 ms ist ein gültiges Ergebnis**, kein „noch nicht gemessen". Deshalb liefert `getPlayerPing()` `number | null` statt `?? 0` – ein `<= 0`-Filter würde eine LAN-Runde dauerhaft im Status `sampling` festhalten.
- `currentRoundTripTime` aktualisiert nur alle **~2–5 s** (STUN-Consent-Checks). Ein neues Sample wird deshalb nur gezählt, wenn `responsesReceived` steigt. Der veröffentlichte Ping enthält diesen monotonen Sample-Zähler; der Raumtest zählt denselben gecachten Wert dadurch nicht mehrfach.

**Reaktion (Anwendungs-Ping).** `NetworkPingController` misst über den unzuverlässigen Kanal einen Umlauf durch **beide Spielschleifen**. Darin stecken rund vier Frame-Grenzen (Sende-Puffer bis Frame-Ende, Verarbeitung am Frame-Anfang – auf beiden Seiten), also bei 60 fps schon ohne Netz 30–60 ms; bei gedrosselten Hintergrund-Tabs deutlich mehr. Als angezeigter Ping ist der Wert unbrauchbar, als Maß für die gefühlte Reaktionszeit aussagekräftig. Er dient außerdem weiterhin der Host-Zeitsynchronisation für `getSynchronizedNow()` – dafür wird er gebraucht, die Netzwerk-RTT liefert keinen Zeitversatz.

Beide Werte stehen getrennt im Overlay (Taste **P**, auch über den Lobby-Button „NETZ-INFO"). Jitter ist jeweils die mittlere Abweichung aufeinanderfolgender Messungen – für das Spielgefühl zählt Sprunghaftigkeit, nicht Streubreite.

`ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS = 60` bezieht sich seit der Umstellung auf die Netzwerk-RTT und ist damit erst aussagekräftig. `ROOM_QUALITY_START_POLICY` bleibt `'warn'`, bis reale Werte mit den üblichen Mitspielern vorliegen.

## Referenzen

- Fachliche Grenze und Wire-Keys: `src/network/NetworkBridge.ts`
- Substrat: `src/network/peer/` (`PeerRoom`, `PeerLink`, `PeerJsTransport`, `PeerSignaling`, `protocol.ts`)
- Diagnose: `src/network/peer/TransportDiagnostics.ts`, `src/ui/NetDebugOverlay.ts`
- Ping/Zeitsynchronisation: `src/network/NetworkPingController.ts`
- Raumqualität: `src/network/RoomQualityMonitor.ts`
- Codecs: `src/network/playerStateCodec.ts`, `src/network/enemySnapshotCodec.ts`
- Host-Publikation: `src/scenes/arena/HostUpdateCoordinator.ts`
- Client-Merge/Interpolation: `src/scenes/arena/ClientUpdateCoordinator.ts`
