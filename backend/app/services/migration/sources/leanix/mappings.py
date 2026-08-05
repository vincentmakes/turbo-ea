"""LeanIX → Turbo EA mapping tables.

Lifted out of the old ``leanix_migration_service`` module so the
generic staging pipeline doesn't read source-specific dicts from
module scope. The same data, the same shape — just an explicit home
that the adapter (``adapter.py``) can hand to the staging pipeline.

Adding a new source means writing a sibling ``sources/<key>/mappings.py``
with the equivalent translation tables.
"""

from __future__ import annotations

# 1:1 mapping from default LeanIX fact-sheet type names to Turbo EA
# card-type keys. Custom (tenant-defined) FS types are surfaced as
# ``metamodel_type`` staged rows by the staging pipeline.
TYPE_MAPPING: dict[str, str] = {
    "Application": "Application",
    "ITComponent": "ITComponent",
    "BusinessCapability": "BusinessCapability",
    "BusinessContext": "BusinessContext",
    "Process": "BusinessProcess",  # legacy v3 → BusinessProcess
    "BusinessProcess": "BusinessProcess",
    "DataObject": "DataObject",
    "Interface": "Interface",
    "Project": "Initiative",
    "Initiative": "Initiative",
    "Provider": "Provider",
    "TechCategory": "TechCategory",
    "Platform": "Platform",
    "Objective": "Objective",
    # User Group has no native equivalent — gets mapped to Organization
    # with subtype `team`. Admin can re-classify post-import.
    "UserGroup": "Organization",
}


