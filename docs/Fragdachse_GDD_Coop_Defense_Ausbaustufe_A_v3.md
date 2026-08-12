# FRAGDACHSE

**Game Design Document**

## Coop Defense – Ausbaustufe A · Encounter & Map Director

**Version 3 – nach Codebase-Review**

> **Leitidee**
>
> Coop Defense wird von einem überwiegend kontinuierlichen Gegnerstrom zu einer bewusst inszenierten Folge klarer Angriffe. Der neue Standard ist **Repel Assault**: eine Map besteht aus einer endlichen Folge verpflichtender Encounter, die nacheinander abgewehrt werden. Schnelles und effizientes Spielen verkürzt die Mission und wird damit direkt belohnt.
>
> Daneben bleiben Boss- und Angriffsmissionen gegen feindliche Basen eigenständige Hauptziele. **Survive** verliert seine bisherige Rolle als Standard und wird zu einem seltenen, besonders dramatischen Überlebensmodus mit begrenzten persönlichen Respawns.
>
> Ausbaustufe A schafft dafür den Map Director, endliche Encounter, unterschiedliche Trigger, kontrollierte Angriffspausen, mehrere Spawnfronten und perspektivisch variable Arenahöhen. Spätere Nebenmissionen, Risk-vs.-Reward-Systeme und dynamische Map-Ereignisse bauen darauf auf.

**Designstatus:** Zielkonzept / Implementierungsgrundlage  
**Technischer Kontext:** bestehende Phaser-4-Codebase, host-autoritärer Coop-Defense-Modus  
**Zielbereich Map-Länge:** ca. 40 Sekunden bis perspektivisch ca. 5 Minuten

---

# 1. Zweck und Produktziel

Dieses Dokument beschreibt **Ausbaustufe A** im Detail. Die Ausbaustufen B–D werden als Vision beschrieben, damit die grundlegenden Entscheidungen von A später nicht erneut umgebaut werden müssen.

Der vorhandene Coop-Defense-Modus besitzt bereits eine große Zahl unterschiedlicher Gegner, Basen, Power-ups, Konstrukte, Bosse und Map-Sondermechaniken. Das zentrale Problem ist nicht fehlender Content, sondern dass viele Gegner aktuell als periodische Streams erzeugt werden und dadurch über längere Zeit relativ gleichmäßig in die Arena eintreffen.

Ausbaustufe A soll vorhandenen Content durch **Dramaturgie, Timing und Raumaufteilung** stärker machen.

| Ziel | Beschreibung |
|---|---|
| **Primärziel** | Aus dem kontinuierlichen Gegnerstrom werden klar erkennbare, endliche Angriffe mit bewusstem Rhythmus. |
| **Standard-Hauptziel** | `repel-assault` wird der normale Coop-Defense-Ablauf. |
| **Pacing-Ziel** | Gute Spieler gewinnen Zeit, Ruhe oder offensive Handlungsfenster – niemals zusätzliche Pflichtgegner als Strafe für hohe Effizienz. |
| **Raum-Ziel** | Maps können perspektivisch in Breite und Höhe variieren und dadurch echte Mehrfronten-Situationen ermöglichen. |
| **Architekturziel** | Encounter können neben Zeit und vorherigen Encountern auch auf definierte Gameplay-Ereignisse reagieren. |
| **Langfristiges Ziel** | Grundlage für Nebenmissionen, Map-Events, Risk-vs.-Reward und kontrollierte Encounter-Varianten schaffen. |

---

# 2. Designprinzipien

## 2.1 Rhythmus statt Dauerfeuer

Coop Defense soll zwischen unterschiedlichen Intensitätsstufen wechseln:

- große Angriffe,
- kleinere Verstärkungen,
- kurze Atempausen,
- Repositionierung,
- gezielte Eskalationen,
- Finale.

Eine Pause ist nicht automatisch verlorene Spielzeit. Sie schafft Kontrast und macht den nächsten Angriff stärker.

## 2.2 Effizienz wird immer belohnt

Hohe DPS, gute Positionierung und Teamkoordination sollen Vorteile erzeugen.

Je nach Hauptziel bedeutet das:

- schnellere Gesamtmission,
- längere Ruhephase,
- größeres Gegenangriffsfenster,
- weniger Überlappung mehrerer Angriffe,
- später mehr Zeit für Nebenmissionen.

Es darf **keinen Mechanismus geben, bei dem ein starkes Team allein wegen schneller Kills mehr Pflichtgegner in derselben Zeit bekämpfen muss**.

## 2.3 Encounter sind Dramaturgie, nicht jede Gegnerquelle

Ein **Encounter** ist ein bewusst komponierter, endlicher Angriff.

Daneben dürfen Maps weiterhin begrenzten **Hintergrunddruck** besitzen, beispielsweise durch zerstörbare feindliche Spawnstrukturen.

Diese beiden Ebenen werden bewusst getrennt:

- Encounter bestimmen die Dramaturgie.
- Persistente Spawnquellen erzeugen strategischen Druck.
- Gegner aus unabhängigem Hintergrunddruck blockieren grundsätzlich nicht den Abschluss eines Encounters.

## 2.4 Ereignisse dürfen die Dramaturgie verändern

Encounter müssen nicht ausschließlich auf einer festen Uhr starten.

Ein Encounter kann beispielsweise ausgelöst werden durch:

- einen geplanten Zeitpunkt,
- den Abschluss eines vorherigen Encounters,
- das Ende einer Ruhephase,
- das Erreichen einer Bossphase,
- ein definiertes Map-Ereignis.

Dadurch kann eine Bossphase direkt eine neue Kampfsituation auslösen, ohne dass der Boss selbst Teil des MapDirectors werden muss.

## 2.5 Lesbarkeit vor Überraschung

Neue Fronten, besonders gefährliche Wellen und größere Eskalationen werden verständlich angekündigt.

Spieler dürfen von der konkreten Stärke einer Welle überrascht werden, aber nicht davon, dass plötzlich eine völlig neue Front ohne erkennbare Vorwarnung direkt neben der Verteidigung entsteht.

## 2.6 Raum ist Gameplay

Mapgröße und Wege beeinflussen:

- Reaktionszeit,
- Frontwechsel,
- Laufwege,
- Konstrukte,
- Gegenangriffe,
- spätere Nebenmissionen.

Variable Höhe ist deshalb nicht nur ein technisches Feature für Nord-/Südspawns, sondern ein langfristiger Content-Multiplikator.

