# From Dachs Till Dawn – Gesamtkonzept

**Status:** Work in Progress  
**Modus:** Endgame-/Endlosmodus auf Basis von *Dachs vs Zombies*  
**Freischaltung:** Nach Abschluss der 20 Maps der regulären Kampagne

---

## 1. Vision

**From Dachs Till Dawn** ist der langfristige Endgame-Modus von Fragdachse.

Nach Abschluss der regulären *Dachs vs Zombies*-Kampagne steht nicht mehr eine lineare Folge authored Maps im Mittelpunkt. Stattdessen spielen die Spieler theoretisch unbegrenzt viele kurze, teilweise zufällig erzeugte Tag-/Nacht-Runden.

Die bereits aufgebaute **persistente Basis** wird zum zentralen Bestandteil des Modus.

Der grundlegende Loop lautet:

```text
Lobby
↓
8-Minuten-Runde starten
↓
TAG
Map erkunden
Schrott sammeln
Salvage-Schauplätze absolvieren
↓
NACHT
zur Basis zurückkehren
mehrere Angriffswellen überleben
Basis verteidigen
↓
Sonnenaufgang / Rundensieg
↓
Lobby
↓
Schrott beim Schrotthändler investieren
↓
Spielerstärke verbessern
ODER
Basis expandieren und Threat erhöhen
↓
nächste zufällige Runde
```

Ziel ist ein Modus, der durch Basisentwicklung, Schrottwirtschaft, Itemoptimierung, Upgrade-Progression und variierende Szenarien **viele Stunden Replayability** bietet.

---

# 2. Grundvoraussetzungen

From Dachs Till Dawn wird erst nach Abschluss von **Map 20** freigeschaltet.

Grundsätzlich wird davon ausgegangen, dass der Spieler zu diesem Zeitpunkt bereits Zugang zu den wesentlichen Systemen des Spiels besitzt:

- Klassen
- Upgrade-System
- Boss-Upgrades
- Items
- Konstruktionen
- persistente Basis
- Nebenmissionssysteme
- weitere Late-Game-Mechaniken

Der Modus soll deshalb **kein weiteres Tutorial** und keine zweite klassische Kampagne darstellen.

Stattdessen kombiniert und erweitert er bestehende Systeme zu einem langfristigen Endgame-Loop.

---

# 3. Keine feste Day-Progression

Es gibt keine Struktur wie:

```text
Day 1
Day 2
...
Day 10
Ende
```

Stattdessen existiert eine theoretisch unbegrenzte Zahl von Tag-/Nacht-Zyklen.

Die Tagesnummer kann zu Statistik-/Präsentationszwecken angezeigt werden, besitzt aber **keine direkte Bedeutung für die Schwierigkeit**.

Die zentrale langfristige Progressionsachse ist stattdessen das **Threat Level**.

---

# 4. Rundendauer und Tag-/Nacht-Zyklus

Eine Runde dauert ungefähr:

**8 Minuten**

Innerhalb dieser Zeit durchläuft die Arena einen beschleunigten dynamischen Tag-/Nacht-Zyklus.

Grobe Struktur:

```text
Morgen / Tag
↓
Exploration und Salvage

Dämmerung
↓
Rückkehr / Vorbereitung

Nacht
↓
Angriff auf die Basis

Morgengrauen
↓
Runde gewonnen
```

Die genaue zeitliche Verteilung ist noch nicht final.

Als erste Orientierung könnte die Tagesphase ungefähr 3–4 Minuten und die Nachtphase ungefähr 4 Minuten einnehmen.

> **WORK IN PROGRESS:**  
> Die genaue zeitliche Aufteilung der acht Minuten muss noch getestet und festgelegt werden.

---

# 5. Tagesphase – Exploration und Salvage

Während des Tages sollen Spieler ausdrücklich **nicht hauptsächlich an der Basis stehen**.

Die Tagesphase soll dazu motivieren:

- die Arena zu erkunden,
- sich von der sicheren Basis zu entfernen,
- kleinere Kämpfe auszutragen,
- Salvage-Schauplätze zu finden,
- Schrott zu bergen,
- Risiko gegen verbleibende Zeit abzuwägen.

