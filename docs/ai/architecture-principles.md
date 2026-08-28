# Architektur-Leitbild

## Zweck und Geltungsbereich

Diese Seite beschreibt, **wie Fragdachse Architekturentscheidungen trifft**. Sie ist der
Entscheidungsfilter für neue Features, Refactorings und neue systemübergreifende Verträge –
keine Klassenreferenz und keine Implementierungschronik.

Die konkrete Runtime-Landkarte steht in [architecture.md](architecture.md). Je nach Änderung
kommen [gameplay.md](gameplay.md), [networking.md](networking.md),
[content-and-config.md](content-and-config.md), [rendering.md](rendering.md) oder
[local-persistence.md](local-persistence.md) hinzu. Bei Widersprüchen gilt weiterhin: aktueller
Quellcode, öffentliche Types und Validatoren, passende Tests, authored Daten, erst danach diese
Seiten.

## Leitbild in einem Satz

Fragdachse entwickelt eine host-authoritative, identitäts- und lifecycle-bewusste Runtime, in der
World, Activity, Teilnahme, Simulation, Replikation, Persistenz und lokale Darstellung jeweils
einen klaren Owner haben und über explizite Verträge zusammenspielen.

## Grundsätze

### 1. Erst fachliche Authority, dann Datenstruktur

Für jeden veränderlichen fachlichen Zustand muss vor der Implementierung feststehen:

- Wer besitzt ihn und wer ist der authoritative Writer?
- In welchem Scope und mit welcher Lifetime lebt er?
- Ist er kanonischer Zustand oder nur Snapshot, Cache, Read Model, UI-Projektion oder Save?
- Wie wird eine Projektion aktualisiert, invalidiert und beim Teardown entfernt?

Single Source of Truth bedeutet semantische Authority, nicht physische Einmaligkeit. Mehrere
Kopien sind zulässig, wenn ihre Richtung und ihr Rückweg eindeutig sind. Ein replizierter
Client-Snapshot, eine lokale Presentation oder ein persistierter Baseline-Snapshot wird dadurch
nicht zur fachlichen Authority.

Verwandte Zustände werden nur dann gemeinsam gehalten, wenn sie dieselbe fachliche Identität,
Lifetime und Änderungsentscheidung besitzen. World und Activity bleiben getrennte Zustände;
eine Activity darf nur an eine passende World gebunden sein.

### 2. Den kleinsten passenden Scope wählen

Jeder Zustand gehört dem kleinsten Scope, der seine fachliche Lifetime vollständig abdeckt:
Application, Room, Scene, World, Activity, Participation, Round, Entity oder Presentation.

Room-Mitgliedschaft ist nicht World-Teilnahme; World-Teilnahme ist nicht Round-Teilnahme; lokale
Sichtbarkeit ist nicht Eingaberecht. Eine World darf ohne Activity oder Round existieren, eine
Activity nicht ohne ihre World. Ein längerer Scope darf keinen kürzeren Zustand dauerhaft
besitzen oder aus globalen Variablen rekonstruieren.

Ein `GameMode` ist Auswahl- oder Authoring-Information, aber kein Ersatz für den Activity-
Lifecycle. Activity-Systeme werden aus dem Activity-Vertrag aktiviert, nicht aus verstreuten
Mode-Flags oder Nullable-Zufallszuständen.

Scope-Wechsel werden über stabile Identitäten, Deskriptoren und Revisionen gebunden. Kein Array-
Index, Phasenflag, lokaler Scene-Verweis oder zufälliger Default darf diese Identität ersetzen.
Veraltete oder nicht zusammengehörige Zustände werden an der Vertragsgrenze verworfen oder
sichtbar abgelehnt.

Ein Context oder Bundle darf Abhängigkeiten für einen Scope bündeln. Es ist dadurch noch kein
neuer Owner: fachlicher Zustand bleibt in seinem Lifecycle, System oder Repository. Insbesondere
darf `WorldRuntimeContext` nicht zum Sammelbecken für Activity- oder Round-State werden.
Entity- und Player-Eintritt beziehungsweise -Austritt laufen über den Owner des jeweiligen
Lifecycles; ein teilweiser Attach wird bei Fehlern zurückgerollt.

### 3. Composition Roots orchestrieren; Systeme besitzen Regeln

Die bevorzugte Abhängigkeitsrichtung für neuen Code ist:

```text
Composition / Scene
        ↓
Lifecycle-, Use-Case- und Update-Orchestrierung
        ↓
Runtime, Entities und Simulationssysteme
        ↓
fachliche Regeln und reine Policies
```

Netzwerk, Persistenz und Presentation sind explizite Adapter- beziehungsweise Ausgabengrenzen:

- `NetworkBridge` und darunterliegende Transport-/Codec-Grenzen validieren, replizieren und
  übertragen Verträge.
- Repositories lesen und schreiben validierte Dokumente.
- Renderer, UI und Effects konsumieren Runtime- oder Netzwerk-Projektionen.

