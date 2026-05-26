"""Tests for ArchiMate Model Exchange File Format (AMEFF) export/import.

The Open Group AMEFF specification defines an XML-based interchange format
for ArchiMate models. Reference: https://www.opengroup.org/open-group-archimate-model-exchange-file-format
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from app.plugins.archimate.ameff import (
    AMEFF_NS,
    export_model_to_ameff,
    import_model_from_ameff,
    parse_ameff_xml,
    serialize_ameff_to_xml,
)

# ---------------------------------------------------------------------------
# Serialization / parsing (pure unit tests, no DB needed)
# ---------------------------------------------------------------------------

SAMPLE_AMEFF = """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Archimate.xsd"
       identifier="id-abc123"
       version="3.2">
  <name xml:lang="en">NexaTech Sample</name>
  <elements>
    <element identifier="elem-001" xsi:type="ApplicationComponent">
      <name xml:lang="en">NexaCore ERP</name>
      <documentation xml:lang="en">Core ERP system</documentation>
      <properties>
        <property propertyDefinitionRef="propdef-001">
          <value xml:lang="en">Active</value>
        </property>
      </properties>
    </element>
    <element identifier="elem-002" xsi:type="ApplicationService">
      <name xml:lang="en">Order Management</name>
    </element>
    <element identifier="elem-003" xsi:type="DataObject">
      <name xml:lang="en">Invoice</name>
    </element>
  </elements>
  <relationships>
    <relationship identifier="rel-001" xsi:type="Serving" source="elem-001" target="elem-002">
      <name xml:lang="en">Provides order management service</name>
    </relationship>
    <relationship identifier="rel-002" xsi:type="Access" source="elem-001" target="elem-003">
    </relationship>
  </relationships>
  <propertyDefinitions>
    <propertyDefinition identifier="propdef-001" type="string">
      <name xml:lang="en">Status</name>
    </propertyDefinition>
  </propertyDefinitions>