Die Gegnerdichte ist tagsüber grundsätzlich niedriger als nachts.

Der Hauptreward der Tagesphase ist:

# **Schrott**

Schrott ist die neue zentrale Endgame-Ressource von From Dachs Till Dawn.

---

# 6. Salvage-Schauplätze

Über die Arena verteilt erscheinen zufällig ausgewählte **Salvage-Schauplätze**.

Diese sollen nicht einfach aus statischen Kisten bestehen, bei denen einige Sekunden eine Taste gehalten wird.

Das Bergen selbst soll Gameplay erzeugen.

Mögliche Archetypen wurden bisher diskutiert:

- Wrack bergen oder zerstören
- Schrottsammler verfolgen und töten
- Extraktor aktivieren und kurz verteidigen
- Brutnest zerstören
- Versorgung bergen und transportieren
- kleinere verstreute Schrottfunde

Bestehende Systeme wie:

- `destroy`
- `hold`
- `carry`

sollen nach Möglichkeit dafür wiederverwendet werden.

Wichtig ist, dass verschiedene Schauplätze unterschiedliche Kombinationen aus:

- Zeitaufwand
- Risiko
- Entfernung zur Basis
- Gegnerdruck
- Schrottreward

bieten.

Dadurch soll beispielsweise folgende Entscheidung entstehen:

> Noch eine Bergung versuchen oder lieber vor Sonnenuntergang zur Basis zurückkehren?

> **WORK IN PROGRESS – hoher Designbedarf:**  
> Die Salvage-Schauplätze sind aktuell der größte noch nicht ausgearbeitete Gameplay-Bereich.  
> Es muss definiert werden:
>
> - welche Archetypen es zum Start gibt,
> - wie sie zufällig platziert werden,
> - wie ihre Interaktion konkret funktioniert,
> - wie viel Schrott sie liefern,
> - wie stark sie von Threat beeinflusst werden,
> - wie viele pro Tagesphase erscheinen,
> - ob alle sichtbar sind oder entdeckt werden müssen.

---

# 7. Schrottdrops durch Gegner

Neben Salvage-Schauplätzen können Gegner gelegentlich Schrott fallen lassen.

Dadurch bleibt auch das reine Kämpfen unmittelbar belohnend.

Die Grundidee:

- normale Gegner → geringe Dropchance / kleine Mengen
- stärkere Gegner → höhere Chance
- Elites / besondere Gegner → größere Schrottdrops

Die Tagesphase soll trotzdem die **wichtigste planbare Schrottquelle** bleiben.

Die Gegnerdrops sind eher zusätzliche Belohnung und positiver Feedbackmechanismus.

Höhere Threat Levels können bessere oder häufigere Schrottdrops ermöglichen.

> **WORK IN PROGRESS:**  
> Dropchancen, Mengen und die technische/presentationale Form der Drops müssen noch definiert werden.

---

# 8. Nachtphase – Verteidigung der persistenten Basis

Mit zunehmender Dunkelheit ändert sich das Gameplay deutlich.

Die Spieler sollen zur persistenten Basis zurückkehren.

Während der Nacht greifen große Gegnergruppen die Basis in mehreren Wellen beziehungsweise Encounter-Phasen an.

Der Schwerpunkt verschiebt sich damit von:

> Exploration

zu:

> konzentrierter Base Defense.

Die persistente Basis ist nicht nur Hintergrundelement, sondern das Zentrum der Nachtphase.

Angriffe können sich unter anderem unterscheiden durch:

- Anzahl der Spawnfronten
- Gegnerzusammensetzung
- schnelle Gegner
- schwere Gegner
- Elites
- besondere Angriffsmuster
- unterschiedliche Richtungen
- besondere Night Events

Die Schwierigkeit wird primär vom aktuellen **Threat Level** bestimmt.

Ein wichtiger Designgrundsatz:

> Höheres Threat soll möglichst nicht hauptsächlich durch extreme HP- und Schadensmultiplikatoren entstehen.

Stattdessen sollen vor allem:

- Gegnerzahl
- Komposition
- Spezialgegner
- Encounter-Komplexität
- Mehrfrontangriffe