# LeanIX names relations using camelCased FS pairs, e.g.
# ``relApplicationToITComponent``. Turbo EA shortens both sides (App,
# ITC, BC, DataObj, BizCtx, …). The table below covers every default
# Turbo EA relation; unknown LeanIX relation types are surfaced as
# ``metamodel_relation_type`` staged rows.
#
# The xlsx "Full Export" uses a second naming convention
# (``<lowerType><UpperType>Relation``, e.g. ``applicationITComponentRelation``).
# Both forms are listed side-by-side so each export shape routes to the
# same Turbo EA relation key without a brittle string-munging step.
RELATION_MAPPING: dict[str, str] = {
    # --- Application connections ---
    "relApplicationToBusinessCapability": "relAppToBC",
    "applicationBusinessCapabilityRelation": "relAppToBC",
    "relApplicationToBusinessContext": "relAppToBizCtx",
    "applicationBusinessContextRelation": "relAppToBizCtx",
    "relApplicationToInterface": "relAppToInterface",
    "applicationInterfaceRelation": "relAppToInterface",
    # LeanIX models app↔interface as two-sided (provider vs consumer);
    # Turbo EA has a single relation type — both flavours fold into it.
    "applicationInterfaceProviderRelation": "relAppToInterface",
    "applicationInterfaceConsumerRelation": "relAppToInterface",
    "relApplicationToDataObject": "relAppToDataObj",
    "applicationDataObjectRelation": "relAppToDataObj",
    "relApplicationToITComponent": "relAppToITC",
    "applicationITComponentRelation": "relAppToITC",
    "relApplicationSuccessor": "relAppSuccessor",
    "applicationSuccessorRelation": "relAppSuccessor",
    # --- IT-Component connections ---
    "relITComponentToTechCategory": "relITCToTechCat",
    "itComponentTechCategoryRelation": "relITCToTechCat",
    # The xlsx export calls the same edge ``itComponentTechnologyStackRelation``
    # in tenants that have renamed the Tech Category type to "Technology Stack".
    "itComponentTechnologyStackRelation": "relITCToTechCat",
    "relITComponentToPlatform": "relITCToPlatform",
    "itComponentPlatformRelation": "relITCToPlatform",
    "relITComponentSuccessor": "relITCSuccessor",
    "itComponentSuccessorRelation": "relITCSuccessor",
    # --- Interface connections ---
    "relInterfaceToDataObject": "relInterfaceToDataObj",
    "interfaceDataObjectRelation": "relInterfaceToDataObj",
    "relInterfaceToITComponent": "relInterfaceToITC",
    "interfaceITComponentRelation": "relInterfaceToITC",
    "relInterfaceSuccessor": "relInterfaceSuccessor",
    "interfaceSuccessorRelation": "relInterfaceSuccessor",
    # --- Initiative connections (LeanIX "Project" → TEA "Initiative") ---
    "relProjectToObjective": "relInitiativeToObjective",
    "projectObjectiveRelation": "relInitiativeToObjective",
    "relProjectToBusinessCapability": "relInitiativeToBC",
    "projectBusinessCapabilityRelation": "relInitiativeToBC",
    "relProjectToApplication": "relInitiativeToApp",
    "projectApplicationRelation": "relInitiativeToApp",
    "applicationProjectRelation": "relInitiativeToApp",
    "relProjectToITComponent": "relInitiativeToITC",
    "projectITComponentRelation": "relInitiativeToITC",
    "relProjectToInterface": "relInitiativeToInterface",
    "projectInterfaceRelation": "relInitiativeToInterface",
    "relProjectToDataObject": "relInitiativeToDataObj",
    "projectDataObjectRelation": "relInitiativeToDataObj",
    "relProjectToPlatform": "relInitiativeToPlatform",
    "projectPlatformRelation": "relInitiativeToPlatform",
    # Some tenants rename "Platform" to "Tech Platform" — same edge.
    "projectTechPlatformRelation": "relInitiativeToPlatform",
    "relInitiativeToObjective": "relInitiativeToObjective",
    "relInitiativeToBusinessCapability": "relInitiativeToBC",
    "relInitiativeToApplication": "relInitiativeToApp",
    "relInitiativeToITComponent": "relInitiativeToITC",
    "relInitiativeToInterface": "relInitiativeToInterface",
    "relInitiativeToDataObject": "relInitiativeToDataObj",
    "relInitiativeToPlatform": "relInitiativeToPlatform",
    "relInitiativeSuccessor": "relInitiativeSuccessor",
    "initiativeSuccessorRelation": "relInitiativeSuccessor",
    # --- Objective / Platform ---
    "relObjectiveToBusinessCapability": "relObjectiveToBC",
    "objectiveBusinessCapabilityRelation": "relObjectiveToBC",
    "relPlatformToObjective": "relPlatformToObjective",
    "platformObjectiveRelation": "relPlatformToObjective",
    "relPlatformToApplication": "relPlatformToApp",
    "platformApplicationRelation": "relPlatformToApp",
    "techPlatformApplicationRelation": "relPlatformToApp",
    "relPlatformToITComponent": "relPlatformToITC",
    "platformITComponentRelation": "relPlatformToITC",
    "techPlatformITComponentRelation": "relPlatformToITC",
    "relPlatformSuccessor": "relPlatformSuccessor",
    "platformSuccessorRelation": "relPlatformSuccessor",
    # --- Provider connections ---
    "relProviderToApplication": "relProviderToApp",
    "providerApplicationRelation": "relProviderToApp",
    "relProviderToITComponent": "relProviderToITC",
    "providerITComponentRelation": "relProviderToITC",
    "itComponentProviderRelation": "relProviderToITC",
    "relProviderToProject": "relProviderToInitiative",
    "providerProjectRelation": "relProviderToInitiative",
    "projectProviderRelation": "relProviderToInitiative",
    "relProviderToInitiative": "relProviderToInitiative",
    # --- Business Context / Process ---
    "relBusinessContextToBusinessCapability": "relBizCtxToBC",
    "businessContextBusinessCapabilityRelation": "relBizCtxToBC",
    "relProcessToBusinessCapability": "relProcessToBC",
    "processBusinessCapabilityRelation": "relProcessToBC",
    "relProcessToApplication": "relProcessToApp",
    "processApplicationRelation": "relProcessToApp",
    "applicationProcessRelation": "relProcessToApp",
    "relProcessToDataObject": "relProcessToDataObj",
    "processDataObjectRelation": "relProcessToDataObj",
    "relProcessToITComponent": "relProcessToITC",
    "processITComponentRelation": "relProcessToITC",
    "relProcessDependency": "relProcessDependency",
    "relProcessToOrganization": "relProcessToOrg",
    "processUserGroupRelation": "relProcessToOrg",
    "relProcessToProject": "relProcessToInitiative",
    "processProjectRelation": "relProcessToInitiative",
    "projectProcessRelation": "relProcessToInitiative",
    "relProcessToInitiative": "relProcessToInitiative",
    "relProcessToObjective": "relProcessToObjective",
    "processObjectiveRelation": "relProcessToObjective",
    "relProcessToBusinessContext": "relProcessToBizCtx",
    "processBusinessContextRelation": "relProcessToBizCtx",
    "relProcessSuccessor": "relProcessSuccessor",
    "processSuccessorRelation": "relProcessSuccessor",
    # --- Organization (LeanIX "UserGroup") edges ---
    "relUserGroupToApplication": "relOrgToApp",
    "applicationUserGroupRelation": "relOrgToApp",
    "applicationOwningUserGroupRelation": "relOrgToApp",
    "relUserGroupToBusinessContext": "relOrgToBizCtx",
    "userGroupBusinessContextRelation": "relOrgToBizCtx",
    "relUserGroupToITComponent": "relOrgToITC",
    "itComponentUserGroupRelation": "relOrgToITC",
    "userGroupITComponentRelation": "relOrgToITC",
    "relUserGroupToProject": "relOrgToInitiative",
    "userGroupProjectRelation": "relOrgToInitiative",
    "projectUserGroupRelation": "relOrgToInitiative",
    "relUserGroupToInitiative": "relOrgToInitiative",
    "relUserGroupToObjective": "relOrgToObjective",
    "userGroupObjectiveRelation": "relOrgToObjective",
    # NOTE: ``businessCapabilityUserGroupRelation`` (BC ↔ UserGroup),
    # ``requiresRelation``, the generic ``successorRelation``, and
    # ``projectBlocksProjectRelation`` have no native equivalent in
    # Turbo EA's seeded relation graph. They land as conflict rows so
    # the admin can either drop them or model them as a custom relation
    # type before re-running the apply pass.
}


