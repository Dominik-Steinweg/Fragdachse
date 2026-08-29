# Fragdachse – Persistente Basis
## Implementierungs-GDD Phase 3D – Permanent Rewards & Special Placement Framework (V2)

**Status:** Ready for Implementation Planning  
**Zielgruppe:** Coding-KIs und Entwickler  
**Dokumenttyp:** Delta-orientiertes Implementierungs-GDD  
**Voraussetzung:** Phase 3C ist abgeschlossen. Die persistente Basis ist in die Kampagne integriert und besitzt funktionierende Campaign-Working-State-, Commit- und Rollback-Semantik.

---

# 1. Ziel von Phase 3D

Phase 3D ergänzt die persistente Basis um **dauerhafte, basisgebundene Kampagnen-Rewards**.

Diese Rewards:

- werden durch Kampagnenfortschritt dauerhaft freigeschaltet,
- können sowohl durch Hauptmissions-/Map-Erfolge als auch durch Nebenmissionen vergeben werden,
- gehören zur Persistent Base bzw. zum Kampagnenstand des Hosts,
- sind keine persönlichen Konstruktionen eines Spielers,
- werden nicht auf persönliche Construction Capacity angerechnet,
- können von allen berechtigten Spielern der Host-Session platziert werden,
- verwenden möglichst bestehende Runtime- und Gameplay-Definitionen,
- werden über ein gemeinsames Radialmenü zugänglich gemacht.

Phase 3D führt noch **kein vollständiges Repositioning** ein. Das generische erneute Platzieren bereits zurückgebauter Rewards sowie das Verschieben bestehender Objekte folgen erst in Phase 3F.

---

# 2. Architektur-Leitprinzip

Map-Siege und Nebenmissionen dürfen **keine getrennten permanenten Reward-Systeme** besitzen.

Beide Triggerarten müssen auf denselben generischen Grant-Pfad führen:

```text
Campaign Event
    -> Persistent Base Reward Grant
        -> persönlicher Campaign-Unlock
            -> Host Base Reward State
                -> Placement
```

Der Unterschied zwischen Map-Sieg und Nebenmission liegt ausschließlich darin, **wann und wodurch der Grant ausgelöst wird**.

Nicht erwünscht:

```text
if mapId === '12' && objectiveId === '...'
    unlockHolyHandGrenade()
```

Erwünscht ist ein datengetriebener Reward-Vertrag mit stabiler Reward-ID.

---

# 3. Fachliche Trennung

Phase 3D trennt drei Konzepte strikt voneinander.

## 3.1 Reward Definition

Beschreibt, **was** ein Reward ist.

Beispiele:

- Adrenalin-Podest
- HP-Podest
- Fliegenpilzturm
- Raketenturm
- Holy-Hand-Grenade-Podest

Die Definition enthält die statischen Runtime-/Presentation-/Placement-Informationen.

## 3.2 Reward Grant / Unlock

Beschreibt, dass ein Spieler einen bestimmten Reward **dauerhaft freigeschaltet** hat.

Ein Grant ist idempotent:

```text
locked -> unlocked
unlocked -> keine Änderung
```

Ein Reward darf niemals mehrfach vergeben werden.

## 3.3 Base Placement State

Beschreibt den Zustand des Rewards in der Host-Basis.

Fachliche Zustände:

```text
locked
unlocked + unplaced
unlocked + placed
```

`locked` muss nicht zwingend als eigener persistierter Datensatz gespeichert werden. Entscheidend ist die fachliche Semantik, nicht die konkrete Storage-Repräsentation.

---

# 4. Reward-Katalog für Phase 3D

Phase 3D implementiert fünf konkrete permanente Base Rewards.

| Freischaltung | Reward | Kategorie |
| --- | --- | --- |
| Sieg Map 4 | Adrenalin-Podest | Base Pedestal |
| Sieg Map 6 | Fliegenpilzturm | Base Turret |
| Sieg Map 7 | HP-Podest | Base Pedestal |
| Sieg Map 9 | Raketenturm | Base Turret |
| Nebenmission Map 12 | Holy-Hand-Grenade-Podest | Base Pedestal |

Diese fünf Rewards sind zugleich die Referenzfälle für das generische Framework.

---

# 5. Wiederverwendung vorhandener Gameplay-Definitionen

Es sollen keine parallelen Kopien bereits vorhandener Türme oder Power-up-Systeme entstehen.

## 5.1 Fliegenpilzturm

Der permanente Fliegenpilzturm verwendet die bestehende Gameplay-/Weapon-/Visual-Definition des vorhandenen `spore_turret`.

Die Base-owned Variante unterscheidet sich nur hinsichtlich:

- Provenienz
- Persistenz
- Capacity
- Placement
- Bindung an den Basiskern
- Zerstörbarkeit