eskalieren.

> **WORK IN PROGRESS:**  
> Die genaue Struktur der Nachtwellen sowie Sieg- und Niederlagebedingungen müssen noch final definiert werden.

---

# 9. Szenario-Generierung

Jede Runde soll leicht anders ausfallen.

Ausgehend vom aktuellen Threat Level wird aus einem Pool ein Szenario erzeugt.

Variieren können beispielsweise:

- Arena
- Salvage-Schauplätze
- Positionen der Salvage-Aktivitäten
- Gegnerzusammensetzung am Tag
- Nachtangriffe
- Haupt-Spawnfront
- Nebenfronten
- besondere Gegner
- Elite-Events
- besondere Umweltbedingungen

Ziel ist keine vollständige prozedurale Generierung.

Stattdessen sollen **kontrollierte, kombinierbare Content-Bausteine** verwendet werden.

Dadurch bleibt die Qualität authored, während sich Runden trotzdem unterschiedlich spielen.

> **WORK IN PROGRESS:**  
> Es muss später definiert werden, welche Parameter wirklich zufällig sein dürfen und welche bewusst authored bleiben.

---

# 10. Schrotthändler

Der Schrotthändler befindet sich **in der Lobby zwischen den Runden**.

Während einer laufenden Runde wird dort nicht eingekauft.

Der Händler besitzt vier Bereiche:

1. **Expansion**
2. **Infrastruktur**
3. **Upgrades**
4. **Ausrüstung**

Der Schrotthändler soll zunächst bewusst mit sehr wenig Content starten.

Wichtiger als eine große Anzahl von Angeboten ist eine saubere, datengetriebene Architektur, die später problemlos erweitert werden kann.

---

# 11. Kategorie A – Expansion

Expansion ist die zentrale Progressionsmechanik von From Dachs Till Dawn.

Jede Expansion bewirkt gleichzeitig:

1. **Persistent-Zone-Radius +1**
2. **Threat Level +1**
3. höheres Salvage-Potenzial
4. Zugang zu schwierigeren Szenarien und besseren Rewards

Damit erhält jede Progressionsstufe einen unmittelbar sichtbaren Gegenwert.

Beispiel:

```text
EXPANSION

Threat 4 → Threat 5

Persistent Zone
Radius 8 → Radius 9

Folgen:
+ zusätzliche Baufläche
+ höheres Salvage-Potenzial
+ gefährlichere Gegner
+ bessere Rewards
```

Der größere Radius ermöglicht zusätzliche:

- Mauern
- Türme
- Support-Konstruktionen
- andere defensive Layouts

Die wachsende Basis ist damit gleichzeitig eine **sichtbare Darstellung des Endgame-Fortschritts**.

---

# 12. Threat Level

Das Threat Level besitzt einen festen Bereich:

**Threat 1 bis Threat 10**

Threat 1 ist der Ausgangszustand.

Durch neun Expansionen wird schließlich Threat 10 erreicht.

Threat bestimmt insbesondere:

- Gegnerstärke
- Encounter-Komplexität
- verfügbare Gegnertypen
- mögliche Elite-/Spezialereignisse
- Schrottpotenzial
- XP-Rewards
- Itemqualität bzw. Lootpotenzial

Threat 10 stellt das höchste bewusst gebalancete Schwierigkeitsniveau dar.

Es gibt **keine unbegrenzte numerische Gegnereskalation** oberhalb davon.

Spieler können From Dachs Till Dawn auf Threat 10 trotzdem unbegrenzt weiterspielen.

---

# 13. Nichtlineare Expansion

Die Kosten der Expansion steigen stark an.

Threat 1 → 2 soll relativ schnell erreichbar sein.

Threat 9 → 10 dagegen ein langfristiges Endgame-Ziel darstellen.

Beispielhafte Progressionsidee:

```text
Threat 1 → 2
sehr günstig

Threat 2 → 3
günstig

Threat 3 → 4
moderat

Threat 4 → 5
moderat

Threat 5 → 6
teuer

Threat 6 → 7
sehr teuer

Threat 7 → 8
langfristig

Threat 8 → 9
Endgame

Threat 9 → 10
sehr langfristiges Endgame-Ziel
```

