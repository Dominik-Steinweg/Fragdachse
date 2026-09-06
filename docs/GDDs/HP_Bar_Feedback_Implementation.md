# FRAGDACHSE – HP-Balken-Trefferfeedback

**Status:** Zur Implementierung.  
**Planungsbasis:** Analyse von `main` am Commit `53fc19bfdf19ff9930a1b08ac71a3af8f57e3ee1` vom 06.09.2026.  
**Auftrag:** Die folgenden Schritte vollständig umsetzen. Diese Datei genügt als Feature-Auftrag; der frühere Analysebericht wird nicht benötigt. Betroffene APIs vor Beginn gegen den aktuellen Checkout prüfen. Repository-Regeln und neuere normative Architekturverträge beachten; keine veralteten Integrationsstellen wiederherstellen.

## 1. Festgelegte Lösung und Grenzen

Die Umsetzung erfolgt **vor dem vollständigen Combat-Runtime-Refactoring**, unabhängig von dessen interner Aufteilung. Bei bereits geänderten Health-/Presentation-Grenzen an deren aktuellen Zustand anbinden, nicht auf historische Setter bestehen.

Gemeinsam genutzt werden ein **kleines, Phaser-unabhängiges Feedbackmodell** und ein konkreter Renderer für vorhandene Welt-HP-Balken. Pro Anzeige existiert ein konstanter Feedbackzustand, nicht ein Ablauf pro Treffer. Der Renderer verwendet zunächst **drei wiederverwendete Phaser-Rectangles**: Hintergrund, heller Damage-Trail, tatsächliche HP-Füllung.

Keine neue Health-Authority, Damage-Berechnung, Gameplay-Reaction oder Netzwerksemantik. Keine Änderung an Armor, Kill/Death-Spawns, Favor-the-Shooter oder Snapshotfrequenz. Keine direkten Aufrufe aus einzelnen Waffen-/Projektilpfaden und keine HP-Abzüge anhand kosmetischer Hit-RPCs. `CombatDamageObservation` nicht als alleinige Datenquelle verwenden: Baseline, Heilung und Client-State müssen ebenfalls korrekt übernommen werden.

**Nicht im Scope:** HUD, lokaler Statusring, Armor-Balken, Namensanzeigen, neue Balken an bisher balkenlosen Objekten sowie ein allgemeines Status-/UI-Framework. Kein verstecktes Combat-, EnemyManager- oder World-Komplettrefactoring. Kein GPU-Backend oder Backend-Auswahlframework auf Vorrat; eine spätere Spezialisierung benötigt einen substantiellen Messvorteil unter realer Last.

## 2. Zu migrierende Anzeigen

Einheitlich sind Trefferbewegung und Heilungsbetonung. Bestehende Größen, Ankerpunkte, Fraktionsfarben, Depth-/Kamerazuordnung und unterschiedliche Sichtbarkeitspolitiken bleiben erhalten.

| Anzeige | Sichtbarkeit |
|---|---|
| Normale Gegner und bisher temporäre verbündete Enemy-Anzeigen | Nur nach beobachtetem tatsächlichem HP-Verlust; zunächst 3000 ms. Neuer Schaden verlängert das Fenster. Vollheilung entfernt den Balken. |
| Feindliche Bosse | Dauerhaft, solange lebendig und nicht bewusst unterdrückt. |
| Spieler-Weltbalken, einschließlich Deathmatch | Bestehende World-/Sichtbarkeitsregeln; keine zusätzliche Anzeige neben dem lokalen Statusring erzwingen. |
| Schadensfähige Basisgebäude | Bestehende Sichtbarkeit; ein Balken pro Gesamtbasis, nicht pro Zelle oder angebautem Turm. Dormancy und Activity-Overlay beachten. |
| Bereits vorhandene Construction-/Turret-Balken | Bestehendes „solange beschädigt“; keine automatische Drei-Sekunden-Regel. Unzerstörbare Objekte bleiben ausgenommen. |

Bewusste Darstellungssperren haben immer Vorrang. Ohne lokale Presentation entstehen weder Balken-GameObjects noch aktive Animationen; die Simulation muss ohne sie funktionieren.

## 3. HP- und Snapshot-Vertrag

Die Anbindung unterscheidet **Baseline/Reset**, **beobachtete Veränderung**, **Unterdrückung** und **endgültige Entfernung**. HP und Max-HP gemeinsam übernehmen; Schaden nicht aus einer sinkenden Prozentquote allein ableiten. Bestehende Gameplay-Setter und deren Nebenwirkungen nicht durch pauschale Early-Returns verändern.

