# Zeus: beschlossener Implementierungsplan

Die fachlichen Werte und die Auslösermatrix stehen im [GDD](Fragdachse_GDD_Zeus_Upgrades.md). Dessen Abschnitte 2–13 enthalten die beschlossenen Präzisierungen: voller Boss-Stun mit Angriffsabbruch, kein Inputpuffer, kein zusätzlicher Eskalationsdeckel, Laufbonus ohne Dashverstärkung, dauerhafter Ursprungsausschluss je Salve, Kugelblitz vor Dash-Aufprall und keine Savegame-Migration.

## Umsetzung in Abhängigkeitsreihenfolge

1. **Content und Einsatz:** Authored Zeus-Konfiguration, sieben neue Knoten, Modifier-Deskriptoren, Validatoren, deutsche/englische Texte und vorhandene Icon-Aliase. Die Utility-ID und der Freischaltknoten bleiben erhalten. Einsatzvalidierung, temporäre/Inspector-Instanzen und Cooldowns gehören weiterhin dem PlayerUtilityActionRuntime.
2. **Dash und Dynamo:** Stabile Dash-Identität über Burst und Erholung. Akzeptierter Start reduziert nur bereits laufende Zeus-Cooldowns; tatsächliche Bewegungsabschnitte liefern Position, Körperradius und Positionsrevision.
3. **Kugelblitz und Nervenschock:** Kurzes E löst normalen Zeus beim Loslassen aus. 0,5 Sekunden Halten aktiviert Kugelblitz automatisch mit der vorhandenen Ladeanzeige. Die drei Stufen ergeben 1,5 / 3 / 4,5 Sekunden Körperzustand unabhängig von Dash-Start und -Ende; der Dash-Reichweitenbonus entfällt. WorldZeusBinding bindet die headless ZeusRuntime an Combat, Spielerphysik und räumliche Zielabfragen. Kontinuierliche Kontakte beachten veränderliche Radien, Portalrevisionen und Zielinstanzen. Bei aktivem Kugelblitz wartet der größere Dash-Aufprallbereich auf den elektrischen Körperkontakt, damit er Donnerfront nicht durch vorzeitiges Töten oder Wegstoßen verhindert. CombatStunStatusSystem hält gemeinsame Ablaufzeiten; Spieler-, Gegner- und Bossaktionen werden unterbrochen.
4. **Donnerfront und Durchbruch:** Bestätigte direkte Treffer erzeugen genau eine Salve. Der unmittelbar tödliche Ausgang bestimmt deren Reichweite. Die vorhandene WorldProjectileRuntime besitzt Flug, Homing, Kollision und Replikation; Ursprungszielinstanzen bleiben ausgeschlossen. Bolzen dürfen betäuben, aber keine Salven rekursiv erzeugen.
5. **Blitzboden:** Räumlich indizierte Abschnitte mit eigenem Ablauf, zeitbasiertem Schaden und Zusammenfassung je Besitzer. Freundlicher Kontakt frischt einen nicht stapelnden Laufbonus auf.
6. **Replikation und Darstellung:** World-Snapshot und Bootstrap enthalten Kugelblitze mit Einsatz-Identität und Ablaufzeit, Boden und Stuns. Ausgelassene Slices behalten den Zustand, explizite leere Sammlungen beenden ihn. Kugelblitz und Blitzboden verwenden die gemeinsame GPU-VFX-Pipeline mit bestehenden Atlastexturen: blaue Leuchtschichten, zusammenhängende türkisfarbene Blitzadern und weiße Kerne. Boden und Körper liegen auf getrennten Tiefenebenen; die Körperhülle folgt der Hitbox. Reservierte Kapazität schützt die Hauptadern bei reduzierten dekorativen Effekten. Vorhandene Tesla-Bolzen zeigen die Donnerfront auf Host und Client; World-Teardown entfernt Darstellung und Audio-Deduplizierung.

## Technische Abnahme

- `npm run check`: Core-Tests, Architekturprüfungen und Produktionsbuild.
- `npm run test:integration`: World-, Combat-, Bootstrap- und Lifecycle-Verträge einschließlich Zeus.
- `npx vitest run --pool=threads tests/stress/Zeus.test.ts tests/stress/ProjectilePerformance.test.ts -t Zeus`: vollständige Salven bei mehreren Besitzern sowie 200/400 echte Runtime-Projektile mit Treffer- und Freigabeprüfung.
- `git diff --check`: Patch-Konsistenz.

Messungen sind Headless-Laufzeiten der jeweiligen Testfälle, keine Browser-Framezeiten. Spielgefühl, optische Lesbarkeit und tatsächliche Browser-Framerate bleiben gemäß Abnahmeentscheidung unbestätigt. Neue Browser-, Test- oder Grafikasset-Infrastruktur ist nicht Bestandteil des Plans.
