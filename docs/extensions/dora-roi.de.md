# DORA Register of Information

Jedes EU-Finanzunternehmen muss ein **Informationsregister** über sämtliche
IKT-Drittparteienvereinbarungen führen und es jährlich über seine Aufsicht
einreichen — 15 ineinandergreifende Meldebögen, abgegeben als maschinenlesbares
xBRL-CSV-Paket nach dem EBA-Rahmenwerk. Im Trockenlauf der ESAs enthielten 93,5 %
der Einreichungen mindestens einen Datenfehler, und 86 % davon waren fehlende
Pflichtangaben.

Die Daten, die das Register braucht, liegen bereits in Ihrem EA-Repository.
**DORA Register of Information** macht Turbo EA zu Ihrem Register.

## Das Register lebt auf Ihren Karten

Diese Erweiterung führt **keine eigenen Tabellen** für Registerinhalte. Jedes
Registerobjekt ist eine Karte oder eine Beziehung:

| Registerobjekt | In Turbo EA |
|---|---|
| Rechtsträger im Anwendungsbereich | **Organisations**-Karten mit aktiviertem *In DORA register scope* |
| Zweigniederlassungen | **Organisations**-Karten mit dem Subtyp **Branch**, untergeordnet ihrer Hauptniederlassung |
| IKT-Drittdienstleister | **Provider**-Karten |
| Vertragliche Vereinbarungen | **ICT Arrangement**-Karten (ein neuer Kartentyp) |
| IKT-Dienstleistungen | **ICT Service**-Karten (ein neuer Kartentyp) |
| Kritische oder wichtige Funktionen | **Geschäftsfähigkeits**- bzw. **Geschäftsprozess**-Karten, die als Registerfunktion markiert sind |
| Unterzeichnende, nutzende und erbringende Parteien, Lieferketten | **Beziehungen** zwischen diesen Karten |

Das ist der gesamte Entwurf: Jedes Feld wird in Turbo EAs eigener Kartenansicht
bearbeitet — mit Pflichtkennzeichnung, Validierung, Hilfetexten und
Datenqualitätsbewertung —, und das Register wird bei jeder Validierung oder
jedem Export live aus den Karten zusammengesetzt.

![ICT-Service-Karten im Inventar mit ihrer DORA-Bewertung](../assets/img/en/73_ext_dora_cards.png)

!!! note "Es gibt bewusst keinen DORA-Kartenreiter"
    Die ergänzten Felder erscheinen als gewöhnliche Attributabschnitte auf einer
    Karte, und jede Registerverknüpfung ist eine normale Beziehung. An der Pflege
    des Registers ist nichts ein Sondermodus.

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | Kommerziell — eine signierte Berechtigung ist erforderlich |
| **Mindestversion von Turbo EA** | 2.94.0 |
| **Berechtigungen** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Datenzugriffs-Grants** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Backend-Neustart nötig** | ja — die Erweiterung enthält Backend-Code |
| **Wo sie erscheint** | **DORA-Register** in der Hauptnavigation · **Berichte → DORA-Register** · Abschnitte **DORA Register** und **DORA Function** auf Karten · sechs Umfragevorlagen |

## Was sie Ihrem Metamodell hinzufügt

**Zwei neue Kartentypen**

- **ICT Arrangement** — eine vertragliche Vereinbarung über die Nutzung von
  IKT-Dienstleistungen. Sie ist **hierarchisch**: übergreifende Vereinbarungen
  sind die Elternkarten, nachgelagerte oder zugehörige Vereinbarungen deren
  Kinder. Trägt Jahresaufwand und Währung.
- **ICT Service** — eine je erbrachter Dienstleistung unter einer Vereinbarung,
  mit der Dienstleistungszeile (Art, Termine, Kündigungsfristen, anwendbares
  Recht, Datenstandort, Abhängigkeitsgrad) und ihrer **Bewertung**
  (Substituierbarkeit, Exit-Plan, Reintegration, Auswirkung einer Einstellung,
  alternative Anbieter).

**Ein neuer Subtyp** — **Branch** auf Organisation.

**Neue Abschnitte auf bestehenden Kartentypen**

| Kartentyp | Abschnitt | Inhalt |
|---|---|---|
| **Organisation** | DORA Register | Im DORA-Registerumfang, LEI, Land, Art des Unternehmens, Stellung im Konzern, Zuständige Behörde, Bilanzsumme, Berichtswährung, Zweigstellencode |
| **Provider** | DORA Register | LEI, Kennungsart, EUID, Personenart, Land des Hauptsitzes, Konzerninterner Anbieter, Jahresaufwand, oberste Muttergesellschaft |
| **Geschäftsfähigkeit** / **Geschäftsprozess** | DORA Function | DORA-Registerfunktion, Funktionskennung, Zulassungspflichtige Tätigkeit, Kritikalitätsbewertung, Begründung der Kritikalität, RTO, RPO, Auswirkung einer Einstellung |

