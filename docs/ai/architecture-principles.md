# Architektur-Leitbild

## Rolle dieses Dokuments

Diese Seite beschreibt das **normative Architektur-Zielbild und die Entscheidungsrichtung** von
Fragdachse. Neue Features, Zustände, Abstraktionen und Refactorings sollen danach gestaltet werden.

Die Dokumentationsebenen beantworten unterschiedliche Fragen:

```text
Code
→ Was funktioniert aktuell tatsächlich?

architecture-principles.md
→ Nach welchen Prinzipien sollen neue Architekturentscheidungen getroffen werden?

architecture.md und Fachseiten
→ Welche bewusst etablierten aktuellen Verträge existieren?
```

`architecture-principles.md` ist die bewusst normative Ausnahme innerhalb von `docs/ai`: Es darf
vom Ist-Code abweichen und behauptet keine vollständige Umsetzung. Für technische Fakten gilt die
Quellenhierarchie aus [index.md](index.md); die konkrete Runtime beschreibt [architecture.md](architecture.md).
Eine Abweichung ist weder Präzedenzfall noch automatischer Refactoring-Auftrag.

## Leitbild

Fragdachse bevorzugt eindeutige Ownership und Authority, explizite Lifecycles und Verträge,
klare Abhängigkeiten und einfache konkrete Lösungen; Replikation, Persistenz und Darstellung
bleiben abgeleitete Grenzen.

## Kernprinzipien

### 1. Authority, Ownership und Single Source of Truth

Für veränderlichen fachlichen Zustand müssen Owner, authoritative Writer, kanonische Darstellung
und die Rolle jeder Kopie bestimmbar sein; Aktualisierung, Invalidierung und Teardown gehören zum
Vertrag.

Single Source of Truth bedeutet eine fachliche Authority, nicht zwingend eine physische Kopie.
Mehrere Repräsentationen sind legitim, wenn ihre Ableitungsrichtung eindeutig ist und kein zweiter
Writer dieselbe Entscheidung unabhängig trifft.

### 2. Lifetime und Scope sind explizit

Zustand gehört in den kleinsten Scope, der seine vollständige Lifetime abdeckt. Ein langlebiger
Owner soll kurzlebigen Zustand weder implizit besitzen noch aus Flags rekonstruieren. Entstehung,
Übergänge, Invalidierung und Teardown sind Vertragsbestandteile.

Konkrete Beziehungen zwischen Room-, World-, Activity-, Participation-, Round- und
Presentation-Scope stehen in [architecture.md](architecture.md) und [gameplay.md](gameplay.md).

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

Scenes und Coordinatoren ordnen Abläufe; fachliche Regeln gehören Domain- und Runtime-Ownern.
Untere Regeln hängen nicht von Composition-Details ab. Grenzen verwenden kleine, stabile Verträge.

### 4. Eine Verantwortung, aber keine künstlich kleinen Klassen

SRP wird nach Owner, Authority, Lifetime und unabhängigem Änderungsgrund beurteilt, nicht nach
Dateigröße oder Importanzahl. Composition Roots und echte Coordinatoren dürfen breit bleiben.
Eine Extraktion braucht einen eigenständigen Owner oder Vertrag; das Verteilen einer eng gekoppelten
God Class auf Helper-Dateien genügt nicht.

Die Leitfrage lautet: Kann der Zweck der Einheit in einem kurzen Satz beschrieben werden, ohne
mehrere unabhängige „und“-Verantwortlichkeiten aufzuzählen?

### 5. Semantic DRY – eine Regel, ein Owner

Dieselbe fachliche Entscheidung soll nicht an mehreren Stellen unabhängig getroffen werden.
Mehrfach implementierte Regeln, Defaults, Validierungen, Mappings oder Authorities sind
problematisch. UI, Network und Persistence transportieren oder projizieren Domain-Regeln, treffen
sie aber nicht erneut.

Snapshots, Caches, Read Models, replizierte Kopien und UI-Projektionen können legitim sein. Eine
gemeinsame Abstraktion entsteht nicht allein durch ähnliche Implementierung.

> SSOT schützt Zustand und Authority. Semantic DRY schützt Regeln und Entscheidungen.

### 6. KISS und pragmatische Abstraktion

