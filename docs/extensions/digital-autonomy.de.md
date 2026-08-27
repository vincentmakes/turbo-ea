# Digital Autonomy Assessment

**Digital Autonomy Assessment** bringt das **Digital Autonomy Assessment
Framework (DAAF)** der Universität Utrecht auf Anwendungsebene nach Turbo EA. Die
Erweiterung ergänzt jede Anwendungskarte um den Abschnitt **Digitale Autonomie**
— 22 gewichtete Indikatoren zu Risiko-Exposition, Mitigationskapazität und
strategischer Bedeutung, jeweils mit einer Skala von 1–5 nach dem
Original-Rubrik-Text des DAAF samt Hilfetext —, berechnet automatisch einen
Autonomie-Wert von 1–10 und stellt Ihr gesamtes Portfolio im
**Autonomie-Quadranten** dar.

Sie beantwortet eine Frage, die die meisten Landschaften offenlassen: *Wie stark
wären wir betroffen, wenn ein Anbieter morgen nicht mehr verfügbar, nicht mehr
bezahlbar oder rechtlich nicht mehr nutzbar wäre — und was könnten wir dagegen
tatsächlich tun?*

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | **Kostenlos** — läuft ohne Lizenzberechtigung |
| **Mindestversion von Turbo EA** | 2.17.0 |
| **Berechtigung** | `ext.digital-autonomy.view` |
| **Datenzugriffs-Grants** | keine |
| **Backend-Neustart nötig** | nein |
| **Wo sie erscheint** | Abschnitte **Digitale Autonomie** und **Digitale-Autonomie-Bewertung** auf Anwendungskarten · **Berichte → Digitale Autonomie** · **Neu aus Vorlage** auf der Umfragen-Seite |

## Erste Schritte

1. Installieren Sie die Erweiterung über **Admin → Erweiterungen**. Es ist keine
   Lizenz einzuspielen und kein Neustart nötig — die Felder erscheinen sofort.
2. Vergeben Sie `ext.digital-autonomy.view` unter **Admin → Benutzer und Rollen**
   an die Rollen, die den Bericht sehen sollen. Administratoren haben sie bereits.
