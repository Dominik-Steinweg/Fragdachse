# Coop-Defense-Authoring

## Geltungsbereich

Coop Defense ist eine Activity auf einer World. Diese Seite beschreibt die stabile Aufteilung von authored Daten und die Grenzen für neue Missionen. Balancewerte, aktuelle Map-Listen und konkrete Eventdaten bleiben in authored JSON, Resolvern und Tests.

## Aufteilung des Authorings

[src/config/authoring/coopDefenseAuthoringAdapter.ts](../../src/config/authoring/coopDefenseAuthoringAdapter.ts) nimmt den bereits normalisierten und validierten Coop-Defense-Map-Vertrag entgegen und projiziert ihn in zwei Verträge:

- World-Inhalt: Arena-Geometrie und Metrics, Rocks und Trees, Track-Daten, World-Zeitbasis, World-Basen und die optionale persistente Base-Site.
- Activity-Inhalt: Objective und Überlebensregeln, Respawns, Encounters, Spawns, Map-Events, Secondary Objectives, Missionsprogress, Boss, Power-Ups, Item-Drops, dynamische Activity-Umgebung und Tutorial.

Der Adapter normalisiert nicht erneut, materialisiert keine Defaults und ersetzt keine Validierung. Änderungen am Eingabeformat werden am normalisierten Map-Vertrag und am Round-Trip abgesichert; die Quelle bleibt die authored Definition, nicht die Adapterimplementierung.

Eine Activity referenziert ihre World über worldDefinitionId und liefert keine alternative Layout- oder Metrics-Quelle. Dadurch kann dieselbe World ohne Activity geladen, angezeigt oder activity-unabhängig resident gehalten werden.

Die optionale World-seitige persistentBase-Konfiguration entspricht CoopDefenseMapPersistentBaseConfig und beschreibt die Stelle des Basiskerns sowie seine Baubereich-Regel: baseId, Anker, Ausrichtung, optional ein `square`- oder `radius`-Bereich und Grunddauerhaftigkeit. Ohne explizite authored Regel gilt der definierte Default. Die Kernform ist Code-Definition; die Map-Normalisierung erzeugt daraus den `bases`-Eintrag und prüft die räumliche Reservierung. Eine Map, die dieselbe baseId zusätzlich selbst in `bases` beschreibt, wird abgelehnt: Zwei Beschreibungen derselben Basis könnten über Maps hinweg auseinanderlaufen.

**Bereits normalisierte Coop-Configs nicht erneut normalisieren.** `normalizeCoopDefenseMapConfig()` ist nicht idempotent: Der erste Lauf materialisiert zum Beispiel den Default für `front`; zusammen mit einer authored `spawnArea` kann ein zweiter Lauf an der gegenseitigen Ausschließlichkeit scheitern. Adapter erhalten daher bereits normalisierte Configs.

## Basen und Overlays

Eine Basis ist zunächst World-Geometrie und World-Identität: Position, Form, Faction, Rolle, maximale Struktur, Turrets und Spawn-Zentrum gehören zur World. Startzustand, Spieler-Skalierung, Dormancy und missionsbezogene Pedestals sind Activity-Overlay.

Die dauerhafte Base-Konfiguration ist nicht mit dem laufenden HP- oder Cooldown-Zustand gleichzusetzen. Solche Laufzeitwerte gehören zur Activity-Simulation oder zur Replikation, nicht zum authored PersistentBase-Zustand.

## Mission und Zeit

Der Host hat die Authority über Objective, Pressure, Wellen, Gegner, Events, Missionsprogress und das Ergebnis. Clients visualisieren replizierte Activity-Daten und senden Aktionen; sie konstruieren keine Mission aus lokaler Uhr oder lokaler Presentation.

Fachliche Zeit folgt der Activity-/Round-Simulation und den replizierten Zuständen. Date.now, lokale Renderzeit und Browser-Takt dürfen keine Entscheidungen über Sieg, Niederlage, Spawns oder Missionsfortschritt treffen. Darstellung darf zwischen validierten Zuständen interpolieren.

`after-defense` bedeutet, dass die referenzierte Defense terminal aufgelöst ist: `completed` oder `failed`. Es bedeutet nicht „nach erfolgreicher Defense“. Ob ein fehlgeschlagenes Hold die gesamte Mission beendet, entscheidet separat das authored Flag `failureEndsMission`.

## Persistente Base

Die persistente Base ist eine World-Site. Ihre sichtbare Runtime-Zusammensetzung entsteht aus der authored Site und den persönlichen Beiträgen der anwesenden Spieler:

- [PersistentBaseTypes.ts](../../src/persistentBase/PersistentBaseTypes.ts) definiert den persönlichen Beitrag samt Sanitizing für Speicher und Netzwerk.
- [PersistentBaseComposite.ts](../../src/persistentBase/PersistentBaseComposite.ts) mischt authored Geometrie, Host-Beitrag und Gastbeiträge deterministisch zu einem reinen Ergebnis.
- [PersistentBaseContributionStore.ts](../../src/persistentBase/PersistentBaseContributionStore.ts) hält den host-seitigen Zustand aller Beiträge; in der Lobby als direkten committed Stand, in einer Mission als Working State.
- [PersistentBaseRoundOutcome.ts](../../src/persistentBase/PersistentBaseRoundOutcome.ts) koppelt Sieg an Commit und Niederlage, Abbruch oder fehlendes Ergebnis an Rollback.

Es gibt genau einen Besitzpfad: Der dauerhafte Blueprint-Besitz liegt im persönlichen Progress des jeweiligen Besitzers, unabhängig davon, ob dieser im aktuellen Raum Host oder Gast ist. Die Base-Site und die Activity besitzen keine persönlichen Konstruktionen. Der hostseitige Store materialisiert und bearbeitet sie laufzeitbezogen: ohne Mission mit sofortigem Commit, in einer Mission über die Working Copy. Freischaltung, Loadout und Kapazität gelten je Besitzer, nicht je Host und nicht als gemeinsamer Basis-Pool.

Die Priorität des Merges ist authored Geometrie, dann der Beitrag des Raum-Hosts, dann Gastbeiträge; „Host-Beitrag“ bezeichnet dabei die aktuelle Raumrolle, nicht eine zusätzliche Besitzklasse. Gäste werden nach stabiler Besitzeridentität sortiert, damit die Beitrittsreihenfolge das Ergebnis nicht verändert. Ein Konflikt materialisiert nicht und löscht nichts: Der Blueprint bleibt im Beitrag seines Besitzers und kann in einem anderen Raum wieder erscheinen.

Der Host hat die Authority über Materialisierung, Validierung, Merge-Ergebnis und laufende Simulation. Diese Authority macht ihn nicht zum fachlichen Eigentümer der Beiträge. Eine Activity oder Runde liefert nur Laufzeitregeln und kann den aktuellen Arbeitsstand committen oder verwerfen.

Runtime-IDs, HP, Cooldowns und temporäre Beziehungsdaten bleiben aus dem Blueprint heraus. Die authored Site liefert Anker und Build Area; Generator-Reservation und Baurecht bleiben getrennte Begriffe.

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
- [tests/PersistentBaseContributionStore.test.ts](../../tests/PersistentBaseContributionStore.test.ts)
- [tests/PersistentBaseRoundOutcome.test.ts](../../tests/PersistentBaseRoundOutcome.test.ts)
- [tests/PersistentBaseComposite.test.ts](../../tests/PersistentBaseComposite.test.ts)