| Eingang | Darstellung und Feedback |
|---|---|
| Erstellung, erster Snapshot **dieser Entity**, Respawn, bewusster Reset | Aktuelle HP sofort übernehmen; Trail gleich HP, keine Treffer-/Heilanimation und keine neue Damage-Deadline. Sichtbarkeit folgt trotzdem dem Profil. |
| Identische HP und Max-HP, auch in Full-/Refresh-Snapshots | Kein neues Feedback und keine Verlängerung der Sichtbarkeit. Bereits laufendes Feedback läuft normal weiter. |
| Tatsächlicher HP-Verlust bei unverändertem Max-HP | Echte Füllung sofort verkürzen; Trail retargeten; temporäre Sichtbarkeitsdeadline erneuern. |
| Heilung | Echte Füllung sofort vergrößern; alten Damage-Trail beenden. Bereits sichtbare Füllfläche kurz dezent farblich betonen; unsichtbare normale Gegner nicht einblenden und Damage-Deadline nicht verlängern. |
| Reine Max-HP-Änderung einschließlich dadurch verursachtem Clamp | Korrekte neue Füllung ohne Treffer oder Heilimpuls; Trail still neu basieren. Eine bestehende Sichtbarkeitsdeadline höchstens unverändert auslaufen lassen. |
| Gleichzeitige HP-/Max-HP-Änderung ohne eindeutige Ursache | Konservativ still neu basieren; keine erfundene Trefferwirkung. Eine bereits am Aufrufpunkt bekannte Ursache darf lokal übergeben werden. |
| Burrow/Stealth oder andere bewusste Darstellungssperre | Balken ausblenden, laufende Episode, Heilimpuls und alte Deadline verwerfen. Verdeckte HP-Änderungen nur still übernehmen. Beim Wiedererscheinen keine Historie nachspielen. |
| Endgültige Entity-/Visual-Entfernung | Bindung lösen und View freigeben. Kein zusätzlicher Balken-Todeseffekt erforderlich. |

Vorhandene Revisions-/Ordering-Prüfungen bleiben am Netzwerkeingang; keine zweite Reordering-Logik im Renderer. Snapshots bilden nicht jeden Zwischen-Treffer ab: Nettoveränderungen darstellen, keine lückenlose Schadens-/Heilhistorie rekonstruieren oder neue Events replizieren. Identische Refreshes dürfen insbesondere verletzte Gegner nicht dauerhaft sichtbar halten.

**Lethal-Guard:** Ein kurzzeitiger HP-Wert null kann vor der tatsächlichen Entfernung durch eine Rettung/Heilung aufgehoben werden. Er darf den logischen Presenter nicht irreversibel zerstören. HP null blendet aus; endgültige Freigabe folgt dem echten Lifecycle. Keine eigene Death-/Kill-Entscheidung treffen.

## 4. Trefferbewegung und Tuning

Der echte HP-Balken folgt unmittelbar dem bestätigten Wert, spätestens im nächsten Renderbild, ohne zusätzliche Animation oder Verzögerung. Nur das Ende des hellen Trails läuft nach.

Bei einem neuen Treffer reicht der Trail zunächst bis zur vorherigen HP-Füllung. Läuft bereits ein Trail, bleibt dessen aktuelles Ende erhalten; nur das HP-Ziel ändert sich. Kein Rücksprung, kein sichtbarer Neustart, kein Overshoot.

Eine kurze Haltephase beginnt **nur bei einer neuen Schadensepisode**. Weitere Treffer verlängern weder diese Haltephase noch eine Animationslaufzeit. Ein neuer Hold ist erst erlaubt, wenn der Trail aufgeholt hat **und** eine echte Schadenspause vorliegt. So lösen auch sehr kleine Treffer im Dauerfeuer nicht ständig neue Holds aus.

Nach dem Hold exponentiell nachführen, als einfacher Startansatz:

```text
trailNext = hp + (trailNow - hp) * exp(-ln(2) * activeDeltaMs / halfLifeMs)
```

`activeDeltaMs` enthält ausschließlich Zeit nach dem Hold-Ende. Vor Retargeting den alten Verlauf bis zur Beobachtungszeit auswerten; vergangene Zeit nicht rückwirkend mit dem neuen Ziel verrechnen. Bei subpixelkleinem Rest exakt auf HP einrasten. Nach Ende des Schadens muss der Trail zuverlässig vollständig aufschließen.