> **WORK IN PROGRESS:**  
> Die konkreten Kosten und die gewünschte Spielzeit zwischen den Threat Levels müssen noch anhand der tatsächlichen Schrott-Economy berechnet werden.

---

# 14. Höheres Threat = höheres Salvage-Potenzial

Ein höheres Threat Level bedeutet nicht ausschließlich mehr Schwierigkeit.

Es verbessert gleichzeitig die möglichen Rewards.

Dadurch entsteht eine positive Progressionsspirale:

```text
Basis expandieren
↓
Threat steigt
↓
schwierigere Runde
↓
mehr / wertvolleres Salvage
↓
mehr XP und bessere Items
↓
Spieler und Basis werden stärker
↓
nächste Expansion
```

Das höhere Salvage-Potenzial soll nach Möglichkeit auch **sichtbar in der Welt** sein.

Nicht ausschließlich:

```text
Threat 6
→ +30 % Schrott
```

sondern beispielsweise:

- wertvollere Wracks
- größere Bergungsevents
- neue Salvage-Archetypen
- bessere Extraktoren
- seltene Schrottquellen
- stärkere Gegner mit besseren Drops

> **WORK IN PROGRESS:**  
> Wie stark Threat die verschiedenen Rewardkanäle beeinflusst, muss noch ausgearbeitet werden.

---

# 15. Kategorie B – Infrastruktur

Infrastruktur enthält permanente Verbesserungen der Basis beziehungsweise des From-Dachs-Till-Dawn-Systems.

Diese Upgrades:

- kosten Schrott,
- machen die Basis effektiver,
- erhöhen **nicht** das Threat Level.

Erstes mögliches Angebot:

### Reparaturdrohnen

Nach einer erfolgreich überstandenen Runde reparieren Drohnen beschädigte persistente Konstruktionen.

Weitere spätere Beispiele:

- Schrottscanner
- verbesserte Salvage-Erkennung
- Schrott-Pickup-Unterstützung
- Bergungsboni
- Support-Systeme der Basis

Für Version 1 sollen nur sehr wenige Infrastruktur-Upgrades umgesetzt werden.

> **WORK IN PROGRESS:**  
> Die konkrete Startauswahl und genaue Wirkung der Infrastruktur-Upgrades ist noch nicht festgelegt.

---

# 16. Kategorie C – Upgrades

Der Schrotthändler erweitert das bereits existierende Upgrade-System.

Diese Investitionen erhöhen **nicht** Threat.

Dadurch kann ein Spieler zunächst stärker werden, wenn ihm seine aktuelle Threat-Stufe zu schwierig ist.

Zwei zentrale Mechaniken sind vorgesehen.

## 16.1 Zusätzliche Boss-Upgrades

Über die Kampagne erhält der Spieler nur eine begrenzte Zahl an Boss-Upgrades.

Im Endgame können zusätzliche Boss-Upgrades beziehungsweise Boss-Punkte gegen Schrott erworben werden.

Diese werden mit jedem Kauf deutlich teurer.

Beispiel:

```text
1. zusätzlicher Boss-Punkt
→ günstig

2.
→ deutlich teurer

3.
→ noch teurer

...
```

Dadurch entsteht ein langfristiger Schrott-Sink.

> **WORK IN PROGRESS:**  
> Kostenkurve und eventuell vorhandene Obergrenze müssen noch festgelegt werden.

---

# 17. Neue Upgrade-Zweige

Der Schrotthändler kann Upgrade-Inhalte freischalten, die anschließend im normalen Upgrade-System geskillt werden.

Ein möglicher erster Kandidat ist:

## Nekromantie

Die Nekromantie könnte aus der normalen Kampagnenprogression entfernt werden.

Beim Händler wird stattdessen beispielsweise gekauft:

> **Nekromantie-Forschung freischalten**

Danach erscheint der vorhandene Nekromantie-Zweig im normalen Upgrade-Baum und wird dort regulär mit Upgrade-/Boss-Punkten entwickelt.