## 5.2 Raketenturm

Der permanente Raketenturm verwendet die bestehende Gameplay-/Weapon-/Visual-Definition des vorhandenen `rocket_turret`.

Auch hier darf keine zweite technisch unabhängige Raketenturm-Implementierung entstehen.

## 5.3 HP-Podest

Das permanente HP-Podest verwendet die vorhandene Health-Power-up-Mechanik.

Initialer Zielwert für den Respawn:

```text
5 Sekunden
```

Balancing erfolgt später.

## 5.4 Adrenalin-Podest

Das permanente Adrenalin-Podest verwendet die bestehende Adrenalin-Power-up-Mechanik.

Initialer Zielwert:

```text
10 Sekunden Respawn
```

Balancing erfolgt später.

## 5.5 Holy-Hand-Grenade-Podest

Das permanente HHG-Podest verwendet die bestehende Holy-Hand-Grenade-Power-up-Logik.

Zielverhalten:

- erfolgreiche Erstplatzierung gibt sofort die erste Holy Hand Grenade aus,
- anschließend normaler Respawnzyklus,
- initial weiterhin 30 Sekunden Respawn.

---

# 6. Base-owned vs. persönliche Konstruktionen

Base Rewards sind ausdrücklich **keine persönlichen Konstruktionen**.

Beispiel:

```text
Persönlicher rocket_turret
    -> frei platzierbar
    -> eigene HP
    -> persönliche Ownership
    -> persönliche Construction Capacity
    -> persönlicher Persistent-Base-Contribution-State

Base-owned rocket_turret
    -> direkt mit Persistent Base verbunden
    -> keine eigenen HP
    -> keine persönliche Capacity
    -> gehört zum Host-Base-State
    -> einzigartiger Campaign Reward
```

Ein Inspector darf zusätzlich zum Base-owned Raketenturm weiterhin seine persönlichen Raketentürme besitzen und bauen.

---

# 7. Construction Capacity

Permanente Base Rewards kosten **keine persönliche Construction Capacity**.

Dies gilt für:

- Base Pedestals
- Base Turrets

Die persönliche Kapazität bleibt ausschließlich für persönliche Spieler-Konstruktionen zuständig.

---

# 8. Base Turrets

Die permanenten Türme aus Phase 3D sind **direkt an die Persistent Base gekoppelte Türme**.

Sie funktionieren fachlich wie bereits vorhandene authored Base-Turrets:

- kein eigener kollidierender Turm-Body,
- keine eigenen HP,
- kein eigenes zerstörbares Construction-Objekt,
- ihre Existenz ist an die Basis gekoppelt.

Wird der Basiskern im Kampf zerstört, fällt der daran gekoppelte Base Turret mit der Basis aus.

Der Turm selbst kann nicht separat zerstört werden.

---

# 9. Base Pedestals

Permanente Podeste sind:

- nicht kollidierend,
- überlaufbar,
- nicht durch Spieler oder Projektile blockierend,
- nicht separat zerstörbar.

Dies gilt für:

- Adrenalin-Podest
- HP-Podest
- Holy-Hand-Grenade-Podest

Podeste müssen daher nicht dieselbe Damage-/Collision-Semantik wie frei platzierbare Konstruktionen besitzen.

---

# 10. Unlock über Map-Siege

Folgende Rewards werden bei erfolgreichem Abschluss der jeweiligen Map vergeben:

```text
Map 4 Victory
    -> adrenaline_pedestal

Map 6 Victory
    -> spore_turret

Map 7 Victory
    -> health_pedestal

Map 9 Victory
    -> rocket_turret
```

Der Reward-Grant wird nur für reward-berechtigte Teilnehmer der Runde vergeben.

Spectators und nicht reward-berechtigte Latejoiner erhalten keinen Unlock.

Jeder berechtigte Spieler speichert den Reward in seinem eigenen Kampagnenfortschritt.

Dadurch kann ein Spieler den Reward später auch verwenden, wenn er selbst Host einer Session ist.

---

# 11. Unlock über Nebenmissionen

Nebenmissionen dürfen permanente Base Rewards über denselben generischen Grant-Pfad vergeben.

Der Secondary-Objective-Reward-Vertrag wird dafür datengetrieben erweitert.

Konzeptionelles Authoring:

```text
secondaryObjective:
    rewards:
        persistentBaseRewardsOnComplete:
            - holy_hand_grenade_pedestal
```

Der konkrete TypeScript-/JSON-Vertrag darf sich an die bestehende Map-Authoring-Architektur anpassen.

Entscheidend ist:

- keine Map-12-Sonderlogik,
- keine HHG-Sonderlogik im Objective-System,
- die Nebenmission meldet lediglich einen generischen Reward Grant.

