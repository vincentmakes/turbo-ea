import { describe, it, expect, beforeAll } from "vitest";
import { EmptyFileSystem } from "langium";
import { createArchiMateServices } from "../services.js";
import { isElement, isRelation, isModel, type ElementType, type RelationType } from "../generated/ast.js";

// All element types from the grammar — derived from bigArchiMate (borkdominik, MIT License)
const ALL_ELEMENT_TYPES: ElementType[] = [
  // Business Layer
  "BusinessActor", "BusinessRole", "BusinessCollaboration", "BusinessInterface",
  "BusinessProcess", "BusinessFunction", "BusinessInteraction", "BusinessEvent",
  "BusinessService", "BusinessObject", "Contract", "Representation", "Product",
  // Application Layer
  "ApplicationComponent", "ApplicationCollaboration", "ApplicationInterface",
  "ApplicationProcess", "ApplicationFunction", "ApplicationInteraction",
  "ApplicationEvent", "ApplicationService", "DataObject",
  // Technology Layer
  "Node", "Device", "SystemSoftware", "TechnologyCollaboration", "TechnologyInterface",
  "TechnologyProcess", "TechnologyFunction", "TechnologyInteraction",
  "TechnologyEvent", "TechnologyService", "Path", "CommunicationNetwork", "Artifact",
  // Motivation
  "Stakeholder", "Driver", "Assessment", "Goal", "Outcome",
  "Principle", "Requirement", "Constraint", "Meaning", "Value",
  // Strategy
  "Resource", "Capability", "ValueStream", "CourseOfAction",
  // Implementation & Migration
  "WorkPackage", "ImplementationEvent", "Deliverable", "Gap", "Plateau",
  // Physical
  "Equipment", "Facility", "DistributionNetwork", "Material",
  // Composite
  "Grouping", "Location", "Junction",
];

const ALL_RELATION_TYPES: RelationType[] = [
  "Association", "Composition", "Aggregation", "Realization",
  "Assignment", "Serving", "Access", "Influence",
  "Triggering", "Flow", "Specialization",
];

let services: ReturnType<typeof createArchiMateServices>;

beforeAll(() => {
  services = createArchiMateServices(EmptyFileSystem);
});

async function parse(text: string) {
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(
    text,
    { path: "test.archimate" } as any,
  );
  await services.shared.workspace.DocumentBuilder.build([document]);
  return document;
}

describe("ArchiMate Grammar — Element Types", () => {
  it("parses a minimal ApplicationComponent definition", async () => {
    const doc = await parse(`ApplicationComponent "NexaCore ERP"`);
    const model = doc.parseResult.value;
    expect(isModel(model)).toBe(true);
    expect(model.elements).toHaveLength(1);
    const el = model.elements[0];
    expect(isElement(el)).toBe(true);
    expect(el.type).toBe("ApplicationComponent");
    expect(el.name).toBe("NexaCore ERP");
  });

  it("parses element with optional description", async () => {
    const doc = await parse(`BusinessActor "Payments Team" description "Handles all payment flows"`);
    const model = doc.parseResult.value;
    expect(model.elements[0].description).toBe("Handles all payment flows");
  });

  it(`parses all ${ALL_ELEMENT_TYPES.length} element types without error`, async () => {
    const text = ALL_ELEMENT_TYPES.map((t, i) => `${t} "element${i}"`).join("\n");
    const doc = await parse(text);
    expect(doc.parseResult.lexerErrors).toHaveLength(0);
    expect(doc.parseResult.parserErrors).toHaveLength(0);
    expect(doc.parseResult.value.elements).toHaveLength(ALL_ELEMENT_TYPES.length);
  });

  it("counts exactly the expected element types in the grammar", () => {
    expect(ALL_ELEMENT_TYPES).toHaveLength(61);
  });
});

describe("ArchiMate Grammar — Relation Types", () => {
  it(`parses all ${ALL_RELATION_TYPES.length} relation types without error`, async () => {
    const elementDefs = ["ApplicationComponent", "ApplicationService"].map(
      (t, i) => `${t} "e${i}"`,
    ).join("\n");
    const relationDefs = ALL_RELATION_TYPES.map(
      (r) => `${r} from "e0" to "e1"`,
    ).join("\n");
    const doc = await parse(`${elementDefs}\n${relationDefs}`);
    expect(doc.parseResult.lexerErrors).toHaveLength(0);
    expect(doc.parseResult.parserErrors).toHaveLength(0);
    expect(doc.parseResult.value.relations).toHaveLength(ALL_RELATION_TYPES.length);
  });

  it("counts exactly the expected relation types", () => {
    expect(ALL_RELATION_TYPES).toHaveLength(11);
  });

  it("parses a Composition relation with label", async () => {
    const doc = await parse(
      `ApplicationComponent "App"\n` +
      `DataObject "DB"\n` +
      `Composition from "App" to "DB" label "stores"`,
    );
    const model = doc.parseResult.value;
    const rel = model.relations[0];
    expect(isRelation(rel)).toBe(true);
    expect(rel.type).toBe("Composition");
    expect(rel.label).toBe("stores");
  });

  it("reports a parser error for an unknown relation type", async () => {
    const doc = await parse(`ApplicationComponent "A"\nUnknownRelation from "A" to "A"`);
    // Parser should fail since 'UnknownRelation' is not a keyword
    expect(doc.parseResult.parserErrors.length).toBeGreaterThan(0);
  });
});

describe("ArchiMate Grammar — Viewpoints", () => {
  it("parses a viewpoint with element type filters", async () => {
    const doc = await parse(
      `viewpoint "Application Cooperation" filters [ApplicationComponent, ApplicationInterface, ApplicationService]`,
    );
    const model = doc.parseResult.value;
    expect(model.viewpoints).toHaveLength(1);
    expect(model.viewpoints[0].name).toBe("Application Cooperation");
    expect(model.viewpoints[0].filters).toHaveLength(3);
  });

  it("parses a viewpoint without filters", async () => {
    const doc = await parse(`viewpoint "Basic"`);
    const model = doc.parseResult.value;
    expect(model.viewpoints[0].filters).toHaveLength(0);
  });
});

describe("ArchiMate Grammar — Full Model", () => {
  it("parses a multi-element, multi-relation model", async () => {
    const text = `
      BusinessActor "IT Department"
      ApplicationComponent "NexaCore ERP"
      ApplicationService "Order Management"
      DataObject "Invoice"

      Assignment from "IT Department" to "NexaCore ERP"
      Realization from "NexaCore ERP" to "Order Management"
      Access from "NexaCore ERP" to "Invoice"
    `;
    const doc = await parse(text);
    expect(doc.parseResult.lexerErrors).toHaveLength(0);
    expect(doc.parseResult.parserErrors).toHaveLength(0);
    const model = doc.parseResult.value;
    expect(model.elements).toHaveLength(4);
    expect(model.relations).toHaveLength(3);
  });
});