Eine Registry, Event-Schicht, Pipeline, Basisklasse oder Schnittstelle braucht konkreten Druck:
gemeinsamen Vertrag, zweiten Consumer, Austauschgrenze oder nachgewiesene Kopplung. Zunächst gilt
das kleinste verständliche Modell. SOLID ist Diagnosewerkzeug; Dependency Injection bedeutet weder
Container noch Interface für jede Klasse. Semantic DRY verhindert doppelte Entscheidungen, KISS
vorschnelle Abstraktionen.

### 7. Domain-State bleibt unabhängig von Adaptern

Presentation stellt dar, Network transportiert und repliziert, Persistence speichert. Keine dieser
Grenzen übernimmt die Authority eines Domain- oder Runtime-Owners.

```text
                  Presentation
                       ↑ liest
                       │
Network ⇄ Verträge ⇄ Domain / Runtime ⇄ Verträge ⇄ Persistence
```

Das Diagramm beschreibt Ownership, nicht zwingend synchrone Aufrufrichtung:

- Presentation beobachtet Zustand; Simulation hängt nicht von Darstellung ab ([rendering.md](rendering.md)).
- Network validiert und überträgt, entscheidet aber keine Gameplay-Regel erneut ([networking.md](networking.md)).
- Persistence liest und schreibt validierte Dokumente; Runtime- und Commit-/Migrationssemantik stehen in
  [local-persistence.md](local-persistence.md).
- Authored Content wird über Resolver und Validatoren eingebunden ([content-and-config.md](content-and-config.md)).

### 8. Explizite Verträge und kontrollierte Migrationen

Identität, gültige Zustände, Fehlergrenzen und relevante Reihenfolge müssen im Code sichtbar sein.
Wo Interleaving Verhalten verändert, ist explizite Orchestrierung verdeckender Event- oder
Scheduler-Magie vorzuziehen. Invarianten gehören in Types, Validatoren oder Contract-Tests.

Compatibility-Code ist eine gerichtete Übergangsgrenze, keine zweite Wahrheit: Neuer Owner und
schrittweise migrierte Aufrufer ersetzen alte Pfade, die danach entfernt oder sichtbar abgelehnt
werden. Kein versteckter Legacy-Fallback kaschiert fehlende Authority; Verhalten, Reihenfolge und
Fehlersemantik bleiben erhalten. Big-Bang-Rewrites brauchen einen zwingenden Grund.

## Prüfliste vor einem größeren Feature

1. Welche fachliche Wahrheit oder welcher Zustand wird eingeführt?
2. Wer besitzt ihn und wer ist der authoritative Writer?
3. Welche Lifetime und welcher Scope gelten?
4. Ist er kanonisch oder Projektion; wie wird sie synchronisiert und invalidiert?
5. Existiert dieselbe Regel oder Authority bereits?
6. Welche Domain-, Adapter- oder Composition-Grenze ist betroffen?
7. Entsteht ein unabhängiger Änderungsgrund?
8. Ist eine neue Abstraktion durch konkreten Druck gerechtfertigt?
9. Welche Reihenfolge, Identität und Fehlergrenze müssen explizit bleiben?
10. Welche Invariante gehört in Types, Validatoren oder Tests?

Danach die kleinste passende Vertragsseite im [AI-Router](index.md) lesen.

## Refactoring-Grundsätze für gewachsene Strukturen

- Verantwortlichkeiten nach Authority, Lifetime, Änderungsgrund und Abhängigkeit kartieren, nicht
  nach Dateigröße; Composition Roots und echte Coordinatoren dürfen breit bleiben.
- Nur für einen neuen Owner oder eigenständigen Vertrag extrahieren, nicht bloß Methoden verschieben.
- Neue Owner neben der bestehenden Struktur einführen und Aufrufer schrittweise migrieren.
- Während der Migration entscheidet nur eine Authority; Fassaden übersetzen, und Types, Validatoren
  und Tests sichern Verhalten, Reihenfolge und Fehlersemantik.
- Nach dem Cutover alte Pfade entfernen oder sichtbar ablehnen; kein stiller Legacy-Fallback und
  kein Big-Bang-Rewrite ohne zwingenden Grund.

## Verhältnis zu Code und Fachseiten

Dieses Leitbild ersetzt weder Code, Types, Validatoren, authored Daten noch Tests. Es enthält
Entscheidungsregeln; konkrete Runtime-, Wire-, Renderer-, Persistenz-, Balance- und
Migrationsdetails gehören in [architecture.md](architecture.md), die Fachseite oder den Code.
