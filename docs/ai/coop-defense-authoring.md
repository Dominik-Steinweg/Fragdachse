# Coop-Defense-Authoring

## Geltungsbereich

Coop Defense ist eine Activity auf einer World. Diese Seite beschreibt die stabile Aufteilung von authored Daten und die Grenzen für neue Missionen. Balancewerte, aktuelle Map-Listen und konkrete Eventdaten bleiben in authored JSON, Resolvern und Tests.

## Aufteilung des Authorings

[src/config/authoring/coopDefenseAuthoringAdapter.ts](../../src/config/authoring/coopDefenseAuthoringAdapter.ts) nimmt den bereits normalisierten und validierten Coop-Defense-Map-Vertrag entgegen und projiziert ihn in zwei Verträge:

- World-Inhalt: Arena-Geometrie und Metrics, Rocks und Trees, Track-Daten, World-Zeitbasis, World-Basen und die optionale persistente Base-Site.
- Activity-Inhalt: Objective und Überlebensregeln, Respawns, Encounters, Spawns, Map-Events, Secondary Objectives, Missionsprogress, Boss, Power-Ups, Item-Drops, dynamische Activity-Umgebung und Tutorial.

Der Adapter normalisiert nicht erneut, materialisiert keine Defaults und ersetzt keine Validierung. Änderungen am Eingabeformat werden am normalisierten Map-Vertrag und am Round-Trip abgesichert; die Quelle bleibt die authored Definition, nicht die Adapterimplementierung.

Eine Activity referenziert ihre World über worldDefinitionId und liefert keine alternative Layout- oder Metrics-Quelle. Dadurch kann dieselbe World ohne Activity geladen, angezeigt oder activity-unabhängig resident gehalten werden.

Die optionale World-seitige persistentBase-Konfiguration entspricht CoopDefenseMapPersistentBaseConfig und verwendet persistentBase.baseId als Verweis auf eine bestehende authored freundliche Main-Base. Die Map-Normalisierung prüft die Referenz und räumliche Reservierung; sie ist kein freier Runtime- oder Campaign-Key.

**Bereits normalisierte Coop-Configs nicht erneut normalisieren.** `normalizeCoopDefenseMapConfig()` ist nicht idempotent: Der erste Lauf materialisiert zum Beispiel den Default für `front`; zusammen mit einer authored `spawnArea` kann ein zweiter Lauf an der gegenseitigen Ausschließlichkeit scheitern. Adapter erhalten daher bereits normalisierte Configs.

## Basen und Overlays

Eine Basis ist zunächst World-Geometrie und World-Identität: Position, Form, Faction, Rolle, maximale Struktur, Turrets und Spawn-Zentrum gehören zur World. Startzustand, Spieler-Skalierung, Dormancy und missionsbezogene Pedestals sind Activity-Overlay.

Die dauerhafte Base-Konfiguration ist nicht mit dem laufenden HP- oder Cooldown-Zustand gleichzusetzen. Solche Laufzeitwerte gehören zur Activity-Simulation oder zur Replikation, nicht zum authored PersistentBase-Zustand.

## Mission und Zeit

Der Host besitzt Objective, Pressure, Wellen, Gegner, Events, Missionsprogress und das Ergebnis. Clients visualisieren replizierte Activity-Daten und senden Aktionen; sie konstruieren keine Mission aus lokaler Uhr oder lokaler Presentation.

Fachliche Zeit folgt der Activity-/Round-Simulation und den replizierten Zuständen. Date.now, lokale Renderzeit und Browser-Takt dürfen keine Entscheidungen über Sieg, Niederlage, Spawns oder Missionsfortschritt treffen. Darstellung darf zwischen validierten Zuständen interpolieren.

`after-defense` bedeutet, dass die referenzierte Defense terminal aufgelöst ist: `completed` oder `failed`. Es bedeutet nicht „nach erfolgreicher Defense“. Ob ein fehlgeschlagenes Hold die gesamte Mission beendet, entscheidet separat das authored Flag `failureEndsMission`.

## Persistente Base

Die persistente Base ist eine World-Site mit mission-local working copy:

- [PersistentBaseRepository.ts](../../src/persistentBase/PersistentBaseRepository.ts) bildet die lokale Speicherung als Domänengrenze ab.
- [PersistentBaseSession.ts](../../src/persistentBase/PersistentBaseSession.ts) lädt einen Baseline-Zustand, führt die missionslokale Arbeitskopie und entscheidet Commit oder Discard.
- [PersistentBaseRoomState.ts](../../src/persistentBase/PersistentBaseRoomState.ts) hält host-authoritativen Guest-Zustand im Raum und nicht im LocalStorage.
- [PersistentBaseRoundOutcome.ts](../../src/persistentBase/PersistentBaseRoundOutcome.ts) koppelt Sieg an Commit und Niederlage, Abbruch oder fehlendes Ergebnis an Rollback.
- [PersistentBaseRestorePlanner.ts](../../src/persistentBase/PersistentBaseRestorePlanner.ts) stellt Pläne deterministisch wieder her und behandelt gesperrte, unbekannte, außerhalb liegende oder kollidierende Einträge ohne stillen Weltumbau.

Persistiert werden nur validierte, permanente host-owned Platzierungen. Runtime-IDs, HP, Cooldowns und temporäre Beziehungsdaten bleiben aus dem PersistentBase-Blueprint heraus. Die authored Site liefert Radius und räumliche Bindung; der Laufzeitzustand gehört in die lokale Progress- und Room-Grenze.

## Erweiterung einer Mission

Bei einer neuen Activity oder Map zuerst entscheiden, welche Daten World-weit und welche Activity-spezifisch sind. Danach:

1. authored Definition und Registry-Eintrag anlegen;
2. den vorhandenen Resolver/Adapter und die Validatoren verwenden;
3. World- und Activity-Descriptor mit derselben World-Identität prüfen;
4. host-authoritative Runtime und replizierten Snapshot ergänzen;
5. Persistenz nur über die PersistentBase- und LocalPersistence-Verträge anbinden;
6. passende Contract- und Round-Trip-Tests aktualisieren.

Neue Map-Geometrie in Activity-Systemen, lokale Mission-Uhren oder konkrete Testwerte in dieser Seite wären Vertragsverletzungen.

## Einstiegspunkte und Tests

- [src/config/coopDefenseMaps.ts](../../src/config/coopDefenseMaps.ts)
- [src/config/authoring/ActivityDefinition.ts](../../src/config/authoring/ActivityDefinition.ts)
- [src/config/authoring/coopDefenseAuthoringAdapter.ts](../../src/config/authoring/coopDefenseAuthoringAdapter.ts)
- [src/scenes/arena/ArenaLifecycleCoordinator.ts](../../src/scenes/arena/ArenaLifecycleCoordinator.ts)
- [tests/WorldWithoutActivityProof.test.ts](../../tests/WorldWithoutActivityProof.test.ts)
- [tests/PersistentBaseSession.test.ts](../../tests/PersistentBaseSession.test.ts)
- [tests/PersistentBaseRoundOutcome.test.ts](../../tests/PersistentBaseRoundOutcome.test.ts)
- [tests/PersistentBaseRestorePlanner.test.ts](../../tests/PersistentBaseRestorePlanner.test.ts)