## 2.7 Datengetriebene, handgebaute Maps

Maps bleiben bewusst authored.

Der MapDirector soll keine generische prozedurale Missionsmaschine werden.

Ziel ist:

> wenige klare Bausteine + bewusst komponierte Maps

und nicht:

> komplexe universelle Skriptsprache.

---

# 3. Nicht-Ziele von Ausbaustufe A

Ausbaustufe A beinhaltet bewusst noch nicht:

- vollständiges Secondary-Objective-System,
- Bier-/Carry-Missionen,
- Meta-Rewards aus Nebenmissionen,
- allgemeines Map-Event-/Setpiece-System,
- Elite-/Champion-System,
- große neue Gegner- oder Konstruktionswelle,
- komplette Kampagnenmigration vor Stabilisierung,
- komplexe klassenspezifische Beschäftigungssysteme für Ruhephasen,
- vollständig prozedural erzeugte Encounter,
- grundlegenden Umbau der Host-Autorität.

Ausbaustufe A darf **Trigger auf bereits vorhandene Gameplay-Ereignisse** verwenden. Das ist etwas anderes als das spätere allgemeine Map-Event-System aus Ausbaustufe C.

---

# 4. Ausgangslage

## 4.1 Aktuelle Gegnerwellen

Die heutige Coop-Defense-Konfiguration beschreibt Waves im Wesentlichen über:

- Gegnerart,
- Intervall,
- Anzahl pro Intervall,
- Startzeit.

Nach ihrem Start wiederholen sich diese Waves regelmäßig bis zum Ende der Runde.

Mehrere gleichzeitig aktive Streams erzeugen dadurch häufig einen relativ gleichmäßigen Gegnerzustrom.

### Ziel

Zeitplanung und konkrete Gegnererzeugung werden getrennt.

Der neue MapDirector entscheidet:

- wann ein Encounter beginnt,
- wodurch er beginnt,
- welche Spawn-Gruppen dazugehören,
- wann er als abgeschlossen gilt,
- was danach passiert.

Der bestehende Spawner übernimmt möglichst nur noch die konkrete Gegnererzeugung.

---

# 5. Hauptziele des zukünftigen Coop Defense

Die Hauptziele bestimmen, **wann die Map gewonnen ist**.

Der MapDirector bestimmt dagegen, **wie sich die laufende Mission dramaturgisch entwickelt**.

Diese Verantwortungen bleiben getrennt.

## 5.1 `repel-assault` – neuer Standard

`repel-assault` wird der normale Coop-Defense-Modus und ersetzt `survive` als Standard-Hauptziel.

### Grundidee

Die Map enthält eine endliche Folge verpflichtender Angriffe.

```text
Encounter 1
↓
Clear
↓
kurze Vorbereitung
↓
Encounter 2
↓
Clear
↓
kurze Vorbereitung
↓
Final Encounter
↓
Clear
↓
Sieg
```

### Sieg

Die Map ist gewonnen, wenn alle verpflichtenden Assault-Encounter erfolgreich abgewehrt wurden.

### Niederlage

Die normale Coop-Niederlage über die eigene Hauptbasis bleibt bestehen.

### Pacing

`repel-assault` verwendet primär:

> **Clear → Rest → Next**

Schnelles Töten verkürzt die Missionsdauer.

Damit ist der neue Standardmodus unmittelbar auf das Encounter-System zugeschnitten.

### Designziel

Eine typische Coop-Defense-Map soll sich künftig eher wie eine klar strukturierte Verteidigungsschlacht anfühlen:

```text
Angriff
→ Luft
→ neuer Angriff
→ Frontwechsel
→ Peak
→ Finale
```

statt wie ein dauerhaft laufender Spawnstrom.

---

# 6. `survive` – seltener dramatischer Überlebensmodus

`survive` bleibt erhalten, bekommt aber eine deutlich eigenständigere Identität.

Es wird **nicht mehr der Standard** und soll nur auf ausgewählten Maps eingesetzt werden.

## 6.1 Kernidee

Die Spieler müssen eine definierte Zeit durchhalten.

Zusätzlich besitzt jeder Spieler nur eine **begrenzte persönliche Zahl an Respawns**.

Die konkrete Respawn-Anzahl wird pro Map oder Balancingprofil festgelegt.

## 6.2 Persönliche Respawns

Ein Respawn wird verbraucht, wenn ein Spieler nach seinem Tod erneut ins Spiel zurückkehrt.

Beispiel:

```text
Spieler startet
Respawns: 2

1. Tod
→ Respawn
→ 1 verbleibend

2. Tod
→ Respawn
→ 0 verbleibend

Spieler befindet sich nun auf seinem letzten Leben.
```

**0 verbleibende Respawns bedeutet nicht sofortiges Ausscheiden**, solange der Spieler noch lebt.

Erst sein nächster Tod ist endgültig.

## 6.3 Team-Niederlage

Die Map ist wegen der Respawn-Regel verloren, wenn:

- kein Spieler mehr aktiv weiterkämpfen kann
- **und**
- kein weiterer Respawn mehr möglich ist.

Ein kurzer vollständiger Team-Wipe ist also nicht automatisch verloren, wenn mindestens ein Spieler noch einen gültigen Respawn besitzt.

## 6.4 Endgültig ausgeschiedene Spieler

Ein Spieler, dessen letzte Lebensphase endet und der keinen Respawn mehr besitzt:

- bleibt Teilnehmer der laufenden Runde,
- erhält weiterhin die ihm als Rundenteilnehmer zustehenden Ergebnisse und Belohnungen,
- kann aber bis zum Rundenende nicht mehr ins aktive Spiel zurückkehren,
- beobachtet die verbleibenden Teammitglieder.

Er wird dadurch spielerisch zum Zuschauer, aber **nicht** zu einem nachträglichen Nicht-Teilnehmer der Runde.

## 6.5 Sieg

Die Map ist gewonnen, wenn die vorgegebene Überlebenszeit erreicht wird und die normale Niederlage nicht vorher eingetreten ist.

## 6.6 Pacing

`survive` nutzt primär **geplante Angriffszeitpunkte**.

Beispiel:

```text
00:10 Angriff 1
00:32 Angriff 2
00:58 großer Angriff
01:25 Angriff 4
01:50 Finale
02:00 Sieg
```

Schnelles Töten zieht den nächsten Pflichtangriff **nicht nach vorne**.

