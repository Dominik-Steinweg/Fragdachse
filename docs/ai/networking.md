# Networking

Netzwerkänderungen immer gegen `src/network/NetworkBridge.ts`, `src/network/peer/` und die passenden Tests prüfen. Wire-Keys, Nachrichtentypen und Merge-Semantik sind interne Verträge und dürfen nicht beiläufig geändert werden.

## Transport

Client und Host sprechen ausschließlich über **direkte WebRTC-DataChannels**. `peerjs` wird nur als Signaling-Broker verwendet – für Rendezvous, Offer/Answer und ICE. Über den Broker laufen niemals Spieldaten; fällt er aus, betrifft das nur den Verbindungsaufbau, nicht eine laufende Partie.

Die Datenebene gehört dem Projekt selbst. Zwei Kanäle je Verbindung:

- **`rel`** – die PeerJS-DataConnection (`reliable: true`, `serialization: 'raw'`): geordnet und zuverlässig. Handshake, Roster, Commands, Events und alle ordnungs- oder startkritischen Zustände.
- **`fast`** – ein eigener Kanal mit `{negotiated: true, id: PEER_FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0}`: echte „neuester Stand gewinnt"-Semantik für Snapshots, Input und Ping.

Zwei nicht offensichtliche Zwänge dahinter:

1. PeerJS erzeugt seinen Kanal mit `{ordered: !!reliable}` und setzt **nie** `maxRetransmits`. `reliable: false` ist dort ungeordnet, aber weiterhin retransmittierend – ein echter unzuverlässiger Kanal ist über die PeerJS-API nicht ausdrückbar.
2. Der Zusatzkanal muss `negotiated: true` sein. Ein normal ausgehandelter zweiter Kanal löst auf der Gegenseite `ondatachannel` aus, und PeerJS' interner Handler behandelt jeden eingehenden Kanal als seinen eigenen – die zuverlässige Verbindung wäre gekapert.

## STUN-only, kein Relay

`PEER_ICE_SERVERS` in `src/config.ts` enthält ausschließlich STUN und muss immer explizit an `new Peer({ config })` übergeben werden: **PeerJS' Default `util.defaultConfig` enthält TURN-Server.** Ohne das Override wäre „keine Relay-Verbindungen" still verletzt.

`TransportDiagnostics` prüft den gewählten ICE-Kandidatentyp. Ein `relay`-Kandidat kann ohne konfiguriertes TURN nicht legitim auftreten; erscheint er doch, ist die ICE-Konfiguration kaputt – die Verbindung wird geschlossen und als Konfigurationsfehler gemeldet. Es gibt keinen WebSocket-, TURN- oder RPC-Fallback für Spielverkehr: Scheitert der direkte Weg, endet die Partie mit einer konkreten Meldung.

## Raumcode, Rollen, Abbruch

Der Raumcode (`#r=ABC123`, Crockford-Base32 ohne I/L/O/U) ist zugleich die Broker-ID des Hosts. Ohne Code in der URL wird gehostet und der Code hineingeschrieben; mit Code wird beigetreten. Kollisionen auf dem geteilten öffentlichen Broker melden sich als `unavailable-id` und führen zu einem neuen Code.

Der Host vergibt kurze Spieler-IDs (`p0`…`pb`). Broker-Peer-IDs bleiben transportintern – sie stünden sonst bei 20 Hz in jedem Snapshot-Key.

**Es gibt keinen Hostwechsel.** Verlässt der Host den Raum, endet Runde bzw. Lobby mit einer Meldung. Da die URL den Raumcode auch beim Host trägt, würde ein Reload versuchen, dem eigenen toten Raum beizutreten; die Fehleranzeige bietet deshalb ausdrücklich „neuen Raum eröffnen" an.

## Host und Ownership

Ein Spieler ist Host und besitzt die autoritative Simulation: Positionen, Treffer, Schaden, Ressourcen, Spawns, Gegner, Rundenzustand, Arena-Layout und Ergebnisse. Clients senden Input oder Aktionsanforderungen. Lokale Prediction verbessert das Feedback, entscheidet aber keine autoritativen Folgen.

