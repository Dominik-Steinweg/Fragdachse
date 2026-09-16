# Fragdachse – Automatisiertes Performance-Lab

**Konzept für Version 1 · Dokumentrevision 3 · Stand: 16. September 2026**  
**Ziel:** Häufige reale Performanceprobleme schnell finden, gezielt nachtesten und Optimierungen vergleichen. Noch keine Implementierung oder Laufzeitverifikation.

**Änderungen gegenüber Revision 2:** Ablation wird zu einem optionalen, ausdrücklich eingeschalteten Diagnose-Schalter für einzelne Spezialtests. Automatische Normal-/Ablationsfolgen und Ablationsauswertungen entfallen. Zuerst wird eine kleine vollständige Messkette gebaut und erprobt, danach der Szenarioumfang ergänzt. Eigenständige Testfälle, ein einfacher Ergebnisvergleich und ein handlungsorientierter Bericht bilden den Diagnosekern. Die vereinbarten Karten- und Inhaltsanforderungen bleiben erhalten.

## 1. Ziel und bewusste Grenzen

Ein Befehl startet das **normale Spiel**, zeichnet dessen Laden und kurzen Lobbybetrieb auf und führt anschließend einen festen Referenzparcours auf einer eigenen Referenzkarte aus. Danach werden Chrome-Trace, Fragdachse-Trace und ein kompakter Phasenbericht gemeinsam gespeichert. **Ausführung und mechanische Auswertung benötigen keine KI.** KI kommt erst für Ursachenanalyse und Optimierungskonzepte hinzu.

Version 1 misst einen lokalen **Solo-/Host-Lauf**. Rendering, Combat, Physik und Gegnerverhalten werden nicht nachgebaut; nur Ausgangszustände und Eingaben werden kontrolliert. Kein Anspruch auf vollständige Problemabdeckung. Keine Multiplayer-Lasttests, vollständige Inhaltsmatrix, Replay-Technik, Cloud-Infrastruktur, Screenshots, automatische Ablationsvergleiche oder automatische Ursachensuche. Fehler dürfen zum Verlust des Laufs führen; keine Pflicht zur Rettung von Teilergebnissen.

**Arbeitsablauf:** Standardlauf → auffälligen Testfall im Bericht erkennen → nur diesen Fall gezielt wiederholen → Code untersuchen und optimieren → zwei Ergebnisstände vergleichen → abschließend den Standardlauf prüfen. Der Standardlauf sucht breit; Einzeltests dürfen bei Bedarf länger oder mit einer ausdrücklich gewählten Diagnoseeinstellung laufen. Die KI interpretiert Befunde und entwickelt Änderungen, steuert aber nicht den laufenden Test.

**Zeitbudget:** Der Standardlauf soll unter den festgelegten Referenzbedingungen ungefähr zehn Minuten nicht überschreiten, gerechnet vom Seitenaufruf bis zum Ende der aufgezeichneten Rückkehr. Build, Browserstart und Dateiaufbereitung liegen außerhalb. Dies ist ein Planungsziel, **kein hartes Abbruchlimit für langsamere Hardware oder eine Performance-Regression**. Ein separater, großzügigerer Gesamt-Timeout beendet festhängende Läufe. Zunächst ein Durchlauf pro Aufruf; weitere Läufe werden ausdrücklich gestartet. Die Zeitverteilung ist noch zu erproben.

## 2. Automatischer Ablauf und Bedienung

Vorgesehener Befehl: **`npm run perf:chrome`**. Ein Aufruf führt den Standardlauf aus und speichert die Ergebnisse ohne weitere Bedienung. Eine kleine Konfiguration oder Startparameter wählen einen Einzeltest und gegebenenfalls dessen Dauer. Optional kann eine vorhandene Ablationskategorie für genau diesen Spezialtest ausdrücklich aktiviert werden; es folgt dadurch **kein automatischer zweiter Lauf**. Die genaue Syntax wird bei der Umsetzung festgelegt.

```text
Spiel-Build bereitstellen und lokal ausliefern, ohne HMR
→ sichtbares Chrome-Fenster in frischer, isolierter Lab-Browserumgebung öffnen
→ Chrome-Aufzeichnung vor Navigation zur Spielseite starten
→ normaler Einstieg über index.html / src/main.ts
→ Verbindung, Assets, World und Lobby normal laden
→ erfolgreichen Lobby-Reveal abwarten
→ 3 Sekunden frühe Lobby aufzeichnen
→ Referenzkarte über normalen Arena-Startpfad anfordern
→ Lab-Vorbereitung und Referenzphasen automatisch durchlaufen
→ Effekte abklingen lassen, Arena-Abbau und Rückkehr zur Lobby aufzeichnen
→ beide Aufzeichnungen abschließen, Ergebnisse speichern, Ressourcen schließen
```

Die Lobbyfrist beginnt erst nach erfolgreicher Bereitschaft und vollständigem Reveal, nicht nach einem beliebigen Browser-Ladeereignis. Bestehende Ladebarrieren und nachgeladene Assets bleiben erhalten. Zusätzliche Wartezeit nach der Startanforderung wird getrennt ausgewiesen. Die drei Sekunden messen frühen Lobbybetrieb, keinen dauerhaften Lobbybetrieb.