Dadurch gewinnt ein starkes Team mehr Ruhe und senkt das Risiko, dass sich mehrere Angriffe überlagern.

## 6.7 Charakter des Modus

`survive` soll sich deutlich dramatischer anfühlen als der Standard:

- Zeit läuft sichtbar gegen das Team,
- persönliche Respawns werden knapp,
- einzelne endgültige Ausfälle verändern die Teamstärke,
- die letzten Sekunden können mit nur noch einem lebenden Spieler enden.

Damit hat `survive` einen klaren Grund zu existieren, obwohl `repel-assault` der Standard wird.

---

# 7. Weitere Hauptziele

## 7.1 `destroy-hostile-bases`

### Sieg

Alle relevanten feindlichen Hauptbasen werden zerstört.

### Rolle der Encounter

Encounter erzeugen defensive Druckphasen.

Schnelles Clearen schafft Zeitfenster für den Gegenangriff.

```text
Angriff abwehren
↓
kurzes Zeitfenster
↓
Team greift Feindbasis an
↓
nächster Angriff wird angekündigt
↓
Entscheidung: weiter pushen oder zurückziehen
```

Persistente feindliche Spawnpunkte können parallel zusätzlichen Druck erzeugen.

## 7.2 `defeat-boss`

### Sieg

Der Boss wird besiegt.

### Rolle der Encounter

Encounter ergänzen den Bosskampf:

- Adds,
- Verstärkungen,
- Frontwechsel,
- Eskalationen zwischen Bossmechaniken,
- Reaktion auf Bossphasen.

Der Tod des Bosses beendet die Mission unabhängig davon, ob spätere normale Encounter geplant gewesen wären.

---

# 8. Encounter-Modell

Ein Encounter ist eine **endliche, bewusst komponierte Kampfsituation**.

Er besteht typischerweise aus:

- einer oder mehreren Gegnergruppen,
- definierten Spawnquellen,
- einer zeitlichen Staffelung,
- einer Startbedingung,
- einer Abschlussbedingung.

## 8.1 Beispiel

```json
{
  "id": "opening-rush",
  "start": {
    "type": "after-previous"
  },
  "groups": [
    {
      "enemyKind": "zombie-badger",
      "count": 8,
      "source": "west"
    },
    {
      "enemyKind": "demon-badger",
      "count": 4,
      "source": "west",
      "delayMs": 2000
    }
  ]
}
```

Das konkrete Schema wird bei der Implementierung an die bestehenden Konventionen angepasst.

Das GDD legt nur die fachlichen Bausteine fest.

## 8.2 Encounter-Lebenszyklus

Vereinfacht:

```text
wartet
↓
Trigger erfüllt
↓
Telegraphing
↓
Spawn / Kampf
↓
Clear
↓
Folgeaktion oder Ruhephase
```

---

# 9. Encounter-Trigger

Encounter benötigen ein kleines, klar definiertes Trigger-Modell.

Es soll bewusst **keine universelle Skriptsprache** entstehen.

## 9.1 Zeitbasierter Trigger

Der Encounter startet zu einem geplanten Zeitpunkt.

Geeignet für:

- `survive`,
- dramaturgisch exakt geplante Peaks,
- Bossunterstützung,
- bestimmte Gegenangriffe.

Wichtig:

Ein geplanter Startzeitpunkt darf durch definierte Voraussetzungen nach hinten verschoben werden.

Schnelles Töten früherer Gegner zieht ihn jedoch nicht automatisch vor.

## 9.2 Fortschritts-Trigger

Der Encounter startet:

- nachdem ein vorheriger Encounter gecleart wurde,
- optional nach einer kurzen Ruhephase.

Dies ist der Standard für `repel-assault`.

## 9.3 Ereignis-Trigger

Ein Encounter kann auf ein klar definiertes Gameplay-Ereignis reagieren.

Beispiele:

- Eröffnungs-Luftangriff abgeschlossen,
- Boss erreicht Phase 2,
- bestimmte Struktur wurde zerstört,
- ein bereits vorhandener Mapzustand wurde erreicht.

### Bossphasen als wichtiger Anwendungsfall

Beispiel:

```text
Bosskampf läuft
↓
Boss erreicht Phase 2
↓
Phase-2-Telegraphing
↓
neuer Encounter startet
↓
zusätzliche Gegner greifen aus einer zweiten Front an
```

Der Boss bleibt Eigentümer seiner eigenen Bossmechanik.

Der MapDirector reagiert lediglich auf den semantischen Zustand:

> „Bossphase 2 wurde erreicht.“

Dadurch bleiben Bosslogik und Mapdramaturgie getrennt.

## 9.4 Trigger sind einmalig und eindeutig

Ein Encounter wird durch seinen Trigger genau einmal aktiviert.

Das verhindert, dass wiederholt auftretende Zustände unbeabsichtigt denselben Pflichtangriff mehrfach starten.

---

# 10. Encounter-Clear und Mapsieg

Eine der wichtigsten Regeln lautet:

> **Encounter-Clear ist nicht automatisch Mapsieg.**

Der Encounter meldet lediglich, dass seine verpflichtende Bedrohung abgewehrt wurde.

Das Hauptziel entscheidet über den Sieg.

| Hauptziel | Bedeutung eines Encounter-Clears |
|---|---|
| `repel-assault` | Der nächste Pflichtangriff darf folgen; das letzte Pflicht-Clear führt zum Sieg. |
| `survive` | Es entsteht Luft bis zum nächsten geplanten Angriff. |
| `destroy-hostile-bases` | Es entsteht ein mögliches Gegenangriffsfenster. |
| `defeat-boss` | Der Bosskampf läuft weiter, solange der Boss lebt. |

---

# 11. Welche Gegner bestimmen einen Encounter-Clear?

Nur die **zum Encounter gehörende Bedrohung** darf seinen Abschluss bestimmen.

Unabhängige Gegner dürfen ihn nicht versehentlich blockieren.

Dazu gehören insbesondere:

- Gegner aus zerstörbaren Spawnpunkten,
- spätere Nebenmissionsgegner,
- unabhängige Mapmechaniken.

Ebenso darf ein einzelner technisch festhängender oder verlorener Restgegner eine komplette Mission nicht unbegrenzt blockieren.

Die konkrete technische Zuordnung wird bewusst nicht im GDD festgelegt.

---

# 12. Persistenter Hintergrunddruck

Die Codebase besitzt bereits zerstörbare feindliche Spawnpunkte.