Jeder Abschnitt trägt zusätzlich eine schreibgeschützte **DORA-Bewertung (%)** —
einen Vollständigkeitsbalken, der zeigt, wie viele Registerdaten diese Karte noch
schuldet.

**Neun Beziehungstypen**, von denen zwei Attribute tragen, die Sie je Beziehung
setzen:

- **Organisation → ICT Arrangement** (*ist Partei von*) trägt das Attribut
  **DORA-Rollen**: **Unterzeichnendes Unternehmen**, **Nutzung der
  IKT-Dienstleistungen**, **Erbringendes Unternehmen (konzernintern)**.
- **ICT Service → Provider** (*wird erbracht von*) trägt einen
  **Lieferketten-Rang**: **Rang 1** ist der direkte Anbieter, tiefere Ränge sind
  Unterauftragnehmer.

Die Erweiterung ergänzt außerdem eine **DORA**-Regulierung im
[Compliance-Scanner](../guide/compliance.md) des Kerns.

## Erste Schritte

Der Arbeitsbereich öffnet mit einer **Übersicht**, in der eine Checkliste
**Getting started** diese sieben Schritte verfolgt und den Fortschritt anzeigt.

![Die Übersicht des DORA-Registers](../assets/img/en/72_ext_dora_dashboard.png)

1. **Wählen Sie das berichtende Unternehmen in den Einstellungen** — das
   Unternehmen, dessen Register dies ist.
2. **Markieren Sie Ihre Rechtsträger.** Füllen Sie auf jeder
   Organisations-Karte den Abschnitt **DORA Register** aus: Schalten Sie *In DORA
   register scope* ein und geben Sie LEI, Land, Art des Unternehmens und Stellung
   im Konzern an. Zweigniederlassungen sind Organisations-Karten mit dem Subtyp
   **Branch**, untergeordnet ihrer Hauptniederlassung.
3. **Legen Sie je vertraglicher Vereinbarung eine ICT-Arrangement-Karte an.**
   Machen Sie Folgeverträge zu *Kindern* des Hauptvertrags — daraus werden Art
   der Vereinbarung und übergreifender Verweis abgeleitet.
4. **Verknüpfen Sie jede Vereinbarung** mit ihrer Provider-Karte und mit den
   Unternehmen, die unterzeichnen, nutzen oder erbringen, und setzen Sie dabei
   jeweils das Attribut **DORA-Rollen**.
5. **Legen Sie je Dienstleistung eine ICT-Service-Karte an** und verknüpfen Sie
   sie mit ihrem Vertrag, den nutzenden Unternehmen, den unterstützten Funktionen
   und ihren **rangierten** Anbietern.