3. Entscheiden Sie sich für die **Kurz-** oder die **Vollbewertung** — siehe
   [Kurzbewertung oder Vollbewertung](#kurzbewertung-oder-vollbewertung). Die
   vollständige Fassung mit 22 Indikatoren ist ab Werk aktiv.
4. Bewerten Sie Ihre Anwendungen — Karte für Karte oder
   [per Umfrage](#bewertungen-per-umfrage-erheben).

## Die Indikatoren

Der Abschnitt **Digitale Autonomie** erscheint auf jeder Anwendungskarte,
gegliedert in acht Dimensionen (A–H). Jeder Indikator wird mit **1–5** nach einer
eigenen Rubrik bewertet.

![Der Abschnitt «Digitale Autonomie» auf einer Anwendungskarte](../assets/img/en/65_ext_digital_autonomy_indicators.png)

Klicken Sie eine Zahl an, um zu bewerten; ein erneuter Klick auf die gewählte
Zahl löscht die Bewertung wieder. Beim Überfahren einer Zahl erscheint der
Rubrik-Text dieser Stufe, und jeder Indikator bringt einen ausklappbaren
**Hilfetext** mit der DAAF-Erläuterung und den Definitionen der verwendeten
Begriffe mit (*Angemessenheitsbeschluss*, *CLOUD Act*, *FISA 702* und weitere).

Mit **Kurz** markierte Indikatoren bilden die Kurzbewertung.

| Dimension | Indikator | Gewicht | Kurz |
|---|---|---|---|
| **A · Geopolitisches und rechtliches Compliance-Risiko** | A1 · Rechtsraum des Anbieters | 3 | ✔ |
| | A2 · Sanktionen und geopolitisches Risiko | 2 | |
| | A3 · Hosting und Datenstandort | 2 | ✔ |
| **B · Anbieter- und Lieferkettenabhängigkeiten** | B1 · Anbieterkonzentration | 3 | ✔ |
| **C · Technische Resilienz** | C1 · Alternative verfügbar | 3 | ✔ |
| | C2 · Migrierbarkeit | 3 | |
| | C3 · Datenportabilität | 3 | |
| | C4 · Verschlüsselungsverwaltung | 2 | |
| | C5 · Software-Transparenz und Offenheit | 3 | |
| **D · Organisatorische Resilienz** | D1 · Internes Fachwissen und Wissenskontinuität | 3 | ✔ |
| | D2 · Vorhandener Exit-Plan | 3 | |
| | D3 · Backup-Strategie | 2 | |
| **E · Vertragliche Resilienz** | E1 · Exit-Klauseln und Übergangsregelung | 3 | ✔ |
| | E2 · Vertragliche Flexibilität | 2 | |
| **F · Organisatorische Bedeutung** | F1 · Auswirkung eines Ausfalls | 3 | ✔ |
| | F2 · Integrationsabhängigkeiten | 2 | |
| **G · Datensensitivität, Zugriffsverwaltung und Richtlinien** | G1 · Personenbezogene Daten | 3 | ✔ |
| | G2 · Forschungsdaten und Wissenssicherheit | 3 | |
| | G3 · Geistiges Eigentum | 2 | |
| **H · Akademische Auswirkung** | H1 · Akademische Freiheit | 3 | ✔ |
| | H2 · Forschungszusammenarbeit | 2 | |
| | H3 · Langzeitarchivierung | 2 | |

!!! note "Welche Richtung ist gut?"
    Die Rubriken sind nicht alle gleich ausgerichtet, und das Bedienelement färbt
    sie entsprechend ein. Bei **Risiko**-Indikatoren (A, B, F, G, H) ist **1 am
    besten** — A1 Stufe 1 lautet etwa *«EU/EWR-Rechtsraum. Keine
    extraterritorialen Ansprüche. Voller EU-Schutz.»* und Stufe 5 *«Kein
    Angemessenheitsbeschluss, keine Garantien. Direkter Zugriff durch
    ausländische Regierungen.»* Bei **Fähigkeits**-Indikatoren (C, D, E) ist
    **5 am besten**. Sie müssen sich das nicht merken: Die Schaltflächen sind
    farblich abgestuft und mit **Niedrig** und **Hoch** beschriftet.

## Die Bewertung

Der schreibgeschützte Abschnitt **Digitale-Autonomie-Bewertung** steht unter den
Indikatoren und wird bei jedem Speichern automatisch neu berechnet.

![Die berechnete Digitale-Autonomie-Bewertung auf einer Anwendungskarte](../assets/img/en/64_ext_digital_autonomy_score.png)

| Feld | Bedeutung |
|---|---|
| **Risiko-Exposition** | Gewichtetes Mittel der Dimensionen A (geopolitisch) und B (Anbieterkonzentration) |
| **Mitigationskapazität** | Gewichtetes Mittel der technischen (C), organisatorischen (D) und vertraglichen (E) Resilienz |
| **Strategische Bedeutung** | Gewichtetes Mittel aus F (organisatorische Bedeutung), G (Datensensitivität) und H (akademische Auswirkung) |
| **Autonomie-Wert** | Eine einzelne Zahl von 1–10, dargestellt als Skala |

**Höher ist besser** — 10 ist optimal, 1 ist dringend.

!!! warning "Eine unvollständige Bewertung ergibt gar keinen Wert"
    Alle Formeln sind abgesichert: Fehlt auch nur ein benötigter Indikator,
    bleibt die Bewertung leer, statt eine irreführende Zahl anzuzeigen. Eine
    Anwendung erscheint erst dann im Quadranten-Bericht, wenn ihre Bewertung
    vollständig ist.

Da die Werte wie jedes andere Feld auf der Karte gespeichert werden, stehen sie
überall zur Verfügung: im Inventar, in Filtern, in Exporten und in Ihren eigenen
Berichten.

## Kurzbewertung oder Vollbewertung

Die Erweiterung liefert **zwei Varianten derselben vier Berechnungen** — eine
liest alle 22 Indikatoren, die andere nur die neun der Kurzbewertung. Welches
Paar **aktiv** ist, bestimmt sowohl die Berechnung *als auch*, wie viele
Indikatoren die Karte anzeigt.

Umschalten unter **Admin → Metamodell → Berechnungen**:

- **Vollbewertung (Standard)** — die vier Zeilen *Digital Autonomy — … (full)*
  sind aktiv, die *(quick)*-Zeilen inaktiv. Karten zeigen alle 22 Indikatoren.
- **Kurzbewertung** — aktivieren Sie die vier Zeilen *Digital Autonomy — …
  (quick)* und deaktivieren Sie die vier *(full)*-Zeilen. Karten zeigen nur die
  neun Kurz-Indikatoren, und der Wert wird aus diesen berechnet.

!!! tip "Es gibt keinen separaten Anzeigeschalter"
    Diese eine Entscheidung bei den Berechnungen ist der gesamte Umschalter. Die
    Karte blendet die 13 nur in der Vollbewertung enthaltenen Indikatoren
    automatisch aus, sobald das Kurz-Set aktiv ist, und der Bericht folgt
    derselben Einstellung. Aktivieren Sie niemals beide Varianten gleichzeitig —
    sie schreiben in dieselben Felder.

## Bewertungen per Umfrage erheben

Statt 22 Indikatoren für jede Anwendung selbst auszufüllen, fragen Sie die
Menschen, die es wissen. Nutzen Sie auf **Admin → Umfragen** die Schaltfläche
**Neu aus Vorlage**:

- **New DAAF survey — Quick (9)** erzeugt den Entwurf *DAAF Quick Scan*.
- **New DAAF survey — Full (22)** erzeugt den Entwurf *DAAF Full Assessment*.

Beide zielen auf Anwendungskarten und öffnen sich als **Entwurf** im
Umfrage-Editor — es wird also nichts versendet, bevor Sie es geprüft haben.
Wählen Sie die Stakeholder-Rolle, die die Umfrage erhalten soll (und etwaige
Filter — eine Lebenszyklusphase, einen Subtyp), und versenden Sie sie. Die
Befragten erhalten dasselbe 1–5-Bedienelement und dieselben Hilfetexte wie auf
der Karte; beim Anwenden der Antworten werden die Werte in die Karten
zurückgeschrieben.

Sie können jederzeit eine frische Umfrage aus einer Vorlage erzeugen — eine
jährliche Neubewertung ist nur ein Klick.

## Der Autonomie-Quadrant

**Berichte → Digitale Autonomie** stellt jede vollständig bewertete Anwendung dar.

![Der Bericht «Autonomie-Quadrant»](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

Die waagrechte Achse ist **Risiko × strategische Bedeutung**, die senkrechte die
**Mitigationskapazität** (hoch oben) — daraus ergeben sich vier Quadranten:

| Quadrant | Bedeutung | Empfehlung |
|---|---|---|
| **Optimal** | Geringe Exposition, starke Mitigation | Beibehalten und regelmäßig überwachen. |
| **Beherrschbar** | Hohe Exposition, aber solider Rückfallplan | Risiken mit belastbarer Absicherung akzeptiert. |
| **Achtung** | Geringe Exposition, schwache Mitigation | Mitigation aufbauen oder das Risiko bewusst akzeptieren. |
| **Kritisch** | Hohe Exposition, schwache Mitigation | Dringender Handlungsbedarf: migrieren oder mitigieren. |

Jeder Punkt ist nummeriert und entspricht einer Zeile in der Liste neben der
Grafik, die **aufsteigend nach Wert — die dringendsten zuerst** sortiert ist. Ein
Klick auf einen Punkt oder eine Zeile öffnet die Anwendung in einem Seitenbereich,
ohne den Bericht zu verlassen.

**Filter und Achsen**

- Mit den Auswahlfeldern **Risiko-Exposition**, **Mitigationskapazität** und
  **Strategische Bedeutung** lassen sich andere numerische Felder auf die Achsen
  legen — nützlich, wenn Sie eigene Kennzahlen pflegen. Ihre Auswahl wird im
  Browser gemerkt.
- **Lebenszyklus** und **Subtyp** grenzen die Menge ein.

Der Bericht lässt sich wie gewohnt speichern, teilen, drucken und exportieren.
Eine gespeicherte Ansicht erscheint unter **Berichte → Gespeichert**.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `ext.digital-autonomy.view` | Den Bericht **Berichte → Digitale Autonomie** sehen |

Das Bewerten der Indikatoren nutzt Ihre normalen **Bearbeitungsrechte** an
Anwendungskarten — wer eine Anwendung bearbeiten darf, darf sie auch bewerten.
Der Wechsel zwischen Kurz- und Vollbewertung sowie das Anlegen von Umfragen aus
den Vorlagen erfordern die üblichen Administratorrechte für **Berechnungen** und
**Umfragen**.

## Wenn die Erweiterung deaktiviert oder entfernt wird

Beim Deaktivieren oder Deinstallieren werden die beiden Abschnitte aus dem
Kartentyp entfernt, **die auf Ihren Karten gespeicherten Werte bleiben jedoch
unangetastet**. Aktivieren Sie die Erweiterung wieder, und jede Bewertung ist
exakt wie zuvor vorhanden. Die Felder werden additiv eingefügt, sodass auch
Felder erhalten bleiben, die Ihre Administratoren selbst in diesen Abschnitten
ergänzt haben.

## Sprachen

Indikatorbezeichnungen, Fragen, Rubriken und Hilfetexte liegen auf **Englisch,
Deutsch, Französisch, Spanisch, Italienisch und Dänisch** vor. Auf
Portugiesisch, Chinesisch, Russisch und Arabisch fallen die Framework-Inhalte auf
Englisch zurück — das Ursprungs-Framework bietet diese Sprachen nicht an.

## Namensnennung und Lizenz

Diese Erweiterung reproduziert das **Digital Autonomy Assessment Framework
(DAAF)**, entwickelt an der **Universität Utrecht** von **Tim van Neerbos** (Lead
Enterprise Architect) im Rahmen des Projekts Digital Autonomy.

- Quelle: <https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- Originalwerkzeug: <https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- Lizenz: **Creative Commons Namensnennung – Nicht kommerziell – Weitergabe unter
  gleichen Bedingungen 4.0 International (CC BY-NC-SA 4.0)** —
  <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**Es wurden Änderungen vorgenommen.** Indikatoren, Gewichte, Rubriken,
Hilfetexte und die 1–10-Bewertung des Frameworks wurden so angepasst, dass sie
nativ in Turbo EA auf Ebene der Anwendungskarte laufen — mit einem eigenen
1–5-Feldtyp, den Berechnungen für Stufen und Gesamtwert, Umfragevorlagen und dem
Autonomie-Quadranten-Bericht.

Die mehrsprachigen Rubrik- und Hilfetexte stammen aus dem DAAF-Projekt (entstanden
mit Unterstützung von **Thomas Steenbergen, SIVON**; Deutsch, Französisch,
Spanisch, Italienisch und Dänisch sind gemäß Quelle nach bestem Wissen erstellt
und noch nicht muttersprachlich geprüft).

Gemäß der Bedingung **Nicht kommerziell** wird diese Erweiterung **kostenlos**
abgegeben, und gemäß **Weitergabe unter gleichen Bedingungen** bleiben die
enthaltenen angepassten DAAF-Inhalte unter CC BY-NC-SA 4.0 lizenziert.