Diese Mechanik bleibt erhalten und wird **nicht zwanghaft in endliche Encounter umgebaut**.

## 12.1 Funktion

Eine aktive Spawnstruktur kann in regelmäßigen Abständen Gegner erzeugen.

```text
Spawnpunkt lebt
↓
regelmäßiger leichter Druck
↓
Spieler zerstören Spawnpunkt
↓
zukünftiger Druck endet
```

## 12.2 Unterschied zum Encounter

### Encounter

- endliche Gegnerzahl,
- dramaturgischer Peak,
- klarer Beginn,
- klarer Abschluss.

### Persistente Spawnquelle

- erzeugt Hintergrunddruck,
- ist an ein Weltobjekt oder einen Zustand gebunden,
- endet durch Zerstörung oder Deaktivierung,
- blockiert normalerweise keinen Encounter-Clear.

## 12.3 Langfristiger Nutzen

Diese Trennung erzeugt interessante Entscheidungen:

> Bleiben wir an der Basis und halten die nächste Welle aus oder zerstören wir vorher das Brutnest?

Das wird vor allem auf längeren Maps wichtig.

---

# 13. Zwei zentrale Pacing-Modelle

## 13.1 Clear → Rest → Next

Primär für:

- `repel-assault`.

Ablauf:

```text
Encounter
↓
Clear
↓
Ruhe
↓
nächster Encounter
```

### Belohnung für gutes Spielen

Ein schneller Clear verkürzt die Gesamtmission.

Die definierte Mindest-Ruhephase bleibt bestehen, damit die Abfolge nicht hektisch und unlesbar wird.

## 13.2 Geplante Timeline

Primär für:

- `survive`,
- bestimmte Boss- und Feindbasis-Situationen.

Ablauf:

```text
geplanter Angriff A
↓
variable Kampfzeit
↓
geplanter Angriff B bleibt an seinem vorgesehenen Zeitpunkt
```

### Belohnung für gutes Spielen

Ein schneller Clear erzeugt mehr freie Zeit.

### Überforderung

Ein langsames Team kann erleben, dass sich geplante Angriffe stärker annähern oder teilweise überlagern.

Damit steigt die Schwierigkeit organisch, ohne dass gute Spieler dafür bestraft werden.

---

# 14. Ruhephasen und Intermissions

Pausen sind Bestandteil der Dramaturgie.

Nicht jede Pause muss mit einer künstlichen Aufgabe gefüllt werden.

## 14.1 Drei Größenordnungen

| Typ | Richtwert | Zweck |
|---|---:|---|
| **Micro-Pause** | ca. 1,5–3 s | Lesbarkeit zwischen Batches oder Teilangriffen. |
| **Ruhephase** | ca. 4–8 s | Sammeln, Repositionieren, Konstrukte vorbereiten, nächste Front erkennen. |
| **Intermission** | ca. 10–20 s | Nur bewusst auf längeren Maps; später Raum für strategische Nebenaktivitäten. |

Die Werte sind Balancing-Richtwerte und keine globale Pflicht.

## 14.2 Was Spieler in A tun

Während normaler Ruhephasen reichen zunächst:

- HP/Armor/Power-ups einsammeln,
- Team regroupieren,
- nächste Front anlaufen,
- Positionierung ändern,
- Utility vorbereiten,
- Gefahrenbereiche verlassen.

Inspector Gadachs profitiert zusätzlich besonders von den Pausen:

- Verteidigungspositionen anpassen,
- zerstörte Konstrukte ersetzen,
- Konstrukte verlegen,
- bestehende Reparaturmöglichkeiten nutzen.

## 14.3 Telegraphing als Teil der Pause

Bei einem Frontwechsel kann die nächste Bedrohung bereits während der Ruhephase angekündigt werden:

```text
NÄCHSTER ANGRIFF: NORDEN
7 s
```

Damit wird selbst eine kampffreie Phase spielerisch relevant.

---

# 15. Vision für längere Intermissions

Dieser Abschnitt beschreibt eine spätere Nutzung der durch A geschaffenen Pausen.

## 15.1 Gemeinsame Vorbereitung statt Klassen-Minispiele

Dachs Nukem und Dachs of Steel erhalten keine künstlich erfundenen, exklusiven Ruhephasen-Minispiele.

Stattdessen sollen alle Klassen gemeinsame strategische Möglichkeiten nutzen können.

Mögliche spätere Aktivitäten:

- Basis-Instandhaltung,
- Nebenmission,
- Power-up-Ziel,
- Spawnpunkt angreifen,
- Bier bergen,
- freiwillige Challenge starten.

## 15.2 Basis-Instandhaltung als Kandidat

Eine reine Zone, in der Spieler stehen und dadurch die Basis heilen, wäre zu passiv.

Eine spätere interaktive Basis-Instandhaltung ist denkbar, aber noch **nicht endgültig spezifiziert**.

Designziel:

- kurze aktive Handlung,
- Bewegung oder Entscheidung,
- begrenzte Heilung,
- keine kostenlose vollständige Wiederherstellung,
- nicht nach jeder Welle.

Die konkrete Umsetzung wird erst in einer späteren Ausbaustufe festgelegt.

---

# 16. Spawn Sources und Angriffsfronten

## 16.1 Ziel

Encounter sollen aus unterschiedlichen, bewusst gewählten Richtungen und Quellen kommen können.

Grundsätzlich vorgesehen:

- West,
- Ost,
- Nord,
- Süd,
- definierter Spawnpunkt.

Nicht jede Map und nicht jeder Gegnertyp muss jede Richtung unterstützen.

## 16.2 Gegner-spezifische Einschränkungen

Spezialgegner dürfen kompatible Spawnrichtungen besitzen.

Wenn ein vorhandener Gegnermechanismus logisch an einen bestimmten Rand gebunden ist, muss er für Ausbaustufe A nicht künstlich auf alle vier Richtungen erweitert werden.

Das verhindert unnötigen Scope.

## 16.3 Fairness

Eine Source ist nur sinnvoll, wenn:

- ausreichend Anmarschweg vorhanden ist,
- das relevante Ziel nicht unmittelbar daneben liegt,
- der Spawn für den Spieler lesbar ist,
- ein sinnvoller Weg zum Ziel existiert.

## 16.4 Kein „Random Anywhere“

Gegner sollen nicht beliebig irgendwo in der Arena erscheinen.

Die Herkunft eines Angriffs ist ein dramaturgischer Bestandteil der Map.