</model>
"""


class TestAmeffParsing:
    def test_parse_elements(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        assert len(model["elements"]) == 3

    def test_parse_element_types(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        types = {e["type"] for e in model["elements"]}
        assert "ApplicationComponent" in types
        assert "ApplicationService" in types
        assert "DataObject" in types

    def test_parse_element_names(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        names = {e["name"] for e in model["elements"]}
        assert "NexaCore ERP" in names
        assert "Order Management" in names

    def test_parse_element_identifiers(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        ids = {e["identifier"] for e in model["elements"]}
        assert "elem-001" in ids
        assert "elem-002" in ids
        assert "elem-003" in ids

    def test_parse_element_description(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        erp = next(e for e in model["elements"] if e["identifier"] == "elem-001")
        assert erp["description"] == "Core ERP system"

    def test_parse_relationships(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        assert len(model["relationships"]) == 2

    def test_parse_relationship_types(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        types = {r["type"] for r in model["relationships"]}
        assert "Serving" in types
        assert "Access" in types

    def test_parse_relationship_source_target(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        serving = next(r for r in model["relationships"] if r["type"] == "Serving")
        assert serving["source"] == "elem-001"
        assert serving["target"] == "elem-002"

    def test_parse_model_name(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        assert model["name"] == "NexaTech Sample"

    def test_parse_model_version(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        assert model["version"] == "3.2"


class TestAmeffSerialization:
    def test_serialize_elements(self):
        model_data = {
            "name": "Test Model",
            "version": "3.2",
            "elements": [
                {
                    "identifier": "e-001",
                    "type": "ApplicationComponent",
                    "name": "My App",
                    "description": "An app",
                },
            ],
            "relationships": [],
        }
        xml_str = serialize_ameff_to_xml(model_data)
        tree = ET.fromstring(xml_str)
        ns = {"a": AMEFF_NS}
        elements = tree.findall("a:elements/a:element", ns)
        assert len(elements) == 1
        assert elements[0].get("identifier") == "e-001"

    def test_serialize_type_as_xsi_type(self):
        model_data = {
            "name": "Test",
            "version": "3.2",
            "elements": [
                {"identifier": "e-001", "type": "BusinessActor", "name": "CEO"},
            ],
            "relationships": [],
        }
        xml_str = serialize_ameff_to_xml(model_data)
        assert 'type="BusinessActor"' in xml_str or "BusinessActor" in xml_str

    def test_serialize_relationships(self):
        model_data = {
            "name": "Test",
            "version": "3.2",
            "elements": [
                {"identifier": "e-001", "type": "ApplicationComponent", "name": "A"},
                {"identifier": "e-002", "type": "ApplicationService", "name": "B"},
            ],
            "relationships": [
                {
                    "identifier": "r-001",
                    "type": "Serving",
                    "source": "e-001",
                    "target": "e-002",
                },
            ],
        }
        xml_str = serialize_ameff_to_xml(model_data)
        assert "r-001" in xml_str
        assert "e-001" in xml_str
        assert "e-002" in xml_str

    def test_roundtrip_parse_serialize(self):
        model = parse_ameff_xml(SAMPLE_AMEFF)
        xml_out = serialize_ameff_to_xml(model)
        model2 = parse_ameff_xml(xml_out)
        assert len(model2["elements"]) == len(model["elements"])
        assert len(model2["relationships"]) == len(model["relationships"])
        names1 = {e["name"] for e in model["elements"]}
        names2 = {e["name"] for e in model2["elements"]}
        assert names1 == names2

    def test_serialize_produces_valid_xml(self):
        model_data = {
            "name": "Valid XML Test",
            "version": "3.2",
            "elements": [
                {"identifier": "e-001", "type": "Goal", "name": "Reduce costs"},
            ],
            "relationships": [],
        }
        xml_str = serialize_ameff_to_xml(model_data)
        ET.fromstring(xml_str)  # Should not raise

    def test_serialize_includes_namespace(self):
        model_data = {"name": "NS Test", "version": "3.2", "elements": [], "relationships": []}
        xml_str = serialize_ameff_to_xml(model_data)
        assert AMEFF_NS in xml_str


# ---------------------------------------------------------------------------
# DB-dependent integration tests (skipped without Postgres)
# ---------------------------------------------------------------------------


class TestAmeffExport:
    async def test_export_returns_dict_with_required_keys(self, db):
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)
        model_data = await export_model_to_ameff(db, name="Test Export")
        assert "name" in model_data
        assert "version" in model_data
        assert "elements" in model_data
        assert "relationships" in model_data

    async def test_export_version_is_3_2(self, db):
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)
        model_data = await export_model_to_ameff(db, name="Test")
        assert model_data["version"] == "3.2"


class TestAmeffImport:
    async def test_import_creates_cards(self, db):
        from sqlalchemy import select

        from app.models.card import Card
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)

        result = await import_model_from_ameff(db, xml_content=SAMPLE_AMEFF)
        assert result["elements_created"] == 3
        assert result["relationships_created"] == 2

        cards = await db.execute(
            select(Card).where(
                Card.attributes["ameff_identifier"].astext.in_(["elem-001", "elem-002", "elem-003"])
            )
        )
        assert len(cards.scalars().all()) == 3

    async def test_import_sets_correct_card_type(self, db):
        from sqlalchemy import select

        from app.models.card import Card
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)
        await import_model_from_ameff(db, xml_content=SAMPLE_AMEFF)

        result = await db.execute(
            select(Card).where(Card.attributes["ameff_identifier"].astext == "elem-001")
        )
        card = result.scalar_one_or_none()
        assert card is not None
        assert card.card_type_key == "arch_ApplicationComponent"

    async def test_import_is_idempotent(self, db):
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)

        r1 = await import_model_from_ameff(db, xml_content=SAMPLE_AMEFF)
        r2 = await import_model_from_ameff(db, xml_content=SAMPLE_AMEFF)
        assert r1["elements_created"] == 3
        assert r2["elements_created"] == 0  # Already exists

    async def test_import_unknown_type_is_skipped(self, db):
        from app.plugins.archimate.seed import seed_archimate_metamodel
        from app.services.seed import seed_metamodel

        await seed_metamodel(db)
        await seed_archimate_metamodel(db)

        xml_with_unknown = SAMPLE_AMEFF.replace(
            'xsi:type="ApplicationComponent"', 'xsi:type="UnknownType"'
        )
        result = await import_model_from_ameff(db, xml_content=xml_with_unknown)
        assert result["elements_skipped"] >= 1