Diese Adapter werden von der Orchestrierung über stabile Verträge genutzt; neue Regel- und
Policy-Logik soll nicht von PeerJS, Wire-Channels, Storage-Keys oder konkreten Sprites abhängen.
Bestehende direkte Kopplungen sind Migrationskandidaten, aber kein Anlass für eine kosmetische
Sofortaufteilung.

### 4. Breite Composition ist erlaubt, breite fachliche Authority nicht

Eine Scene, ein Lifecycle-Coordinator oder ein Dependency-Bundle darf viele konkrete Systeme
kennen. Dateigröße, Importanzahl und die bloße Zahl von Feldern sind für sich kein
Refactoring-Kriterium.

Eine natürliche Extraktion liegt vor, wenn eine Klasse mehrere unabhängige Authorities,
Lifecycles, fachliche Zustände oder Änderungsgründe besitzt. Ziel ist ein eigenständiger Owner
mit verständlichem Vertrag – nicht eine Gruppe eng gekoppelter Helper, die nur die Zeilenzahl
verteilt.

Die Leitfrage lautet:

> Kann der Zweck der Einheit in einem kurzen Satz beschrieben werden, ohne mehrere unabhängige
> „und“-Verantwortlichkeiten aufzuzählen?

### 5. Simulation ist unabhängig von Presentation

Gameplay und Simulationszustand dürfen keine Darstellung voraussetzen. Treffer, Kollision,
Ressourcen, Spawns, Bewegung und Ablaufregeln lesen explizite Runtime-Geometrie und fachliche
Zustände – nicht Sprite-Größen, UI-Zustände oder lokale Kameraeffekte.

Der Host muss die World auch ohne lokale World-Presentation simulieren können. Renderer und UI
beobachten Runtime oder replizierte Projektionen; sie besitzen keine Treffer-, Spawn-, Rechte-
oder Ressourcen-Authority. Presentation- und Input-Policies leiten lokale Angebote ab, erteilen
aber keine Host-Rechte.

### 6. Netzwerk ist eine Grenze, kein Ersatz für Gameplay

Die Netzwerkgrenze verantwortet Transport, Wire-Format, Parsing und Validation, Channel- und
Snapshot-Semantik, Revisionen, Baselines und Replikation. Die fachliche Entscheidung über
Simulation, Treffer, Ressourcen, Spawns, Rundenzustand und Layout bleibt beim Host und seinen
Simulationssystemen.

Gameplay spricht über `NetworkBridge`; PeerJS und konkrete Transportobjekte dürfen nicht in
Gameplay leaken. World- und Activity-Verträge werden mit passender Identität gebunden, World-
und Activity-Wechsel nicht aus lokalen Defaults rekonstruiert. Für jeden neuen replizierten
Zustand sind mindestens Owner, Identität, Revision, Channel, Baseline, Update-Semantik und
Lebensdauer festzulegen.

### 7. Persistenz liefert Baselines, nicht laufende Runtime-Authority

Settings, Progress und Persistent-Base-Dokumente werden an der Persistenzgrenze gelesen,
validiert, migriert und atomar geschrieben. Runtime-Systeme greifen nicht auf Storage-Keys zu.

Während einer Session ist der typisierte Runtime- beziehungsweise Session-Zustand kanonisch.
Eine Persistenzkopie, eine missionslokale Working Copy und host-authoritativer Room-State sind
unterschiedliche Zustände mit explizitem Commit-, Discard- oder Rollback-Vertrag. Temporäre
Runtime-IDs, HP, Cooldowns und Renderobjekte gehören nicht in einen dauerhaften Blueprint.
Fehlgeschlagene Speicherung darf weder still eine zweite Authority erzeugen noch einen gültigen
In-Memory-Zustand unbrauchbar machen.

### 8. Authored Content und deterministische Auflösung sind Verträge

World- und Activity-Inhalte bleiben in authored Definitionen, Registries und Validatoren.
Resolver liefern daraus einen typisierten Runtime-Vertrag; Scenes und Systems erfinden keine
parallelen Config-Kopien, versteckten Map-Defaults oder zufälligen Fallbacks.

Eine konkrete World besitzt eine eindeutige Layout- und Metrics-Quelle. Activity-Inhalte dürfen
World-Geometrie nicht heimlich duplizieren. Identität, Seed, Generator-/Layout-Vertrag und
relevante Parameter werden explizit weitergereicht, damit Host und Client dieselbe World meinen.
Unbekannte, inkonsistente oder nicht zur aktuellen Identität gehörende Daten werden abgelehnt.

### 9. Reihenfolge und fachliche Zeit bleiben sichtbar

Wenn Interleaving, Lifecycle-Reihenfolge oder Update-Phasen das Gameplay beeinflussen, gehört die
Reihenfolge in eine lesbare Orchestrierung und in einen Contract-Test. Eine explizite Pipeline ist
zu bevorzugen, wenn ein generischer Scheduler oder EventBus die Kausalität verdecken würde.

Fachliche Entscheidungen verwenden die definierte Simulationszeit und replizierte Zeitpunkte,
nicht die lokale Wanduhr. Presentation darf interpolieren. Kurzlebige replizierte Effekte
verwenden bei Bedarf absolute Endzeitpunkte oder monotone Sequenzen; kontinuierliche Zustände
brauchen keine künstliche Ereignisgeschichte.