Heilung nutzt eine begrenzte Farbbetonung der vorhandenen Füllfläche, keine weitere Fläche oder Partikelemission. Wiederholte Regeneration darf diese Betonung begrenzt auffrischen, aber keine sichtbare Pulswarteschlange erzeugen.

Tuning zentral halten und Bedeutung kommentieren. Folgende Werte sind **ungeprüfte Startwerte**, keine Architektur- oder Testkonstanten:

| Parameter | Bedeutung / Startwert |
|---|---|
| `damageHoldMs` | Erste Lesepause je Episode: 50 ms. |
| `damageHalfLifeMs` | Halbierung des Trail-Abstands; kleiner = schneller: 70 ms. |
| `newEpisodeQuietMs` | Schadenspause vor einem erneut erlaubten Hold: 150 ms. |
| `visibleAfterDamageMs` | Sichtbarkeit temporärer Gegnerbalken: 3000 ms. |
| `settleDistancePx` | Restabstand zum exakten Einrasten: 0,25 sichtbare Pixel; konsistent in Balken-/Kameramaße umrechnen. |
| `damageTrailColor`, `damageTrailAlpha` | Helles Warmweiß, z. B. `0xfff1d6` / `0.9`; deutlich vom tatsächlichen HP-Bestand unterscheidbar. |
| `healEmphasisMs`, `healEmphasisStrength` | Kurze, dezente Aufhellung/Farbmischung: 160 ms / 0,25. |

## 5. Einordnung, Taktung und Ressourcen

### Kleine Verantwortungen

Vorgeschlagene Ablage unter `src/effects/health/`; Namen dürfen dem aktuellen Projektstil angepasst werden:

| Baustein | Verantwortung |
|---|---|
| `HealthBarFeedbackModel.ts` | Konstanter Zustand, HP-Übergänge, Zeitverlauf und Sichtbarkeit. Keine Phaser-, Combat- oder Network-Abhängigkeit. |
| `WorldHealthBarRenderer.ts` | Konkrete Dreier-Views, Wiederverwendung, aktive Anzeigen und Darstellung. Keine Gameplay-Authority. |
| `healthBarStyles.ts` | Tuning und benötigte Consumerprofile, kein universeller UI-Baukasten. |

Bestehende Entity-/Visual-Owner liefern HP, Präsentationsposition und Lifecycle. Die kleinen Anbindungen dort belassen; keine zusätzliche Adapter-/Factory-Hierarchie. Nur den HP-spezifischen Anteil der bisherigen Darstellung ersetzen. Insbesondere `EnemyEntity.syncBar()` bedient auch Glow, Boss-, Burn- und andere Effekte; diese dürfen nicht entfallen oder von HP-Sichtbarkeit abhängig werden.

### Frame und Uhr

Ein zentraler Frame-Tick über den bestehenden `ArenaCombatPresentationController` beziehungsweise dessen aktuellen Nachfolger, **nach Zustandsübernahme und relevanter Positionssynchronisation, vor dem Rendern**. Host und Client verwenden dasselbe Modell, aber ihre vorhandenen Zustandsquellen.

Eine gemeinsame lokale monotone, testbar injizierbare Darstellungszeit verwenden. Keine korrigierbare Netzwerkzeit und kein separates `Date.now()` je Balken. Mehrere Setter-/Positions-/Interpolationsaufrufe dürfen dieselbe Zeitspanne nicht doppelt integrieren. `syncBar()` und Kamerasynchronisation sind keine zusätzlichen Animationstakte.

Lange Unterbrechungen lassen abgelaufenes Feedback auslaufen oder einrasten, statt es nachträglich in Zeitlupe abzuspielen. Reines Kamera-Offscreen-Culling ist keine Baseline und keine Schadenspause: Deadlines und Verlauf dürfen dadurch nicht einfrieren.

### Lifecycle und Pool

Die logische Target-Bindung ist von einem ausgeliehenen sichtbaren View getrennt. Unsichtbare normale Gegner benötigen keine dauerhaft drei GameObjects. Pro Frame nur aktive bzw. auslaufende Balken bearbeiten; vorhandene Positionspfade nutzen, keinen zusätzlichen globalen Enemy-Array-Scan einführen. Statische Positionen und unveränderte Darstellungswerte nicht ständig neu schreiben.

Dreier-Views wiederverwenden; eine kleine konfigurierbare Vorwärmung, zunächst etwa 50 Views, darf den typischen AoE-Ersttreffer abfangen. Freie Reserve begrenzen, bei höherem aktivem Bedarf wachsen. Notwendige Balken niemals wegen eines Pool- oder Partikelbudgets verwerfen. Keine per-Hit-Timer, Tweens, Closures, Event-Objekte oder Warteschlangen; Hotpaths im eingeschwungenen Zustand ohne vermeidbare Allokationen.

