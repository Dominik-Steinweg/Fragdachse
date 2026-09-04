# Gameplay

## Geltungsbereich

Diese Seite hält die fachlichen Grenzen zwischen World-Spielraum, Activity/Runde, lokaler Eingabe und Player-Runtime fest. Konkrete Gegnerwerte, Waffenbalance, Map-Inhalte und Ablaufdetails gehören in authored Daten, Systems oder Tests.

## Host-authoritative Spielregeln

Der Host entscheidet Simulation, Treffer, Ressourcen, Spawns, Ziele, Rundenzustand und persistente Ergebnisse. Clients senden Eingaben oder Aktionen; eine lokale Prediction oder ein UI-Zustand ist kein Beweis für eine erlaubte Aktion.

Die zuständige Netzwerkschnittstelle ist [NetworkBridge.ts](../../src/network/NetworkBridge.ts). Gameplay darf weder PeerJS noch Wire-Channel direkt importieren.

## WorldParticipation und Fähigkeiten

[WorldParticipation.ts](../../src/world/WorldParticipation.ts) ist nicht aus GamePhase, RoundParticipation oder canPlayerAct abzuleiten. Room-Mitgliedschaft, World-Admission, Activity-Teilnahme und lokale Presentation sind getrennte Zustände.

Der Host veröffentlicht die Participation. joining, interactive, observer und leaving können unterschiedliche Runtime- und Rechtefolgen haben; none bedeutet keine World-Teilnahme. Ein observer darf World-Daten und eine spectatorische Presentation erhalten, aber keine interaktive Player-Aktion senden.

[PlayerCapabilities.ts](../../src/world/PlayerCapabilities.ts) beschreibt die fachliche Erlaubnis in einzelnen Domänen, etwa Bewegung, Combat, Platzierung, Dismantling, Interaktion, Missionsaktionen und Kamerasteuerung. [InputPolicy.ts](../../src/world/InputPolicy.ts) entscheidet daraus zusammen mit lokalem UI-, Countdown- und Diagnosezustand, welche Eingabe angeboten wird. Der Host revalidiert die Aktion unabhängig davon.

## World, Activity und Runde

World-Zustand umfasst dauerhafte Geometrie, Basen, World-Sites, World-Identität und WorldParticipation. Activity- und Round-Zustand umfasst Ziele, Timer, Gegner, Wellen, Missionsprogress, Respawns, Events und Ergebnis. Eine World ohne Activity ist ein gültiger Betriebszustand; ein Activity-Start darf World-Geometrie oder World-Identity nicht heimlich neu erzeugen.

World Loading ist an worldRevision gebunden. Round Loading wartet auf die World-Readiness und die für den Aktivitätsstart nötigen Teilnehmer, bleibt aber ein eigener Vertrag. Siehe [WorldLoadReady.ts](../../src/world/WorldLoadReady.ts) und [WorldRoundLoadingContracts.test.ts](../../tests/WorldRoundLoadingContracts.test.ts).

## RoundParticipation bleibt separat

[RoundParticipationPolicy.ts](../../src/scenes/arena/RoundParticipationPolicy.ts) bildet den Teilnehmer-Snapshot einer laufenden Runde ab und ist nicht mit WorldParticipation zu vermischen:

- `participantIds` ist die unveränderliche Kohorte beim Rundenstart. Ein Late Joiner wird nur Spectator und nicht rückwirkend Teilnehmer dieser Runde.
- Ein aktiver Teilnehmer kann während derselben Runde nach `spectatorIds` wechseln; die historische Zugehörigkeit in `participantIds` bleibt erhalten.
- Spawn, Respawn, Reward und Ergebnisberechtigung verwenden die effektive aktuelle Rolle. Ein separates authored Respawn-Budget oder andere Eligibility-Regeln bleiben davon unabhängig.
- Die nächste Runde erzeugt einen neuen Teilnehmer-Snapshot. WorldParticipation beantwortet weiterhin die World-Aufnahme und ist kein Ersatz für diese Rundengrenze.

## Player-Runtime