---

# 12. Map 12 als Proof of Concept für Secondary-Objective Rewards

Die Holy Hand Grenade wird in Phase 3D nicht mehr einfach durch den Sieg auf Map 12 freigeschaltet.

Stattdessen:

```text
Map-12-Nebenmission erfolgreich abgeschlossen
    -> holy_hand_grenade_pedestal dauerhaft freischalten
```

Die konkrete Nebenmission wird authored.

Die bisherige normale Map-12-Holy-Hand-Grenade-/Placement-Reward-Lösung wird durch die permanente Reward-Variante ersetzt bzw. entsprechend bereinigt.

---

# 13. Sofortiger Nebenmissions-Grant

Ein Secondary-Objective-Reward wird **sofort beim erfolgreichen Abschluss der Nebenmission** vergeben.

Er wartet nicht auf den späteren Ausgang der Hauptmission.

Beispiel:

```text
Map 12
    -> Nebenmission erfolgreich
    -> HHG-Podest dauerhaft freigeschaltet
    -> Hauptmission später verloren
    -> HHG-Podest bleibt trotzdem freigeschaltet
```

Ein erfolgreich erreichter Meta-Reward darf nicht durch eine spätere Hauptmissionsniederlage zurückgenommen werden.

---

# 14. Sofortige Nutzung in derselben Mission

Wird das HHG-Podest während Map 12 erstmals freigeschaltet, erscheint es **noch während derselben laufenden Mission** als verfügbare Base-Reward-Aktion.

Der Spieler kann es direkt platzieren.

Dadurch entsteht:

```text
Nebenmission geschafft
    -> Reward erhalten
    -> Reward sofort im aktuellen Kampf nutzbar
    -> Reward dauerhaft freigeschaltet
```

Diese Semantik soll grundsätzlich auch für spätere Secondary-Objective-Rewards möglich bleiben.

---

# 15. Multiplayer-Grant-Semantik

Secondary Objectives werden hostautoritativ abgeschlossen.

Bei einem permanenten Reward:

```text
Host erkennt Objective Completion
    -> Host erzeugt zuverlässigen Base-Reward-Grant
    -> alle reward-berechtigten Round Participants erhalten den Grant
    -> jeder Client persistiert den persönlichen Unlock
```

Anforderungen:

- reliable Übertragung,
- idempotente Verarbeitung,
- keine Doppelbelohnung,
- Reconnect-/Wiederholungsrobustheit,
- keine Belohnung für Spectators,
- keine Belohnung für nicht reward-berechtigte Latejoiner.

Der Host-Kampagnenstand entscheidet weiterhin, welche Rewards im aktuellen Raum zur gemeinsamen Persistent Base gehören.

---

# 16. Wer darf Base Rewards platzieren?

Phase 3D verwendet zunächst ein permissives Modell:

**Jeder aktive, berechtigte Spieler darf unplatzierte Base Rewards der Host-Basis platzieren.**

Der Host bleibt authoritative:

- Host validiert Placement,
- Host besitzt den gemeinsamen Base-State,
- Host speichert das Ergebnis.

Der platzierende Gast wird dadurch **nicht Owner des Rewards**.

Provenienz bleibt:

```text
owner = persistent base / host campaign
```

nicht:

```text
owner = player who placed it
```

Sollte dieses Modell im Playtest Probleme verursachen, muss eine spätere Umstellung auf „nur Host darf Base Rewards verwalten“ ohne grundlegenden Datenmodell-Umbau möglich sein.

Daher sollten Permissions nicht implizit durch Ownership des platzierenden Spielers kodiert werden.

---

# 17. Placement-Orte

Unplatzierte Base Rewards dürfen platziert werden:

- im Testgelände / Lobby-Base-Management,
- in einer laufenden Kampagnenmission mit aktiver Persistent Base.

Die normale Placement-Validierung der Persistent Base gilt weiterhin.

Die konkrete zulässige Position kann je Reward-Kategorie unterschiedlich sein:

- Base Pedestal
- Base Turret

Die Architektur soll dafür einen gemeinsamen Special-Placement-Vertrag unterstützen.

---

# 18. Erstplatzierung in Phase 3D

Ein neu freigeschalteter, unplatzierter Reward darf in Phase 3D erstmals platziert werden.

Nach erfolgreicher Platzierung:

```text
unlocked + unplaced
    -> unlocked + placed
```

Der Reward verschwindet danach aus dem Radialmenü.

Ein einzigartiger Reward kann nicht mehrfach platziert werden.

---

# 19. Rückbau in Phase 3D

Ein platzierter permanenter Reward darf zurückgebaut werden.

Rückbau bedeutet:

```text
placed -> unplaced
```

Der Reward wird **nicht vernichtet** und bleibt dauerhaft freigeschaltet.