Der normale Verbindungsaufbau bleibt Bestandteil des Starts; er ist kein gezielt erzeugter Netzwerklasttest. Lokales Laden bildet nicht die Übertragungsbedingungen der öffentlichen Auslieferung ab. Chrome-Tracing vor dem Seitenaufruf ist über die Browser-API möglich [Q1].

**T-Menü:** einfacher manueller Start desselben Szenario-Controllers, keine umfangreiche Konfigurationsoberfläche. Ohne Runner funktioniert die Fragdachse-Aufzeichnung; Chrome wird dann bei Bedarf manuell aufgenommen. Der manuelle Start ist kein kalter, vollständig aufgezeichneter Seitenstart und wird entsprechend gekennzeichnet.

## 3. Umsetzung: erst Messkette erproben, dann Inhalte ergänzen

Die folgenden Schritte sind die Implementierungsreihenfolge, nicht vier parallel zu entwickelnde Teilprojekte. Der vollständige Inhaltsumfang unten ist das Ziel für Version 1, **nicht Voraussetzung für den ersten nutzbaren Zwischenstand**.

| Schritt | Umfang und Abschlusskriterium |
|---|---|
| **1. Einfaches Grund-Lab** | Normaler Spielstart, drei Sekunden Lobby, eine kleine erste Fassung der Referenzkarte und **ein einfacher Testfall**, etwa Glock mit wenigen Gegnern. Chrome- und Fragdachse-Trace, gemeinsame Marker, kompakter Bericht und nutzbare Source-Maps. Noch keine Lab-Ablation und kein vollständiger Parcours. |
| **2. Grundsätzlich erproben** | Den Fall einzeln und mehrfach unverändert ausführen; tatsächliche Last, plausible Messwerte, Streuung und Kosten der Instrumentierung prüfen. Einen einfachen Vergleich zweier Ergebnisordner ergänzen. Mit einem verlängerten einfachen Lauf die geplante Trace-Größe und Auswertbarkeit prüfen. Auffälligkeiten am Werkzeug jetzt beheben. |
| **3. Szenarien schrittweise ausbauen** | Große Karte und die vereinbarten Fälle in derselben Struktur ergänzen: Umgebung, Felsen/Nuke/BFG, Gegner, Waffen, Utilities/Bau, gemischter Tag-/Nachtkampf und Rückkehr. Jeden ergänzten Fall kurz prüfen. Bestehende Ablationsschalter nur bei Bedarf schlank zugänglich machen; kein eigener automatischer Diagnoseablauf. |
| **4. Gesamtlauf kalibrieren und abschließen** | Laufdauer, reale Last, wichtige Einzeltests, Bericht und Build-Trennung prüfen. Mit einer normalen manuellen Spielrunde plausibilisieren, ob die Lasten nützlich und spielnah sind; daraus keine zusätzliche automatisierte Suite machen. |

Einige unveränderte Wiederholungen, beispielsweise drei, dienen zunächst als Plausibilitätsprüfung und sind kein aufwendiges Statistiksystem. Eine kurze Gegenmessung mit geringerer Instrumentierung hilft, grobe Eigenkosten zu erkennen. Keine automatischen Wiederholungen im täglichen Standardlauf verlangen.

**Nicht vorziehen:** vollständige Szenariomatrix, allgemeine Testsprache, eigener umfassender Trace-Analysator oder neue Architektur des eigentlichen Spiels. Ist ein Testfall instabil oder die Aufzeichnung unbrauchbar, zuerst das Grund-Lab verbessern statt weitere Inhalte hinzufügen.

## 4. Referenzkarte und Zeitverteilung

### Karte: groß, wasserreich und dauerhaft felsreich

Eigene, versionierte **relativ große Referenzkarte** mit festem Seed, dichten Felsfeldern, freien Flächen, repräsentativer Vegetation und Umgebungstieren, **mehreren großen Seen**, einem **Zug** und Platz für den kleinen Verteidigungsaufbau. Normale Kamera und produktive Map-/World-Systeme verwenden; keine nachgebauten Test-Renderer. Überwiegend spielnahe Last, ergänzt um ausdrücklich gekennzeichnete Extremabschnitte.

Die Karte muss groß und felsreich genug sein, dass **auch nach Nuke, BFG und den weiteren vorgesehenen Zerstörungen noch viele Felsen auf der Gesamtkarte existieren**. Große zerstörungsfreie Reservebereiche außerhalb der geplanten Wirkbereiche vorsehen; die Last darf nicht unbemerkt verschwinden. Sowohl hohe globale Felsmengen als auch dichte lokale Bereiche sollen mit Projektilen und anderen Operationen zusammenkommen. Ein später lokal freigeräumter Abschnitt bedeutet ausdrücklich **nicht**, dass die ganze Karte fast leer ist.

Kartengröße, anfängliche Felsmenge und eine ausreichende Mindestrestmenge werden als Szenariodaten festgelegt. Vor und nach den großen Zerstörungsphasen sowie zu Beginn relevanter Kampfphasen vorhandene und zerstörte Felsmengen erfassen; globale und lokale/sichtbare Mengen soweit verfügbar unterscheiden. Dafür bestehende Zähler oder wenige Messungen an Phasengrenzen verwenden, keine neuen vollständigen World-Scans pro Frame.