---

# 17. Variable Arenahöhe

## 17.1 Warum die Höhe variabel werden soll

Die Arenabreite kann bereits variieren.

Die Höhe ist aktuell deutlich stärker festgelegt.

Dadurch wären Nord-/Südspawns auf vielen heutigen Maps zu nah an der zu verteidigenden Basis.

Variable Höhe ermöglicht:

- echte Nord-/Südfronten,
- längere vertikale Wege,
- Vorposten außerhalb der Hauptachse,
- spätere Nebenmissionen,
- Flanken,
- mehrere räumliche Verteidigungsschwerpunkte.

## 17.2 Zielbild

Maps können zukünftig neben der Breite optional auch eine eigene Höhe besitzen.

Bestehende Maps behalten ohne eigene Höhenangabe ihr heutiges Format.

## 17.3 Wichtige Scope-Entscheidung

Variable Höhe gehört zu Ausbaustufe A, ist aber **kein Blocker für das Encounter-System**.

Der Encounter-/MapDirector-Umbau wird zunächst auf der bestehenden Arenageometrie validiert.

Erst danach wird die Arena zweidimensional erweitert.

Damit kann das wichtigste neue Gameplay früh getestet werden, ohne gleichzeitig Kamera, Hintergrund, Arena-Geometrie und Spawnlogik verändern zu müssen.

---

# 18. Kamera und große Maps

Wenn eine Map größer als der sichtbare Bereich ist, folgt die Kamera dem Spieler.

Für variable Höhe wird das vorhandene Prinzip auf beide Dimensionen erweitert.

Game-Design-Anforderungen:

- Spieler bleibt gut im Fokus,
- Frontwechsel sind verständlich,
- Offscreen-Gefahren werden angezeigt,
- Aim und Steuerung fühlen sich identisch zu kleineren Maps an,
- HUD bleibt unabhängig von der Weltkamera.

Weitere technische Details sind nicht Teil dieses GDD.

---

# 19. Telegraphing

Mehr Fronten erhöhen nur dann die Tiefe, wenn sie verständlich bleiben.

## 19.1 Kleine Verstärkung

- kurzer lokaler Spawn-Effekt,
- keine große HUD-Meldung erforderlich.

## 19.2 Bedeutender Angriff

- sichtbarer Vorlauf,
- räumlicher Hinweis,
- akustischer Cue.

## 19.3 Frontwechsel oder großer Peak

- frühzeitige Richtungsinformation,
- eindeutiger Warnhinweis,
- optional Countdown,
- Offscreen-Indikator auf großen Maps.

## 19.4 Bossphasen-Encounter

Wenn eine Bossphase einen Encounter auslöst, muss die Verbindung für den Spieler verständlich wirken.

Beispiel:

```text
Boss wechselt in Phase 2
↓
deutliche Boss-Transition
↓
Warnung: neue Front öffnet sich
↓
Encounter beginnt
```

Der Spieler soll den Eindruck einer geplanten Eskalation erhalten und nicht zweier zufällig gleichzeitig ausgelöster Systeme.

---

# 20. Map-Konfiguration und Dateistruktur

Mit Encountern, Triggern und späteren Missionen wird eine einzelne zentrale Map-Datei zu groß.

Zielstruktur:

```text
src/config/coopDefenseMaps/
├─ index.ts
├─ 00-test.json
├─ 01-erste-welle.json
├─ 02-....json
├─ ...
├─ 15-leerenjaeger.json
└─ 16-zeitzuender.json
```

Die Maps bleiben reine Daten.

`index.ts` dient als statische Registry und legt Kampagnenreihenfolge und Default-Map fest.

Die bestehende zentrale Config-Schicht behält die Verantwortung für:

- Types,
- Normalisierung,
- Validierung,
- Resolver,
- Balancing-Hilfen.

---

# 21. Standardwerte und Migration

## 21.1 Zielzustand

Nach der Migration gilt:

> Wenn eine neue normale Coop-Defense-Map kein anderes Hauptziel benötigt, ist `repel-assault` der Standard.

`survive` muss bewusst gewählt werden.

## 21.2 Bestehende Maps

Bestehende Maps dürfen während der Umstellung nicht versehentlich ihr Verhalten ändern.

Deshalb erfolgt die Migration schrittweise.

Legacy-Waves und bestehende Maps bleiben zunächst lauffähig.

Erst wenn eine Map auf das neue Encounter-Modell umgestellt wird, erhält sie bewusst ihr zukünftiges Hauptziel.

---

# 22. Multiplayer und Latejoin

Die bestehende Host-Autorität bleibt erhalten.

Der Host entscheidet über:

- Encounter-Start,
- Encounter-Clear,
- Trigger,
- Spawnaufträge,
- Missionsfortschritt,
- Respawn-Berechtigung im `survive`-Modus.

Clients stellen den relevanten Zustand dar.

## 22.1 Latejoin

Ein Latejoiner bleibt während einer bereits laufenden Runde Zuschauer und beeinflusst:

- Encounter-Anzahl,
- Respawn-Budget,
- Hauptziel,
- Balancing

nicht nachträglich.

## 22.2 Sichtbarer Missionszustand

Ein Spieler, der die laufende Situation betrachtet, muss erkennen können:

- Hauptziel,
- aktuelle Welle bzw. Phase,
- nächste relevante Gefahr,
- bei `survive`: verbleibende Zeit und eigene verbleibende Respawns.

Die konkrete Netzwerkstruktur ist nicht Teil dieses GDD.

---

# 23. XP und Balancing

Das heutige XP-Modell basiert teilweise auf wiederholten Waves über eine Rundendauer.

Endliche Encounter benötigen stattdessen eine berechenbare geplante Gegnerzahl.

## 23.1 `repel-assault`

Alle verpflichtenden Encounter ergeben eine feste geplante Gegner- und XP-Menge.

Ein starkes Team:

- kämpft gegen dieselbe Pflichtmenge,
- beendet die Mission aber schneller.

## 23.2 `survive`

Die geplanten Pflichtangriffe hängen von der Timeline ab und nicht davon, wie schnell frühere Encounter sterben.

Ein starkes Team bekommt daher nicht automatisch mehr Gegner.

## 23.3 Andere Ziele

Boss-, Feindbasis- und persistente Spawnquellen werden bei der Balancingbewertung getrennt betrachtet.

