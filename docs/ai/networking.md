# Networking

## Geltungsbereich

Gameplay spricht ausschließlich über [NetworkBridge](../../src/network/NetworkBridge.ts). Transportdetails, Peer-Verbindungen und Wire-Formate bleiben darunter. Die Netzwerkdokumentation beschreibt deshalb Autorität, Identität, Lebensdauer und Replikationssemantik statt einzelner Handlerfolgen.

## Autorität und Grenzen

Der Host entscheidet World- und Activity-Zustand, Simulation, Treffer, Ressourcen, Spawns, Rundenzustand und Layout. Clients senden Eingaben oder Aktionen und visualisieren validierten Zustand. Ein Client darf lokale InputPolicy oder UI-Zustände nicht als Berechtigung behandeln.

Bei PersistentBase-Daten entscheidet der Host über Materialisierung, Validierung, Merge-Ergebnis und laufende Runtime. Der dauerhafte Blueprint-Besitz bleibt im persönlichen Progress des jeweiligen Spielers; Host-Authority ist kein fachlicher Eigentumstitel. `ownerId` identifiziert diesen Besitz über Sessions hinweg, autorisiert aber keine eingehende Mutation. Netzwerkaktionen und Änderungen werden hostseitig unabhängig validiert. In einer persistenten World ohne Mission bestätigt der Host jede akzeptierte Änderung sofort; in einer Mission erst den Working State nach einem Sieg. In beiden Fällen erhält und speichert jeder Spieler ausschließlich seinen eigenen bestätigten Beitrag.

PeerJS wird nur in [PeerJsTransport.ts](../../src/network/peer/PeerJsTransport.ts) importiert. [PeerRoom.ts](../../src/network/peer/PeerRoom.ts) kennt eine Transport-Schnittstelle; Gameplay kennt nur NetworkBridge.

## Fachliche Systeme und die Netzwerkgrenze

Keine der fachlichen Runtime-/Domain-Schichten `src/activity/`, `src/effects/`, `src/entities/`, `src/loadout/`, `src/powerups/`, `src/systems/`, `src/train/` und `src/world/` importiert das Modul-Singleton [bridge](../../src/network/bridge.ts). Der Zugang zum Transportsubstrat entsteht ausschließlich an den expliziten Composition-/Adapter-Grenzen (`ArenaLifecycleCoordinator`, `src/scenes/arena/Arena*Composition.ts`, `CoopMission*Composition`).

Die im Arena-Runtime-Refactor migrierten Owner-Grenzen bekommen von dort die kleine fachliche Sicht, die sie wirklich brauchen - einen benannten Port oder Callback wie `WorldTrainNetworkPort`, `TranslocatorNetworkPort` oder `CaptureTheBeerRosterPort`. Ein Owner, der schon eine Portgruppe besitzt, setzt die Sicht seines Kindes daraus zusammen, statt eine zweite Adapterkette zu eröffnen. Neue Runtime-Owner folgen diesem Muster und sollen keine direkte Bridge kennen.

Einige ältere Kernsysteme bekommen weiterhin eine konkrete `NetworkBridge` per Constructor-Injection von der Composition-Grenze: `CombatSystem`, `InputSystem`, `HostPhysicsSystem`, `DecoySystem`, `EffectSystem`, `EnergyShieldSystem` und `BurrowSystem`. Diese Menge ist eine bewusst eingefrorene Legacy-Grenze - sie wird nicht allein für architektonische Reinheit auf Ports umgebaut, darf aber auch nicht wachsen. `LoadoutManager` ist davon getrennt und bleibt vollständig transportagnostisch; World- und Combat-Owner binden seine fachlichen Reads und Actions über Ports.

Das hält Regeln testbar: Ein Test übergibt den Port direkt und braucht kein Modulmock der Bridge. [tests/WorldGameplayCompositionContracts.test.ts](../../tests/WorldGameplayCompositionContracts.test.ts) hält beide Grenzen fest - den fehlenden Singleton-Import und die eingefrorene Liste der konkreten Consumer.

## World- und Activity-Store

World und Activity sind getrennte replizierte Verträge:

- WorldDescriptor identifiziert eine konkrete World-Instance mit worldRevision, Definition, Seed, Generatorversion und Layout-Fingerprint.
- ActivityDescriptor identifiziert eine optionale Activity mit activityRevision, zugehöriger worldRevision, Art und Definition.
- World und Activity werden beim gemeinsamen Wechsel atomar veröffentlicht. Eine Activity ohne passende World ist ungültig.
- Ein World-Wechsel initialisiert Participation leer und verwirft gecachte Spiel-Deltas. Das Löschen beendet beide Store-Einträge.

Die fachliche Grenze liegt in den Methoden publishWorldAndActivity, publishActivity, clearWorldAndActivity, getWorldDescriptor und getActivityDescriptor von [NetworkBridge.ts](../../src/network/NetworkBridge.ts). Replikation darf keine World-Definition aus zufälligen lokalen Defaults rekonstruieren.

## Revisionen und veraltete Nachrichten

Jede World-scoped Nachricht trägt worldRevision oder wird vor dem Versand damit versehen. [WorldRevision.ts](../../src/world/WorldRevision.ts) akzeptiert nur exakt die aktuell gebundene Revision. Das gilt für Participation, World-RPCs und andere World-Aktionen; ein altes Paket darf weder in der alten World noch in der aktuellen World weiterwirken.

Die Annahmeprüfung liegt zentral in NetworkBridge.acceptsWorldRpc beziehungsweise den zugehörigen World-Parsern. Einzelne Handler dürfen diese Prüfung nicht nachbilden oder auslassen. Activity-Wechsel innerhalb derselben World erfordern nicht automatisch einen World-Neuaufbau.

Die LobbyWorld repliziert pro Spieler zusaetzlich einen kleinen Live-Build getrennt vom Ready-Commit. Er umfasst Coop-Klasse, sanitisiertes Upgrade-Profil, ausgeruestete Items und Inspector-Tools; die laufenden Waffen-, Utility- und Ultimate-Slots bleiben die bestehenden per-player States. Ohne Activity ist dieser Live-Build die hostseitige Quelle fuer World-Gameplay und wird laufend reconciled, waehrend ein aktiver Ready-Commit die unveraenderliche Activity-Auswahl bleibt. Aendert sich daraus die fuer das Persistent-Base-Composite relevante Besitzersicht (insbesondere Klasse, Construction-Loadout, Freischaltungen oder effektive Construction-Werte), reconciled der Host das bestehende Composite erneut; `not-in-loadout` bleibt dabei regulaere Dormancy. Preview-Peers konsumieren die Projektion nur zur Darstellung und erhalten keine eigene Player-Runtime.

## WorldParticipation ist kein Round-State

Room-Mitgliedschaft sagt nur, dass ein Peer im Raum bekannt ist. WorldParticipation sagt, ob der Peer für diese World admittiert ist und ob er interaktiv, beobachtend oder im Übergang ist. RoundParticipation und GamePhase beschreiben dagegen Aktivitäts- oder Rundenzustand.

Participation wird host-authoritativ über den zuverlässigen World-Kanal veröffentlicht und anhand von worldRevision geprüft. Eine lokale Preview ohne Participation darf World-Replikation konsumieren, erzeugt aber keinen World-Runtime-Eintrag und darf keine World-Aktion senden.

## Channel- und Snapshot-Semantik

[protocol.ts](../../src/network/peer/protocol.ts) definiert die Wire-Hülle und die Protokollversion. [PeerLink.ts](../../src/network/peer/PeerLink.ts) trennt:

- reliable, geordnete Übertragung für Handshake, Roster, Befehle, Events und Ordnungsinformationen;
- fast, verlustbehaftete Übertragung für Snapshots, Eingaben und Ping, mit newest-state-Semantik.

Die Zuverlässigkeit kommt vom Channel, nicht aus einem Payload-Feld. Fast-Nachrichten dürfen bei geschlossener Verbindung oder Überlast verworfen werden; ein Sender darf dort keinen dauerhaften Zustandsfortschritt voraussetzen.