Wichtig:

Phase 3D erlaubt nach einem Rückbau noch **keine erneute Platzierung**.

Damit kann Rückbau nicht bereits als provisorisches Repositioning genutzt werden.

---

# 20. Wiederaufbau und Repositioning erst in Phase 3F

Folgende Funktionen bleiben ausdrücklich Phase 3F vorbehalten:

- erneute Platzierung eines bereits zurückgebauten Rewards,
- Verschieben eines platzierten Rewards,
- allgemeines Repositioning,
- vollständiges Radial Menu V2.

Somit kann ein in 3D zurückgebauter Reward bis Phase 3F vorübergehend im Zustand:

```text
unlocked + unplaced
```

verbleiben, ohne erneut platzierbar zu sein.

Diese Einschränkung ist bewusst.

---

# 21. Campaign Working State bei Placement und Rückbau

Base-Reward-Placement während einer Kampagnenmission verwendet die vorhandene Working-State-Philosophie.

## Erstplatzierung während einer Mission

```text
Reward vorher:
unlocked + unplaced

Mission Working State:
placed
```

Bei Sieg:

```text
placed wird committed
```

Bei Niederlage/Abbruch:

```text
Rollback auf unlocked + unplaced
```

## Rückbau während einer Mission

```text
Reward vorher:
placed

Mission Working State:
unplaced
```

Bei Sieg:

```text
unplaced wird committed
```

Bei Niederlage/Abbruch:

```text
Rollback auf placed
```

---

# 22. Unterschied zu Secondary-Objective-Unlocks

Der **Unlock selbst** ist Meta-Progression und wird bei erfolgreicher Nebenmission sofort dauerhaft gespeichert.

Er gehört nicht zum Mission Working State.

Deshalb:

```text
Secondary Objective abgeschlossen
    -> Reward dauerhaft unlocked

danach Reward platziert
    -> Placement ist Working State
```

Beispiel:

```text
Map 12:
Nebenmission geschafft
    -> HHG dauerhaft unlocked

HHG-Podest platziert
Hauptmission verloren

Ergebnis:
    HHG bleibt unlocked
    Placement wird zurückgerollt
    Reward ist wieder unplaced
```

Diese Trennung ist zentral.

---

# 23. Action Radial – Ziel von 3D

3D baut noch nicht das vollständige Radial Menu V2 aus Phase 3F.

Es verallgemeinert das bisher Inspector-zentrierte Radialmenü aber bereits zu einem **universellen Action Radial**, das grundsätzlich in allen unterstützten Spielmodi und für alle Klassen erreichbar ist.

Die zentrale Trennung lautet:

```text
E = aktuell ausgewählte E-Aktion ausführen

R = Action Radial öffnen
```

Die Verfügbarkeit von `R` hängt **nicht** von folgenden Bedingungen ab:

- Klasse
- Spielmodus
- Anzahl ausgerüsteter Aktionen
- vorhandenen persönlichen Konstruktionen
- aktiver Persistent Base
- aktuell gültigen Rückbauzielen

Es gibt somit keine Gameplay-Regel mehr wie:

```text
>= 2 Aktionen -> Radial
>= 1 Konstrukt -> Radial
sonst kein Radial
```

`R` ist stattdessen ein stabiler, universeller Zugriff auf Auswahl und Management.

---

# 24. Universeller R-Zugriff

`R` öffnet das Action Radial grundsätzlich immer, sofern Gameplay-Input in der aktuellen Situation erlaubt ist.

Das Input-System soll nicht entscheiden müssen, **warum** das Radial in einem bestimmten Kontext sinnvoll ist.

Dadurch werden Sonderregeln vermieden wie:

```text
if Inspector ...
else if Construction equipped ...
else if Persistent Base active ...
else if multiple E actions ...
```

Das Verhalten soll über die Modi hinweg konsistent sein:

- Deathmatch
- Team Deathmatch
- Capture the Beer
- Coop Defense
- Coop Defense mit Persistent Base
- Testgelände / Lobby-Aktivität

---

# 25. Kontext bestimmt Menüinhalt, nicht Zugriff

Das Action Radial wird beim Öffnen dynamisch aus den Action-Kategorien aufgebaut, die im aktuellen Player-, Mode- und World-Kontext grundsätzlich existieren.

Mögliche Kategorien:

```text
utility
construction
persistentReward
managementAction
specialPower
```

Phase 3D muss davon mindestens sauber unterstützen:

- normale Utility-Aktion
- persönliche Construction-Aktionen
- Persistent-Base-Rewards
- notwendige Management-Aktionen für Rückbau

Spätere Kategorien, insbesondere weitere Special Powers und vollständiges Repositioning, folgen in 3F oder später.