Insbesondere dauerhaft aktive, zerstörbare Spawnpunkte sind nicht sinnvoll als feste Encounter-Anzahl zu behandeln.

## 23.4 Sinnvolle Balancing-Diagnostik

Pro Map sollten mindestens nachvollziehbar sein:

- geplante Pflichtgegner,
- geplante XP,
- Anzahl der Encounter,
- größte Angriffsspitze,
- verwendete Fronten,
- geplante Ruhefenster,
- persistente Spawnquellen,
- erwartete Missionsdauer,
- bei `survive`: Respawn-Budget und Zeitlimit.

Die Werte müssen nicht als Spieler-UI existieren.

---

# 24. Pacing-Zielbilder nach Map-Länge

| Map-Länge | Struktur | Ziel |
|---|---|---|
| **40–60 s** | 3–4 klare Encounter | Schneller Einstieg, klarer Peak, Finale. |
| **1–2,5 min** | 4–7 Encounter, ggf. mehrere Phasen | Standardbereich für viele Kampagnenmaps. |
| **3–5 min** | mehrere Akte mit 6–10 größeren Encounter-Situationen | Frontwechsel, Intermissions und später Nebenmissionen tragen die Map. |

## 24.1 Kurze Maps

Nicht künstlich verlängern.

Eine kurze `repel-assault`-Map darf sehr kompakt sein.

## 24.2 Mittlere Maps

Typischer Rhythmus:

```text
Opening
↓
Ruhe
↓
neue Front
↓
Peak
↓
Ruhe
↓
Finale
```

## 24.3 Lange Maps

Lange Maps sollen nicht aus fünf nahezu identischen kurzen Abschnitten bestehen.

Sie sollen im Verlauf ihre Situation verändern:

- Fronten,
- Ziele,
- Druckquellen,
- Bosse,
- später Nebenmissionen und Events.

---

# 25. Referenzszenarien für Ausbaustufe A

Die neue Architektur soll zuerst an wenigen gezielten Szenarien validiert werden.

## 25.1 Map 1 – neuer Standard `repel-assault`

Die frühe Tutorial-Map eignet sich dafür, den zukünftigen Standard unmittelbar verständlich zu machen.

Statt eines einzelnen kontinuierlichen Zombie-Stroms:

```text
kleiner erster Angriff
↓
kurze Pause
↓
größerer zweiter Angriff
↓
Finale
↓
Sieg
```

Spieler lernen damit von Anfang an die zukünftige Coop-Defense-Grammatik.

## 25.2 Map 13 – Encounter + persistenter Hintergrunddruck

Die vorhandenen zerstörbaren Spawnpunkte machen diese Map zum wichtigen Regressionstest.

Ziel:

- endliche dramaturgische Encounter,
- gleichzeitig aktive Spawnstrukturen,
- Spawnpunkt-Gegner blockieren keinen falschen Encounter-Clear,
- Zerstörung der Strukturen reduziert den Hintergrunddruck.

## 25.3 Map 15 – Bossphasen-Trigger

Der Leerenjäger besitzt bereits eine deutliche zweite Bossphase.

Diese Map eignet sich als Referenz für:

> Gameplay-Ereignis → Encounter-Trigger

Beispiel:

```text
Leerenjäger erreicht Phase 2
↓
Boss-Transition
↓
neue Angriffswelle / neue Front
```

Ob die finale Kampagnenversion exakt dieses Encounter erhält, ist eine Balancingentscheidung. Wichtig ist zunächst, dass der Mechanismus mit einer echten vorhandenen Bossphase validiert wird.

## 25.4 Map 0 – variable Höhe und Mehrfrontentest

Die Testmap eignet sich dafür, zunächst ohne Kampagnenrisiko zu prüfen:

- größere Arenahöhe,
- vertikale Kamera,
- Nord-/Südspawns,
- Offscreen-Telegraphing.

## 25.5 `survive`-Prototyp

Der neue dramatische `survive`-Modus wird zunächst auf einer Testkonfiguration validiert:

- begrenzte persönliche Respawns,
- sichtbares Respawn-Budget,
- endgültiges Ausscheiden einzelner Spieler,
- Team-Wipe ohne mögliche Respawns als Niederlage,
- Zeitablauf als Sieg.

Erst danach wird entschieden, welche wenigen Kampagnenmaps diesen besonderen Modus erhalten.

---

# 26. Empfohlene Implementierungsreihenfolge für Ausbaustufe A

Die Reihenfolge trennt den wichtigsten Gameplay-Umbau bewusst von der größeren Arena-Geometrie-Erweiterung.

## A1 – Map-Dateistruktur

- eine JSON-Datei je Map,
- statische Registry,
- bestehende Maps ohne Gameplayänderung weiter nutzbar.

**Ergebnis:** übersichtliche Grundlage für komplexere Mapdaten.

## A2 – Encounter-Grundlage auf bestehender Arena

- endliche Spawn-Gruppen,
- MapDirector,
- Zeitplanung vom konkreten Spawn trennen,
- bestehende westliche Spawnlogik zunächst weiterverwenden.

**Ergebnis:** das zentrale neue Gameplay kann isoliert getestet werden.

## A3 – `repel-assault` als Standard-Pacing

- Clear → Rest → Next,
- letzter verpflichtender Encounter beendet die Mission,
- Map 1 als erste Referenz.

**Ergebnis:** zukünftiger Standardmodus funktioniert vollständig.

## A4 – Hauptziel-Integration und `survive`

- Boss- und Feindbasisziele sauber mit Encountern verbinden,
- `survive` auf begrenzte Respawns und geplante Timeline umstellen,
- endgültig ausgeschiedene Spieler bleiben Rundenteilnehmer.

**Ergebnis:** die vier Hauptziele besitzen klar unterschiedliche Identitäten.

## A5 – Encounter-Trigger

Mindestens:

- Zeit,
- vorheriger Encounter,
- definierter Gameplay-Zustand bzw. Ereignis,
- Bossphase.

Bestehende Ereignisbedingungen wie das Ende eines Eröffnungsangriffs sollen anschließbar bleiben.

**Ergebnis:** Encounter können echte Missionsdramaturgie abbilden.

## A6 – Persistenter Hintergrunddruck

- bestehende zerstörbare Spawnpunkte neben dem Encounter-System erhalten,
- unabhängige Gegner blockieren Encounter-Clears nicht.

**Ergebnis:** vorhandene komplexe Maps bleiben spielerisch interessant.

## A7 – Telegraphing und Referenzmaps