Beim Ausleihen **vollständig initialisieren**: aktuelle HP-/Trail-Breite, Position, Größe, Origin, Farben, Alpha, Depth, Kamera-/Sichtbarkeit und Diagnosezuordnung. Kein voller Startbalken oder alter Trail aus einem anderen Target. Bestehende Grafikdiagnose korrekt anbinden, ohne Mehrfachregistrierung desselben physischen Objekts. Keine per-Bar-Glow-Filter, Masken oder Container für diese einfachen Flächen.

Pool-Ressourcen dürfen scene-langlebig sein; aktive Bindings und HP-Vorgeschichte nicht. Entity-Removal, Activity-Abbau und World-Wechsel lösen jeweils ihren Bestand. Keine aktiven Bindings im statischen World-Presentation-Handoff. Alte Handles nach Freigabe ungültig machen; wiederverwendete IDs/Slots dürfen keine fremden Zustände verändern. Ein reiner View-Rebuild ist keine neue Schadensmeldung und muss den gültigen aktuellen Zustand vollständig darstellen.

## 6. Umsetzungsschritte

**A – Integrationsstellen prüfen.** Repository-Regeln, `docs/ai/architecture.md`, `docs/ai/rendering.md` und die relevanten Ownership-/Presentation-Verträge der Gameplay-/gegebenenfalls neueren Combat-Dokumente lesen. Anschließend gezielt diese bestehenden Einstiegspunkte bzw. ihre Nachfolger prüfen:

| Bereich | Einstiegspunkte |
|---|---|
| Enemy, Snapshot, Removal | `src/entities/EnemyEntity.ts`, `EnemyManager.ts`; insbesondere HP-Setter, `applyRemoteSnapshot`, `syncBar`, Burrow und Lethal-Guard. |
| Player | `src/entities/PlayerEntity.ts`; regelmäßige HP-Übernahme in `src/scenes/arena/HostUpdateCoordinator.ts` und `ClientUpdateCoordinator.ts`. |
| Basen, Konstrukte | `src/entities/BaseEntity.ts`, zugehöriger Snapshot-Apply und `src/scenes/arena/RockVisualHelper.ts`. |
| Frame, Composition, Teardown | `src/scenes/arena/ArenaCombatPresentationController.ts`, `ArenaRuntime.ts`, Renderer-Composition und `src/world/WorldPresentationFrameBinding.ts`. |

Pro Consumer Baseline, Änderung, Unterdrückung und Removal identifizieren. Aktuelle Host-/Client-Frame-Reihenfolge prüfen. Keine erneute umfassende Architekturanalyse beginnen.

**B – Modell und Tests.** Abschnitt 3–4 ohne Phaser implementieren. Unterschiedliche Frameabstände, Ereigniszeitpunkte und Dauerfeuer deterministisch prüfen.

**C – Renderer und Gegner.** Pool und einmaligen Frame-Tick integrieren. Alte konkurrierende HP-Bar-Writer/Deadline-Verwaltung entfernen. Erstzustand und unveränderte Refreshes über den echten EnemyManager-/Codec-Pfad absichern; Boss, Burrow und Removal übernehmen.

**D – Weitere Weltbalken.** Player, Basen und vorhandene Construction-/Turret-Balken migrieren. Base-Start-HP, Overlay-Reset und Respawn sind Baselines; Reparatur ist Heilung; Repositionierung kein neuer Treffer. Bestehende Sichtbarkeit und Armor-/HUD-Darstellung erhalten.

**E – Verifizieren und abschließen.** Fokussierte Tests während der Umsetzung; anschließend die Abschluss-Gates unten. Nicht nach jedem Teilschritt auf Freigabe warten. Keine weiteren Plan-/Statusdokumente erzeugen; Ergebnis knapp in Abschnitt 8 fortschreiben.

## 7. Abnahme

Bestehende passende Suites erweitern. Reines Modell ohne große Phaser-Mocks testen; Integration an den tatsächlichen Consumergrenzen. Verhalten und Invarianten prüfen, keine privaten Feldnamen, festen Produktions-Tuningwerte oder realen P90-Balancingwerte festschreiben.