Die Seen müssen tatsächlich entlang der vorgegebenen Route sichtbar werden. Ufer, große Wasserflächen und deren Eintritt in beziehungsweise Austritt aus dem Kamerabild gehören in den Umgebungstest. Mindestens ein vergleichbarer Kampfausschnitt für Tag und Nacht enthält Wasser im Bild. Seen nicht vorab außerhalb der normalen Lade- und Renderpfade vorbereiten, um Kosten aus der Messung zu entfernen.

Der Zug fährt während eines frühen, benannten Abschnitts tatsächlich durch den sichtbaren Testbereich, bevor große Zerstörungsaktionen ihn treffen können. Darstellung und Bewegung nutzen die produktive Zuglogik. **Er darf später zerstört werden und muss innerhalb des Laufs nicht wiederkehren oder ersetzt werden.** Auftreten und gegebenenfalls Zerstörung markieren. Für den Tag-/Nachtvergleich denselben Zugzustand herstellen; ein in beiden Vergleichsabschnitten bereits zerstörter beziehungsweise abwesender Zug ist zulässig.

### Phasen und Budget

**Erster Budgetvorschlag:** ungefähr acht Minuten für die folgenden Abschnitte; Rest bis ungefähr zehn Minuten für initiales Laden, drei Sekunden Lobby, Arena-Vorbereitung und zusätzliche Umrüstungen. Die größere Karte und beide Tageszeiten bleiben in diesem Budget. Die konkrete Machbarkeit muss der erste Lauf bestätigen; Feinverteilung anhand tatsächlich ausgelöster Mechaniken festlegen, nicht jede Aktion auf dieselbe Dauer zwingen.

| Abschnitt | Inhalt | Richtbudget |
|---|---|---:|
| Umgebung und dichtes Felsfeld | Definierte Route mit mehreren großen Seen und sichtbarer Zugfahrt; wenig Gegner/Projektile; Grundlast bei hoher globaler Felsmenge. | 55 s |
| Felszerstörung und lokal freigeräumtes Gebiet | Einzelzerstörung, Nuke-Großereignis, danach BFG mit wiederholten Zerstörungen; lokal ausgedünnte Route bei weiterhin hoher globaler Felsmenge. | 75 s |
| Gegnerstaffelung | Wenige, mittlere und viele Gegner, wenig Spielerfeuer; feste Artenmischung und sichere Bewegungsroute. | 40 s |
| Waffenparcours | Die zehn unten genannten Waffen; passende Ziele, geringe und hohe Projektilmengen, auch in felsreichen Bereichen; benannte Unterphasen. | 125 s |
| Utility und Verteidigungsaufbau | HE, Molotov, Smoke, Platzieren einiger Basis-Walls und Basis-Raketen-Türme; Armageddon in klar markiertem Abschnitt. Nuke/BFG sind bereits im Felszerstörungstest abgedeckt. | 75 s |
| Gemischter Kampf: Tag und Nacht | Vergleichbare Durchläufe um 12:00 und 00:00 Uhr mit Verteidigungsaufbau, Gegnern, Projektilen, Kills und Folgeeffekten; markierter Tageszeitwechsel und gleichartige Extremanteile. | 90 s |
| Erholung und Rückkehr | Neue Angriffe/Spawns stoppen; langlebige Effekte, Restobjekte, Abbau und Lobby-Rückkehr beobachten. | 20 s |
| **Summe** | **Richtbudgets, keine bereits bestätigten Laufzeiten.** | **480 s / 8 min** |

Ein Inhalt kann mehrere Fragestellungen abdecken und muss nicht mehrfach vollständig getestet werden. Für Folgeexplosionen, DoT, BFG-Zerstörung und anhaltende Effekte genügend Auslauf vorsehen; Umrüstung darf diese nicht vor der Beobachtung löschen. Reichen Unterphasen nicht, zunächst innerhalb des Budgets umverteilen statt die Last oder die beobachteten Mechaniken zu reduzieren.

### Felszerstörung: unterschiedliche Lastmuster

**Nuke:** Ein großes, klar markiertes Zerstörungsereignis mit sehr vielen Felsen im Wirkbereich. Insbesondere die gleichzeitig beziehungsweise in einem engen Zeitfenster anfallende Arbeit beobachten.

**BFG:** Anschließend ein noch dicht besetzter, anderer oder ausreichend unbeschädigter Bereich. Sehr viele Felsen in kurzen Abständen **über mehrere Sekunden hinweg** zerstören. Wiederkehrende Zerstörungsspitzen, Aufstau und nachlaufende Arbeit getrennt vom einmaligen Nuke-Ereignis betrachten. Ein bereits von der Nuke geleerter Zielbereich wäre kein gültiger BFG-Test.

Beide Utilities über ihre echten Aktions-, Schadens- und World-Mutationspfade einsetzen, nicht durch direkte Massenlöschung ersetzen. Hohe Zerstörungszahlen sollen durch die tatsächlich ausgelösten Aktionen entstehen. Nach jedem Einsatz kurz beobachten, bis die relevante nachlaufende Arbeit erfasst ist. Danach normale Projektile und weitere Aktionen bei weiterhin hoher globaler Felsmenge prüfen. Auch Armageddon darf die für spätere Abschnitte benötigte Restlast nicht unbemerkt beseitigen; Reihenfolge beziehungsweise Wirkbereich entsprechend festlegen.