# LeanIX relation types whose ``from → to`` direction is the reverse of
# the matching Turbo EA ``source → target``. The staging layer swaps the
# endpoints on these so the frontend's SuccessorsSection — which trusts
# the stored direction — renders the right list under each heading.
#
# Currently exclusively the successor-chain edges: LeanIX reads them as
# "X has successor Y" (from = older), while Turbo EA defines them as
# "source succeeds target" (source = newer).
FLIP_DIRECTION: frozenset[str] = frozenset(
    {
        # xlsx-form names
        "applicationSuccessorRelation",
        "itComponentSuccessorRelation",
        "interfaceSuccessorRelation",
        "initiativeSuccessorRelation",
        "platformSuccessorRelation",
        "processSuccessorRelation",
        "dataObjectSuccessorRelation",
        # GraphQL-form names (JSON snapshots — retained for completeness
        # even though the JSON parser path was removed in 1.24.0)
        "relApplicationSuccessor",
        "relITComponentSuccessor",
        "relInterfaceSuccessor",
        "relInitiativeSuccessor",
        "relPlatformSuccessor",
        "relProcessSuccessor",
        "relDataObjectSuccessor",
    }
)


# LeanIX dataType → Turbo EA fields_schema type. ``FACT_SHEET_REFERENCE``
# is intentionally absent: LeanIX models references as fields, Turbo EA
# models them as relations, so the staging service emits a
# `metamodel_relation_type` row instead of a field row.
FIELD_TYPE_MAPPING: dict[str, str] = {
    "STRING": "text",
    "TEXT": "text",
    "RICH_TEXT": "text",
    "INTEGER": "number",
    "DOUBLE": "number",
    "MONEY": "cost",
    "COST": "cost",
    "BOOLEAN": "boolean",
    "DATE": "date",
    "DATETIME": "date",
    "URL": "url",
    "EMAIL": "url",
    "SINGLE_SELECT": "single_select",
    "MULTIPLE_SELECT": "multiple_select",
}


# LeanIX subscription role-name → Turbo EA stakeholder role key. LeanIX
# tenant subscription roles are admin-customisable in LeanIX too, so the
# adapter accepts the lowercased free-form name and falls back to a
# sensible default for anything unrecognised. The default seeded Turbo
# EA roles are ``responsible``, ``observer``, ``processOwner``,
# ``itProjectManager``.
SUBSCRIPTION_ROLE_MAPPING: dict[str, str] = {
    # ACCOUNTABLE / RESPONSIBLE typed subscriptions → "responsible"
    "application owner": "responsible",
    "responsible": "responsible",
    "owner": "responsible",
    # OBSERVER-typed subscriptions
    "observer": "observer",
    "subscriber": "observer",
    # PROCESS context
    "process owner": "processOwner",
    # IT project context
    "it project manager": "itProjectManager",
    "project manager": "itProjectManager",
}


# Hierarchy edges — folded into ``Card.parent_id`` by the parser and
# must never surface as a relation. The adapter exposes this set so the
# staging pipeline can skip them when iterating relations.
HIERARCHY_RELATIONS: frozenset[str] = frozenset({"relToParent", "relToChild"})