`RpcCoordinator` bindet Gameplay-Handler an die fachliche Bridge-API. Neue Nachrichtennamen immer über `NetworkBridge` registrieren, nie direkt am Substrat.

## Replizierter Zustand

`PeerRoom` bietet einen Key-Value-Store, global und pro Spieler. Verträge:

- **Lokale Schreibvorgänge wirken sofort lokal** und werden danach verteilt. `setLocalReady(true)` gefolgt von `getPlayerReady(localId)` liefert ohne Roundtrip `true`.
- **Zuverlässig** (`reliable = true`, Kanal `rel`, sofortiger Versand): Spielphase, Modus/Map, Arena-Layout, Zeitbasen, Lobby-Snapshot, committed Loadouts, Teams, Rundenergebnisse, Farbpool.
- **Ersetzbar** (Default, Kanal `fast`): Input, Ping, `KEY_GAME_STATE`. Diese Schreibvorgänge werden pro Key gesammelt und einmal je Frame verschickt – pro Key gewinnt der letzte Wert.
- Der Host ist die einzige Instanz, die weiterreicht; Clients sprechen nie miteinander. `HOST_ONLY_PLAYER_KEYS` hält Keys vom Relay fern, die ausschließlich der Host liest. `KEY_INPUT` gehört bewusst nicht dazu: `PlacementPreviewRenderer` liest `placementPreview` fremder Spieler und läuft auch auf Clients.
- Beim Join erhält ein Client den vollständigen Store, bevor Join-Callbacks feuern.

Der Host veröffentlicht bei `NET_TICK_RATE_HZ = 20` einen einzelnen kompakten `KEY_GAME_STATE`-Payload. `playerStateCodec.ts` komprimiert Spielerzustände, Gegner nutzen `enemySnapshotCodec.ts` mit Full-/Delta-Upserts und sticky Removals. Weitere Slices lassen leere oder unveränderte Daten aus und werden clientseitig gegen den letzten Stand gemerged; Felsen, Power-ups, Pedestals und brennender Boden besitzen eigene Delta-/Full-Resync-Regeln. Clients erkennen neue Payloads über eine monotone Sequenz, extrapolieren Projektile und glätten Entity-Ziele (`NET_SMOOTH_TIME_MS = 80`). Beim Arena-Aufbau muss der Merge-Cache zurückgesetzt werden. **Fehlend bedeutet bei Delta-Slices „unverändert", nicht „leer".**

Nutzlast ist JSON. Ein Binärformat lohnt erst, wenn die Slice-Metriken (`NET_DEBUG_ENEMY_SYNC_METRICS`) es belegen.

## Zwei Latenzen, die nicht verwechselt werden dürfen

**Ping (Netzwerk-RTT).** `RTCIceCandidatePairStats.currentRoundTripTime` des gewählten Kandidatenpaars. Der ICE-Stack misst sie per STUN **außerhalb unseres Main-Threads**, sie ist daher bildratenunabhängig und mit der Ping-Anzeige üblicher Shooter vergleichbar: auf einem Rechner bzw. im LAN einstellig. Das ist der Wert, der als `KEY_PING` veröffentlicht und in Lobby und Leaderboard angezeigt wird, und der den Raumtest speist.

Zwei Fallstricke:

- **0 ms ist ein gültiges Ergebnis**, kein „noch nicht gemessen". Deshalb liefert `getPlayerPing()` `number | null` statt `?? 0` – ein `<= 0`-Filter würde eine LAN-Runde dauerhaft im Status `sampling` festhalten.
- `currentRoundTripTime` aktualisiert nur alle **~2–5 s** (STUN-Consent-Checks). Ein neues Sample wird deshalb nur gezählt, wenn `responsesReceived` steigt; sonst ginge derselbe Messwert mehrfach in Median und Jitter ein.

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