Felsfeld → Zerstörung → lokal freigeräumtes Gebiet bleibt eine zusammenhängende Folge. Andere Abschnitte starten mit definierter Vorbereitung. Resets und künstliche Eingriffe bekommen eigene Marker und werden nicht als reguläre Kampfkosten ausgegeben. Ein freigeräumtes Gebiet ist kein isolierter Vergleich zu einer von Anfang an dünn besetzten Karte. Einzelphasen müssen ihre nötigen Ausgangszustände selbst herstellen können.

### Gemischter Kampf: 12 Uhr gegenüber 24 Uhr

Zwei benannte Vergleichsabschnitte: **Tag um 12:00 Uhr** und **Nacht um 00:00 Uhr, entsprechend den gewünschten 24 Uhr**. Während jedes Abschnitts die Tageszeit konstant halten. Gleiche hohe Grafikqualität, Kamera/Route, Gegnergruppen, Waffen-/Utility-Builds, Aktionsfolge, Verteidigungsaufbau sowie vergleichbare Fels-, Wasser- und Effektlast verwenden. Vorgesehene Lichtquellen müssen in beiden Abläufen tatsächlich aktiviert werden.

Den Wechsel von Tag zu Nacht über die produktive Tageszeit-/Beleuchtungslogik auslösen und ebenfalls aufzeichnen. Umschaltkosten und die anschließende Nachtphase getrennt auswerten; kein beschleunigter vollständiger Tageszyklus erforderlich. Als Budgetansatz beispielsweise je 35 Sekunden Kampf und 20 Sekunden für markierten Wechsel/Vorbereitung verwenden, nicht als starre technische Wartezeiten.

Den Nachtabschnitt nicht einfach mit den vom Tageskampf übrig gebliebenen Gegnern, zerstörten Felsen und beschädigten Türmen fortsetzen. Beide Vergleichsabschnitte aus denselben Szenariodaten und mit vergleichbarem Ausgangszustand vorbereiten; dafür die vorhandene Phasenvorbereitung nutzen, **keine allgemeine Replay- oder Snapshot-Technik** entwickeln. Zugzustand und tatsächliche Last im Bericht festhalten. Ein bereits zerstörter Zug muss für diesen Vergleich nicht neu erzeugt werden. Unterschiede der Messwerte nicht ohne Lastprüfung allein der Beleuchtung zuschreiben.

## 5. Verbindlicher Inhaltsumfang

Die folgenden **18 Gegenstände** bilden die explizit gepflegte Auswahl für Version 1. Nuke und BFG werden im Felszerstörungsabschnitt wirksam eingesetzt; ein zusätzlicher Test im Utility-Parcours ist nicht erforderlich. Keine automatische Aufnahme neuer Inhalte; keine zusätzliche Pflicht zur Abdeckung aller Waffen. Hitscan, Projektil und Melee sowie Sonderfälle wie Folgeexplosionen müssen über die tatsächliche Laufzeitmechanik erreicht werden.

| Gegenstand | Festgelegter Zustand |
|---|---|
| Glock | Basis |
| P90 | Voll ausgebaut |
| Plasma | Voll ausgebaut |
| ASMD Primary | Basis, ausdrücklich Primary |
| Bite | Basis |
| Mini-Raketenwerfer | Voll ausgebaut |
| Raketenwerfer | Basis |
| Tesla Kuppel | Basis |
| Flammenwerfer | Basis |
| Shotgun | Voll ausgebaut |
| HE Granate | Basis |
| Molotov | Voll ausgebaut |
| Smoke | Voll ausgebaut |
| Wall | Basis |
| Raketen-Turm | Basis |
| Armageddon | Basis |
| Nuke | Festes Zerstörungs-Preset; Ausbaustufe bei Umsetzung explizit festlegen; Einsatz im Felszerstörungstest. |
| BFG | Festes Zerstörungs-Preset; Ausbaustufe bei Umsetzung explizit festlegen; Einsatz im Felszerstörungstest. |

Für Nuke und BFG ist bislang **keine Ausbaustufe vorgegeben**. Einen festen, legalen Zustand wählen, der die beschriebenen Zerstörungsmuster erreicht, und wie die übrigen Test-Builds versionieren. Keine zusätzliche Upgrade-Matrix verlangen.

**Build-Vertrag:** „Basis“ bedeutet ohne optionale Gegenstands-Upgrades, mit den technisch nötigen Freischaltungen. „Voll ausgebaut“ wird einmal pro Gegenstand als expliziter, legaler Upgrade-Snapshot festgelegt, einschließlich relevanter Boss-/Folgestufen. Bei alternativen Ästen eine feste zulässige Auswahl definieren, keine unmögliche Kombination. Keine automatische Aktivierung aller künftig hinzugefügten Upgrades. Allgemeine Upgrades, Items und Klassenboni neutral halten oder erforderliche Ausnahmen explizit fixieren. Produktive Konfiguration und Loadout-Auflösung verwenden, keine kopierten Schadens-/Cooldown-Formeln [Q6].

Beim Umsetzen interne IDs und tatsächliche Aktionstypen gegen die Registry prüfen. Erfolgreiche Folgeexplosionen, betroffene Ziele und andere ausgewählte Sondermechaniken beobachten; ein bloß angeforderter Angriff genügt nicht. Zielmengen, Ziel-HP, Baupositionen, Zerstörungsbereiche, Mindestrestmengen und Upgrade-Snapshots werden als kleine Szenariodaten festgelegt und im Report identifizierbar gemacht.