Dieses Prinzip erlaubt später weitere exklusive Endgame-Upgrade-Zweige.

Der Händler ersetzt damit nicht das Upgrade-System.

Er **erweitert dessen verfügbaren Content**.

> **WORK IN PROGRESS:**  
> Ob Nekromantie tatsächlich vollständig aus der Kampagne in From Dachs Till Dawn verschoben wird, muss noch final entschieden werden.

---

# 18. Kategorie D – Ausrüstung

Dieser Händlerbereich erweitert das bestehende Item-System.

Auch Ausrüstungsinvestitionen erhöhen **nicht** Threat.

Mögliche Startangebote:

## Items kaufen

Der Händler kann eine kleine Auswahl zufälliger Items anbieten.

Die genaue Mechanik ist noch offen.

## Crafting-Items kaufen

Ein wichtiges erstes Infinite-Sink-Beispiel:

### Rekalibrierungskern

Ein Crafting-Gegenstand, mit dem die Affixe eines Items neu ausgewürfelt werden.

Beispielsweise bleiben erhalten:

- Item-Slot
- Item-Level
- Rarität

während die Affixe neu bestimmt werden.

Später könnte das Crafting-System erweitert werden um:

- Affix sperren
- einzelnes Affix neu rollen
- Affix-Werte neu rollen
- weitere Item-Manipulationen

Damit bleibt Schrott auch nach vollständigem Ausbau der Basis dauerhaft relevant.

> **WORK IN PROGRESS:**  
> Das genaue Crafting-System, Händlerangebot und die Itempreise müssen separat ausgearbeitet werden.

---

# 19. Zentrale Trennung: Stärke vs. Progression

Ein wichtiger Designgrundsatz lautet:

## Infrastruktur, Upgrades und Ausrüstung

machen den Spieler oder seine bestehende Basis stärker.

**Threat bleibt unverändert.**

Dadurch kann ein Spieler beispielsweise auf Threat 6 mehrere Runden spielen und:

- bessere Items finden,
- Items craften,
- zusätzliche Boss-Upgrades kaufen,
- neue Upgrade-Zweige freischalten,
- Infrastruktur verbessern.

Threat 6 wird dadurch zunehmend einfacher.

---

## Expansion

ist dagegen die bewusste Entscheidung:

> **Ich bin bereit für die nächste Endgame-Stufe.**

Expansion:

```text
Radius +1
+
Threat +1
+
Rewardpotenzial ↑
```

Damit fungiert Expansion als organischer Difficulty-/Progression-Regler, ohne dass der Spieler im Menü einfach „Schwierigkeitsgrad: Schwer“ auswählt.

---

# 20. Persistente Basis als visueller Fortschritt

Die persistente Basis ist ein zentraler Bestandteil des gesamten Systems.

Durch Expansion wächst ihre Persistent Zone schrittweise.

Dadurch wird Progression direkt sichtbar:

```text
Threat 1
kleine Basis

↓

Threat 5
deutlich größere befestigte Anlage

↓

Threat 10
maximal ausgebaute Persistent Zone
```

Spieler gewinnen dadurch nicht nur abstrakte Werte, sondern tatsächlich neue Fläche für:

- Verteidigungsringe
- Turmpositionen
- Support-Strukturen
- alternative Basislayouts

Das Basiswachstum soll deshalb einer der wichtigsten langfristigen Motivatoren des Modus sein.

---

# 21. Rundenerfolg und Persistenz

Nach erfolgreicher Verteidigung wird der relevante persistente Zustand gespeichert.

Das bestehende Prinzip der Persistent Base soll erhalten bleiben:

```text
Committed Base
↓
Runde startet
↓
Working State
↓
Sieg
↓
Working State wird committed
```

Bei einer Niederlage soll grundsätzlich kein dauerhaft zerstörter Basiszustand entstehen.

> **WORK IN PROGRESS:**  
> Im Detail muss noch definiert werden, welche während einer Runde erzielten Rewards bei Niederlage behalten werden:
>
> - Schrott aus Salvage?
> - Schrottdrops?
> - XP?
> - Items?
>
> Dies ist eine wichtige Economy- und Exploit-Entscheidung.