- große Angriffe,
- Frontwechsel,
- eventgekoppelte Eskalationen verständlich ankündigen,
- Map 1, Map 13 und Bossreferenz im Spiel testen.

**Ergebnis:** Pacing wird praktisch validiert, bevor die Arena erweitert wird.

## A8 – Zweidimensionale Arena

- variable Arenahöhe,
- vertikale Kamerabewegung,
- bestehende Maps unverändert lassen.

**Ergebnis:** größere räumliche Varianz wird möglich.

## A9 – Erweiterte Fronten

- Nord/Süd,
- Ost wo sinnvoll,
- Spawnpunkt-Sources,
- Gegner-spezifische Einschränkungen respektieren,
- Offscreen-Lesbarkeit.

**Ergebnis:** echte Mehrfronten-Maps.

## A10 – XP, Balancing und Stabilisierung

- endliche Encounter korrekt bewerten,
- Respawn-Budget von `survive` balancen,
- Multiplayer und Latejoin prüfen,
- Performance und Regressionen prüfen,
- danach weitere Kampagnenmaps schrittweise migrieren.

**Ergebnis:** stabile Grundlage für B–D.

---

# 27. Definition of Done

Ausbaustufe A gilt als abgeschlossen, wenn folgende Designziele erfüllt sind.

## 27.1 Standardmodus

- `repel-assault` ist als normaler Coop-Defense-Ablauf vollständig spielbar.
- Neue bzw. migrierte Standardmaps nutzen endliche Pflicht-Encounter.
- Schnelles Töten verkürzt die Missionsdauer.
- Das letzte verpflichtende Encounter-Clear führt nachvollziehbar zum Sieg.

## 27.2 `survive`

- `survive` ist kein Default mehr.
- Eine Map kann ein begrenztes Respawn-Budget pro Spieler definieren.
- 0 Respawns bedeutet „letztes Leben“, nicht sofortige Niederlage.
- Ein endgültig toter Spieler kann nicht mehr zurückkehren.
- Er bleibt trotzdem Rundenteilnehmer für Ergebnis und Belohnungen.
- Team-Wipe ohne mögliche Respawns führt zur Niederlage.
- Erreichen des Zeitlimits führt zum Sieg.

## 27.3 Encounter

- Encounter sind endlich.
- Encounter-Clear und Mapsieg sind getrennte Konzepte.
- Ein Encounter kann über Zeit, vorherigen Fortschritt oder ein definiertes Gameplay-Ereignis starten.
- Mindestens ein echter Bossphasen-Trigger wurde praktisch validiert.
- Unabhängiger Hintergrunddruck blockiert einen Encounter nicht.
- Ein technischer Restgegner kann eine Map nicht dauerhaft festhalten.

## 27.4 Persistente Spawnquellen

- vorhandene zerstörbare Spawnpunkte funktionieren weiterhin.
- ihre Gegner zählen nicht automatisch zu laufenden Pflicht-Encountern,
- Zerstörung beendet zukünftige Spawns dieser Quelle.

## 27.5 Pacing

- gute Spieler werden niemals durch zusätzliche Pflichtwellen in derselben vorgesehenen Zeit bestraft,
- Ruhephasen besitzen klare Grenzen,
- `repel-assault` belohnt Effizienz durch kürzere Mission,
- `survive` belohnt Effizienz durch mehr freie Zeit.

## 27.6 Arena

- variable Höhe ist optional möglich,
- bestehende Maps behalten ohne Höhenangabe ihr heutiges Verhalten,
- Nord-/Südfronten werden nur auf dafür geeigneten Maps eingesetzt,
- große Maps bleiben über Kamera und Telegraphing verständlich.

## 27.7 Multiplayer

- Host bleibt Autorität,
- Latejoiner verändern die laufende Mission nicht,
- aktuelle Mission und Bedrohung sind für Clients rekonstruierbar.

---

# 28. Risiken und Leitplanken

| Risiko | Folge | Leitplanke |
|---|---|---|
| `repel-assault` wird nur „alte Waves mit Pausen“ | Wenig echter Mehrwert | Endliche, bewusst komponierte Encounter mit Peaks und Frontwechseln. |
| Schnelle Kills starten sofort mehr Pflichtwellen | Gute Spieler werden bestraft | Mindestpause bei `repel-assault`; geplante Timeline bei `survive`. |
| `survive` bleibt faktisch Standard mit anderem Namen | Modi unterscheiden sich kaum | Survive bewusst selten einsetzen und über Respawnknappheit definieren. |
| Letzter Respawn = sofortige Niederlage | Unlogischer Last-Life-Moment | Niederlage erst, wenn niemand mehr aktiv oder respawnfähig ist. |
| Ausgeschiedene Spieler verlieren Rewards | Frust trotz Teilnahme | Eliminierung nicht mit dem bestehenden Nicht-Teilnehmer-Spectator gleichsetzen. |
| MapDirector übernimmt Bosslogik | God Object | Director reagiert auf Bosszustände, Boss-System bleibt Eigentümer der Bossmechanik. |
| Allgemeiner Eventbus wird zu groß | unnötige Komplexität | kleine, typisierte Encounter-Trigger. |
| Jeder Gegner muss aus jeder Richtung spawnen | Scope Creep | Spawnrichtungen dürfen gegnerspezifisch eingeschränkt sein. |
| Persistente Spawnpunkte werden zu Encounter-Gegnern | falsche Clear-Bedingungen | dramaturgische Encounter und Hintergrunddruck getrennt halten. |
| Variable Höhe blockiert Kernumbau | langer technischer Umbau vor Gameplaytest | Encounter zuerst auf bestehender Geometrie validieren. |
| Zu viele Gegner gleichzeitig | Performance-Spitzen | Spawn-Batches und sinnvolle Active-Enemy-Grenzen. |
| Pausen werden mit Busywork gefüllt | künstliches Spielgefühl | kurze Ruhe darf Ruhe bleiben; strategische Aufgaben erst bei längeren Intermissions. |

---

# 29. Vision: Ausbaustufe B – Nebenmissionen und Belohnungen

Ausbaustufe B nutzt die in A entstandenen zeitlichen und räumlichen Handlungsfenster.

## 29.1 Secondary Objectives

Mögliche Archetypen:

- Vorposten einnehmen,
- Bier bergen und zurückbringen,
- Spawnstruktur zerstören,
- Spezialziel eliminieren,
- Position kurz verteidigen.

