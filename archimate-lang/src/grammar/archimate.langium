// ArchiMate 3.2 Grammar for Turbo EA
// Grammar specification derived from bigArchiMate by borkdominik
// (https://github.com/borkdominik/bigArchiMate) — MIT License
// Full grammar implemented in Phase 1.1

grammar ArchiMate

entry Model:
    (elements+=Element | relations+=Relation | viewpoints+=Viewpoint)*
;

Element:
    type=ElementType name=STRING ('description' description=STRING)?
;

Relation:
    type=RelationType 'from' source=[Element:STRING] 'to' target=[Element:STRING]
    ('label' label=STRING)?
;

Viewpoint:
    'viewpoint' name=STRING
    ('filters' '[' filters+=ElementType (',' filters+=ElementType)* ']')?
;

// ── Element Types ──────────────────────────────────────────────────────────────

ElementType returns string:
    // Business Layer — Active Structure
    'BusinessActor' | 'BusinessRole' | 'BusinessCollaboration' | 'BusinessInterface' |
    // Business Layer — Behavior
    'BusinessProcess' | 'BusinessFunction' | 'BusinessInteraction' |
    'BusinessEvent' | 'BusinessService' |
    // Business Layer — Passive Structure
    'BusinessObject' | 'Contract' | 'Representation' | 'Product' |
    // Application Layer — Active Structure
    'ApplicationComponent' | 'ApplicationCollaboration' | 'ApplicationInterface' |
    // Application Layer — Behavior
    'ApplicationProcess' | 'ApplicationFunction' | 'ApplicationInteraction' |
    'ApplicationEvent' | 'ApplicationService' |
    // Application Layer — Passive Structure
    'DataObject' |
    // Technology Layer — Active Structure
    'Node' | 'Device' | 'SystemSoftware' |
    'TechnologyCollaboration' | 'TechnologyInterface' |
    // Technology Layer — Behavior
    'TechnologyProcess' | 'TechnologyFunction' | 'TechnologyInteraction' |
    'TechnologyEvent' | 'TechnologyService' |
    // Technology Layer — Infrastructure
    'Path' | 'CommunicationNetwork' | 'Artifact' |
    // Motivation
    'Stakeholder' | 'Driver' | 'Assessment' | 'Goal' | 'Outcome' |
    'Principle' | 'Requirement' | 'Constraint' | 'Meaning' | 'Value' |
    // Strategy
    'Resource' | 'Capability' | 'ValueStream' | 'CourseOfAction' |
    // Implementation & Migration
    'WorkPackage' | 'ImplementationEvent' | 'Deliverable' | 'Gap' | 'Plateau' |
    // Physical
    'Equipment' | 'Facility' | 'DistributionNetwork' | 'Material' |
    // Composite
    'Grouping' | 'Location' | 'Junction'
;

// ── Relation Types ─────────────────────────────────────────────────────────────

RelationType returns string:
    'Association' | 'Composition' | 'Aggregation' | 'Realization' |
    'Assignment' | 'Serving' | 'Access' | 'Influence' |
    'Triggering' | 'Flow' | 'Specialization'
;

// ── Terminals ──────────────────────────────────────────────────────────────────

terminal STRING: /"[^"]*"|'[^']*'/;
hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