**Erlaubte Hilfen:** Schutz des Testspielers vor Tod, kontrollierte Ressourcenversorgung, Szenario-Loadouts und Gegnerersatz. Nicht pauschal Cooldowns oder produktive Angriffspfade umgehen. Haltbare Ziele für Dauerlast, sterbliche Gegner für Treffer, Kills, Drops und Todeseffekte. Konstrukte tatsächlich über die Bauaktion setzen und anschließend unter Angriff betreiben. Testwelt und persönliche persistente Basis getrennt halten.

## 6. Kleine, eigenständig ausführbare Testfälle

Der Standardparcours setzt benannte Fälle zusammen. Jeder wichtige Fall besitzt eine stabile Kennung, seine nötige Vorbereitung, eine definierte Aktionsfolge, Messfenster, wenige Lastprüfungen und einen Abschluss. Kleine TypeScript-Module und Szenariodaten mit gemeinsamen Hilfen genügen; keine universelle Testsprache oder Snapshot-/Replay-Technik.

**Ein Einzeltest darf nicht unbemerkt vom vorherigen Standardlauf abhängen.** Beispielsweise stellt der BFG-Test selbst einen ausreichend dichten, unbeschädigten Zielbereich und hohe globale Felslast bereit. Ein Neuaufbau der Karte oder eine explizite Vorbereitung ist dafür zulässig. Natürlich zusammenhängende Folgen wie Felsfeld → Zerstörung → freigeräumter Bereich können Vorbereitung und Teilabschnitte teilen. Vorbereitung bleibt im Trace sichtbar, aber getrennt von den bewerteten Aktionen.

Lastmengen, Dauer, Gegner und Test-Builds liegen in kleinen Szenariodaten. Aktionen nach dem vorgesehenen Zeit-/Eingabemodell auslösen, nicht „ein Schuss pro gerendertem Frame“. Tatsächliche Dauer und erreichte Last mitführen; langsamere Läufe nicht durch weniger Arbeit kaschieren.

**Erweiterbarkeit:** Ein neuer kritischer Fall soll überwiegend aus neuen Szenariodaten und Aktionen bestehen und vorhandenen Runner, Messung und Ausgabe verwenden. Ausgewählte Lastparameter dürfen später gezielt variiert werden, etwa der entfernte Felsbestand bei gleichbleibendem lokalem Kampf. Dafür zunächst nur die Datenstruktur offenhalten; keine fertige Parametermatrix oder automatische Kombinationssuche bauen. Ein solcher Lastvergleich ist keine reine Darstellungs-Ablation.

## 7. Messprofil: hohe Qualität, Ziel 120 FPS

Hohe Grafikeinstellungen explizit setzen, nicht aus dem persönlichen Profil übernehmen. **120 FPS entsprechen einem Budget von 1000/120 ≈ 8,33 ms; sie sind ein Bewertungsziel, kein zusätzliches FPS-Limit.** Geringe Last und Messwerte oberhalb von 120 FPS werden genauso untersucht. Physik- und andere Spieltakte bleiben unverändert.

**Noch nicht vom Nutzer festgelegter Default-Vorschlag:** Viewport 1920 × 1080 CSS-Pixel, DPR 1. Vor den ersten Referenzwerten verbindlich konfigurieren; tatsächliche Canvas-/Renderauflösung gesondert protokollieren. Keine automatische Qualitätsreduktion oder Anpassung der Last, um 120 FPS zu halten.

Je Phase FPS, Frame-Anzahl, Median/p95/p99, Maximum, Anzahl und Anteil der Frames über 8,33 ms sowie gröbere Hänger erfassen. CPU-Arbeitszeiten, Render-Submission und verfügbare GPU-Zeiten ergänzen die Grundlastanalyse; sie sind keine austauschbaren Größen und dürfen nicht einfach addiert werden. Browser-Animationsaufrufe orientieren sich normalerweise an der Bildschirmrate [Q2]. Ein Anzeige-/VSync-Limit daher nicht mit einem CPU-/GPU-Engpass verwechseln; vorhandene Limits und Messbedingungen festhalten.

**Erstaufruf als einziger automatischer Standard:** frische isolierte Browserumgebung ohne wiederverwendete Spielcache-Daten; Einstellungen gezielt initialisieren, aber die Spielseite nicht vorab zum Aufwärmen laden. Kein Warmstart-Vergleich in Version 1. „Kalt“ bezieht sich auf den Browserzustand, nicht auf garantiert geleerte Betriebssystem- oder Treibercaches. Normales Nachladen und erste Effektverwendung nicht durch verstecktes Vorwärmen aus der Messung entfernen.

Audio zu einem festen Zeitpunkt über normale Browserinteraktion entsperren und Zustand prüfen. Fenster sichtbar lassen; Pause, Größenänderung oder Hintergrundwechsel als ungültige Bedingung erkennen. Im Hintergrund können Animationsaufrufe pausieren [Q2].

## 8. Ablation: optionaler Schalter für Spezialtests

**Der erste Implementierungsschritt und der Standardlauf benötigen keine Ablation.** Kein automatischer Kategorienzyklus, keine Normal-/Ablationsfolge, kein automatisch angeforderter Gegenlauf und keine eigene Ablationsvergleichslogik. Auch das unveränderte Verhalten vorhandener manueller Diagnosewerkzeuge muss dafür nicht neu gestaltet werden.