### 10. Abstraktionen müssen ein aktuelles Problem lösen

Vor einer neuen Registry, Event-Schicht, generischen Pipeline, Base-Class-Hierarchie oder einem
neuen Interface ist der konkrete heutige Druck zu benennen. Abstrahiert wird primär gemeinsames
fachliches Verhalten oder ein stabiler Boundary-Vertrag – nicht bloß ähnliche Syntax.

KISS ist ein Architektur-Veto gegen vorweggenommene Variabilität. Ein derzeit einzelner
Aktivitätstyp rechtfertigt kein generisches Framework ohne realen zweiten Owner oder Vertrag.
SOLID bleibt ein Diagnosewerkzeug: Eine Composition Root darf konkrete Abhängigkeiten kennen;
Dependency Injection und Interfaces werden dort eingesetzt, wo sie Ownership, Testbarkeit oder
eine echte Austauschgrenze verbessern.

### 11. Compatibility Code ist ein Übergang, keine zweite Wahrheit

Adapter und Fassaden sind bei Migrationen erlaubt, wenn sie eine klar gerichtete Übergangsgrenze
bilden. Der Authority-Cutover wird sichtbar gemacht, alte Aufrufer werden schrittweise migriert
und der alte Zustand bleibt danach kein versteckter Fallback.

Bei fehlender oder inkonsistenter kanonischer Quelle ist ein sichtbarer Fehler oder Fail-fast
dem stillen Rekonstruieren aus Legacy-State vorzuziehen. Eine Migration erhält relevantes
Verhalten und Reihenfolge, aber sie konserviert keine historische Misch-Authority als Zielbild.

## Prüfliste vor einem größeren Feature

1. Welches fachliche Problem und welcher Zustand werden eingeführt oder verändert?
2. Wer ist Owner, authoritative Writer und Leser dieses Zustands?
3. In welchem Scope lebt er; wann entsteht er, wann wird er invalidiert und wann abgebaut?
4. Ist er kanonisch oder eine Projektion? Wenn Projektion: aus welcher Quelle und mit welcher
   Reconciliation-/Refresh-Semantik?
5. Gehört das Verhalten zu World, Activity, Participation, Round, Entity, Network, Persistence
   oder Presentation?
6. Welche Identität, Revision, Baseline und fachliche Zeit binden den Vertrag?
7. Existiert bereits ein passender Owner, Resolver, Codec, Policy-, Registry- oder Callback-
   Vertrag? Wenn nein: welches konkrete Problem rechtfertigt einen neuen?
8. Welche Reihenfolge, Autoritätsgrenze und Fehlerfälle müssen sichtbar bleiben?
9. Erweitert die Änderung eine Einheit um einen unabhängigen Änderungsgrund? Falls ja, welche
   natürliche fachliche Grenze kann neben der bestehenden Struktur eingeführt werden?
10. Welche Invariante gehört in Types, Validatoren oder einen bestehenden Contract-/Domain-Test?

## Refactoring-Grundsätze für gewachsene Strukturen

- Nicht nach Dateigröße refactoren, sondern nach Authority, Lifetime, Änderungsgrund und
  Abhängigkeitsrichtung.
- Zuerst Verantwortlichkeiten und echte fachliche Grenzen kartieren; Composition Roots und
  notwendige Koordinatoren nicht reflexhaft zerlegen.
- Einen neuen Owner neben der bestehenden Struktur einführen, den Vertrag festlegen und alte
  Aufrufer schrittweise migrieren.
- Während der Migration nur eine fachliche Authority zulassen. Eine Kompatibilitätsfassade darf
  übersetzen, aber nicht parallel entscheiden.
- Bestehendes Verhalten, Fehlersemantik und relevante Update-/Teardown-Reihenfolge erhalten und
  durch passende bestehende Tests absichern.
- Keine Big-Bang-Rewrites und keine generischen Zwischenlagen, deren einziger Zweck die
  Verteilung einer God Class ist.
- Nach dem Cutover alte Pfade entfernen oder sichtbar fehlschlagen lassen; kein stiller
  Legacy-Fallback, der Inkonsistenzen verdeckt.

## Verhältnis zu Code und Dokumentation

Dieses Leitbild ersetzt weder Code, Types, Validatoren, authored Daten, Tests noch lokale
Kommentare. Es enthält nur Regeln, die systemübergreifend und längerfristig als
Entscheidungsgrundlage gelten. Konkrete Balancewerte, Dateigrößen, Bug-Historie, temporäre
Implementierungsdetails und To-do-Listen gehören nicht hierher.

Bei einer neuen Änderung zuerst diese Seite für die Entscheidungsrichtung und danach die kleinste
maßgebliche Vertragsseite lesen. Wenn Code und Leitbild auseinanderlaufen, wird nicht der Code
an die Dokumentation angepasst, sondern die tatsächliche Authority geklärt und – falls dauerhaft
– die Dokumentation aktualisiert.