Eine Action-Kategorie, die in einem Spielmodus prinzipiell nicht existiert, muss nicht angezeigt werden.

---

# 26. Enabled/Disabled statt Zugriffs-Sonderregeln

Die momentane Ausführbarkeit einer Aktion entscheidet **nicht**, ob das Radial geöffnet werden darf.

Stattdessen wird zwischen zwei Fragen unterschieden:

```text
Existiert diese Aktion grundsätzlich in diesem Kontext?

Kann diese Aktion genau jetzt erfolgreich ausgeführt werden?
```

Beispiele:

## Rückbau

Rückbau kann als Management-Aktion im Radial vorhanden sein.

Existiert aktuell kein gültiges Rückbauziel:

```text
Rückbau
-> sichtbar
-> deaktiviert / nicht ausführbar
```

Die Aktion muss deshalb nicht aus dem Menü verschwinden.

## Persistent-Base-Management

In einer World mit Persistent Base können entsprechende Management-Aktionen grundsätzlich vorhanden sein.

Ist aktuell kein geeignetes Objekt vorhanden, darf die Aktion deaktiviert dargestellt werden.

## Deathmatch mit normaler Utility

Auch wenn ein Spieler nur eine normale Utility besitzt, darf `R` das Action Radial öffnen.

Das Radial kann beispielsweise nur die Utility und grundsätzlich unterstützte, aktuell aber deaktivierte Management-Aktionen enthalten.

Dieser selten wenig nützliche Fall ist bewusst akzeptiert, weil dadurch die globale Bedienlogik erheblich einfacher bleibt.

---

# 26.1 E bleibt reine Ausführungstaste

`E` ist unabhängig vom Radialzugriff.

`E` führt die aktuell ausgewählte E-Aktion aus bzw. startet deren Placement-, Targeting- oder Aktivierungsmodus.

Beispiele:

```text
R -> Raketenturm auswählen
E -> Raketenturm platzieren
```

```text
R -> normale Utility auswählen
E -> Utility verwenden
```

Die zuletzt ausgewählte, weiterhin gültige E-Aktion bleibt aktiv, bis:

- der Spieler eine andere auswählt,
- die Aktion grundsätzlich nicht mehr verfügbar ist,
- ein definierter Kontextwechsel einen deterministischen Fallback erfordert.

---

# 26.2 Stabile Management-Aktionen

Management-Aktionen sollen grundsätzlich stabile Radial-Einträge sein, sofern sie im aktuellen Spielmodus bzw. World-Kontext unterstützt werden.

Für Phase 3D insbesondere:

- Rückbau
- ggf. bestehendes Global-Dismantle, sofern weiterhin fachlich gewollt

Später in 3F zusätzlich beispielsweise:

- Verschieben / Repositioning

Ein aktuell fehlendes gültiges Ziel führt vorzugsweise zu `disabled`, nicht zum vollständigen Entfernen des Eintrags.

Dadurch bleiben Menüpositionen und mentale Modelle für den Spieler stabil.

---

# 26.3 Kein Inspector-Besitz des Radialmenüs

Inspector Gadachs bleibt ein wichtiger Nutzer des Action Radials, besitzt das System aber nicht mehr exklusiv.

Der Inspector erhält typischerweise besonders viele persönliche Construction-Aktionen.

Andere Klassen können das gleiche Radial für:

- normale Utilities,
- eigene verfügbare Konstruktionen,
- Persistent-Base-Rewards,
- Rückbau,
- spätere Base-Management-Aktionen

verwenden.

Damit wird das Radial zu einer allgemeinen Eingabeschnittstelle statt zu einem klassenbezogenen Spezial-UI.

---

# 27. Keine Base Rewards im Loadout

Permanente Base Rewards werden nicht in normale Loadout-Slots aufgenommen.

Sie werden dynamisch aus dem Host-Base-State in die verfügbaren Radialaktionen eingespeist.

Damit bleiben getrennt:

```text
Player Loadout
```

und:

```text
Host Persistent Base Capabilities
```

---

# 28. Generisches Special-Action-Modell

Phase 3D soll das Aktionsmodell so vorbereiten, dass später weitere Kategorien ohne erneuten grundlegenden Umbau integriert werden können.

Konzeptionelle Kategorien:

```text
construction
persistentReward
utility
specialPower
managementAction
```

Die konkreten TypeScript-Typen werden anhand der aktuellen Architektur festgelegt.

3D muss noch nicht alle Kategorien vollständig implementieren.

Mindestens erforderlich:

- `construction`
- `persistentReward`
- bestehende Utility-Kompatibilität
- notwendige Management-Aktionen für Rückbau

---

# 29. Zukünftige Erweiterbarkeit

Das 3D-Modell soll später ohne grundlegenden Architekturwechsel unterstützen können:

- weitere Base-Türme,
- weitere Base-Podeste,
- einzigartige Spezialstrukturen,
- Nebenmissions-Rewards,
- alternative Campaign-Rewards,
- Special Powers wie Nuke,
- Management-Aktionen,
- weitere Freischaltquellen.

Die Nuke selbst ist nicht Teil von 3D.

---

# 30. Nicht Bestandteil von Phase 3D

Explizit ausgeschlossen:

- Build-Area-Erweiterung / Radius-Progression → 3E
- Repositioning → 3F
- Wiederplatzierung zurückgebauter Rewards → 3F
- vollständiger Cooldown-UX-Refactor → 3F
- vollständiges Radial Menu V2 → 3F
- Structure Occupancy
- Wachturm
- Dachsbau
- neue komplexe Turmtypen
- großes Balancing der Reward-Werte

---

# 31. Implementierungsschritte

Phase 3D wird in vier Implementierungsschritte geteilt.

## 3D-1 – Persistent Base Reward Domain & Progression Grants

### Ziel

Ein generisches, persistierbares Base-Reward-Modell einführen.

### Scope

- stabile Reward-IDs definieren
- Reward-Katalog für die fünf Phase-3D-Rewards
- persistierte persönliche Unlocks ergänzen
- Host-Base-Placement-State ergänzen
- Zustände `locked / unplaced / placed`
- Grant-Funktion idempotent gestalten
- Map-Victory-Reward-Authoring einführen
- Secondary-Objective-Reward-Authoring einführen
- beide Triggerarten auf denselben Grant-Pfad führen
- Save-Sanitizing / Export / Import entsprechend ergänzen

### Progression

- Map 4 -> Adrenalin-Podest
- Map 6 -> Fliegenpilzturm
- Map 7 -> HP-Podest
- Map 9 -> Raketenturm
- Map-12-Nebenmission -> HHG-Podest

### Multiplayer

- Grants an alle reward-berechtigten Round Participants
- reliable
- idempotent
- Spectators/Latejoiner ausgeschlossen

### Akzeptanzkriterien

- derselbe Reward kann niemals doppelt freigeschaltet werden
- Map-Rewards und Secondary-Objective-Rewards verwenden denselben Grant-Service/-Pfad
- ein verlorenes Match nach erfolgreicher Map-12-Nebenmission entfernt den HHG-Unlock nicht
- jeder berechtigte Teilnehmer erhält seinen persönlichen Unlock
- Host-State bleibt Grundlage für die Basis im aktuellen Raum

---

## 3D-2 – Base-owned Runtime & Special Placement

### Ziel

Base Rewards als eigenständige Base-owned Runtime-Kategorie materialisieren und erstmals platzierbar machen.

### Scope

- gemeinsame Runtime-/Definition-Wiederverwendung für:
  - `spore_turret`
  - `rocket_turret`
  - Health Power-up
  - Adrenaline Power-up
  - Holy Hand Grenade
- Base Turrets als Anbauten des Persistent-Base-Cores
- keine eigenen HP / Bodies für Base Turrets
- Base Pedestals ohne Blocker-Kollision
- Base Pedestals unzerstörbar
- keine persönliche Construction Capacity
- Host-validiertes Placement
- jeder aktive berechtigte Spieler darf platzieren
- erfolgreiche Erstplatzierung `unplaced -> placed`
- einzigartiger Reward kann nur einmal stehen

### Working State

- Placement im Testgelände entsprechend vorhandener Base-Management-Semantik
- Placement in Campaign Mission:
  - Sieg -> Commit
  - Defeat/Abort -> Rollback

### Akzeptanzkriterien

- Base-owned Raketenturm verwendet bestehendes Raketenturm-Gameplay
- Base-owned Fliegenpilzturm verwendet bestehendes Spore-Turret-Gameplay
- beide sind nicht separat zerstörbar
- Podeste sind überlaufbar und unzerstörbar
- Base Rewards verbrauchen keine persönliche Capacity
- Gast-Placement ändert nicht die Ownership des Rewards
- Niederlage nach Placement rollt nur das Placement zurück, nicht einen bereits erworbenen Unlock

---

## 3D-3 – Universal Action Radial & Reward UX

### Ziel

Das bestehende Inspector-zentrierte Radialmenü zu einem universellen Action Radial verallgemeinern.

### Scope

- `R` öffnet das Action Radial grundsätzlich in allen unterstützten Spielmodi und für alle Klassen
- keine Zugriffsregeln anhand von:
  - Klasse
  - Anzahl verfügbarer Aktionen
  - ausgerüsteten Konstruktionen
  - Persistent-Base-Zustand
