# EA Value Tracker

Jede EA-Funktion bekommt irgendwann dieselbe Frage vom CFO oder CIO gestellt:
*Was ist Architektur für uns eigentlich wert?* Roadmaps und Diagramme beantworten
sie nicht — Zahlen schon.

**EA Value Tracker** macht aus den [Architekturentscheidungen](../guide/delivery.md)
von Turbo EA ein prüfbares Wertregister Ihrer EA-Praxis. Wert wird dort gemeldet,
wo er entsteht — an der Entscheidung —, mit der Unterzeichnung eingefroren und
später gegen das tatsächlich Realisierte abgeglichen, im Vier-Augen-Prinzip. Ein
Dashboard fasst alles zusammen, sodass die Antwort in der Budgetrunde ein Bericht
ist statt einer Suche in Tabellenkalkulationen.

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | Kommerziell — eine signierte Berechtigung ist erforderlich |
| **Mindestversion von Turbo EA** | 2.14.0 |
| **Berechtigungen** | `ext.value-savings.record`, `ext.value-savings.approve` |
| **Datenzugriffs-Grants** | keine |
| **Backend-Neustart nötig** | ja — die Erweiterung enthält Backend-Code |
| **Wo sie erscheint** | Bereich **Wert & Einsparungen** auf Entscheidungen · **Wertrealisierung** unterhalb des Unterschriftenblocks · vier Spalten in den Entscheidungs-Tabellen · **Berichte → EA Value Tracker** |

## Der Lebenszyklus

Wert durchläuft vier Stufen, die auf jeder Entscheidung als Kette angezeigt
werden:

**Gemeldet (Entwurf)** › **Gemeldet (genehmigt)** › **Realisiert (ausstehend)** ›
**Realisiert (genehmigt)**

1. Während eine Entscheidung entworfen wird, hängen Architektinnen und
   Architekten **Einsparungsmeldungen** an.
2. **Das Unterzeichnen friert sie ein.** Die von den Unterzeichnenden gebilligten
   Zahlen werden zu genehmigten Meldungen und lassen sich nicht mehr ändern.
3. Nach der Umsetzung wird **erfasst, was tatsächlich realisiert wurde**.
4. Eine **zweite Person genehmigt** die Realisierung — wer erfasst, kann die
   eigenen Zahlen niemals selbst genehmigen.

## Wert an einer Entscheidung melden

Öffnen Sie einen Entscheidungsentwurf (**EA-Delivery → Entscheidungen**) und
scrollen Sie zu **Wert & Einsparungen**, direkt nach den Konsequenzen.

![Der Bereich «Wert & Einsparungen» auf einem Entscheidungsentwurf](../assets/img/en/66_ext_value_tracker_claims.png)

Klicken Sie **Einsparung hinzufügen** und füllen Sie den Dialog aus:

| Feld | Hinweise |
|---|---|
| **Kategorie** | **Harte Einsparungen**, **Weiche Einsparungen**, **Kostenvermeidung**, **Umsatzermöglichung** oder **Risikovermeidung** |
| **Betrag** | In Ihrer Arbeitsbereichs-Währung. Muss größer als null sein |
| **Geschäftsjahr** | Abgeleitet aus dem Geschäftsjahresbeginn in den [Allgemeinen Einstellungen](../admin/settings.md) |
| **Art** | **Einmalig** oder **Laufend** |
| **Verantwortlich** | Eine oder mehrere Personen, die für die Zahl einstehen |
| **Beschreibung** | Optionaler Freitext |

Fügen Sie so viele Meldungen hinzu, wie die Entscheidung hergibt. Neben der
Überschrift steht die laufende Summe, darunter je eine Kachel pro Kategorie.

!!! note "«Laufend» ist eine Information"
    Ein als **laufend** gekennzeichneter Eintrag bleibt im angegebenen
    Geschäftsjahr — er wird nie automatisch auf Folgejahre hochgerechnet. Die
    Unterscheidung existiert, damit Lesende eine wiederkehrende jährliche
    Einsparung von einer einmaligen unterscheiden können und das Dashboard die
    jährliche Laufrate gesondert ausweisen kann.