Nebenmissionen bleiben vom Hauptziel getrennt.

## 29.2 Rewards

Map-interne Belohnungen:

- Power-up-Podest aktivieren,
- Verteidigungsturm aktivieren,
- Basis teilweise reparieren,
- Spawnquelle deaktivieren,
- temporären Team-Buff erhalten.

Meta-Belohnungen:

- Bonus-XP,
- bessere Item-Rarity,
- später eventuell zusätzliche Item-Auswahl.

## 29.3 Intermissions als Missionsfenster

Beispiel:

```text
Pflichtangriff gecleart
↓
15 Sekunden bis zur nächsten Front
↓
Option: Vorposten nördlich einnehmen
↓
Risiko: Team ist beim nächsten Angriff noch unterwegs
```

Damit werden Ruhephasen auf langen Maps zu echten Entscheidungen.

---

# 30. Vision: Ausbaustufe C – Dynamik und Risk-vs.-Reward

## 30.1 Challenge-Waves

Spieler können freiwillig zusätzliche Gefahr aktivieren:

```text
Challenge starten
↓
zusätzlicher harter Encounter
↓
zusätzliche Belohnung
```

Pflicht-Encounter und Challenge-Encounter bleiben klar unterscheidbar.

## 30.2 Dynamische Map-Events

Beispiele:

- Luftangriff öffnet einen Weg,
- Zug verändert temporär die Arena,
- neue Brutöffnung entsteht,
- Bereich fängt Feuer,
- Verteidigungsanlage wird aktiviert oder fällt aus,
- neuer Zugang oder neue Front entsteht.

Der MapDirector darf diese Ereignisse auslösen oder auf sie reagieren, implementiert ihre Fachlogik aber nicht selbst.

## 30.3 Kontrollierte Encounter-Varianten

Ein Encounter kann später wenige authored Varianten besitzen:

```text
Variante A: Angriff Nord
Variante B: Angriff Süd
```

Dadurch steigt Wiederspielwert, ohne die Identität der Map aufzugeben.

---

# 31. Vision: Ausbaustufe D – Content-Multiplikatoren und Kampagnenrework

## 31.1 Elite-/Champion-System

Wenige klar erkennbare Modifikatoren können bestehende Gegner neu kombinieren.

Beispiele:

- gepanzert,
- schneller,
- regenerierend,
- Buff-Aura,
- explosive Eigenschaft.

## 31.2 Vollständige Kampagnenmigration

Nach Stabilisierung von A–C:

- Kampagnenmaps vollständig auf das neue Encounter-System migrieren,
- `repel-assault` als normalen Standard etablieren,
- nur wenige gezielt ausgewählte Maps als `survive` gestalten,
- Maplängen von ca. 40 Sekunden bis ca. 5 Minuten sinnvoll verteilen,
- Schwierigkeit, XP, Items und Multiplayer-Skalierung neu prüfen.

## 31.3 Neue Inhalte danach gezielt ergänzen

Neue Gegner, Bosse oder Konstrukte werden erst ergänzt, wenn tatsächlich eine spielerische Lücke erkennbar ist.

---

# 32. Langfristiges Zielbild

Eine Coop-Defense-Map ist zukünftig nicht mehr primär:

> **Gelände + Basen + periodische Gegnerintervalle**

sondern:

> **Gelände + Encounter + Trigger + Fronten + Pausen + Entscheidungen + Ziele + Belohnungen**

Der Standardablauf ist:

> **Repel Assault – endliche, klar komponierte Angriffe abwehren.**

`Survive` wird dagegen zum seltenen Sonderfall:

> **Zeit überleben, während das Team nach und nach seine begrenzten Respawns verliert.**

Boss- und Feindbasisziele verwenden dasselbe Encounter-Fundament, dürfen ihre Dramaturgie aber durch eigene Ereignisse beeinflussen.

Damit erhält Coop Defense mehrere klar voneinander unterscheidbare Missionsformen, ohne für jede davon ein separates Grundsystem aufzubauen.

---

# Anhang A – Empfohlenes Authoring-Muster

```text
Map
├─ Geometrie
│  ├─ Breite
│  ├─ optionale Höhe
│  ├─ Terrain
│  └─ Umgebung
│
├─ Basen / Spawnstrukturen
│
├─ Hauptziel
│  ├─ repel-assault        ← Standard
│  ├─ survive              ← seltener Spezialmodus
│  ├─ destroy-hostile-bases
│  └─ defeat-boss
│
├─ optionale persistente Druckquellen
│
└─ Director
   ├─ Phase: Opening
   │  └─ Encounter
   │
   ├─ Phase: Pressure
   │  ├─ Encounter
   │  └─ Encounter mit Event-Trigger
   │
   └─ Phase: Finale
      └─ Final Encounter
```

---

# Anhang B – Beispiel `repel-assault`

```text
Encounter 1
├─ Zombies West
└─ Demons West

Clear
↓
5 s Ruhe
↓
Telegraph neue Front

Encounter 2
├─ Zombies Nord
└─ Spore Wardens Nord

Clear
↓
6 s Ruhe
↓
Finale

Encounter 3
└─ großer Mixed Assault

Clear
↓
Sieg
```

Ein stärkeres Team beendet dieselbe Pflichtmenge schneller.

---

# Anhang C – Beispiel `survive`

```text
Zeitlimit: 2:00
Respawns pro Spieler: konfiguriert

00:10 Encounter A
00:35 Encounter B
01:00 großer Angriff
01:25 Encounter C
01:50 Finale
02:00 Sieg
```

Spieler A:

```text
Start
Respawns: 2
↓ Tod
Respawn: 1
↓ Tod
Respawn: 0
↓ letzter Lebensabschnitt
↓ Tod
endgültig ausgeschieden
```

Die Map läuft weiter, solange mindestens ein Teammitglied aktiv weiterkämpfen oder noch regulär respawnen kann.

---

# Anhang D – Beispiel Bossphasen-Trigger

```text
Bosskampf beginnt
↓
Encounter A unterstützt Phase 1
↓
Boss erreicht definierten Phase-2-Zustand
↓
Boss-System führt seine eigene Transition aus
↓
MapDirector erkennt "Phase 2 erreicht"
↓
Telegraph neue Front
↓
Encounter B startet
```

Die Bossmechanik bleibt im Boss-System. Der MapDirector orchestriert nur die Reaktion der Map.

---

**Ende des GDD – Ausbaustufe A · Version 3**