[PlayerWorldRuntime.ts](../../src/world/PlayerWorldRuntime.ts) liefert eine gemeinsame Feature-Beschreibung für Entity, Navigation, Combat, Ressourcen, Loadout, Targeting, World-scoped Player-Build und Missionsstatus. Autoritative Simulationsfeatures sind hostgebunden; ein Client darf keinen Serverzustand aus einer lokalen Visualisierung herstellen. Build- und Item-Modifikatoren können in einer Activity-losen World laufen, während Missionsstatus Activity-spezifisch bleibt.

Die Runtime kann ohne Renderer oder lokale Phaser-Szene existieren. PlayerBody ist der kanonische physische Körper; PlayerEntity kapselt ihn und die optionale Sprite-Präsentation. Attach- und Detach-Operationen sind atomar und müssen bei einem Fehler zurückrollen.

`WorldPlayerGameplayRuntime` besitzt den World-Lifetime der Player-Gameplay-Systeme und stellt nach außen nur benannte Lifecycle-, Action-, Read-, Resource- und Combat-Integration-Ports bereit. Activity-, Construction-, Support-, Host- und Client-Adapter konsumieren diese semantischen Sichten; sie traversieren weder den internen Child-Graphen noch greifen sie auf `.systems` zu. Die Runtime bleibt dabei ohne Renderer, ArenaContext und direkte NetworkBridge-Abhängigkeit.

## Eingaben und Aktionen

World-scoped Aktionen werden an die aktuelle worldRevision gebunden und vor dem Handler zentral geprüft. Activity- oder Round-Aktionen erhalten zusätzlich die fachlich nötige Activity-/Round-Identität. Ein alter Client kann so weder nach einem World-Wechsel noch nach einem Activity-Wechsel veraltete Aktionen ausführen.

Temporäre Utilities sind keine Mutation des ausgerüsteten Utility-Slots. [TemporaryUtilityCollection.ts](../../src/loadout/TemporaryUtilityCollection.ts) besitzt hostseitig jede Aufnahme als eigene Instanz mit stabiler `instanceId`, Erwerbsreihenfolge, Charges und Cooldown. Auswahl, Use-RPC, Radialzustand und Objective-Placement referenzieren diese Instanzidentität; mehrere Instanzen desselben Utility-Typs bleiben deshalb unabhängig. Clients rekonstruieren daraus nur Präsentation und Auswahl und erzeugen weder beim Pickup-ACK noch beim lokalen Einsatz eigenen Bestand.

Für ein neues Eingabefeld oder eine neue Aktion zuerst festlegen:

- Welcher Capability-Bereich ist betroffen?
- Ist es World-, Activity-, Round- oder rein lokale Interaktion?
- Welcher Host-Handler validiert sie?
- Welche replizierte Bestätigung verändert die sichtbare Darstellung?

## Fachliche Zeit

Aktivitäts- und Rundensysteme arbeiten mit ihrer definierten Simulationszeit und replizierten Zuständen. Wellen, Gegner, Events und Ziele dürfen für fachliche Entscheidungen nicht von lokaler Wanduhr oder Date.now abhängen. Die Darstellung darf interpolieren, bleibt aber gegenüber Host-Zustand und Revisionen nachgeordnet.

## Verifikation und Einstiegspunkte

- [src/world/PlayerCapabilities.ts](../../src/world/PlayerCapabilities.ts)
- [src/world/InputPolicy.ts](../../src/world/InputPolicy.ts)
- [src/world/PlayerWorldRuntime.ts](../../src/world/PlayerWorldRuntime.ts)
- [tests/PlayerCapabilityContracts.test.ts](../../tests/PlayerCapabilityContracts.test.ts)
- [tests/PlayerWorldRuntimeContracts.test.ts](../../tests/PlayerWorldRuntimeContracts.test.ts)
- [tests/SharedWorldWithoutActivity.test.ts](../../tests/SharedWorldWithoutActivity.test.ts)
- [tests/TemporaryUtilityLifecycle.test.ts](../../tests/TemporaryUtilityLifecycle.test.ts)
- [tests/RadialActionInput.test.ts](../../tests/RadialActionInput.test.ts)