Nach einer konkreten Auffälligkeit kann der Nutzer oder ein von ihm gestarteter Auftrag **eine vorhandene Kategorie für einen einzelnen Spezialtest einschalten**. Die Einstellung wird vor dem Messfenster aktiviert und bleibt darin konstant. Beispiel: einen Projektiltest separat mit unterdrückter Projektil-Darstellung starten. Einen normalen Vergleichslauf startet man bei Bedarf selbst; der Runner erzeugt ihn nicht zusätzlich. Die Testaktionen können trotzdem automatisch ablaufen.

Bestehende Kategorien und Schalter wiederverwenden, etwa Partikel, GPU-Partikel, Beleuchtung, Schatten, Felsdarstellung oder Post-FX [Q3]. Falls ein Kategorienzyklus bislang der einzige Zugang ist, höchstens eine schmale explizite Auswahl ergänzen. Erfordert ein Bereich größere Umbauten, wird diese Anbindung vertagt; sie blockiert das Grund-Lab nicht. Keine neuen feingranularen Schalter für Version 1 voraussetzen und keine große T-Konfigurationsoberfläche bauen.

**Minimaler Vertrag:**
- Standardmäßig aus; keine Ablations-Scans oder Schaltarbeit im normalen Referenzlauf.
- Kategorie, Aktivierungsfenster und tatsächlich unterdrückte Arbeit im Manifest und Bericht ausweisen; ein solcher Lauf ist ein **Spezialtest**, keine neue normale Baseline.
- Fehlender Hook oder nicht anwendbare Kategorie ergibt „nicht anwendbar“, nicht „dieser Bereich kostet nichts“. Nach Ende/Abbruch den Schalter zurücknehmen.

Eine reine Felsdarstellungs-Ablation darf keine Felsen aus Kollisionen oder Projektilprüfungen entfernen. Bestehende Schalter können auch weitere Effektarbeit unterdrücken oder heuristische Zuordnungen verwenden; Umfang bei Nutzung benennen [Q3]. Kein Beweis einer Ursache allein aus unveränderten FPS oder einem einzelnen Unterschied.

Beim bewussten Vergleich zweier gespeicherter Läufe gleiche Szene, Kamera, Tageszeit, Fels-/Zugzustände, Last, Instrumentierung und Erstverwendungsbedingungen wählen. Nur im zweiten Lauf bereits aufgewärmte Effekte wären ein Störfaktor. Der allgemeine Dateivergleich kann Messwerte gegenüberstellen, **wählt aber weder Ablationen aus noch bestätigt er automatisch eine Ursache**.

## 9. Klare technische Trennung

| Baustein | Verantwortung |
|---|---|
| Externer Runner | Browser, echte Chrome-Aufzeichnung, Startparameter, einfache Timeouts, Dateien und Abschlussstatus. Kein KI-Dienst. |
| Eigenes Lab-Modul | Karte, Szenariodaten, Phasenfolge, Test-Builds und Aktionssteuerung; optionaler Diagnose-Schalter nur im ausdrücklich gewählten Spezialtest. |
| Schmale Spielanbindung | Bereitschaftssignale, kontrollierte Aktionen und bestehende Diagnostik zugänglich machen. Keine Szenariologik in Waffen, Gegnern oder UI. |

Szenarien verwenden echte Runtime-Systeme. Kein zweites Spiel, kein komplettes Navigation-Lab-Bootstrap als Ersatz des normalen Starts. Zeitkritische Aktionen im Spiel ausführen; keine externe Browser-Kommunikation pro Frame. Lange Auswertungen und Komprimierung erst nach der Messung.

Lab-Zugang ausdrücklich aktivieren; umfangreiche Lab-Module nach Bedarf laden. Für den öffentlichen Build müssen neue Lab-Module, Referenzkarte und Test-Builds ausgeschlossen sein; bloßes Verstecken des Buttons genügt nicht. Build-Schalter können statisch entfernbare Pfade ermöglichen [Q4]; Ergebnis im Build prüfen. Normale Start-/Renderlogik und Optimierungseinstellungen beibehalten. Nur minimale Boot-Marker früh einbinden; Lab-Laden und Vorbereitung separat kennzeichnen, damit sie nicht als reine Spielstartkosten erscheinen.

Im normalen Betrieb keine neuen Lab-Timer, Scans oder per-Frame-Szenarioprüfungen. Innerhalb eines Tests die zusätzlichen Kosten klein halten und bekannte Instrumentierung benennen. Kein weiterer großer Architekturumbau ist Voraussetzung.

**Spätere Netzwerktests:** Runner, Szenario und Aufzeichnung getrennt halten; eine Laufkennung sowie Teilnehmer-ID/Rolle mitführen. Später können mehrere echte Teilnehmer und deren Aufzeichnungen ergänzt werden. In Version 1 keine zusätzlichen Browserteilnehmer, Netzwerkemulation oder allgemeine Netzwerk-Orchestrierung bauen.

## 10. Aufzeichnung, Befunde und einfacher Ergebnisvergleich