Game-State wird als vollständiger Bootstrap oder als Delta übertragen. Bei Deltas dürfen unveränderte Slices fehlen; ein vollständiger Bootstrap muss alle erforderlichen Slices enthalten und wird durch [FullGameStateBootstrap.ts](../../src/network/FullGameStateBootstrap.ts) validiert. Nach World- oder Round-Wechsel wird der Delta-Cache zurückgesetzt.

Replizierte Entities und langlebige Zustände brauchen stabile Identitäten. Bei einem neuen Zustand sind Owner, Channel, Update-Frequenz, Lebensdauer und Baseline zu klären; ein Array-Index oder eine lokale Scene-Referenz ist keine Netzidentität.

Bei delta-gemergten Slices bedeutet ein fehlender Slice unverändert, nicht leer. Der Übergang auf eine leere Sammlung muss im Slice-Vertrag ausdrücklich codiert werden, etwa als leere Voll-Liste, explizite Removals oder vollständiger Snapshot. Eine abweichende Semantik ist nur zulässig, wenn der konkrete Codec sie ausdrücklich definiert.

Ein veränderlicher Zustand darf nicht nur einmal über den Fast-Kanal gesendet werden: `PeerLink` darf Fast-Pakete bei Überlast oder geschlossenem Kanal verwerfen. Ohne erneute Sendung geht ein solcher Zustand verloren. Geeignete Verträge sind wiederholte Vollzustände oder Refreshes, Deltas mit expliziten Entfernungen oder der zuverlässige Kanal.

Zeitlich begrenzte replizierte Zustände verwenden bevorzugt einen absoluten fachlichen Endzeitpunkt wie `expiresAt` statt ausschließlich einer Restdauer. Clients können daraus zwischen Snapshots herunterzählen, ohne dass Paketlatenz die Lebensdauer neu startet; das ist eine passende Option, kein Zwang für jeden Zustand.

Wenn jede einzelne Auslösung eines wiederkehrenden Host-Ereignisses fachlich oder für die Presentation eindeutig erkannt werden muss, darf der Client sie nicht nur aus Dauer, Phase oder lokalem Timing rekonstruieren. In solchen Fällen ist eine monotone Sequence/Revision das bevorzugte Muster. Ein initialer Snapshot setzt typischerweise die aktuelle Baseline; vergangene Presentation-Ereignisse werden nicht automatisch nachgespielt. Das ist kein Zwang für rein kontinuierliche Zustände, bei denen nur der aktuelle Zustand zählt. Der Tesla-Dome nutzt dafür `pulseSequence`; sein Renderer löst Effekte nur bei fortschreitender Sequenz aus.

## Join, Resume und Sichtbarkeit

Welcome- und Resume-Pfade liefern den für den aktuellen Peer relevanten Store- und Zustandsstand. Die replizierte World darf dabei unabhängig von lokaler Presentation resident werden. Ein passiver Peer braucht weder Player-Sprite noch Gameplay-Eingaben, um eine Preview korrekt zu zeigen.

## Neue Nachrichten

Vor dem Hinzufügen einer Nachricht klären:

1. Ist sie World-, Activity-, Round- oder rein lokal?
2. Wer besitzt und validiert sie?
3. Welche Identität und Revision bindet sie an einen Zustand?
4. Muss sie reliable geordnet oder fast verlustbehaftet sein?
5. Ist ein vollständiger Bootstrap oder ein Delta der kleinste korrekte Empfangsvertrag?

World-scoped RPCs verwenden den zentralen Bridge-Pfad. Keine neue Funktion darf Transportobjekte in Gameplay leaken.

## Maßgebliche Tests

- [tests/WorldChannelContracts.test.ts](../../tests/WorldChannelContracts.test.ts)
- [tests/WorldParticipationContracts.test.ts](../../tests/WorldParticipationContracts.test.ts)
- [tests/WorldDescriptorContracts.test.ts](../../tests/WorldDescriptorContracts.test.ts)
- [tests/PeerProtocol.test.ts](../../tests/PeerProtocol.test.ts)
- [tests/PeerLink.test.ts](../../tests/PeerLink.test.ts)
- [tests/FullGameStateBootstrap.test.ts](../../tests/FullGameStateBootstrap.test.ts)
- [tests/WorldGameplayCompositionContracts.test.ts](../../tests/WorldGameplayCompositionContracts.test.ts)
