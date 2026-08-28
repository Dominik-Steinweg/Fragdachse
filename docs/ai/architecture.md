# Architektur

## Geltungsbereich

Fragdachse ist ein browserbasierter Phaser-4-Arena-Shooter mit host-authoritativer Simulation und direkten WebRTC-Verbindungen. Diese Seite beschreibt die Grenzen, an denen neue Features andocken müssen. Sie ist keine vollständige Klassen- oder Ablaufreferenz.

## Leitidee

Die Laufzeit trennt vier Dinge, die nicht auseinander rekonstruiert werden dürfen:

- Ein World-Instance beschreibt eine konkrete Welt: World-Identität, authored Definition oder Generator, Seed, Layout-Fingerprint, Metrics, Basen und persistente World-Sites.
- Eine Activity beschreibt optional das fachliche Geschehen in dieser Welt: Mission, Deathmatch oder andere Aktivitätsart. Eine World kann ohne Activity existieren.
- WorldParticipation beschreibt, ob und wie ein Peer an der World teilnimmt. Room-Mitgliedschaft ist dafür weder hinreichend noch gleichbedeutend.
- Presentation beschreibt, welche Flächen lokal sichtbar und interaktiv angeboten werden. Eine replizierte Preview kann ohne lokale Participation existieren.

Der Einstieg ist [src/main.ts](../../src/main.ts). Es gibt eine zentrale ArenaScene; Szenen koordinieren, während Regeln in Systems, Entity-Lifecycle in Entities und Darstellung in arena, effects oder ui liegen.

## Lebensdauer und Ownership

World und Activity haben getrennte Lebenszyklen:

- [src/world/WorldLifecycle.ts](../../src/world/WorldLifecycle.ts) besitzt die World-Instance, ihren Descriptor und den WorldRuntimeContext. Der Host veröffentlicht oder löscht World und Activity über die Netzwerkgrenze.
- [src/world/ActivityLifecycle.ts](../../src/world/ActivityLifecycle.ts) darf erst mit einer aktiven World beginnen und endet vor der World. Das Ende oder Abtrennen einer Activity beendet die World nicht.
- Arena-Aufbau und vollständige Entkopplung liegen beim [ArenaLifecycleCoordinator](../../src/scenes/arena/ArenaLifecycleCoordinator.ts). Ein lokales Runtime-Detach darf die replizierte World-Identität nicht zerstören.
- Außerhalb einer aktiven World sind World- und Activity-Runtime null oder abgebaut. Ein Activity-Start erzeugt keine zweite Welt.

Die zentrale Reihenfolge ist deshalb: World definieren und laden, optional Activity starten, Teilnahme admittieren, lokale Runtime anbinden; beim Abbau zuerst Activity, dann World-Runtime und schließlich die World-Instance lösen. Die konkrete Orchestrierung bleibt im Coordinator und soll nicht in Renderer oder UI kopiert werden.

## Loading ist World- und Activity-bewusst

World Loading erzeugt und rendert die konkrete World-Geometrie und ist an worldRevision gebunden. Round Loading beziehungsweise Activity-Start wartet auf eine resident World und auf die vereinbarten lokalen World-Teilnehmer, ist aber kein Ersatz für World Loading. Eine World ohne Activity kann nach ihrer World-Readiness bereits laufen.

Der Vertrag steht in [src/world/WorldLoadReady.ts](../../src/world/WorldLoadReady.ts) und wird im Coordinator verwendet. Round- oder Mission-State darf nicht in die World-Readiness zurückgeschrieben werden.

## Teilnahme, Rechte und lokale Flächen

[WorldParticipation](../../src/world/WorldParticipation.ts) ist ein eigener, host-authoritativer Vertrag. Die Zustände none, joining, interactive, observer und leaving unterscheiden Teilnahme, Runtime-Eintrag, lokale Figur und Eingaberecht. Activity-Teilnahme, Beobachten und reine Room-Mitgliedschaft sind jeweils eigene Entscheidungen.

Eine Activity kann ihre Teilnehmer und Zuschauer für die World aufnehmen; eine World ohne Activity kann über ihre eigene Participation-Policy selbst Eintritt erlauben. In beiden Fällen entsteht Player-Runtime erst nach dem gültigen World- und Participation-Vertrag.

[WorldPresentation](../../src/world/WorldPresentation.ts), [PresentationPolicy](../../src/world/PresentationPolicy.ts) und [InputPolicy](../../src/world/InputPolicy.ts) bilden daraus reine lokale Projektionen:

- none zeigt keine World-Flächen;
- preview darf replizierte World-Flächen und Overlay-Informationen zeigen, ohne Participation, Runtime-Eintrag oder Rechte zu erzeugen;
- interactive bietet die vollständige lokale World- und HUD-Präsentation nur für gültige Participation an.

Capabilities sind fachliche Domänenrechte, zum Beispiel Bewegung, Kampf, Platzierung, Interaktion oder Kamerasteuerung. InputPolicy beschreibt nur, was lokal angeboten wird; der Host entscheidet und validiert die tatsächliche Aktion. GamePhase oder ein pauschales canPlayerAct dürfen WorldParticipation nicht ersetzen.

World-Replikation, WorldParticipation und lokale Presentation sind drei verschiedene Fragen. [WorldReplication.ts](../../src/world/WorldReplication.ts) erlaubt auch eine aktive Preview ohne lokale Teilnahme; ein Peer kann also passive World-Daten konsumieren, ohne eine Player-Runtime zu besitzen.

## Runtime und Darstellung

Simulation und Präsentation sind entkoppelt. World- und Player-Runtime müssen auf dem Host auch ohne lokale Sprites oder Renderer funktionieren:

- PlayerBody ist der kanonische Laufzeitkörper; PlayerEntity kapselt seine private visuelle Darstellung.
- Physik- und Kollisionsproxy, etwa TreePhysicsProxy, werden aus Runtime-Geometrie gebaut und nicht aus Sprite-Größe abgeleitet.
- Renderer beobachten Runtime-Zustand und besitzen weder Treffer-, Ressourcen- noch Spawn-Autorität.
- PlayerWorldRuntime beschreibt die gemeinsam benötigten Features und macht sichtbar, welche Simulation nur der Host ausführt. World-scoped Player-Build- oder Item-Zustände dürfen auch ohne Activity existieren; missionsgebundener Zustand bleibt Activity-spezifisch.

Für PersistentBase trennt derselbe Vertrag die Ebenen: Die World bindet Site, Basiskern, Lage, Baubereich und World-Parameter; persönlicher Progress besitzt die dauerhaften Blueprints; Runtime/Working Copy materialisiert den aktuellen bearbeitbaren Zustand. Ohne aktive Mission committed der Host validierte Änderungen sofort; eine Activity/Round kann ihren Working State committen oder verwerfen. Der Host hat Authority über Materialisierung, Validierung, Merge und Simulation, ist dadurch aber nicht fachlicher Eigentümer der Konstruktionen.

Die Verträge sind in [PlayerWorldRuntime.ts](../../src/world/PlayerWorldRuntime.ts), [PlayerCapabilities.ts](../../src/world/PlayerCapabilities.ts) und den Tests [PlayerTreeRuntimeContracts.test.ts](../../tests/PlayerTreeRuntimeContracts.test.ts), [WorldPresentationContracts.test.ts](../../tests/WorldPresentationContracts.test.ts) und [WorldWithoutActivityProof.test.ts](../../tests/WorldWithoutActivityProof.test.ts) verankert.

## Geometrie und World-Kontext

Eine World hat genau eine aufgelöste Layout-Quelle. [WorldLayout.ts](../../src/world/WorldLayout.ts) entscheidet zwischen authored Layout und deterministischem Generator; beide erfüllen denselben ArenaLayout-Vertrag. Das Ergebnis muss aus World-Identität und Seed reproduzierbar sein und liefert einen Fingerprint für Paritätsprüfungen. Activity besitzt keine eigene Geometriequelle.

WorldMetrics sind an die konkrete World gebunden. Neue World-Systeme erhalten Metrics explizit; mutable Arena-Konfiguration ist nur Kompatibilitätsspiegel und keine Primärquelle. [WorldRuntimeContext.ts](../../src/world/WorldRuntimeContext.ts) hält World-Identität, Definition, Metrics, Basen und persistente Site, aber keine Activity-Systeme, Gegner, Missions- oder Respawn-Zustände.

Die Lobby ist ein normales authored World mit der Definition world:lobby. Sie nutzt das gemeinsame World-Lifecycle-, Layout- und Renderer-Modell, kann ohne Activity bestehen und hat keine Ambient-Simulation oder Sonder-Scene. Ihre Player-Beziehungen folgen dem aktuell gewaehlten GameMode: Deathmatch ist FFA, Coop ist vollstaendig verbuendet und Team-Deathmatch/CTB nutzen die autoritative Teamzuweisung. Die laufende Coop-Player-Build-Projektion bleibt vom Ready-Commit getrennt und darf in dieser Activity-losen World wirken; Missionssysteme bleiben Activity-gebunden. Ihre authored Definition liegt in [lobbyWorld.ts](../../src/config/authoring/lobbyWorld.ts), ihre Geometrie in [LobbyWorldLayout.ts](../../src/arena/LobbyWorldLayout.ts).

## Erweiterungsregeln

Bei einem neuen Feature zuerst seinen Owner bestimmen:

1. World-Identität, Layout, Metrics, Basis oder persistente Site gehören in World-Definition, WorldRuntimeContext oder WorldLifecycle.
2. Dauerhafte Blueprint-Beiträge gehören in persönlichen Progress; materialisierte Konstruktionen und der bearbeitbare Zustand gehören in Runtime beziehungsweise Missions-Working-Copy. Eine persistente World ohne Mission committed host-validierte Änderungen sofort; Activity/Round liefert für ihren Working State den Ausgang und die Commit-/Rollback-Entscheidung, nicht den dauerhaften Eigentümer.
3. Ziel, Timer, Gegner, Mission, Round-Events oder Aktivitätsprogress gehören in Activity-Definition und Activity-Systeme.
4. Admission, Beobachten und World-Eingaben gehören in WorldParticipation, Capabilities und NetworkBridge.
5. Sichtbarkeit, Kamera, FX und Overlay gehören in Presentation, Renderer oder Effects.
6. Ein neues Netzwerkobjekt braucht eine explizite Identität und, für World-Daten, worldRevision-Bindung.

Keine neue Abstraktion darf World und Activity wieder über ein Mode-Flag oder eine globale Mutable-State-Spiegelung vermischen.

## Maßgebliche Einstiegspunkte

- [src/scenes/arena/ArenaLifecycleCoordinator.ts](../../src/scenes/arena/ArenaLifecycleCoordinator.ts)
- [src/world/WorldDescriptor.ts](../../src/world/WorldDescriptor.ts)
- [src/world/ActivityDescriptor.ts](../../src/world/ActivityDescriptor.ts)
- [src/world/WorldParticipation.ts](../../src/world/WorldParticipation.ts)
- [src/world/WorldRuntimeContext.ts](../../src/world/WorldRuntimeContext.ts)
- [tests/WorldChannelContracts.test.ts](../../tests/WorldChannelContracts.test.ts)
- [tests/WorldRoundLoadingContracts.test.ts](../../tests/WorldRoundLoadingContracts.test.ts)