---

# 22. Multiplayer

From Dachs Till Dawn baut auf der bestehenden Coop-Defense-Architektur auf.

Die persistente Basis folgt grundsätzlich weiterhin dem Host-Persistence-Modell.

Bestehende Regeln für:

- Host-Persistent-Konstruktionen
- Guest-Session-Konstruktionen
- Base-Owned-Rewards
- Restore
- Commit
- Disconnect

sollen möglichst wiederverwendet werden.

> **WORK IN PROGRESS:**  
> Händlerbesitz, Schrottbesitz und Progression im Multiplayer müssen noch ausdrücklich spezifiziert werden.  
> Insbesondere:
>
> - Ist Schrott persönlich oder hostbezogen?
> - Wer darf Expansion kaufen?
> - Profitieren Clients dauerhaft von Schrott?
> - Wie werden individuelle Händler-Upgrades synchronisiert?

---

# 23. Aktueller Kern des Modus

Der derzeitige konzeptionelle Stand lässt sich auf fünf Säulen reduzieren:

## A. Dynamische 8-Minuten-Runden

Unbegrenzt wiederholbare, leicht variierende Tag-/Nacht-Szenarien.

## B. Tagesphase

Freie Exploration und Schrottgewinn über zufällige Salvage-Schauplätze sowie kleinere Gegnerdrops.

## C. Nachtphase

Mehrstufiger Angriff auf die persistente Basis, die gemeinsam verteidigt werden muss.

## D. Schrotthändler

Vier Kategorien:

```text
Expansion
Infrastruktur
Upgrades
Ausrüstung
```

## E. Threat-Progression

Expansion ist der zentrale Fortschrittstreiber:

```text
Expansion kaufen
↓
Persistent-Zone-Radius +1
↓
Threat +1
↓
schwierigere Gegner
+
höheres Salvage-/Rewardpotenzial
```

Threat besitzt ein festes Maximum von **10**.

---

# 24. Wichtigste noch offene Designbereiche

Vor einer vollständigen GDD-/Implementierungsplanung müssen insbesondere folgende Punkte weiter ausgearbeitet werden:

1. **Salvage-Schauplätze**  
   Konkrete Gameplay-Archetypen, Anzahl, Platzierung, Rewards und Variation.

2. **8-Minuten-Rundenstruktur**  
   Exakte Dauer von Tag, Dämmerung und Nacht.

3. **Nacht-Encounter**  
   Wellenstruktur, Threat-Budgets und Eskalation von Threat 1–10.

4. **Threat-Kurve**  
   Konkrete Expansion-Kosten und gewünschte Spielzeit bis Threat 10.

5. **Reward-Skalierung**  
   Einfluss von Threat auf Schrott, XP und Itemqualität.

6. **Schrotthändler-Content**  
   Startangebote für Expansion, Infrastruktur, Upgrades und Ausrüstung.

7. **Crafting**  
   Genaue Funktionsweise und Kosten der Item-Manipulation.

8. **Niederlagenregel**  
   Welche während eines gescheiterten Runs gewonnenen Ressourcen erhalten bleiben.

9. **Multiplayer-Economy**  
   Besitz und Persistenz von Schrott, Händler-Upgrades und Expansion.

10. **Sieg-/Niederlagebedingungen der Nacht**  
    Insbesondere die genaue Rolle der Hauptbasis und der Spieler-Tode.

---

# 25. Leitprinzip

From Dachs Till Dawn soll kein zweites separates Spiel innerhalb von Fragdachse werden.

Der Modus soll möglichst viele vorhandene Systeme miteinander verbinden:

- Dachs-vs-Zombies-Kampf
- dynamische Tageszeit
- Encounter-System
- Nebenmissionen
- persistente Basis
- Konstruktionen
- Upgrade-System
- Boss-Upgrades
- Items
- Multiplayer

Neue Systeme werden vor allem dort ergänzt, wo sie einen echten langfristigen Endgame-Loop schaffen:

> **Schrott → Schrotthändler → Basis/Charakter verbessern → Expansion → Threat erhöhen → schwierigere und lukrativere Runden → weiterer Fortschritt.**