Das Bearbeiten von Meldungen erfordert die übliche Berechtigung `adr.manage`.

## Was bei der Unterzeichnung geschieht

Sobald die Unterzeichnenden die Entscheidung signieren, friert Turbo EA die
gesamte Entscheidung ein — einschließlich der Meldungen. Der Editor verschwindet
aus dem Textkörper und:

- die Meldungen werden **Gemeldet (genehmigt)** und schreibgeschützt;
- unterhalb des Unterschriftenblocks erscheint das Register **Wertrealisierung**;
- in der Kopfzeile der Entscheidung erscheinen eine Schaltfläche
  **Wertrealisierung** sowie die Kacheln **Gemeldet** und **Realisiert**, neben
  Duplizieren und Neue Revision.

Um eine genehmigte Zahl zu ändern, legen Sie eine **neue Revision** der
Entscheidung an. Das ist Absicht: Die Zahlen, die die Unterzeichnenden gebilligt
haben, bleiben genau so, wie sie gebilligt wurden.

## Realisierten Wert erfassen und genehmigen

![Das Register «Wertrealisierung» unterhalb des Unterschriftenblocks](../assets/img/en/67_ext_value_tracker_realization.png)

**Erfassen.** Wer `ext.value-savings.record` besitzt, sieht auf jeder genehmigten
Meldung ohne Realisierung die Schaltfläche **Erfassen**. Der Dialog fragt den
tatsächlichen **Betrag**, das **Geschäftsjahr**, eine **genehmigende Person** und
optional eine Beschreibung ab.

Die genehmigende Person **muss eine andere sein als die erfassende** — ein
Vier-Augen-Prinzip, das der Server durchsetzt, nicht nur das Formular. Beim
Speichern entsteht die Zeile als **Ausstehend**, und für die genehmigende Person
wird eine Aufgabe («Realisierten Wert genehmigen: …») mit Rückverweis auf die
Entscheidung samt der üblichen Benachrichtigung erzeugt.

**Genehmigen.** Die benannte Person — die zusätzlich
`ext.value-savings.approve` benötigt — öffnet die Entscheidung und klickt in der
Zeile **Genehmigen** oder **Ablehnen**. Die Aufgabe wird abgeschlossen und die
Zahl gilt als **Realisiert (genehmigt)**. Abgelehnte Zeilen bleiben für die
Nachvollziehbarkeit erhalten.

**Korrekturen.**

- Nur wer entschieden hat, darf die Entscheidung später umkehren oder über
  **Entscheidung zurückziehen** die Zeile wieder auf ausstehend setzen (dabei
  wird die Aufgabe erneut geöffnet).
- Nur die erfassende Person darf ihre eigene Zeile löschen, und nur solange sie
  ausstehend ist. Genehmigende lehnen ab, statt zu löschen.
- Eine bereits genehmigte Zahl wird durch einen **neuen Korrektureintrag**
  berichtigt, nicht durch Ändern der Historie.

## Das Dashboard

**Berichte → EA Value Tracker** fasst alles zusammen.

![Das Dashboard des EA Value Tracker](../assets/img/en/68_ext_value_tracker_dashboard.png)

**Werkzeugleiste**

- **Gemeldet** / **Realisiert** — die Grundlage des gesamten Berichts: an
  Entscheidungen *gemeldeter* oder tatsächlich *realisierter* Wert.
- **Geschäftsjahr** — das laufende Geschäftsjahr ist vorausgewählt; heben Sie die
  Auswahl ganz auf, um alle Jahre zu sehen.
- Filter für **Kategorie** und **Person**.
- **Entwürfe einbeziehen** bzw. **Ausstehende einbeziehen**.

**Kennzahlen** — Realisiert (genehmigt), Genehmigte Meldungen, Laufrate
(jährlich), Entwurf und die Zahl der beitragenden Entscheidungen.

