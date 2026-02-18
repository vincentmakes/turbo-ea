-- ============================================================
-- Restore original option keys for functionalSuitability
-- and technicalSuitability fields
-- ============================================================
-- Run this against the turboea database.
-- These queries restore the original LeanIX seed option keys
-- in the metamodel (card_types.fields_schema and
-- relation_types.attributes_schema).
-- ============================================================

-- 1. Restore functionalSuitability options in Application type fields_schema
-- The options are nested inside fields_schema JSONB array.
-- We use a DO block to find the right field and update it.

DO $$
DECLARE
  _schema jsonb;
  _section_idx int;
  _field_idx int;
  _found boolean := false;
  _correct_options jsonb := '[
    {"key": "perfect", "label": "Perfect", "color": "#2e7d32"},
    {"key": "appropriate", "label": "Appropriate", "color": "#66bb6a"},
    {"key": "insufficient", "label": "Insufficient", "color": "#f57c00"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#d32f2f"}
  ]'::jsonb;
BEGIN
  SELECT fields_schema INTO _schema FROM card_types WHERE key = 'Application';
  IF _schema IS NULL THEN
    RAISE NOTICE 'Application type not found, skipping functionalSuitability in Application';
    RETURN;
  END IF;

  FOR _section_idx IN 0..jsonb_array_length(_schema)-1 LOOP
    FOR _field_idx IN 0..jsonb_array_length(_schema->_section_idx->'fields')-1 LOOP
      IF _schema->_section_idx->'fields'->_field_idx->>'key' = 'functionalSuitability' THEN
        _schema := jsonb_set(_schema,
          ARRAY[_section_idx::text, 'fields', _field_idx::text, 'options'],
          _correct_options);
        _found := true;
        EXIT;
      END IF;
    END LOOP;
    IF _found THEN EXIT; END IF;
  END LOOP;

  IF _found THEN
    UPDATE card_types SET fields_schema = _schema WHERE key = 'Application';
    RAISE NOTICE 'Restored functionalSuitability options in Application type';
  ELSE
    RAISE NOTICE 'functionalSuitability field not found in Application type';
  END IF;
END $$;


-- 2. Restore technicalSuitability options in Application type fields_schema