Chrome zeichnet vom Seitenaufruf bis zum Ende durchgehend auf. Vorhandenen Fragdachse-Profiler ab Verfügbarkeit automatisch aktivieren; frühe Startschritte durch wenige unabhängige Marker ergänzen. Gemeinsame Laufkennung, Start-/End- und Phasenmarker verbinden beide Zeitachsen. Frühe fehlende Spielmesswerte nicht nachträglich erfinden.

Ein festes Aufnahmeprofil mit benötigten JS-Stacks, Worker-Ereignissen und Zeitmarkern verwenden; keine Screenshots, Videos oder aufwendige Paint-Diagnostik. Zusätzliche Trace-Instrumentierung verursacht Eigenaufwand [Q5]. Bei der Abnahme deshalb prüfen, dass der volle Lauf aufzeichnbar und auswertbar bleibt und keine benötigten Daten stillschweigend fehlen. Kein Wiederherstellungssystem dafür bauen.

Phasenkennzahlen aus einzelnen Frame-Daten oder geeigneten Histogrammen berechnen, nicht aus grob aggregierten Begleitintervallen. Nicht vorhandene GPU-Zeiten als nicht verfügbar ausgeben. Start, Lobby, Lab-Vorbereitung, Aufbau, Waffen-Unterphasen, Stress und Rückkehr getrennt beurteilen; keine alleinige Gesamt-FPS-Zahl und keine Behauptung automatischer Ursachenbestimmung. Nuke-Großereignis, BFG-Zerstörungsfolge, verbleibende Felslast, Zugfahrt/gegebenenfalls Zugzerstörung sowie Tag, Tageszeitwechsel und Nacht erhalten eigene benannte Zeitfenster oder Ereignismarker.

Der Bericht stellt Tag und Nacht mit jeweiliger tatsächlicher Last gegenüber. Für Nuke und BFG zusätzlich zerstörte Felsmenge, zeitliche Verteilung und Restbestand zusammen mit den Frame-/CPU-/GPU-Messungen ausweisen. Vorhandene Zähler und kompakte Intervalle nutzen; keine unbeschränkte Protokollierung jedes Felsens. Die Anzahl aktiver Projektile und global verbleibender Felsen soll an den relevanten Abschnitten gemeinsam erkennbar sein.

```text
build/performance-results/<run-id>/
  manifest.json          # Build/Quellidentität, Szenarioversion, Builds, Umgebung, Status
  chrome-trace.json.gz   # originale Chrome-Aufzeichnung, verlustfrei komprimiert
  fragdachse-trace.json  # Spielmessungen und semantischer Kontext
  summary.json          # Phasen/Fälle, Last, Zerstörung, Tag/Nacht, Diagnosezustand
  summary.md            # wenige Befunde, Zeitfenster und gezielt wiederholbare Fälle
```

Passende Source-Maps/Build-Artefakte eindeutig zuordnen und bereits am Grund-Lab prüfen, dass auffällige Aufrufstapel bis zum richtigen Quellstand untersucht werden können. Originaltraces für Detailanalyse behalten. Keine aufwendige automatische Stack-Voranalyse, eigene Profiler-Oberfläche, Ergebnisdatenbank oder historische Baseline-Verwaltung. Inhaltsänderungen und neue Upgrade-Builds bewusst pflegen und versionieren.

### Bericht: Beobachtung und nächste Untersuchung

`summary.md` beginnt mit wenigen konkreten Auffälligkeiten, getrennt nach **hoher Grundlast, wiederkehrenden Spitzen und einzelnen starken Hängern**. Je Befund genügen Fallkennung, Zeitfenster, wesentliche Messwerte, tatsächlich erreichte Last und die Konfiguration zum gezielten Wiederholen. Extremabschnitte kennzeichnen, damit ein einmaliges Nuke-Ereignis häufigere Normalprobleme nicht verdeckt. Diese Aufbereitung erfolgt regelbasiert ohne KI und behauptet keine Ursache.

Nuke-/BFG-Ereignisse anhand ihrer eigenen Spitzen und nachlaufenden Arbeit beurteilen, nicht nur anhand des p99 einer langen Gesamtphase. Eine Referenzkarte zeigt Belastbarkeit unter den definierten Bedingungen; wie häufig ein Befund im normalen Spiel relevant ist, bleibt gesondert einzuordnen.

### Zwei gespeicherte Ergebnisse vergleichen

Ab Implementierungsschritt 2 einen **einfachen Offline-Vergleich zweier Ergebnisordner** vorsehen. Er startet keine Tests, wählt keine Referenz automatisch und benötigt keine Datenbank. Gleiche Fälle zuordnen, absolute und relative Unterschiede von Frame-/CPU-/verfügbaren GPU-Werten sowie tatsächlicher Last ausweisen. Konfiguration, Szenarioversion, Browser/Hardware, Auflösung und Aufnahmeprofil auf erkennbare Abweichungen prüfen. Unterschiedliche Quellstände sind beim Optimierungsvergleich ausdrücklich vorgesehen.

Nicht ausreichend vergleichbare Bedingungen kennzeichnen, nicht daraus automatisch „besser/schlechter“ ableiten. Gewollte Unterschiede eines Spezialtests, etwa eine eingeschaltete Ablation, sichtbar lassen und nicht mit einem normalen Code-Regressionsvergleich vermischen. Kein statistischer Signifikanztest und keine automatische Erfolgsentscheidung in Version 1; bei knappen Ergebnissen weitere Läufe bewusst starten.

