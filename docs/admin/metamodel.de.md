# Metamodell

Das **Metamodell** definiert die gesamte Datenstruktur Ihrer Plattform — welche Kartentypen existieren, welche Felder sie haben, wie sie zueinander in Beziehung stehen und wie Kartendetailseiten aufgebaut sind. Alles ist **datengesteuert**: Sie konfigurieren das Metamodell über die Administrator-Oberfläche, nicht durch Codeänderungen.

![Metamodell-Konfiguration](../assets/img/en/20_admin_metamodel.png)

Navigieren Sie zu **Admin > Metamodell**, um auf den Metamodell-Editor zuzugreifen. Er hat sechs Tabs: **Kartentypen**, **Beziehungstypen**, **Berechnungen**, **Tags**, **EA-Prinzipien** und **Metamodell-Graph**.

## Kartentypen

Der Kartentypen-Tab listet alle Typen im System auf. Turbo EA wird mit 14 integrierten Typen über vier Architekturebenen ausgeliefert:

| Ebene | Typen |
|-------|-------|
| **Strategie & Transformation** | Ziel, Plattform, Initiative |
| **Geschäftsarchitektur** | Organisation, Geschäftsfähigkeit, Geschäftskontext, Geschäftsprozess |
| **Anwendung & Daten** | Anwendung, Schnittstelle, Datenobjekt |
| **Technische Architektur** | IT-Komponente, Technologiekategorie, Anbieter, System |

### Einen benutzerdefinierten Typ erstellen

Klicken Sie auf **+ Neuer Typ**, um einen benutzerdefinierten Kartentyp zu erstellen. Konfigurieren Sie:

| Feld | Beschreibung |
|------|-------------|
| **Schlüssel** | Eindeutiger Bezeichner (Kleinbuchstaben, keine Leerzeichen) — kann nach der Erstellung nicht geändert werden |
| **Bezeichnung** | Anzeigename in der Benutzeroberfläche |
| **Symbol** | Google Material Symbol-Symbolname |
| **Farbe** | Markenfarbe für den Typ (verwendet in Inventar, Berichten und Diagrammen) |
| **Kategorie** | Architekturebenen-Gruppierung |
| **Hat Hierarchie** | Ob Karten dieses Typs Eltern-/Kind-Beziehungen haben können |

### Einen Typ bearbeiten

Klicken Sie auf einen beliebigen Typ, um die **Typ-Detail-Schublade** zu öffnen. Hier können Sie konfigurieren:

#### Felder

Felder definieren die benutzerdefinierten Attribute, die auf Karten dieses Typs verfügbar sind. Jedes Feld hat:

| Einstellung | Beschreibung |
|-------------|-------------|
| **Schlüssel** | Eindeutiger Feldbezeichner |
| **Bezeichnung** | Anzeigename |
| **Typ** | text, number, cost, boolean, date, url, single_select oder multiple_select |
| **Optionen** | Für Auswahlfelder: die verfügbaren Auswahlmöglichkeiten mit Bezeichnungen und optionalen Farben |
| **Pflichtfeld** | Ob das Feld für die Datenqualitätsbewertung ausgefüllt sein muss |
| **Gewichtung** | Wie stark dieses Feld zum Datenqualitätswert beiträgt (0–10) |
| **Nur lesen** | Verhindert manuelle Bearbeitung (nützlich für berechnete Felder) |

Klicken Sie auf **+ Feld hinzufügen**, um ein neues Feld zu erstellen, oder klicken Sie auf ein bestehendes Feld, um es im **Feldeditor-Dialog** zu bearbeiten.

#### Abschnitte

Felder werden in **Abschnitte** auf der Kartendetailseite organisiert. Sie können:

- Benannte Abschnitte erstellen, um verwandte Felder zu gruppieren
- Abschnitte auf **1-Spalten**- oder **2-Spalten**-Layout einstellen
- Felder in **Gruppen** innerhalb eines Abschnitts organisieren (dargestellt als einklappbare Unterüberschriften)
- Felder zwischen Abschnitten verschieben und neu anordnen

Der spezielle Abschnittsname `__description` fügt Felder zum Beschreibungsabschnitt der Kartendetailseite hinzu.

#### Subtypen (Unter-Vorlagen)

Subtypen fungieren als **Unter-Vorlagen** innerhalb eines Kartentyps. Jeder Subtyp kann steuern, welche Felder für Karten dieses Subtyps sichtbar sind, während alle Felder auf der Ebene des Kartentyps definiert bleiben.

Zum Beispiel hat der Typ Anwendung die Subtypen: Geschäftsanwendung, Microservice, AI Agent und Deployment. Ein Administrator könnte serverbezogene Felder für den SaaS-Subtyp ausblenden, da sie dort nicht relevant sind.

**Feldsichtbarkeit pro Subtyp konfigurieren:**

1. Öffnen Sie einen Kartentyp im Metamodell-Admin.
2. Klicken Sie auf einen beliebigen Subtyp-Chip, um den **Subtyp-Vorlagen**-Dialog zu öffnen.
3. Schalten Sie die Feldsichtbarkeit mit den Schaltern um — deaktivierte Felder werden für Karten dieses Subtyps ausgeblendet.
4. Ausgeblendete Felder werden von der Datenqualitätsbewertung ausgeschlossen, sodass Benutzer nicht für Felder bestraft werden, die sie nicht sehen können.

Wenn bei einer Karte kein Subtyp ausgewählt ist (oder der Typ keine Subtypen hat), sind alle Felder sichtbar. Ausgeblendete Felder behalten ihre Daten — wenn sich der Subtyp einer Karte ändert, bleiben zuvor ausgeblendete Werte erhalten.

#### Stakeholder-Rollen

