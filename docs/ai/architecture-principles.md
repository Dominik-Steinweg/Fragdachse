# Architektur-Leitbild

## Rolle dieses Dokuments

Diese Seite beschreibt das **Architektur-Zielbild und die Entscheidungsrichtung** von
Fragdachse. Sie ist normativ: Neue Features, Systeme, Zustände, Abstraktionen und Refactorings
sollen nach diesen Prinzipien gestaltet werden.

Die drei Dokumentationsebenen beantworten unterschiedliche Fragen:

```text
Code
→ Was funktioniert aktuell tatsächlich?

architecture-principles.md
→ Nach welchen Prinzipien sollen neue Architekturentscheidungen getroffen werden?

architecture.md und Fachseiten
→ Welche bewusst etablierten aktuellen Verträge existieren?
```

Historisch gewachsener, temporärer oder migrationsbedingter Code kann vom Zielbild abweichen.
Eine solche Abweichung ist weder Präzedenzfall für neuen Code noch automatisch ein Auftrag zum
sofortigen Refactoring. Für technische Fakten gilt weiterhin die Quellenhierarchie aus
[index.md](index.md); die konkrete Runtime beschreibt [architecture.md](architecture.md).

## Leitbild

Fragdachse bevorzugt eindeutige Ownership und Authority, explizite Lifecycles und Verträge,
klare Abhängigkeitsgrenzen und einfache konkrete Lösungen. Fachliche Wahrheiten haben einen
bestimmbaren Owner; Replikation, Persistenz und Darstellung bleiben davon abgeleitete Grenzen.

## Kernprinzipien

### 1. Authority, Ownership und Single Source of Truth

Für veränderlichen fachlichen Zustand muss bestimmbar sein:

- Wer besitzt ihn?
- Wer darf ihn verändern?
- Welche Darstellung ist kanonisch?
- Welche Kopien sind nur Snapshots, Caches, Read Models oder Projektionen?
- Wie werden diese Kopien aktualisiert, invalidiert und zerstört?

Single Source of Truth bedeutet eine fachliche Authority, nicht zwingend eine physische Kopie.
Mehrere Repräsentationen sind legitim, wenn ihre Ableitungsrichtung eindeutig ist und kein
zweiter Writer dieselbe Entscheidung unabhängig trifft.

### 2. Lifetime und Scope sind explizit

Zustand gehört in den kleinsten Scope, der seine vollständige fachliche Lifetime abdeckt. Ein
langlebiger Owner soll kurzlebigen Zustand weder implizit besitzen noch aus indirekten Flags
rekonstruieren. Entstehung, Übergänge, Invalidierung und Teardown sind Teil des Vertrags.

Konkrete Beziehungen zwischen Room-, World-, Activity-, Participation-, Round- und
Presentation-Scope stehen in [architecture.md](architecture.md) und [gameplay.md](gameplay.md).
Für neue Scopes gilt dasselbe Prinzip: Beziehung und Lifetime werden modelliert, nicht erraten.

### 3. Klare Grenzen und Abhängigkeitsrichtung

Die bevorzugte Abhängigkeitsrichtung für neuen Code ist:

```text
Composition / Scene
        ↓
Lifecycle / Use Cases / Orchestration
        ↓
Runtime / Domain / Simulation
        ↓
Pure Rules / Policies
```

Scenes und Coordinatoren verdrahten und ordnen Abläufe; fachliche Regeln gehören ihren Domain-
und Runtime-Ownern. Untere Regeln sollen nicht von oberen Composition-Details abhängen.
Abhängigkeiten über Grenzen werden als möglichst kleine, stabile Verträge ausgedrückt.

### 4. Eine Verantwortung, aber keine künstlich kleinen Klassen

SRP wird nach Owner, Authority, Lifetime und unabhängigem Änderungsgrund beurteilt. Dateigröße,
Importanzahl oder viele konkrete Abhängigkeiten sind allein kein Architekturproblem.
Composition Roots und echte Coordinatoren dürfen bewusst breit sein.

Eine Extraktion braucht einen eigenständigen Owner oder Vertrag. Eine God Class nur in eng
gekoppelte Helper-Dateien zu verteilen verbessert die Architektur nicht. Die Leitfrage lautet:

> Kann der Zweck der Einheit in einem kurzen Satz beschrieben werden, ohne mehrere unabhängige
> „und“-Verantwortlichkeiten aufzuzählen?

### 5. Semantic DRY – eine Regel, ein Owner

Dieselbe fachliche Entscheidung soll nicht an mehreren Stellen unabhängig getroffen werden.
Problematisch sind insbesondere mehrfach implementierte Gameplay-Regeln, Defaults,
Validierungen, Mappings oder mehrere Authorities für denselben Zustand. UI, Network und
Persistence dürfen eine Domain-Regel transportieren oder projizieren, aber nicht nochmals selbst
entscheiden.

Snapshots, Caches, Read Models, replizierte Kopien, UI-Projektionen und syntaktisch ähnlicher
lokaler Code können dagegen legitim sein. Eine gemeinsame Abstraktion entsteht nicht allein,
weil zwei Implementierungen ähnlich aussehen.

> SSOT schützt Zustand und Authority. Semantic DRY schützt Regeln und Entscheidungen.

Wiederhole nicht dieselbe fachliche Wahrheit. Abstrahiere aber auch nicht bloß ähnliche
Implementierung.

### 6. KISS und pragmatische Abstraktion