- `E` bleibt ausschließlich Ausführungstaste der aktuell ausgewählten E-Aktion
- Base Rewards nicht als `LoadoutToolRef` persistieren
- Radialinhalt dynamisch aus Player-/Mode-/World-Kontext aufbauen
- mindestens folgende Action-Kategorien sauber integrieren:
  - Utility
  - persönliche Construction
  - Persistent Base Reward
  - Management / Rückbau
- platzierte einzigartige Base Rewards aus der auswählbaren Reward-Liste entfernen
- Management-Aktionen dürfen sichtbar, aber deaktiviert sein, wenn aktuell kein gültiges Ziel existiert
- Inspector-spezifische Konstruktionen weiterhin ergänzend anzeigen
- Auswahl einer gültigen E-Aktion bleibt als Quick Action aktiv
- noch kein vollständiges 3F-Cooldown-/Statusmodell
- vollständiges Repositioning bleibt 3F

### Akzeptanzkriterien

- `R` öffnet unabhängig von Klasse und Spielmodus dasselbe generische Action Radial
- normale Klassen benötigen kein ausgerüstetes Konstrukt, um das Radial öffnen zu können
- Deathmatch mit nur einer normalen Utility darf das Radial trotzdem öffnen
- `E` funktioniert unabhängig davon weiterhin direkt mit der aktuell ausgewählten Aktion
- Dachs Nukem und Dachs of Steel können verfügbare Base Rewards auswählen
- Inspector sieht zusätzlich seine persönlichen Construction-Aktionen
- platzierter einzigartiger Reward ist nicht mehr als auswählbarer Placement-Reward sichtbar
- Rückbau kann als stabiler Management-Eintrag vorhanden sein und bei fehlendem Ziel deaktiviert werden
- das Input-System enthält keine Sonderlogik mehr, die anhand der Anzahl von Aktionen entscheidet, ob `R` verfügbar ist
- Base Rewards benötigen keinen Loadout-Slot

---

## 3D-4 – Concrete Reward Integration, Map 12 & Dismantle

### Ziel

Alle fünf Rewards vollständig in die Kampagne integrieren und Map 12 als End-to-End-Test für Secondary-Objective-Meta-Rewards abschließen.

### Scope

#### Map 4
- Adrenalin-Podest nach Victory freischalten

#### Map 6
- Fliegenpilzturm nach Victory freischalten

#### Map 7
- HP-Podest nach Victory freischalten

#### Map 9
- Raketenturm nach Victory freischalten

#### Map 12
- geeignete Secondary Objective authored mit HHG-Podest als permanentem Reward
- HHG-Grant sofort bei Objective Completion
- Reward sofort in derselben Mission platzierbar
- bisherige temporäre HHG-Reward-/Map-Mechanik bereinigen
- sofortige erste Holy Hand Grenade bei Placement
- danach 30-Sekunden-Zyklus

#### Rückbau
- platzierte Base Rewards zurückbaubar
- `placed -> unplaced`
- Reward bleibt unlocked
- keine erneute Platzierung in 3D
- Mission-Rückbau verwendet Commit/Rollback

### Akzeptanzkriterien

- alle fünf Rewards funktionieren End-to-End
- wiederholte Siege vergeben kein zweites Exemplar
- wiederholte Map-12-Nebenmission vergibt keinen zweiten HHG-Reward
- Map-12-HHG kann unmittelbar nach Nebenmissionsabschluss in derselben Runde genutzt werden
- spätere Niederlage entfernt den HHG-Unlock nicht
- Rückbau vernichtet keinen Reward
- zurückgebauter Reward bleibt bis 3F unplaced und nicht erneut platzierbar

---

# 32. Empfohlene Tests

## Reward Grants

- Map 4 victory -> Adrenalin unlocked
- Map 6 victory -> Spore Turret unlocked
- Map 7 victory -> Health unlocked
- Map 9 victory -> Rocket Turret unlocked
- Map 12 victory ohne Nebenmission -> kein HHG-Unlock
- Map-12-Nebenmission -> HHG unlocked
- derselbe Grant zweimal -> nur eine Zustandsänderung

## Multiplayer Grants

- Host + berechtigter Client -> beide erhalten persönlichen Unlock
- Spectator -> kein Unlock
- nicht reward-berechtigter Latejoiner -> kein Unlock
- reliable Event mehrfach verarbeitet -> kein Duplikat

## Secondary Objective

- Nebenmission abgeschlossen -> HHG sofort persistiert
- danach Hauptmission verloren -> HHG bleibt unlocked
- HHG erscheint sofort im Radialmenü
- HHG kann noch in derselben Mission platziert werden

## Placement

- Host platziert Reward
- Client platziert Host-Reward
- Ownership bleibt Base-owned
- kein Capacity-Verbrauch
- zweites Exemplar wird abgelehnt

## Campaign Commit / Rollback