## 11. Einfacher Fehlerumfang und Abnahme

Bei Startfehler, fehlender Phase, nicht ausgeführter Mechanik, technischem Timeout oder Speicherfehler: verständliche Meldung, Fehlerstatus und Aufräumen der gestarteten Ressourcen. **Keine Pflicht zu Teilreports, Rettung unvollständiger Traces, Wiederaufnahme oder automatischen Wiederholungen.** Erfolg erst nach erfolgreicher Ablage; unfertige Dateien gelten nicht als erfolgreicher Lauf. Die Diagnoseeinstellungen nach Ende oder Abbruch zurücknehmen.

Wenige Prüfungen genügen: erfolgreiche Aktionen, passende Ziel-/Projektilmengen, tatsächliche Folgeeffekte, Zerstörungen und gesetzte Konstrukte. Ein verlangsamter, vollständig ausgeführter Fall ist eine gültige Messung; eine ausgebliebene Mechanik nicht. Erreichte Lastabweichungen sichtbar machen. Phasen weder heimlich verkürzen noch Last reduzieren, um das Zehn-Minuten-Ziel oder 120 FPS zu erreichen. Nur der separate technische Timeout begrenzt endlos blockierte Läufe.

### Erste Abnahme: nutzbares Grund-Lab

Ein Befehl zeichnet normalen Erststart, drei Sekunden bereite Lobby und **einen** funktionierenden Fall auf. Beide Traces, Zeitmarker und ein kompakter Bericht sind zuordenbar; Source-Maps funktionieren. Einzelstart, einfache Wiederholungsprüfung und Dateivergleich liefern plausible Ergebnisse. Persönlicher Fortschritt bleibt unverändert. **Diese Abnahme erfordert weder Ablation noch alle Kartenmerkmale oder alle 18 Gegenstände.** Erst danach den breiten Inhaltsausbau vorantreiben.

### Abnahme des vollständigen geplanten V1-Umfangs

- Der ungefähr zehnminütige Standardparcours sowie wichtige Einzeltests sind ohne Bedienung ausführbar. Berichte unterscheiden Grundlast, Spitzen, Stress und Vorbereitung; zwei Ergebnisstände lassen sich einfach vergleichen.
- Die 18 ausgewählten Gegenstände werden passend eingesetzt, einschließlich Hitscan/Projektil/Melee und ausgewählter Sonderfälle. Nuke und BFG erzeugen ihre unterschiedlichen Zerstörungsmuster; anschließend bleibt ausreichend globale Felslast vorhanden.
- Große Seen und der fahrende Zug werden sichtbar geprüft. Ein zerstörter Zug muss nicht wiederkehren. Gemischter Kampf um 12:00 und 00:00 Uhr sowie der Tageszeitwechsel sind getrennt und mit vergleichbaren Bedingungen auswertbar.
- Traces bleiben vollständig und praktisch auswertbar. Neue Lab-Logik beeinflusst den normalen Betrieb nicht laufend; Lab-Inhalte sind aus dem öffentlichen Build ausschließbar. Kein Netzwerklasttest erforderlich.

**Ablation ist kein blockierendes V1-Kriterium.** Eine einfach nutzbare bestehende Kategorie kann als optionaler Spezialtest freigegeben werden; dann gelten Kennzeichnung und Rücknahme. Automatisierte A/B-Läufe, Kategorienfolgen und Kausalitätsauswertung bleiben ausdrücklich außerhalb dieser Version.

## Technische Referenzen (aus der Vorfassung übernommen)

Die Anforderungen beruhen auf den abgestimmten Nutzerentscheidungen. Technische Referenzen wurden aus Revision 2 übernommen; diese Überarbeitung enthält keine erneute Prüfung der Webseiten oder des Repositorys. Die Quellen belegen vorhandene technische Ansatzpunkte, nicht eine bereits fertige Lab-Implementierung. Konkrete Upgrade-Snapshots, Lastmengen, Kartengröße und Zeiten sind noch umzusetzen und zu erproben.

- **[Q1]** Playwright Browser-API: Chrome-Tracing und Start vor Seitennavigation. https://playwright.dev/docs/api/class-browser#browser-start-tracing
- **[Q2]** MDN: `requestAnimationFrame`, Bildschirmtakt und Hintergrund-Tabs. https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- **[Q3]** Repository: `src/scenes/arena/PerformanceAblation.ts`, geprüft am 16.09.2026; Datei-Blob `4bee7f539a05c4132aa8b720b3dd7cda9271d758`. https://github.com/Dominik-Steinweg/Fragdachse/blob/main/src/scenes/arena/PerformanceAblation.ts
- **[Q4]** Vite: statisch ersetzte Build-Konstanten und Tree-Shaking. https://vite.dev/guide/env-and-mode
- **[Q5]** Chrome DevTools: Aufnahmeoptionen und zusätzlicher Performance-Aufwand. https://developer.chrome.com/docs/devtools/performance/overview
- **[Q6]** Repository: `src/loadout/LoadoutConfig.ts`, öffentliche Registry-/Auflösungsfassade; Datei-Blob `530d2433bca7aa9e3605e37ccd293ca2238be0af`. https://github.com/Dominik-Steinweg/Fragdachse/blob/main/src/loadout/LoadoutConfig.ts