Eine neue Registry, Event-Schicht, generische Pipeline, Basisklasse oder Schnittstelle braucht
einen konkreten aktuellen Druck: einen stabilen gemeinsamen Vertrag, einen echten zweiten
Consumer, eine notwendige Austauschgrenze oder eine nachgewiesene Kopplung.

Spekulative Variabilität ist kein ausreichender Grund. Zunächst gilt das kleinste verständliche
Modell. SOLID dient als Diagnosewerkzeug; Dependency Injection bedeutet weder einen Container
noch ein Interface für jede Klasse. Semantic DRY verhindert doppelte fachliche Entscheidungen,
KISS verhindert vorschnelle Abstraktionen über bloß ähnliche Implementierung.

### 7. Domain-State bleibt unabhängig von Adaptern

Presentation stellt dar, Network transportiert und repliziert, Persistence speichert. Diese
Grenzen übernehmen keine fachliche Authority, die einem Domain- oder Runtime-Owner gehört.

```text
                  Presentation
                       ↑ liest
                       │
Network ⇄ Verträge ⇄ Domain / Runtime ⇄ Verträge ⇄ Persistence
```

Das Diagramm beschreibt Ownership, nicht zwingend synchrone Aufrufrichtung.

- Presentation beobachtet fachlichen Zustand; Simulation hängt nicht von Sprites, UI oder
  lokalen Effekten ab. Die etablierte Player-/World-Trennung illustriert dieses Prinzip in
  [rendering.md](rendering.md).
- Network validiert und überträgt Zustände und Aktionen, entscheidet aber keine Gameplay-Regel
  ein zweites Mal. Konkrete Autoritäts-, Identitäts- und Snapshot-Verträge stehen in
  [networking.md](networking.md).
- Persistence liest und schreibt validierte langlebige Dokumente. Laufender Runtime-State und
  Commit-/Migrationssemantik beschreibt [local-persistence.md](local-persistence.md).
- Authored Content wird über seine Resolver und Validatoren eingebunden; konkrete Definitionen
  und Auflösungsregeln stehen in [content-and-config.md](content-and-config.md).

### 8. Explizite Verträge und kontrollierte Migrationen

Identität, gültige Zustände, Fehlergrenzen und fachlich relevante Reihenfolge müssen im Code
sichtbar sein. Wo Interleaving Verhalten verändert, ist explizite Orchestrierung einer
verdeckenden Event- oder Scheduler-Magie vorzuziehen. Wichtige Invarianten gehören in Types,
Validatoren oder passende Contract-Tests.

Compatibility-Code ist eine gerichtete Übergangsgrenze, keine zweite Wahrheit. Bei einem
Cutover wird ein neuer Owner eingeführt, Aufrufer werden schrittweise migriert und alte Pfade
anschließend entfernt oder sichtbar abgelehnt. Kein versteckter Legacy-Fallback darf fehlende
Authority kaschieren. Verhalten, relevante Reihenfolge und Fehlersemantik bleiben während der
Migration erhalten; Big-Bang-Rewrites brauchen einen zwingenden Grund.

## Prüfliste vor einem größeren Feature

1. Welche fachliche Wahrheit oder welcher Zustand wird eingeführt?
2. Wer besitzt ihn und wer ist der authoritative Writer?
3. Welche Lifetime und welchen Scope besitzt er?
4. Ist er kanonisch oder eine Projektion; wie wird diese synchronisiert und invalidiert?
5. Existiert dieselbe fachliche Regel oder Authority bereits an anderer Stelle?
6. Welche Domain-, Adapter- oder Composition-Grenze ist betroffen?
7. Erweitert die Änderung eine Einheit um einen unabhängigen Änderungsgrund?
8. Ist eine neue Abstraktion durch einen konkreten aktuellen Druck gerechtfertigt?
9. Welche Reihenfolge, Identität und Fehlergrenze müssen explizit bleiben?
10. Welche Invariante gehört in Types, Validatoren oder Tests?

Danach die kleinste passende Vertragsseite im [AI-Router](index.md) lesen.

## Refactoring-Grundsätze für gewachsene Strukturen

- Nicht nach Dateigröße refactoren, sondern nach Authority, Lifetime, Zuständigkeit,
  Änderungsgrund und Abhängigkeitsrichtung.
- Composition Roots und echte Coordinatoren dürfen breit bleiben. Eine Extraktion braucht einen
  neuen Owner oder einen eigenständigen Vertrag.
- Verantwortlichkeiten zuerst kartieren; nicht lediglich Methoden in Helper-Dateien verschieben.
- Neue Owner möglichst neben der bestehenden Struktur einführen und Aufrufer schrittweise
  migrieren.
- Während der Migration nur eine fachliche Authority zulassen. Temporäre Fassaden übersetzen,
  entscheiden aber nicht parallel.
- Verhalten, relevante Reihenfolge und Fehlersemantik durch bestehende Types, Validatoren und
  Tests erhalten.
- Nach dem Cutover alte Pfade entfernen oder sichtbar fehlschlagen lassen; kein stiller
  Legacy-Fallback und kein Big-Bang-Rewrite ohne zwingenden Grund.

## Verhältnis zu Code und Fachseiten

Dieses Leitbild ersetzt weder Code, Types, Validatoren, authored Daten, Tests noch lokale
Kommentare. Es enthält nur langlebige Entscheidungsregeln. Konkrete Runtime-Beziehungen,
Wire-Verträge, Renderer-Pipelines, Persistenzformate, Balancewerte und Migrationsdetails gehören
in [architecture.md](architecture.md), die jeweilige Fachseite oder den Code.