| Prüfgruppe | Erforderliche Nachweise |
|---|---|
| Baseline / Netzwerk | Initial volle und verletzte Entities ohne künstliches Feedback; identische Full-/Refresh-Upserts über das gesamte Sichtbarkeitsfenster hinaus verlängern nichts. Neuer echter Schaden verlängert korrekt. |
| Bewegung / Dauerfeuer | Sofortige echte Füllung; mindestens 20 schnelle, auch sehr kleine Treffer; kein Hold-Lock, Rücksprung, Overshoot oder Queuewachstum; vollständiges Aufschließen. |
| Zeit | Verschiedene Frameabstände, Hold-Grenzüberschreitung, mehrere Änderungen zwischen Frames, Retargeting ohne doppelte Zeitintegration und lange Unterbrechung. |
| HP-Ursachen | Heilung beendet Trail; kein HP-Feedback bei Armor-only-Schaden; Max-HP-/Clamp-/Reset-Änderungen ohne künstlichen Treffer. |
| Lifecycle | Burrow/Unterdrückung, Tod und Lethal-Guard-Rettung, Respawn, Pool-Reuse, wiederverwendete IDs, Activity-/World-Wechsel; kein Ghost-State und keine fremden Handle-Writes. |
| Consumer / Darstellung | Boss dauerhaft; Player-/Base-/Construction-Politiken erhalten; Overlay/Dormancy/Reparatur korrekt; erster sichtbarer Frame bereits mit korrekter Breite; keine Bars ohne lokale Presentation. Andere Enemy-Effekte bleiben intakt. |
| Last / Ressourcen | 50 gleichzeitig beschädigte Gegner, mindestens 100 sichtbare bewegte Balken, mehrere schnelle Schadensquellen; nach Vorwärmung kein per-Hit-Ressourcenwachstum. Pool, aktive Bindings und Frame-Arbeit bleiben nachvollziehbar begrenzt. |

**Automatisierter Abschluss:** `npm run typecheck`, `npm run check`, betroffene Integrations-/Stress-Tests und `git diff --check` beziehungsweise die aktuellen entsprechenden Repository-Skripte. Nur tatsächlich ausgeführte Gates als bestanden melden; fremde bestehende Fehler separat benennen.

**Gebündelte menschliche Abnahme:** Einzelschuss, P90-Dauerfeuer, AoE, Heilung/Reparatur, Boss, Burrow, Deathmatch sowie Host/Client und World-Wechsel. Browser/Dev-Server/Screenshots nur bei ausdrücklichem Auftrag, ansonsten keine eigenen Sichtprüfungen durchführen und diese Abnahme als offen ausweisen.

**Performance-Gate:** Für die Lastfälle Kaltstart und vorgewärmten Pool auf Host/Client getrennt prüfen. CPU-/Framezeitspitzen, Allokationen/GC, aktive/freie Views und zusätzliche Draw Calls auf realer Zielhardware beurteilen; 250/500 Balken nur als zusätzliche künstliche Skalierungsprobe. Automatische Struktur-/Stresstests ersetzen keine GPU-Messung. Fehlende Browser-/Hardwaremessung ehrlich als offen markieren, nicht die Implementierung deshalb unvollständig lassen. Erst bei relevantem Engpass einen gezielten Backendvergleich erwägen; keine GPU-Migration allein aufgrund der Objektzahl.

## 8. Abschlussstatus

- **Implementierung:** Vollstaendig umgesetzt: gemeinsames Feedbackmodell, gepoolte Dreier-Views, alle vorhandenen Enemy-/Player-/Base-/Construction-Weltbalken, zentraler Tick sowie Entity-/Activity-/World-Cleanup.
- **Automatisierte Gates:** Bestanden: `npm run check` (2662 Core-Tests, 32 Architecture-Tests, TypeScript und Vite-Build), `npm run test:integration` (175 Tests), `npx vitest run --pool=threads tests/stress/WorldHealthBarStress.test.ts` (2 Lasttests fuer kalten/vorgewaermten Pool auf Host und Client) und `git diff --check`. Kein separater Typecheck, da im Build enthalten.
- **Menschliche Sicht-/Performanceabnahme:** Offen. Kein Browser, Dev-Server oder Screenshot gestartet; CPU-/GC-/GPU-/Draw-Call-Messungen auf Zielhardware stehen aus.
- **Relevante Abweichungen oder verbleibende Blocker:** Keine Implementierungsblocker. Die dynamische Diagnosefamilie des Pools wird durch Verhaltenstests fuer alle Consumer statt durch literale Source-Hook-Erkennung abgesichert. Der Build meldet weiterhin drei zur Laufzeit aufzuloesende Font-Referenzen.