6. **Markieren Sie die Funktionen.** Schalten Sie *DORA register function* auf
   den Geschäftsfähigkeits- oder Geschäftsprozess-Karten ein, die kritische oder
   wichtige Funktionen sind, und füllen Sie deren Abschnitt **DORA Function** aus
   — oder übernehmen Sie Vorschläge aus [Vorschläge](#vorschlage).
7. **Validieren Sie das Register und beheben Sie die Befunde.**

!!! tip "Erheben Sie die Daten bei denen, die sie besitzen"
    Sechs Umfragevorlagen unter **Admin → Umfragen → Neu aus Vorlage** holen die
    Pflichtangaben bei den Kartenverantwortlichen ein: **DORA entity data**,
    **DORA provider data**, **DORA arrangement data**, **DORA ICT service data**
    sowie **DORA function data** für Fähigkeiten und für Prozesse. Jede öffnet
    sich als Entwurf.

### Was Sie nie eintippen müssen

Das Register leitet Folgendes ab, statt danach zu fragen: die LEI der
Muttergesellschaft (aus der Kartenhierarchie), Integrations- und Löschdaten (aus
dem Lebenszyklus der Karte), Art der Vereinbarung und übergreifenden Verweis (aus
der Vereinbarungshierarchie), die Art der Zweigniederlassung (aus dem Subtyp
Branch), den Empfänger einer unterbeauftragten Dienstleistung (aus der
Anbieterrangfolge) sowie das Datum der letzten Aktualisierung. Auch der
**Anbieterumfang** wird abgeleitet — nur Provider-Karten, auf die eine
Vereinbarung oder eine Lieferkette tatsächlich verweist, gelangen ins Register;
nicht beteiligte Lieferanten bleiben automatisch außen vor. Die
ITS-Ausfüllkonventionen (`9999-12-31` für unbefristete Daten, *not applicable*
für nicht nachgelagerte Vereinbarungen) werden für Sie angewendet.

## Der Arbeitsbereich

**DORA-Register** in der Hauptnavigation hat fünf Reiter. Dieselbe Übersicht ist
zusätzlich als speicherbarer Bericht unter **Berichte → DORA-Register**
verfügbar.

### Übersicht

Sechs Kacheln — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — über der Schaltfläche
**Validate now**. Darunter verlinkt eine Zählleiste direkt ins Inventar für jedes
Registerobjekt, und die Tabelle **Template completeness** zeigt Zeilen und
Befunde je Meldebogen.

![Die Tabelle «Template completeness»](../assets/img/en/74_ext_dora_template_completeness.png)

Ein Klick auf eine Befundzahl öffnet die Leiste **Validation findings**,
gruppiert nach Registerzeile, jeder Befund eingeordnet als **Missing**, **Invalid
value**, **Duplicate row**, **Broken reference**, **Unknown column** oder **EBA
rule** und als **Blocking** oder **Warning** gekennzeichnet. Jeder Befund hat eine
Schaltfläche **Open card**, die genau zu dem Feld führt, das zu korrigieren ist.

### Register

Sechs Ansichten — **Legal entities**, **Branches**, **Contractual
arrangements**, **ICT third-party providers**, **ICT services** und
**Functions** — je eine Tabelle der Karten hinter diesem Registerteil, mit
Suchfeld, einer Schaltfläche **New …**, die eine Karte mit passendem Typ und
gesetzten Kennzeichen anlegt, und einem Link **Open in inventory**. Ein Klick auf
eine Zeile öffnet die Karte in einem Seitenbereich.

### Vorschläge

**Find suggestions** durchläuft Ihre Beziehungen Provider → Anwendung →
Fähigkeit/Prozess und schlägt Registeraktualisierungen vor — nicht markierte
Funktionen und Kritikalitäts-Höherstufungen — jeweils mit der zugrunde liegenden
Evidenz. Nichts wird geschrieben, bevor Sie in einer Zeile **Accept** klicken;
**Dismiss** entfernt sie aus der Liste.

### Einreichungen

**New snapshot** hält das Register zu einem **Stichtag** fest. Jede Momentaufnahme
durchläuft drei Zustände:

1. **Draft** — mit **Validate** prüfen. Befunde werden mit Schweregrad,
   Meldebogen, Zeile, Spalte und Meldung aufgelistet.
2. **Validated** — **Finalize** klicken. Das wird verweigert, solange ein
   **blockierender** Befund besteht oder kein berichtendes Unternehmen mit LEI
   gesetzt ist.
3. **Final** — die Momentaufnahme ist unveränderlich, ihr Paket-Hash ist für die
   Revision festgeschrieben, und sie lässt sich weder löschen noch erneut
   validieren.

Zwei Downloads stehen jederzeit bereit:

- **xBRL-CSV package** — das offizielle DORA-Berichtspaket des EBA-Rahmenwerks
  4.0 als `.zip`, mit Berichtsmetadaten, Meldeindikatoren, Parametern und je einer
  CSV-Datei pro Meldebogen. Es ist bytegleich reproduzierbar, und ein erneuter
  Download einer finalen Momentaufnahme wird gegen ihren festgeschriebenen Hash
  geprüft.
- **Excel workbook** — eine Prüfmappe mit Deckblatt, je einem Blatt pro Meldebogen
  mit den offiziellen Spaltenbezeichnungen und -codes sowie einem
  Mitgliederblatt, um das Register vor der Einreichung intern in Umlauf zu geben.

### Einstellungen

**Filing** — der **Filing scope** (**Consolidated (.CON)** oder **Individual
(.IND)**), die **Reporting currency**, die **Taxonomy version** und die
**Reporting entity**, deren LEI und Land das Einreichungspaket bestimmen.

**Definitions (B_99.01)** — optionale Freitextdefinitionen für die von Ihrem
Register verwendeten Begriffe aus geschlossenen Listen, eingereicht als Meldebogen
B_99.01.

**Demo data** — **Load demo data** befüllt ein vollständiges Beispielregister
(Konzernunternehmen und eine Zweigniederlassung, Anbieter, übergreifende und
konzerninterne Vereinbarungen, eine dreistufige Lieferkette, kritische Funktionen,
Vorschläge und eine Entwurfsmomentaufnahme), damit Sie alles ausprobieren können,
bevor Sie echte Daten anfassen. Alle Demokarten heißen *Demo DORA — …* und sind
mit **Demo Dora** getaggt; **Remove demo data** entfernt sie wieder.

## Die 15 Meldebögen

| Meldebogen | Inhalt |
|---|---|
| B_01.01 | Unternehmen, das das Informationsregister führt |
| B_01.02 | Liste der Unternehmen im Anwendungsbereich |
| B_01.03 | Liste der Zweigniederlassungen |
| B_02.01 | Vertragliche Vereinbarungen – allgemeine Angaben |
| B_02.02 | Vertragliche Vereinbarungen – spezifische Angaben |
| B_02.03 | Liste konzerninterner vertraglicher Vereinbarungen |
| B_03.01 / B_03.02 / B_03.03 | Unterzeichnende Parteien |
| B_04.01 | Unternehmen, die die IKT-Dienstleistungen nutzen |
| B_05.01 | IKT-Drittdienstleister |
| B_05.02 | Lieferketten der IKT-Dienstleistungen |
| B_06.01 | Identifikation der Funktionen |
| B_07.01 | Bewertung der IKT-Dienstleistungen |
| B_99.01 | Definitionen |

## Validierung

Die Validierung läuft in vier Schichten: **Struktur** (Datentypen,
LEI-Prüfsummen, Datumsangaben, Zahlen sowie die Pflichtfeld-Kennzeichen als
blockierend), **Mitglieder** (Werte aus geschlossenen Listen gegen die offiziellen
Domänen), **Schlüssel** (Vollständigkeit und Eindeutigkeit der Primärschlüssel
sowie meldebogenübergreifende Verweise) und das **EBA-Regelwerk** mit den dort
veröffentlichten Schweregraden.

!!! warning "Die Abdeckung ist teilweise — und wird offen ausgewiesen"
    Turbo EA führt die Regeln aus, die sich offline auswerten lassen. Regeln, die
    die Ausdrucks-Engine der ESAs oder Live-Abfragen bei GLEIF/BRIS benötigen,
    können auf Ihrer Instanz nicht laufen. Statt sie stillschweigend zu
    überspringen, weist die Übersicht aus, wie viele EBA-Regeln ausgeführt wurden
    und wie viele nicht. Betrachten Sie eine saubere Validierung als starke
    Vorprüfung, nicht als Garantie für die Annahme durch die Aufsicht.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `ext.dora-roi.view` | Register, Übersichten und Validierungsergebnisse ansehen |
| `ext.dora-roi.manage` | Registerdaten bearbeiten und über Vorschläge entscheiden |
| `ext.dora-roi.submit` | Stichtags-Momentaufnahmen festschreiben und Einreichungspakete herunterladen |
| `ext.dora-roi.admin` | Einreichungseinstellungen konfigurieren, Demodaten laden oder entfernen |

Das Bearbeiten der Registerdaten selbst nutzt zusätzlich Ihre normalen
Bearbeitungsrechte an Karten, da jedes Registerfeld auf einer Karte liegt.

## Wenn die Lizenz abläuft oder die Erweiterung deaktiviert wird

Der Arbeitsbereich und seine Berichte verschwinden und die Kartendaten-Brücke
stoppt, **es wird jedoch nichts gelöscht**. Ihr Register lebt auf gewöhnlichen
Karten und Beziehungen, sodass jeder Wert genau dort bleibt, wo er ist — sichtbar
und im Inventar bearbeitbar. Momentaufnahmen und Einstellungen bleiben erhalten.
Eine erneuerte Lizenz stellt den Arbeitsbereich sofort wieder her.

Erscheint *The card-data bridge is unavailable*, ist die Erweiterung zwar
installiert, aber nicht lizenziert — oder das Backend wurde seit der Installation
nicht neu gestartet.

## Hinweise und Grenzen

- **Version 2.0.0 war eine tiefgreifende Änderung.** Register aus früheren
  Versionen speicherten Dienstleistungen und Funktionen in eigenen Tabellen der
  Erweiterung; diese Zeilen werden nicht migriert. Erfassen Sie sie erneut als
  ICT-Service- und Funktionskarten (oder laden Sie die Demodaten) und führen Sie
  **Find suggestions** erneut aus.
- Die Taxonomieinhalte werden aus dem veröffentlichten EBA-Rahmenwerk generiert;
  die Übernahme einer neuen Fassung ist daher eine Datenaktualisierung plus ein
  Wechsel der **Taxonomy version**.
- Die **DORA-Bewertung** auf einer Karte ist ein Triage-Signal, kein
  Compliance-Urteil. Maßgeblich für Lücken sind die Befunde der Übersicht.
- Aufsichtsspezifische Excel-Varianten werden nicht erzeugt; das xBRL-CSV-Paket
  ist das Einreichungsartefakt.
