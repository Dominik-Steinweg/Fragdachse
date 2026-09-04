# Fragdachse – Test Refactoring: Migrationsstatus

**Architektur:** `01_Test_Architecture_Core.md` + `02_Test_Architecture_Details.md`  
**Plan:** `03_Test_Refactoring_Implementation_Plan.md`

> Temporäres, bewusst kleines Arbeitsprotokoll für Coding-KIs.  
> Nach jeder Phase nur den **aktuellen handlungsrelevanten Zustand** pflegen.  
> Abgeschlossene Detailhistorie, frühere Dateilisten und erledigte Risiken wieder entfernen.  
> Keine Commit-SHAs eintragen – die Commit-Historie liegt in Git.  
> `01`, `02` und `03` werden während der Umsetzung nicht selbständig geändert.

---

## Statuslegende

- ⬜ offen
- 🟨 aktiv
- 🟧 blockiert
- ✅ abgeschlossen

---

## 1. Aktueller Stand

- **Aktive Phase:** `Phase 1 – Baseline und handlungsrelevante Migrationskarte`
- **Zuletzt abgeschlossen:** `–`
- **Gesamtstatus:** Test-Refactoring noch nicht begonnen.
- **Letzter automatisierter Gate:** noch nicht für dieses Refactoring ausgeführt
- **Bekannte Regressionen:** keine
- **Sichtprüfung:** nicht vorgesehen

---

## 2. Phasenstatus

| Phase | Status | Kurzgegenstand |
|---|:---:|---|
| 1 | 🟨 | Baseline + handlungsrelevante Migrationskarte |
| 2 | ⬜ | Runner-/Suite-Trennung |
| 3 | ⬜ | Source-Ratchets + Architecture-Tests |
| 4 | ⬜ | Config-/Content-/Visual-Tuning-Kopplung |
| 5 | ⬜ | Redundanz + Mock-Shape + Restballast |
| 6 | ⬜ | AI-Testpolicy + Final Gate |

---

## 3. Offene Test-Migrationskarte

> Nur problematische oder noch ungeklärte Cluster aufnehmen.  
> Gute `KEEP`-Tests nicht vollständig inventarisieren.  
> Erledigte Einträge nach Abschluss des Clusters entfernen.

| Cluster / Testbereich | Problem | Zielaktion | Zielphase | Status |
|---|---|---|---:|:---:|
| Source-/Phase-/Cutover-Ratchets | Implementation Shape / Historie teilweise mit echten Verträgen vermischt | B/R/S klassifizieren, REWRITE/CONSOLIDATE/DELETE | 3 | offen |
| normale Config-/Balance-Tests | mutable authored Werte als zweite Wahrheit | relativ zur Config / Invariante / DELETE | 4 | offen |
| Visual-/VFX-Snapshots | ästhetische Tuningwerte teilweise eingefroren | semantisch prüfen / DELETE / MOVE | 4 | offen |
| Balance-Lab-/Benchmarktests | spezialisiertes Werkzeug, aktuell über Einzelfile-Excludes getrennt | `balance-lab` Suite | 2 | offen |
| Large-Arena-/Multi-Seed-Tests | wertvoll, aber zu schwer für Daily Gate | `stress` Suite | 2 | offen |
| teure Asset-/Pixeltests | Jimp/Dateisystem/Pixelloops | `assets` Suite | 2 | offen |
| große World-/Campaign-Integration | Integration selbst sinnvoll, aber nicht Core | `integration` Suite | 2 | offen |
| Redundanz / Mock-Call-Shape | Wartungsballast in bereits berührten Clustern | CONSOLIDATE/REWRITE/DELETE | 5 | offen |

---

## 4. Offene Risiken / Entscheidungen

Aktuell keine zusätzlichen Entscheidungen offen.

Während der Umsetzung hier nur Punkte führen, die die **nächste Phase** beeinflussen, z. B.:

- echter Vertrag unklar;
- Test lässt sich nicht ohne Produktionsänderung sinnvoll retten;
- Runner-Zuordnung technisch problematisch;
- unerwartete Flakiness;
- möglicher Produktionsbug.

Erledigte Punkte entfernen.

---

## 5. Dokumentations-Follow-ups

Für Phase 6 vorgesehen:

- `docs/ai/testing.md` neu
- `AGENTS.md` sehr kurzer Testhinweis
- `docs/ai/index.md`
- `docs/ai/local-dev-environment.md`
- `docs/ai/weapon-balance-lab.md`
- `.ai/skills/fragdachse-phaser/SKILL.md`
- danach `npm run ai:sync`

Keine dieser Änderungen vor Phase 6 nur vorsorglich durchführen, sofern ein früherer Runner-Umbau nicht zwingend einen kleinen aktuellen Kommando-Hinweis erfordert.

---

## 6. Nächster konkreter Schritt

**Phase 1 vollständig umsetzen.**

Dabei:

1. problematische Testmuster repositoryweit suchen;
2. nur handlungsrelevante Cluster hier konkretisieren;
3. keine Vollinventur guter Tests erstellen;
4. keine Tests allein zur Charakterisierung hinzufügen, wenn kein wichtiger ungeschützter Vertrag existiert;
5. Phase-1-Gate ausführen;
6. diesen Status aktualisieren;
7. bei grünem Gate genau einen Phase-1-Commit erstellen.

---

## 7. Update-Format nach jeder Phase

Nur aktualisieren:

- aktive Phase;
- zuletzt abgeschlossen;
- Gesamtstatus;
- letzter automatisierter Gate;
- bekannte aktuelle Regressionen;
- Phasenstatus;
- offene handlungsrelevante Migrationscluster;
- offene Risiken/Entscheidungen;
- Dokumentations-Follow-ups;
- nächster konkreter Schritt.

Nicht pflegen:

- Commit-SHAs;
- chronologische Historie;
- Liste aller guten Tests;
- abgeschlossene Detailmigrationen;
- vollständige Teststatistik je Phase, sofern sie für den nächsten Schritt nicht relevant ist.