Definieren Sie benutzerdefinierte Rollen für diesen Typ (z.B. «Anwendungseigner», «Technischer Eigner»). Jede Rolle hat **kartenebene Berechtigungen**, die beim Zugriff auf eine Karte mit der anwendungsweiten Rolle des Benutzers kombiniert werden. Siehe [Benutzer & Rollen](users.md) für mehr zum Berechtigungsmodell.

#### Übersetzungen

Klicken Sie auf die Schaltfläche **Übersetzen** in der Symbolleiste des Typ-Drawers, um den **Übersetzungsdialog** zu öffnen. Hier können Sie Übersetzungen für alle Metamodell-Bezeichnungen in jeder unterstützten Sprache angeben:

- **Typbezeichnung** — Der Anzeigename des Kartentyps
- **Untertypen** — Bezeichnungen für jeden Untertyp
- **Sektionen** — Abschnittsüberschriften auf der Kartendetailseite
- **Felder** — Feldbezeichnungen und Auswahloptionsbezeichnungen
- **Stakeholder-Rollen** — Rollennamen, die in der Stakeholder-Zuweisungs-UI angezeigt werden

Übersetzungen werden zusammen mit jedem Kartentyp gespeichert und beim Rendern entsprechend der vom Benutzer ausgewählten Sprache aufgelöst. Nicht übersetzte Bezeichnungen fallen auf den englischen Standard zurück.

### Einen Typ löschen

- **Integrierte Typen** werden weich gelöscht (ausgeblendet) und können wiederhergestellt werden
- **Benutzerdefinierte Typen** werden dauerhaft gelöscht

## Beziehungstypen

Beziehungstypen definieren die zulässigen Verbindungen zwischen Kartentypen. Jeder Beziehungstyp spezifiziert:

| Feld | Beschreibung |
|------|-------------|
| **Schlüssel** | Eindeutiger Bezeichner |
| **Bezeichnung** | Bezeichnung der Vorwärtsrichtung (z.B. «nutzt») |
| **Umgekehrte Bezeichnung** | Bezeichnung der Rückwärtsrichtung (z.B. «wird genutzt von») |
| **Quelltyp** | Der Kartentyp auf der «Von»-Seite |
| **Zieltyp** | Der Kartentyp auf der «Nach»-Seite |
| **Kardinalität** | n:m (viele-zu-viele) oder 1:n (eins-zu-viele) |

Klicken Sie auf **+ Neuer Beziehungstyp**, um eine Beziehung zu erstellen, oder klicken Sie auf einen bestehenden, um dessen Bezeichnungen und Attribute zu bearbeiten.

## Berechnungen

Berechnete Felder verwenden vom Administrator definierte Formeln, um Werte automatisch zu berechnen, wenn Karten gespeichert werden. Siehe [Berechnungen](calculations.md) für die vollständige Anleitung.

## Tags

Tag-Gruppen und Tags können über diesen Tab verwaltet werden. Siehe [Tags](tags.md) für die vollständige Anleitung.

## EA-Prinzipien

Der Tab **EA-Prinzipien** ermöglicht die Definition von Architekturprinzipien, die die IT-Landschaft Ihrer Organisation steuern. Diese Prinzipien dienen als strategische Leitplanken — zum Beispiel „Wiederverwenden vor Kaufen vor Bauen" oder „Wenn wir kaufen, kaufen wir SaaS".

Jedes Prinzip hat vier Felder:

| Feld | Beschreibung |
|------|-------------|
| **Titel** | Ein prägnanter Name für das Prinzip |
| **Aussage** | Was das Prinzip besagt |
| **Begründung** | Warum dieses Prinzip wichtig ist |
| **Auswirkungen** | Praktische Konsequenzen der Befolgung des Prinzips |

Prinzipien können über den Umschalter auf jeder Karte einzeln **aktiviert** oder **deaktiviert** werden.

### Wie Prinzipien die KI-Insights beeinflussen

Wenn Sie **KI-Portfolio-Insights** im [Portfolio-Bericht](../guide/reports.md#ai-portfolio-insights) generieren, werden alle aktiven Prinzipien in die Analyse einbezogen. Die KI bewertet Ihre Portfoliodaten anhand jedes Prinzips und berichtet:

- Ob das Portfolio mit dem Prinzip **übereinstimmt** oder es **verletzt**
- Konkrete Datenpunkte als Belege
- Empfohlene Korrekturmaßnahmen

Beispielsweise würde ein „SaaS kaufen"-Prinzip dazu führen, dass die KI On-Premise- oder IaaS-gehostete Anwendungen markiert und Cloud-Migrationsprioritäten vorschlägt.

## Metamodell-Graph

Der **Metamodell-Graph**-Tab zeigt ein visuelles SVG-Diagramm aller Kartentypen und ihrer Beziehungstypen. Dies ist eine schreibgeschützte Visualisierung, die Ihnen hilft, die Verbindungen in Ihrem Metamodell auf einen Blick zu verstehen.

## Karten-Layout-Editor

Für jeden Kartentyp steuert der **Layout**-Bereich in der Typ-Schublade, wie die Kartendetailseite aufgebaut ist:

- **Abschnittsreihenfolge** — Abschnitte (Beschreibung, EOL, Lebenszyklus, Hierarchie, Beziehungen und benutzerdefinierte Abschnitte) per Drag & Drop neu anordnen
- **Sichtbarkeit** — Abschnitte ausblenden, die für einen Typ nicht relevant sind
- **Standarderweiterung** — Wählen, ob jeder Abschnitt standardmäßig erweitert oder eingeklappt startet
- **Spaltenlayout** — 1 oder 2 Spalten pro benutzerdefiniertem Abschnitt festlegen