### Placement

- unplaced -> place -> victory -> placed
- unplaced -> place -> defeat -> unplaced

### Dismantle

- placed -> dismantle -> victory -> unplaced
- placed -> dismantle -> defeat -> placed

## Base Turrets

- Base-owned spore turret ohne eigene HP
- Base-owned rocket turret ohne eigene HP
- direkte Base-Bindung
- Base zerstört -> Turm fällt mit Basis aus
- Turm kann nicht separat zerstört werden

## Pedestals

- keine Spielerblockade
- keine Projektilblockade
- unzerstörbar
- Health Respawn initial 5 s
- Adrenaline Respawn initial 10 s
- HHG erste Ausgabe sofort
- HHG Respawn initial 30 s

## Action Radial

- `R` öffnet das Radial in Deathmatch mit nur einer normalen Utility
- `R` öffnet das Radial für Nicht-Inspector-Klassen
- `R` öffnet das Radial unabhängig davon, ob persönliche Konstruktionen vorhanden sind
- `E` führt weiterhin die aktuell ausgewählte E-Aktion direkt aus
- unplatzierter Base Reward ist auswählbar
- platzierter Reward verschwindet aus der auswählbaren Reward-Liste
- Rückbau ist als Management-Aktion grundsätzlich verfügbar
- Rückbau ohne gültiges Ziel ist deaktiviert bzw. nicht ausführbar
- Nicht-Inspector kann Base Reward auswählen
- Inspector behält persönliche Construction-Auswahl

---

# 33. Technische Leitplanken

- Kein separates Map-Reward- und Secondary-Objective-Reward-System.
- Keine HHG-Sonderlogik außerhalb der Reward-Definition.
- Keine Kopien vorhandener Raketenturm-/Spore-Turret-Gameplay-Definitionen.
- Base Rewards nie in persönliche Contribution-Daten schreiben.
- Base Rewards nie auf persönliche Capacity anrechnen.
- Placement-Permission nicht mit dauerhaftem Player-Ownership verwechseln.
- Reward-Unlock und Reward-Placement getrennt persistieren.
- Secondary-Objective-Unlock nicht vom Round Outcome abhängig machen.
- Placement/Rückbau in Campaign Missions weiterhin über Working State / Commit / Rollback.
- Kein Repositioning durch Rückbau + sofortigen Neubau in 3D.
- Keine Klassen-/Modus-/Action-Count-Sonderregel für den Zugriff auf `R`.
- `R` ist universeller Radialzugriff; `E` bleibt Ausführung der aktuell ausgewählten E-Aktion.
- Kontext bestimmt Radialinhalt und Enabled/Disabled-Zustände, nicht den grundsätzlichen Zugriff.
- Keine numerischen Map-ID-Heuristiken zur Bestimmung von Rewards.
- Map-/Objective-Authoring verweist auf stabile Reward-IDs.
- Tests sollen fachliche Zustände prüfen, nicht unnötig konkrete Klassen-/Typnamen fixieren.

---

# 34. Definition of Done für Phase 3D

Phase 3D gilt als abgeschlossen, wenn:

1. ein generisches persistentes Base-Reward-Modell existiert,
2. Map-Siege und Nebenmissionen denselben Reward-Grant-Pfad verwenden,
3. Map 4 das Adrenalin-Podest freischaltet,
4. Map 6 den Fliegenpilzturm freischaltet,
5. Map 7 das HP-Podest freischaltet,
6. Map 9 den Raketenturm freischaltet,
7. eine Secondary Objective auf Map 12 das HHG-Podest freischaltet,
8. der HHG-Unlock sofort und unabhängig vom späteren Round Outcome persistiert,
9. alle reward-berechtigten Teilnehmer ihren persönlichen Unlock erhalten,
10. die Host-Basis den gemeinsamen Placement-State besitzt,
11. `R` für alle Klassen und unterstützten Spielmodi als universeller Action-Radial-Zugriff funktioniert,
12. `E` unabhängig davon die aktuell ausgewählte E-Aktion ausführt,
13. Base Rewards keine Loadout-Slots und keine persönliche Capacity verwenden,
14. Base Turrets direkt an die Basis gekoppelt und nicht separat zerstörbar sind,
15. Base Pedestals nicht kollidierend und unzerstörbar sind,
16. Rewards nur einmal gleichzeitig platziert werden können,
17. platzierte Rewards aus dem Radialmenü verschwinden,
18. Rückbau einen Reward nur auf `unplaced` setzt,
19. erneute Platzierung zurückgebauter Rewards weiterhin 3F vorbehalten bleibt,
20. Campaign Placement/Rückbau korrekt committed bzw. zurückgerollt wird,
21. keine Map-12-/HHG-Sonderarchitektur eingeführt wurde.