DO $$
DECLARE
  _schema jsonb;
  _section_idx int;
  _field_idx int;
  _found boolean := false;
  _correct_options jsonb := '[
    {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
    {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
    {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"}
  ]'::jsonb;
BEGIN
  SELECT fields_schema INTO _schema FROM card_types WHERE key = 'Application';
  IF _schema IS NULL THEN
    RAISE NOTICE 'Application type not found, skipping technicalSuitability in Application';
    RETURN;
  END IF;

  FOR _section_idx IN 0..jsonb_array_length(_schema)-1 LOOP
    FOR _field_idx IN 0..jsonb_array_length(_schema->_section_idx->'fields')-1 LOOP
      IF _schema->_section_idx->'fields'->_field_idx->>'key' = 'technicalSuitability' THEN
        _schema := jsonb_set(_schema,
          ARRAY[_section_idx::text, 'fields', _field_idx::text, 'options'],
          _correct_options);
        _found := true;
        EXIT;
      END IF;
    END LOOP;
    IF _found THEN EXIT; END IF;
  END LOOP;

  IF _found THEN
    UPDATE card_types SET fields_schema = _schema WHERE key = 'Application';
    RAISE NOTICE 'Restored technicalSuitability options in Application type';
  ELSE
    RAISE NOTICE 'technicalSuitability field not found in Application type';
  END IF;
END $$;


-- 3. Restore technicalSuitability options in ITComponent type fields_schema

DO $$
DECLARE
  _schema jsonb;
  _section_idx int;
  _field_idx int;
  _found boolean := false;
  _correct_options jsonb := '[
    {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
    {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
    {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"}
  ]'::jsonb;
BEGIN
  SELECT fields_schema INTO _schema FROM card_types WHERE key = 'ITComponent';
  IF _schema IS NULL THEN
    RAISE NOTICE 'ITComponent type not found, skipping';
    RETURN;
  END IF;

  FOR _section_idx IN 0..jsonb_array_length(_schema)-1 LOOP
    FOR _field_idx IN 0..jsonb_array_length(_schema->_section_idx->'fields')-1 LOOP
      IF _schema->_section_idx->'fields'->_field_idx->>'key' = 'technicalSuitability' THEN
        _schema := jsonb_set(_schema,
          ARRAY[_section_idx::text, 'fields', _field_idx::text, 'options'],
          _correct_options);
        _found := true;
        EXIT;
      END IF;
    END LOOP;
    IF _found THEN EXIT; END IF;
  END LOOP;

  IF _found THEN
    UPDATE card_types SET fields_schema = _schema WHERE key = 'ITComponent';
    RAISE NOTICE 'Restored technicalSuitability options in ITComponent type';
  ELSE
    RAISE NOTICE 'technicalSuitability field not found in ITComponent type';
  END IF;
END $$;


-- 4. Restore functionalSuitability options in relAppToBC relation type attributes_schema

DO $$
DECLARE
  _schema jsonb;
  _attr_idx int;
  _found boolean := false;
  _correct_options jsonb := '[
    {"key": "perfect", "label": "Perfect", "color": "#2e7d32"},
    {"key": "appropriate", "label": "Appropriate", "color": "#66bb6a"},
    {"key": "insufficient", "label": "Insufficient", "color": "#f57c00"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#d32f2f"}
  ]'::jsonb;
BEGIN
  SELECT attributes_schema INTO _schema FROM relation_types WHERE key = 'relAppToBC';
  IF _schema IS NULL THEN
    RAISE NOTICE 'relAppToBC not found or no attributes_schema, skipping';
    RETURN;
  END IF;

  FOR _attr_idx IN 0..jsonb_array_length(_schema)-1 LOOP
    IF _schema->_attr_idx->>'key' = 'functionalSuitability' THEN
      _schema := jsonb_set(_schema,
        ARRAY[_attr_idx::text, 'options'],
        _correct_options);
      _found := true;
      EXIT;
    END IF;
  END LOOP;

  IF _found THEN
    UPDATE relation_types SET attributes_schema = _schema WHERE key = 'relAppToBC';
    RAISE NOTICE 'Restored functionalSuitability options in relAppToBC relation type';
  ELSE
    RAISE NOTICE 'functionalSuitability not found in relAppToBC attributes_schema';
  END IF;
END $$;


-- 5. Restore technicalSuitability options in relAppToITC relation type attributes_schema

DO $$
DECLARE
  _schema jsonb;
  _attr_idx int;
  _found boolean := false;
  _correct_options jsonb := '[
    {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
    {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
    {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"}
  ]'::jsonb;
BEGIN
  SELECT attributes_schema INTO _schema FROM relation_types WHERE key = 'relAppToITC';
  IF _schema IS NULL THEN
    RAISE NOTICE 'relAppToITC not found or no attributes_schema, skipping';
    RETURN;
  END IF;

  FOR _attr_idx IN 0..jsonb_array_length(_schema)-1 LOOP
    IF _schema->_attr_idx->>'key' = 'technicalSuitability' THEN
      _schema := jsonb_set(_schema,
        ARRAY[_attr_idx::text, 'options'],
        _correct_options);
      _found := true;
      EXIT;
    END IF;
  END LOOP;

  IF _found THEN
    UPDATE relation_types SET attributes_schema = _schema WHERE key = 'relAppToITC';
    RAISE NOTICE 'Restored technicalSuitability options in relAppToITC relation type';
  ELSE
    RAISE NOTICE 'technicalSuitability not found in relAppToITC attributes_schema';
  END IF;
END $$;


-- ============================================================
-- VERIFICATION: Check the restored options
-- ============================================================

-- Check Application type options
SELECT
  key AS type_key,
  s->'fields' AS fields
FROM card_types,
  jsonb_array_elements(fields_schema) AS s
WHERE key = 'Application'
  AND s->>'section' = 'Application Information';

-- Check ITComponent type options
SELECT
  key AS type_key,
  s->'fields' AS fields
FROM card_types,
  jsonb_array_elements(fields_schema) AS s
WHERE key = 'ITComponent'
  AND s->>'section' = 'Component Information';

-- Check relAppToBC attributes_schema
SELECT key, attributes_schema FROM relation_types WHERE key = 'relAppToBC';

-- Check relAppToITC attributes_schema
SELECT key, attributes_schema FROM relation_types WHERE key = 'relAppToITC';