Der **Einsparungs-Funnel** zeigt die vier Stufen nebeneinander, sodass die Lücke
zwischen Versprochenem und Verbuchtem sofort sichtbar wird.

![Einsparungen nach Kategorie](../assets/img/en/69_ext_value_tracker_categories.png)

**Einsparungen nach Kategorie** ist ein Ring mit der Gesamtsumme in der Mitte.
**Einsparungen pro Person (gleichmäßig geteilt)** rechnet einem Eintrag mit *N*
Verantwortlichen je *Betrag ÷ N* zu, damit kein Wert doppelt gezählt wird.

![Einsparungen pro Geschäftsjahr](../assets/img/en/70_ext_value_tracker_fiscal_years.png)

**Einsparungen pro Geschäftsjahr** umfasst ein festes Fenster von vier Jahren
zurück bis zwei Jahre voraus und ignoriert bewusst den Geschäftsjahresfilter,
damit der Verlauf immer lesbar bleibt.

Zwei Tabellen vervollständigen das Bild: die **Aufschlüsselung pro Person** und
die **beitragenden Entscheidungen** — das vollständige Register mit einem Link
**Öffnen** zu jeder Entscheidung.

Der Bericht lässt sich wie jeder Kernbericht speichern, teilen, drucken und nach
XLSX und PPTX exportieren — direkt verwendbar für die Lenkungsausschuss-Unterlage.

## In den Entscheidungs-Tabellen

Der gemeinsamen Entscheidungstabelle werden vier Spalten hinzugefügt, sowohl
unter **EA-Delivery → Entscheidungen** als auch unter **GRC → Governance →
Entscheidungen**:

| Spalte | Inhalt |
|---|---|
| **Gemeldete Einsparungen** | Gesamtsumme der Meldungen dieser Entscheidung |
| **Realisiert** | Summe der genehmigten Realisierungen |
| **Einsparungsgenehmiger** | Wer die Realisierungen genehmigt hat |
| **Einsparungsphase** | Die weiteste erreichte Stufe |

Sie verhalten sich wie native Spalten — Sortierung, Schnellfilter und Design
funktionieren, und sie lassen sich über die Spaltenauswahl ausblenden oder
fixieren.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `adr.view` (Kern) | Die Bereiche, die Tabellenspalten und das Dashboard sehen |
| `adr.manage` (Kern) | Meldungen an einer nicht unterzeichneten Entscheidung anlegen, ändern und löschen |
| `ext.value-savings.record` | Eine Realisierung zu einer genehmigten Meldung erfassen |
| `ext.value-savings.approve` | Eine Realisierung genehmigen oder ablehnen — **und** die dort benannte Person sein |

Vergeben Sie die beiden Erweiterungs-Berechtigungen unter **Admin → Benutzer und
Rollen**. Beachten Sie: `ext.value-savings.approve` allein genügt nicht — der
Server prüft zusätzlich, ob Sie die in dieser Zeile benannte Person sind.

## Wenn die Lizenz abläuft oder die Erweiterung deaktiviert wird

Die Bereiche, die Spalten und das Dashboard verschwinden, **es wird jedoch nichts
gelöscht**. Meldungen liegen in der Entscheidung selbst und wandern mit einem
Workspace-Transfer mit; Realisierungen bleiben in den eigenen Tabellen der
Erweiterung. Eine erneuerte Lizenz bringt alles zurück.

## Hinweise und Grenzen

- Einsparungen sind bewusst **nicht** im Word-Export der Entscheidung enthalten —
  der Export ist das Entscheidungsdokument, nicht das Wertregister.
- Realisierungen werden gegen eine genehmigte Meldung erfasst; eine Entscheidung
  muss also unterzeichnet sein, bevor Wert dagegen realisiert werden kann.
- Die Erweiterung enthält Backend-Code; Installation und Update erfordern daher
  einmalig einen Backend-Neustart. Turbo EA blendet dann einen Hinweis ein.
