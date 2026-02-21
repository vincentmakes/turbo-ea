# Test Coverage Documentation

> **Last updated**: February 21, 2026
> **Overall backend line coverage**: 41%
> **Total tests**: ~720 across 54 test files

---

## Table of Contents

- [How to Run Tests](#how-to-run-tests)
- [Backend — API Integration Tests](#backend--api-integration-tests)
- [Backend — Unit Tests](#backend--unit-tests-no-database)
- [Backend — Service Tests](#backend--service-tests)
- [Frontend Tests](#frontend-tests)
- [Coverage Summary](#coverage-summary)

---

## How to Run Tests

```bash
# Backend — unit tests only (no database needed)
cd backend && python -m pytest tests/core/ tests/services/ -q

# Backend — all tests (auto-provisions ephemeral Postgres via Docker)
./scripts/test.sh

# Frontend — watch mode
cd frontend && npm test

# Frontend — single run (CI mode)
cd frontend && npm run test:run
```

---

## Backend — API Integration Tests

These tests hit the actual API endpoints with a real test database. Each test runs inside a database transaction that rolls back automatically, so tests never affect each other.

### Authentication (`test_auth.py`) — 14 tests

| Test | What it verifies |
|------|-----------------|
| `test_first_user_gets_admin_role` | First registered user automatically receives admin role |
| `test_second_user_gets_member_role` | Subsequent users get the default member role |
| `test_duplicate_email_rejected` | Duplicate email registration returns 400 |
| `test_weak_password_rejected` | Short/weak passwords fail validation |
| `test_successful_login` | Valid email/password returns an access token |
| `test_wrong_password` | Incorrect password returns 401 |
| `test_nonexistent_user` | Login with non-existent email returns 401 |
| `test_inactive_user_rejected` | Deactivated accounts cannot log in |
| `test_account_lockout_after_failed_attempts` | Account locks after 5 failed login attempts |
| `test_sso_user_cannot_password_login` | SSO-only users cannot use password authentication |
| `test_returns_current_user` | `GET /auth/me` returns authenticated user details |
| `test_unauthenticated_returns_401` | Missing token returns 401 |
| `test_invalid_token_returns_401` | Malformed/forged token returns 401 |
| `test_refresh_returns_new_token` | `POST /auth/refresh` generates a new JWT |

### Cards (`test_cards.py`) — 24 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_card` | Admin can create cards with required fields |
| `test_member_can_create_card` | Members can create cards |
| `test_viewer_cannot_create_card` | Viewers get 403 when creating cards |
| `test_data_quality_auto_computed` | Card creation auto-calculates data quality score |
| `test_unauthenticated_returns_401` | Unauthenticated request returns 401 |
| `test_get_existing_card` | `GET /cards/{id}` returns card details |
| `test_get_nonexistent_card` | Non-existent card returns 404 |
| `test_list_returns_cards` | `GET /cards` returns paginated list |
| `test_search_filter` | Search query filters cards by name |
| `test_viewer_can_list` | Viewers can list cards (read-only) |
| `test_update_name` | `PATCH /cards/{id}` updates card name |
| `test_approval_breaks_on_edit` | Editing approved card changes approval_status to BROKEN |
| `test_viewer_cannot_update` | Viewers get 403 when updating |
| `test_url_validation_rejects_bad_scheme` | JavaScript URLs rejected (XSS prevention) |
| `test_url_validation_accepts_https` | HTTPS URLs accepted in URL fields |
| `test_update_nonexistent_card_returns_404` | Updating non-existent card returns 404 |
| `test_archive_sets_status` | Archive soft-deletes card |
| `test_archive_already_archived_returns_400` | Cannot archive already-archived card |
| `test_restore_archived_card` | Restore unarchives card |
| `test_restore_non_archived_returns_400` | Cannot restore non-archived card |
| `test_admin_can_permanently_delete` | `DELETE /cards/{id}` hard-deletes card |
| `test_viewer_cannot_delete` | Viewers get 403 on delete |
| `test_delete_nonexistent_returns_404` | Non-existent card delete returns 404 |
| `test_approve/reject/reset_card` | Approval workflow (approve/reject/reset) works |

### Metamodel (`test_metamodel.py`) — 24 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_types` | `GET /metamodel/types` returns all card types |
| `test_hidden_types_excluded_by_default` | Hidden (soft-deleted) types excluded from listing |
| `test_include_hidden` | `?include_hidden=true` shows hidden types |
| `test_create_custom_type` | `POST /metamodel/types` creates new card type |
| `test_duplicate_key_rejected` | Duplicate type key returns 400 |
| `test_viewer_cannot_create` | Viewers get 403 |
| `test_update_label` | `PATCH /metamodel/types/{key}` updates type label |
| `test_update_nonexistent_returns_404` | Non-existent type returns 404 |
| `test_soft_delete_builtin` | Built-in type deletion soft-deletes (hides) |
| `test_hard_delete_custom_no_cards` | Custom type with no cards is hard-deleted |
| `test_cannot_delete_custom_with_cards` | Cannot delete type with existing cards |
| `test_field_usage_counts_cards` | Field usage API counts cards using a specific field |
| `test_section_usage` | Section usage counts cards with any field in section |
| `test_option_usage_single_select` | Option usage counts cards using a specific select option |
| `test_create_relation_type` | Create relation type between two card types |
| `test_duplicate_source_target_rejected` | Duplicate source/target combination rejected |
| `test_invalid_source_type_rejected` | Non-existent source type returns 400 |
| `test_list_relation_types` | List all relation types |
| `test_filter_by_type_key` | Filter relations by card type |
| `test_update_relation_type` | Update relation type label |
| `test_cannot_change_endpoints_with_instances` | Cannot change source/target with existing relations |
| `test_delete_relation_type_no_instances` | Delete succeeds when no relations exist |
| `test_delete_with_instances_returns_409` | Delete blocked when relations exist |
| `test_force_delete_with_instances` | `?force=true` overrides conflict |

### Roles (`test_roles.py`) — 20 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_roles` | `GET /roles` returns all app-level roles |
| `test_list_excludes_archived_by_default` | Archived roles excluded by default |
| `test_list_includes_archived_when_requested` | `?include_archived=true` shows archived |
| `test_user_count_included` | Role response includes user_count field |
| `test_returns_schema` | `GET /roles/permissions-schema` returns all valid permissions |
| `test_create_role` | `POST /roles` creates custom role |
| `test_duplicate_key_returns_409` | Duplicate role key returns 409 |
| `test_invalid_key_pattern_rejected` | Uppercase/special chars in key rejected |
| `test_unknown_permission_key_rejected` | Invalid permission key rejected |
| `test_create_as_default_clears_existing` | Creating new default role clears old default |
| `test_update_label` | `PATCH /roles/{key}` updates role label |
| `test_update_nonexistent_returns_404` | Non-existent role returns 404 |
| `test_cannot_remove_admin_wildcard` | Cannot modify admin wildcard permissions |
| `test_cannot_update_archived_role` | Cannot update archived roles |
| `test_archive_role` | Archive custom role |
| `test_cannot_archive_system_role` | System roles cannot be archived |
| `test_cannot_archive_default_role` | Default role cannot be archived |
| `test_cannot_archive_already_archived` | Cannot archive already-archived role |
| `test_restore_role` | Restore unarchives role |
| `test_restore_non_archived_returns_400` | Cannot restore non-archived role |

### Stakeholder Roles (`test_stakeholder_roles.py`) — 18 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_roles_for_type` | List stakeholder roles for a card type |
| `test_excludes_archived_by_default` | Archived roles excluded |
| `test_nonexistent_type_returns_404` | Non-existent card type returns 404 |
| `test_create_role` | Create per-type stakeholder role |
| `test_duplicate_key_returns_409` | Duplicate role key returns 409 |
| `test_invalid_key_pattern_rejected` | Invalid key format rejected |
| `test_unknown_permission_key_rejected` | Unknown card permission rejected |
| `test_wildcard_not_allowed` | Wildcard permissions blocked on stakeholder roles |
| `test_update_label` | Update stakeholder role label |
| `test_cannot_update_archived` | Cannot update archived roles |
| `test_nonexistent_returns_404` | Non-existent role returns 404 |
| `test_archive_role` | Archive stakeholder role |
| `test_cannot_archive_last_active_role` | Cannot archive the only active role (409) |
| `test_cannot_archive_already_archived` | Cannot archive already-archived |
| `test_restore_role` | Restore unarchives |
| `test_restore_non_archived_returns_400` | Cannot restore non-archived |
| `test_returns_schema` | Card-level permissions schema returned |

### Relations (`test_relations.py`) — 11 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create` | Create relation between two cards |
| `test_viewer_cannot_create` | Viewers get 403 |
| `test_list_returns_relations` | `GET /relations` returns all relations |
| `test_filter_by_card_id` | `?card_id` filters relations by card |
| `test_viewer_can_list` | Viewers can list (read-only) |
| `test_update_attributes` | Update relation attributes |
| `test_update_nonexistent_returns_404` | Non-existent relation returns 404 |
| `test_viewer_cannot_update` | Viewers get 403 |
| `test_admin_can_delete` | Delete relation |
| `test_delete_nonexistent_returns_404` | Non-existent returns 404 |
| `test_viewer_cannot_delete` | Viewers get 403 |

### Comments (`test_comments.py`) — 8 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_comment` | Admin can create comments |
| `test_member_can_create_comment` | Members can create comments |
| `test_viewer_cannot_create_comment` | Viewers get 403 |
| `test_reply_creates_thread` | Reply threading works |
| `test_list_returns_comments` | List comments on a card |
| `test_viewer_can_list` | Viewers can read comments |
| `test_owner_can_update` | Comment owner can edit |
| `test_owner_can_delete` | Comment owner can delete |

### Todos (`test_todos.py`) — 8 tests

| Test | What it verifies |
|------|-----------------|
| `test_create_todo` | Create a basic todo |
| `test_create_todo_with_assignee` | Create todo assigned to a user |
| `test_create_todo_with_due_date` | Create todo with due date |
| `test_list_card_todos` | List todos for a specific card |
| `test_list_all_todos` | List user's own todos |
| `test_mark_done` | Mark todo as complete |
| `test_system_todo_cannot_toggle` | System-generated todos protected (403) |
| `test_creator_can_delete` | Creator can delete their todo |

### Documents (`test_documents.py`) — 7 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_document` | Admin can attach documents |
| `test_viewer_cannot_create_document` | Viewers get 403 |
| `test_javascript_url_rejected` | `javascript:` URLs rejected (XSS prevention) |
| `test_mailto_accepted` | `mailto:` URLs accepted |
| `test_list_documents` | List documents on a card |
| `test_admin_can_delete` | Admin can delete documents |
| `test_viewer_cannot_delete` | Viewers get 403 |

### Tags (`test_tags.py`) — 6 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_group` | Create tag group |
| `test_viewer_cannot_create_group` | Viewers get 403 |
| `test_list_tag_groups` | List all tag groups |
| `test_admin_can_create_tag` | Create tag in group |
| `test_admin_can_assign_tags` | Assign tags to card |
| `test_admin_can_remove_tag` | Remove tag from card |

### Bookmarks (`test_bookmarks.py`) — 8 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_bookmark` | Create bookmark with full config |
| `test_viewer_can_create_bookmark` | Viewers can save views |
| `test_list_returns_bookmarks` | List bookmarks |
| `test_filter_my_bookmarks` | `?filter=my` returns only owned |
| `test_owner_can_update` | Owner can update bookmark |
| `test_non_owner_cannot_update` | Non-owner gets 403 |
| `test_owner_can_delete` | Owner can delete bookmark |
| `test_non_owner_cannot_delete` | Non-owner gets 403 |

### Notifications (`test_notifications.py`) — 7 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_own_notifications` | List user's notifications |
| `test_filter_unread` | Filter to unread only |
| `test_other_user_not_visible` | Other user's notifications hidden |
| `test_unread_count` | Unread badge count correct |
| `test_mark_single_read` | Mark one notification as read |
| `test_mark_read_nonexistent_404` | Non-existent notification returns 404 |
| `test_mark_all_read` | Mark all notifications as read |

### Events (`test_events.py`) — 5 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_list_events` | Admin can view audit trail |
| `test_viewer_cannot_list` | Viewer gets 403 (admin-only) |
| `test_filter_by_card_id` | Filter events by card |
| `test_event_includes_user_info` | Events include acting user info |
| `test_unauthenticated_returns_401` | Missing token returns 401 |

### Reports (`test_reports.py`) — 6 tests

| Test | What it verifies |
|------|-----------------|
| `test_dashboard_empty` | Dashboard returns valid structure with no data |
| `test_dashboard_with_cards` | Dashboard counts cards by type correctly |
| `test_dashboard_data_quality_distribution` | Quality distribution bucketed correctly |
| `test_dashboard_viewer_can_access` | Users with report permission can view |
| `test_dashboard_forbidden_without_permission` | Users without permission get 403 |
| `test_dashboard_unauthenticated` | Missing token returns 401 |

### Users (`test_users.py`) — 13 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_returns_users` | `GET /users` returns all users |
| `test_unauthenticated_returns_401` | Missing token returns 401 |
| `test_admin_can_create_user` | Admin can create users |
| `test_member_cannot_create_user` | Members get 403 |
| `test_duplicate_email_rejected` | Duplicate email returns 409 |
| `test_invalid_role_rejected` | Non-existent role returns 400 |
| `test_admin_can_update_user` | Admin can update any user |
| `test_self_update_display_name` | Users can update own display name |
| `test_non_admin_cannot_change_role` | Non-admins cannot change roles |
| `test_update_nonexistent_returns_404` | Non-existent user returns 404 |
| `test_admin_can_deactivate_user` | Admin can deactivate users |
| `test_cannot_delete_self` | Users cannot deactivate themselves |
| `test_member_cannot_delete_user` | Non-admins cannot delete users |

### Calculations (`test_calculations.py`) — 11 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create` | Admin can create formula |
| `test_member_cannot_create` | Members get 403 |
| `test_viewer_cannot_create` | Viewers get 403 |
| `test_list_returns_calculations` | List all formulas |
| `test_filter_by_type_key` | Filter by card type |
| `test_admin_can_delete` | Delete formula |
| `test_delete_nonexistent_returns_404` | Non-existent returns 404 |
| `test_member_cannot_delete` | Members get 403 |
| `test_validate_simple_formula` | Valid formula returns `{valid: true}` |
| `test_validate_invalid_formula` | Invalid formula returns `{valid: false}` |
| `test_activate_and_deactivate` | Toggle formula active/inactive |

### BPM (`test_bpm.py`) — 8 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_templates` | BPMN starter templates returned |
| `test_list_templates_has_fields` | Templates include required fields |
| `test_templates_require_auth` | Missing token returns 401 |
| `test_create_assessment` | Create process assessment scores |
| `test_list_assessments` | List assessments for a process |
| `test_create_assessment_requires_auth` | Missing token returns 401 |
| `test_update_assessment` | Update assessment scores |
| `test_delete_assessment` | Delete assessment |

### Surveys (`test_surveys.py`) — 9 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_survey` | Create survey with questions |
| `test_create_survey_invalid_type` | Invalid card type rejected |
| `test_viewer_cannot_create_survey` | Viewers get 403 |
| `test_list_surveys` | List all surveys |
| `test_get_survey` | Get survey by ID |
| `test_get_nonexistent_returns_404` | Non-existent survey returns 404 |
| `test_update_survey` | Update survey details |
| `test_delete_survey` | Delete survey |
| `test_survey_response` | Submit survey response |

### Diagrams (`test_diagrams.py`) — 14 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create` | Admin can create diagram |
| `test_member_can_create` | Member can create diagram |
| `test_viewer_cannot_create` | Viewer gets 403 |
| `test_list_diagrams` | List all diagrams |
| `test_get_diagram` | Get diagram by ID |
| `test_get_nonexistent_returns_404` | Non-existent returns 404 |
| `test_update_diagram` | Update diagram name/data |
| `test_update_nonexistent_returns_404` | Non-existent returns 404 |
| `test_viewer_cannot_update` | Viewer gets 403 |
| `test_delete_diagram` | Delete diagram |
| `test_delete_nonexistent_returns_404` | Non-existent returns 404 |
| `test_viewer_cannot_delete` | Viewer gets 403 |
| `test_create_with_initiatives` | Link diagram to initiative cards |
| `test_unauthenticated_returns_401` | Missing token returns 401 |

### SoAW (`test_soaw.py`) — 19 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create` | Admin can create SoAW document |
| `test_member_can_create` | Member can create SoAW |
| `test_viewer_cannot_create` | Viewer gets 403 |
| `test_list_soaws` | List all SoAW documents |
| `test_filter_by_initiative` | Filter SoAW by initiative |
| `test_get_soaw` | Get SoAW by ID |
| `test_get_nonexistent_returns_404` | Non-existent returns 404 |
| `test_update_soaw` | Update SoAW sections/title |
| `test_update_nonexistent_returns_404` | Non-existent returns 404 |
| `test_viewer_cannot_update` | Viewer gets 403 |
| `test_delete_soaw` | Delete SoAW document |
| `test_delete_nonexistent_returns_404` | Non-existent returns 404 |
| `test_viewer_cannot_delete` | Viewer gets 403 |
| `test_create_with_sections` | Create SoAW with section content |
| `test_update_status` | Change SoAW status (draft/review/approved) |
| `test_create_with_initiative_link` | Link SoAW to initiative card |
| `test_list_viewer_can_read` | Viewers can list SoAW (read-only) |
| `test_unauthenticated_returns_401` | Missing token returns 401 |
| `test_create_minimal` | Create SoAW with minimal fields |

### Saved Reports (`test_saved_reports.py`) — 16 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_private` | Create private saved report |
| `test_member_can_create_public` | Create public saved report |
| `test_viewer_cannot_create` | Viewer gets 403 |
| `test_list_saved_reports` | List all saved reports |
| `test_filter_by_report_type` | Filter by report type |
| `test_list_excludes_others_private` | Other users' private reports hidden |
| `test_get_saved_report` | Get report by ID |
| `test_get_nonexistent_returns_404` | Non-existent returns 404 |
| `test_owner_can_update` | Owner can update report config |
| `test_non_owner_cannot_update` | Non-owner gets 403 |
| `test_update_nonexistent_returns_404` | Non-existent returns 404 |
| `test_owner_can_delete` | Owner can delete report |
| `test_admin_can_delete_others` | Admin can delete any report |
| `test_non_owner_cannot_delete` | Non-owner gets 403 |
| `test_delete_nonexistent_returns_404` | Non-existent returns 404 |
| `test_unauthenticated_returns_401` | Missing token returns 401 |

### Settings (`test_settings.py`) — 10 tests

| Test | What it verifies |
|------|-----------------|
| `test_get_default_currency` | Default currency is USD |
| `test_admin_can_set_currency` | Admin can change currency |
| `test_member_cannot_set_currency` | Member gets 403 |
| `test_viewer_cannot_set_currency` | Viewer gets 403 |
| `test_set_currency_persists` | Currency change persists across requests |
| `test_get_bpm_enabled` | Get BPM feature flag |
| `test_admin_can_toggle_bpm` | Admin can enable/disable BPM |
| `test_member_cannot_toggle_bpm` | Member gets 403 |
| `test_unauthenticated_returns_401` | Missing token returns 401 |
| `test_invalid_currency_rejected` | Invalid currency code rejected |

### Web Portals (`test_web_portals.py`) — 11 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_can_create_portal` | Create portal with slug |
| `test_create_portal_invalid_slug` | Invalid slug format rejected |
| `test_create_portal_duplicate_slug` | Duplicate slug returns 409 |
| `test_member_cannot_create` | Member gets 403 |
| `test_list_portals` | List all portals |
| `test_get_portal` | Get portal by ID |
| `test_get_nonexistent_returns_404` | Non-existent returns 404 |
| `test_update_portal` | Update portal config |
| `test_delete_portal` | Delete portal |
| `test_public_access_by_slug` | Public portal accessible without auth |
| `test_public_nonexistent_slug_returns_404` | Non-existent slug returns 404 |

### Auth Extended (`test_auth_extended.py`) — 16 tests

| Test | What it verifies |
|------|-----------------|
| `test_register_missing_email` | Registration without email returns 422 |
| `test_register_empty_password` | Empty password fails validation (422) |
| `test_register_missing_display_name` | Missing display_name returns 422 |
| `test_register_invalid_email_format` | Malformed email returns 422 |
| `test_register_password_too_short` | Password under 10 chars fails (422) |
| `test_register_password_no_uppercase` | Password without uppercase fails (422) |
| `test_register_password_no_digit` | Password without digit fails (422) |
| `test_login_nonexistent_email` | Login with non-existent email returns 401 |
| `test_login_missing_password_field` | Login without password field returns 422 |
| `test_login_missing_email_field` | Login without email field returns 422 |
| `test_login_empty_body` | Login with empty JSON body returns 422 |
| `test_refresh_with_invalid_token` | Refresh with invalid JWT returns 401 |
| `test_refresh_without_token` | Refresh without token returns 401 |
| `test_me_with_expired_token` | GET /auth/me with expired token returns 401 |
| `test_me_with_invalid_token` | GET /auth/me with garbage token returns 401 |
| `test_sso_config_returns_data` | GET /auth/sso/config returns SSO config structure |

### Cards Extended (`test_cards_extended.py`) — 14 tests

| Test | What it verifies |
|------|-----------------|
| `test_root_card_no_parent_no_children` | Root card returns level=1, empty ancestors/children |
| `test_hierarchy_with_parent_and_children` | Card with parent/children returns correct lists |
| `test_hierarchy_card_not_found` | Non-existent card returns 404 |
| `test_history_empty_for_new_card` | Freshly created card has no events |
| `test_history_after_update` | Updating card creates card.created and card.updated events |
| `test_history_pagination` | History respects page and page_size parameters |
| `test_bulk_update_names` | Admin can bulk-update card names |
| `test_bulk_update_attributes` | Admin can bulk-update attributes on multiple cards |
| `test_bulk_update_viewer_forbidden` | Viewer lacks inventory.bulk_edit gets 403 |
| `test_export_csv_returns_csv_content_type` | CSV export returns text/csv with attachment header |
| `test_export_csv_with_type_filter` | CSV export with type filter includes only that type |
| `test_export_csv_has_correct_headers` | CSV first row contains expected column headers |
| `test_export_csv_viewer_can_export` | Viewer role has inventory.export permission |
| `test_export_csv_empty_type` | CSV export for type with no cards returns headers only |

### Relations Extended (`test_relations_extended.py`) — 9 tests

| Test | What it verifies |
|------|-----------------|
| `test_create_with_nonexistent_source` | Relation with fake source card fails |
| `test_create_with_nonexistent_target` | Relation with fake target card fails |
| `test_create_duplicate_relation` | Duplicate relation handled gracefully |
| `test_update_relation_attributes` | PATCH updates attributes and description |
| `test_update_clears_description` | Setting description to None clears it |
| `test_filter_by_source_card_id` | GET /relations?card_id filters by source |
| `test_filter_by_target_card_id` | GET /relations?card_id filters by target |
| `test_filter_by_nonexistent_card_id` | Filtering by nonexistent card returns empty list |
| `test_card_appears_in_both_directions` | Card as source and target returns both relations |

### Stakeholders (`test_stakeholders.py`) — 21 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_roles_empty` | Returns empty list when no definitions exist |
| `test_list_roles_with_definitions` | Returns all unique roles across types |
| `test_list_roles_filtered_by_type_key` | Returns only roles for specified type_key |
| `test_list_roles_filtered_by_type_key_with_no_defs` | Falls back to defaults when no definitions |
| `test_list_stakeholders_empty` | Returns empty list when no stakeholders assigned |
| `test_list_stakeholders_after_create` | Returns stakeholder data after creating one |
| `test_viewer_can_list_stakeholders` | Viewer role has stakeholders.view permission |
| `test_admin_can_create_stakeholder` | Admin assigns stakeholder to card |
| `test_member_can_create_stakeholder` | Member has stakeholders.manage permission |
| `test_duplicate_stakeholder_returns_409` | Same user+role on same card rejected |
| `test_same_user_different_role_allowed` | Same user can hold different role on same card |
| `test_invalid_role_returns_400` | Role must be one of defined stakeholder roles |
| `test_card_not_found_returns_404` | Creating stakeholder on non-existent card returns 404 |
| `test_viewer_cannot_create_stakeholder` | Viewer lacks stakeholders.manage (403) |
| `test_update_stakeholder_role` | Admin updates stakeholder's role |
| `test_update_with_invalid_role_returns_400` | Updating to invalid role rejected |
| `test_update_nonexistent_returns_404` | Updating non-existent stakeholder returns 404 |
| `test_viewer_cannot_update_stakeholder` | Viewer cannot update stakeholders (403) |
| `test_delete_stakeholder` | Admin deletes stakeholder assignment (204) |
| `test_delete_nonexistent_returns_404` | Deleting non-existent stakeholder returns 404 |
| `test_viewer_cannot_delete_stakeholder` | Viewer cannot delete stakeholders (403) |

### Reports Extended (`test_reports_extended.py`) — 44 tests

| Test | What it verifies |
|------|-----------------|
| `test_landscape_empty` | Returns empty groups/ungrouped with no cards |
| `test_landscape_with_data` | Cards grouped by related type correctly |
| `test_landscape_reverse_relation` | Reverse direction relations grouped correctly |
| `test_landscape_permission_denied` | User without reports.ea_dashboard gets 403 |
| `test_portfolio_empty` | Returns empty items with no cards |
| `test_portfolio_with_data` | Card attributes mapped to axes correctly |
| `test_portfolio_invalid_field_400` | Invalid field name returns 400 |
| `test_portfolio_unsafe_field_format_400` | Field with special characters rejected |
| `test_portfolio_permission_denied` | User without permission gets 403 |
| `test_matrix_empty` | Returns empty rows/columns/intersections |
| `test_matrix_with_data` | Returns rows, columns, intersections from relations |
| `test_matrix_same_type_diagonal` | Self-relations appear on diagonal |
| `test_matrix_permission_denied` | User without permission gets 403 |
| `test_roadmap_empty` | Returns empty items |
| `test_roadmap_with_lifecycle` | Cards with lifecycle dates appear |
| `test_roadmap_no_type_filter` | Without filter, all types with lifecycle returned |
| `test_roadmap_permission_denied` | User without permission gets 403 |
| `test_cost_empty` | Returns empty items and zero total |
| `test_cost_with_data` | Aggregates cost fields sorted descending |
| `test_cost_permission_denied` | User without permission gets 403 |
| `test_cost_treemap_empty` | Returns empty items and zero total |
| `test_cost_treemap_with_data` | Returns items sorted by cost descending |
| `test_cost_treemap_with_group_by` | Group_by adds group labels to items |
| `test_cost_treemap_invalid_cost_field_400` | Invalid cost_field format returns 400 |
| `test_cost_treemap_permission_denied` | User without permission gets 403 |
| `test_capability_heatmap_empty` | Returns empty items |
| `test_capability_heatmap_with_data` | Capabilities with linked apps show correct app_count |
| `test_capability_heatmap_hierarchy` | Parent capabilities include parent_id field |
| `test_capability_heatmap_invalid_metric_400` | Invalid metric returns 400 |
| `test_capability_heatmap_total_cost_metric` | total_cost metric accepted |
| `test_capability_heatmap_risk_count_metric` | risk_count metric accepted |
| `test_capability_heatmap_permission_denied` | User without permission gets 403 |
| `test_dependencies_empty` | Returns empty nodes/edges |
| `test_dependencies_with_data` | Returns nodes and edges from relations |
| `test_dependencies_with_center_id_bfs` | BFS depth limits nodes to given depth |
| `test_dependencies_type_filter` | Type filter limits nodes to specified type |
| `test_dependencies_ancestor_path` | Nodes include ancestor path for hierarchical cards |
| `test_dependencies_permission_denied` | User without permission gets 403 |
| `test_data_quality_empty` | Returns zero summary with no cards |
| `test_data_quality_with_data` | Correctly categorizes cards into quality buckets |
| `test_data_quality_orphaned_vs_connected` | Cards with relations not counted as orphaned |
| `test_data_quality_overall_average` | Overall quality is average of all scores |
| `test_data_quality_permission_denied` | User without permission gets 403 |
| `test_data_quality_type_filter` | Type filter limits results to specified type |

### BPM Extended (`test_bpm_extended.py`) — 23 tests

| Test | What it verifies |
|------|-----------------|
| `test_create_assessment` | POST creates assessment with scores |
| `test_list_assessments` | GET lists assessments with all score fields |
| `test_update_assessment_scores` | PUT updates specific score fields |
| `test_delete_assessment` | DELETE removes assessment (204) |
| `test_assessment_nonexistent_process_404` | Assessments on fake process returns 404 |
| `test_score_clamping_high` | Scores above 5 clamped to 5 |
| `test_score_clamping_low` | Scores at/below 0 clamped to 1 |
| `test_dashboard_empty` | BPM dashboard returns valid structure |
| `test_dashboard_with_process_attributes` | Dashboard aggregates process attributes correctly |
| `test_dashboard_permission_denied` | User without reports.bpm_dashboard gets 403 |
| `test_matrix_empty` (cap-process) | Capability-process matrix empty when no relations |
| `test_matrix_empty` (proc-app) | Process-application matrix empty when no relations |
| `test_dependencies_empty` | Process dependencies empty when no relations |
| `test_heatmap_empty` | Capability heatmap empty when no capabilities |
| `test_heatmap_with_capabilities` | Heatmap includes unlinked capabilities with metric_value=0 |
| `test_process_map_empty_when_no_processes` | Process map returns items for existing processes |
| `test_element_app_map_empty` | Element-application map empty when no links |

### BPM Workflow (`test_bpm_workflow.py`) — 30 tests

| Test | What it verifies |
|------|-----------------|
| `test_no_published_returns_none` | Returns null when no version is published |
| `test_get_published_after_approve` | After approve, published returns the approved version |
| `test_create_draft` | Admin can create draft process flow version |
| `test_create_draft_with_svg` | Draft can include SVG thumbnail |
| `test_create_draft_increments_revision` | Each new draft gets higher revision number |
| `test_viewer_cannot_create_draft` | Viewer lacks bpm.edit and gets 403 |
| `test_list_drafts` | Admin can list draft versions |
| `test_list_drafts_empty` | No drafts returns empty list |
| `test_update_draft_bpmn_xml` | Admin can update BPMN XML of draft |
| `test_update_draft_svg_thumbnail` | Admin can update SVG thumbnail |
| `test_update_non_draft_fails` | Cannot update non-draft version (400) |
| `test_delete_draft` | Admin can delete draft version (204) |
| `test_delete_non_draft_fails` | Cannot delete non-draft version (400) |
| `test_submit_draft` | Submitting draft changes status to pending |
| `test_submit_non_draft_fails` | Cannot submit already pending version (400) |
| `test_approve_pending` | Approving pending version publishes it |
| `test_approve_non_pending_fails` | Cannot approve draft (400) |
| `test_approve_archives_previous_published` | Approving archives previously published version |
| `test_reject_pending` | Rejecting pending returns to draft status |
| `test_reject_non_pending_fails` | Cannot reject non-pending version (400) |
| `test_get_specific_version` | Can fetch specific version by ID |
| `test_version_not_found` | Non-existent version returns 404 |
| `test_published_process_not_found` | Returns 404 for non-existent process |
| `test_create_draft_process_not_found` | Returns 404 for non-existent process |
| `test_list_drafts_process_not_found` | Returns 404 for non-existent process |
| `test_admin_permissions` | Admin has full flow permissions |
| `test_viewer_permissions` | Viewer has view-only flow permissions |
| `test_permissions_process_not_found` | Returns 404 for non-existent process |
| `test_list_archived_empty` | Returns empty list when no archived versions |
| `test_list_archived_after_two_publishes` | First published version appears in archived list |

### EOL (`test_eol.py`) — 18 tests

| Test | What it verifies |
|------|-----------------|
| `test_list_products` | List all products returns cached product names |
| `test_list_products_with_search` | Searching filters products by substring |
| `test_list_products_empty_search` | Empty search string returns all products |
| `test_fuzzy_search` | Fuzzy search for 'python' returns high score match |
| `test_fuzzy_search_partial` | Fuzzy search for 'node' finds 'nodejs' |
| `test_get_product_cycles` | Fetching cycles returns cycle data |
| `test_get_product_invalid_name_characters` | Product names with invalid chars returns 400 |
| `test_get_product_special_chars` | Product name with special chars rejected |
| `test_mass_search_application` | Mass search for Application type returns fuzzy matches |
| `test_mass_search_invalid_type` | Mass search with invalid type_key returns 400 |
| `test_mass_search_no_cards` | Mass search with no cards returns empty list |
| `test_mass_search_itcomponent` | Mass search works for ITComponent type |
| `test_unauthenticated_rejected` | EOL endpoints require authentication |

### Surveys Extended (`test_surveys_extended.py`) — 33 tests

| Test | What it verifies |
|------|-----------------|
| `test_send_survey_success` | Sending draft survey activates it |
| `test_send_survey_already_sent` | Sending already active survey returns 400 |
| `test_send_survey_no_fields` | Sending survey with no fields returns 400 |
| `test_send_survey_no_target_roles` | Sending survey with no target roles returns 400 |
| `test_send_survey_viewer_forbidden` | Viewer cannot send surveys (403) |
| `test_member_sees_pending_survey` | Targeted member sees survey in /surveys/my |
| `test_non_targeted_user_sees_no_surveys` | Non-stakeholder sees no surveys |
| `test_get_response_form` | Targeted user retrieves response form |
| `test_get_response_form_not_found_for_wrong_user` | Non-targeted user cannot access form (404) |
| `test_submit_response_success` | Targeted user submits survey response |
| `test_submit_response_not_targeted` | Non-targeted user cannot submit (404) |
| `test_submit_response_survey_closed` | Submitting to closed survey returns 400 |
| `test_close_active_survey` | Admin closes active survey |
| `test_close_draft_survey_returns_400` | Closing draft survey returns 400 |
| `test_close_survey_viewer_forbidden` | Viewer cannot close surveys (403) |
| `test_list_responses_after_submission` | Admin lists responses including submitted ones |
| `test_list_responses_filter_by_status` | Admin filters responses by status |
| `test_list_responses_viewer_forbidden` | Viewer cannot list responses (403) |
| `test_apply_responses_to_cards` | Admin applies responses, updating card attributes |
| `test_apply_already_applied_returns_error` | Applying already-applied response returns error |
| `test_apply_pending_response_returns_error` | Applying not-yet-submitted response returns error |
| `test_apply_nonexistent_response_returns_error` | Applying non-existent response returns error |
| `test_apply_viewer_forbidden` | Viewer cannot apply responses (403) |
| `test_end_to_end_workflow` | Full lifecycle: create, send, respond, list, apply, close |

### ServiceNow (`test_servicenow.py`) — 18 tests

| Test | What it verifies |
|------|-----------------|
| `test_create_basic_connection` | Admin creates connection with basic auth |
| `test_create_oauth2_connection` | Admin creates connection with OAuth2 auth |
| `test_create_connection_invalid_url_no_https` | Connection URL must start with https:// |
| `test_viewer_cannot_create_connection` | Viewer lacks servicenow.manage permission (403) |
| `test_list_empty` | Listing connections when none exist returns empty |
| `test_list_returns_created_connections` | Created connections appear in list |
| `test_viewer_cannot_list_connections` | Viewer lacks servicenow.manage permission (403) |
| `test_get_connection_by_id` | Admin fetches single connection by ID |
| `test_get_nonexistent_connection_404` | Getting non-existent connection returns 404 |
| `test_update_connection_name` | Admin updates connection name via PATCH |
| `test_update_connection_deactivate` | Admin can deactivate connection |
| `test_update_nonexistent_connection_404` | Updating non-existent connection returns 404 |
| `test_update_connection_url_must_be_https` | Updating instance_url validates HTTPS requirement |
| `test_delete_connection` | Admin deletes connection |
| `test_delete_nonexistent_connection_404` | Deleting non-existent connection returns 404 |
| `test_viewer_cannot_delete_connection` | Viewer lacks permission (403) |
| `test_unauthenticated_list_rejected` | ServiceNow endpoints require authentication |
| `test_unauthenticated_create_rejected` | ServiceNow create requires authentication |

---

## Backend — Unit Tests (no database)

These tests run without any database connection. They test pure logic functions.

### JWT Security (`test_security.py`) — 15 tests

| Test | What it verifies |
|------|-----------------|
| `test_returns_string` | JWT creation returns a string token |
| `test_contains_required_claims` | Token has sub, role, iss, aud, iat, exp claims |
| `test_default_role_is_member` | Default role is "member" |
| `test_expiration_is_in_future` | Token expiry is in the future |
| `test_valid_token` | Valid JWT decodes correctly |
| `test_expired_token_returns_none` | Expired tokens return None |
| `test_wrong_signature_returns_none` | Wrong secret key returns None |
| `test_wrong_audience_returns_none` | Wrong audience claim returns None |
| `test_wrong_issuer_returns_none` | Wrong issuer claim returns None |
| `test_garbage_token_returns_none` | Malformed token returns None |
| `test_empty_string_returns_none` | Empty token returns None |
| `test_hash_returns_bcrypt_string` | Hash produces bcrypt format |
| `test_hash_is_not_plaintext` | Hash differs from original |
| `test_different_calls_produce_different_hashes` | Random salt used each time |
| `test_verify_correct/wrong_password` | Password verification works both ways |

### Encryption (`test_encryption.py`) — 14 tests

| Test | What it verifies |
|------|-----------------|
| `test_roundtrip` | Encrypt then decrypt returns original value |
| `test_encrypted_value_has_prefix` | Encrypted values start with `enc:` |
| `test_empty_string_returns_empty` | Empty strings pass through unchanged |
| `test_none_returns_none` | None values return None |
| `test_decrypt_empty_string_returns_empty` | Decrypting empty string returns empty |
| `test_decrypt_none_returns_none` | Decrypting None returns None |
| `test_different_inputs_produce_different_outputs` | Different values produce different ciphertexts |
| `test_unicode_roundtrip` | Unicode characters encrypt/decrypt correctly |
| `test_legacy_plaintext_returned_as_is` | Pre-encryption plaintext detected and returned |
| `test_corrupted_encrypted_value_returns_empty` | Invalid Fernet token returns empty string |
| `test_encrypted_value` | `is_encrypted()` detects encrypted values |
| `test_plain_value` | `is_encrypted()` returns false for plain text |
| `test_empty_string` | `is_encrypted()` handles empty strings |
| `test_none` | `is_encrypted()` handles None |

---

## Backend — Service Tests

### Calculation Engine (`test_calculation_engine.py`) — 40+ tests

| Category | Tests | What they verify |
|----------|-------|-----------------|
| **IF** | 5 | Conditional logic: truthy/falsy, None, zero, strings |
| **SUM** | 3 | Sum numbers, empty list, ignores non-numeric |
| **AVG** | 3 | Average numbers, empty list, ignores non-numeric |
| **MIN / MAX** | 4 | Min/max of numbers and empty lists |
| **COUNT** | 2 | Count items, empty list |
| **ROUND / ABS** | 4 | Rounding, absolute value |
| **COALESCE** | 3 | First non-null value, zero vs None |
| **LOWER / UPPER** | 2 | Case conversion |
| **CONCAT** | 3 | String joining, skips None |
| **CONTAINS** | 2 | Substring search |
| **PLUCK** | 3 | Extract values from array of objects, dot notation |
| **FILTER** | 3 | Filter array by key=value, dot notation |
| **MAP_SCORE** | 2 | Map value to score via dictionary |
| **Formulas** | 17 | Arithmetic, IF, lazy evaluation, multi-line, variables, builtins |

### BPMN Parser (`test_bpmn_parser.py`) — 16 tests

| Test | What it verifies |
|------|-----------------|
| `test_extracts_start_and_end_events` | Parser finds start/end events in BPMN XML |
| `test_element_count` | Correct number of elements extracted |
| `test_names_populated` | Element names captured from XML |
| `test_events_not_automated` | Events marked as non-automated |
| `test_extracts_all_task_types` | All task types extracted (task, userTask, serviceTask, etc.) |
| `test_automation_flags` | Service/script tasks marked as automated |
| `test_extracts_all_gateway_types` | All gateway types extracted |
| `test_gateway_names` | Gateway names captured |
| `test_lane_assignment` | Elements assigned to correct lanes |
| `test_element_not_in_lane` | Unassigned elements have lane_name=None |
| `test_documentation_extracted` | Task documentation text captured |
| `test_order_increments` | Unique incrementing sequence order |
| `test_empty_process` | Empty processes return empty list |
| `test_element_without_id_is_skipped` | Elements without ID skipped |
| `test_malformed_xml_raises` | Invalid XML raises exception |
| `test_subprocess_extracted` | SubProcess/callActivity types extracted |

### Permission Service (`test_permission_service.py`) — 13 tests

| Test | What it verifies |
|------|-----------------|
| `test_admin_wildcard_grants_any_permission` | Admin `{"*": true}` has all permissions |
| `test_member_has_inventory_view` | Members have inventory.view |
| `test_member_denied_admin_settings` | Members denied admin.settings |
| `test_viewer_denied_inventory_create` | Viewers cannot create |
| `test_viewer_has_inventory_view` | Viewers can view |
| `test_nonexistent_role_returns_false` | Non-existent role denied |
| `test_passes_for_admin` | Admin passes permission check |
| `test_raises_403_for_viewer_on_create` | Viewer denied raises 403 |
| `test_app_level_grants_access` | Members pass inventory.edit check |
| `test_app_level_denies_access` | Viewers fail inventory.edit check |
| `test_invalidate_specific_role` | Cache invalidation by role |
| `test_invalidate_all_roles` | Full cache clear |
| `test_invalidate_srd_*` | Stakeholder role definition cache |

### Notification Service (`test_notification_service.py`) — 9 tests

| Test | What it verifies |
|------|-----------------|
| `test_creates_notification_record` | Notification inserted to database |
| `test_self_notification_blocked` | Same actor/user returns None |
| `test_self_notification_allowed_for_special_types` | Special types (e.g., todo_assigned) allow self-notification |
| `test_inactive_user_gets_no_notification` | Inactive users skipped |
| `test_publishes_event_bus_message` | Event bus message published |
| `test_mark_single_as_read` | Mark one as read |
| `test_mark_as_read_wrong_user` | Cannot mark other user's notification |
| `test_mark_all_as_read` | Mark all as read |
| `test_count_reflects_unread` | Unread count accurate |

### Email Service (`test_email_service.py`) — 6 tests

| Test | What it verifies |
|------|-----------------|
| `test_returns_false_when_not_configured` | SMTP disabled returns false |
| `test_calls_smtp_when_configured` | SMTP enabled invokes sendmail |
| `test_no_tls_when_disabled` | TLS skipped when disabled |
| `test_generates_html_with_title` | HTML email body generated correctly |
| `test_subject_has_prefix` | Subject prefixed with "[Turbo EA]" |

### Event Bus (`test_event_bus.py`) — 9 tests

| Test | What it verifies |
|------|-----------------|
| `test_publish_adds_to_subscriber_queues` | Messages appear in subscriber queues |
| `test_publish_to_multiple_subscribers` | All subscribers receive messages |
| `test_publish_with_card_id` | card_id stringified in message |
| `test_publish_without_card_id` | card_id=None when not provided |
| `test_full_queue_removes_subscriber` | Backpressure removes slow subscribers |
| `test_subscribe_yields_json_messages` | Subscription yields JSON messages |
| `test_subscribe_cleans_up_on_cancel` | Cleanup on unsubscribe |
| `test_message_contains_required_fields` | Messages have all required fields |
| `test_timestamp_is_iso_format` | Timestamps are ISO formatted |

### Seed Service (`test_seed.py`) — 11 tests

| Test | What it verifies |
|------|-----------------|
| `test_creates_all_card_types` | Seed creates all defined card types |
| `test_expected_type_keys_present` | All expected type keys exist |
| `test_card_types_are_built_in` | All seeded types marked built_in=True |
| `test_creates_relation_types` | Relation types created |
| `test_expected_relation_keys_present` | All expected relation keys exist |
| `test_creates_standard_roles` | Admin, member, viewer roles created |
| `test_admin_has_wildcard_permissions` | Admin has `{"*": true}` |
| `test_creates_stakeholder_role_definitions` | Stakeholder roles created per type |
| `test_application_has_extra_roles` | Application type has TAO/BAO roles |
| `test_running_twice_does_not_duplicate` | Seed is idempotent (safe to run twice) |

---

## Frontend Tests

### API Client (`client.test.ts`) — 18 tests

| Test | What it verifies |
|------|-----------------|
| `stores token in sessionStorage` | Token persistence works |
| `removes token from sessionStorage` | Token removal works |
| `includes Bearer token when set` | Authorization header sent |
| `omits Authorization when no token` | No header when logged out |
| `calls GET with correct URL` | GET requests use correct URL prefix |
| `sets Content-Type to application/json` | JSON content type set |
| `sends JSON body with POST method` | POST serializes body as JSON |
| `sends PATCH/PUT/DELETE method` | HTTP methods correct |
| `returns undefined for 204 No Content` | Empty responses handled |
| `throws ApiError with status and detail` | Error format correct |
| `formats 422 validation errors` | Validation errors formatted as readable messages |
| `handles object detail with message field` | Custom error objects handled |
| `falls back to statusText` | Non-JSON error responses handled |
| `auth.login calls POST /auth/login` | Login helper works |
| `auth.register calls POST /auth/register` | Register helper works |
| `auth.me calls GET /auth/me` | User fetch helper works |

### useAuth (`useAuth.test.ts`) — 5 tests

| Test | What it verifies |
|------|-----------------|
| `initial state has null user when no token` | No user without token |
| `loads user on mount when token exists` | Auto-loads user from stored token |
| `login stores token and fetches user` | Login flow works end-to-end |
| `logout clears token and user` | Logout clears state |
| `clears token when loadUser fails` | Invalid token cleaned up |

### useMetamodel (`useMetamodel.test.ts`) — 4 tests

| Test | What it verifies |
|------|-----------------|
| `fetches types and relation types on mount` | Metamodel loaded on mount |
| `getType returns matching type` | Type lookup by key works |
| `getType returns undefined for missing key` | Missing type returns undefined |
| `getRelationsForType filters by type key` | Relation filtering works |

### useCurrency (`useCurrency.test.ts`) — 5 tests

| Test | What it verifies |
|------|-----------------|
| `defaults to USD before fetch completes` | USD default before API response |
| `provides a format function` | `fmt()` function exists |
| `provides a symbol` | Currency symbol available |
| `fmtShort abbreviates thousands` | 5000 displays as "5k" |
| `fmtShort formats small numbers normally` | Small numbers not abbreviated |

### useCalculatedFields (`useCalculatedFields.test.ts`) — 5 tests

| Test | What it verifies |
|------|-----------------|
| `fetches calculated fields on first use` | Data fetched on mount |
| `isCalculated returns true for calculated fields` | Known calculated fields detected |
| `isCalculated returns false for non-calculated fields` | Regular fields not flagged |
| `isCalculated returns false for unknown type` | Unknown types return false |
| `defaults to empty map on API error` | Graceful error fallback |

### usePermissions (`usePermissions.test.ts`) — 11 tests

| Test | What it verifies |
|------|-----------------|
| `returns false with no user` | No user = no permissions |
| `returns true for admin with wildcard` | Admin wildcard grants everything |
| `checks specific permission key` | Specific permission lookup works |
| `returns false for missing permission` | Missing permission denied |
| `isAdmin is true for wildcard` | Admin detection works |
| `isAdmin is false for non-admin` | Non-admin detection works |
| `isAdmin is false when user is null` | No user = not admin |
| `loads card permissions and enables canOnCard` | Card-level permissions work |
| `canOnCard returns true for admin without loading` | Admin bypass on card perms |
| `canOnCard returns false when not loaded` | Unloaded = denied |
| `invalidateCardPermissions clears cache` | Cache invalidation works |

### useEventStream (`useEventStream.test.ts`) — 6 tests

| Test | What it verifies |
|------|-----------------|
| `creates EventSource with correct URL` | SSE connection URL correct |
| `does NOT create EventSource when no token` | No connection without auth |
| `encodes token in URL` | Special characters in token handled |
| `parses incoming messages` | JSON messages parsed and forwarded |
| `ignores invalid JSON` | Bad messages silently dropped |
| `cleanup closes EventSource on unmount` | Connection cleaned up |

### useBpmEnabled (`useBpmEnabled.test.ts`) — 4 tests

| Test | What it verifies |
|------|-----------------|
| `fetches BPM enabled status` | Feature flag fetched from server |
| `returns false when server says disabled` | Disabled flag respected |
| `defaults to true on API error` | Error fallback is enabled |
| `defaults to true before fetch completes` | Loading state defaults to enabled |

### LifecycleBadge (`LifecycleBadge.test.tsx`) — 14 tests

| Test | What it verifies |
|------|-----------------|
| `returns null for undefined/empty lifecycle` | No badge without data |
| `returns 'active' when active date is past` | Active phase detected |
| `returns 'plan' when plan date is set` | Plan phase detected |
| `returns 'endOfLife' when EOL date is past` | EOL phase detected |
| `returns 'phaseOut' when phaseOut past but EOL future` | Phase-out detected |
| `returns 'phaseIn' when phaseIn past but active future` | Phase-in detected |
| `returns most advanced past phase` | Priority ordering correct (EOL > phaseOut > active) |
| `renders Active/EOL/Plan/Phase Out chips` | Badge rendering correct |
| `renders nothing when no lifecycle` | Null render without data |

### ApprovalStatusBadge (`ApprovalStatusBadge.test.tsx`) — 7 tests

| Test | What it verifies |
|------|-----------------|
| `renders Draft badge` | Draft status displays correctly |
| `renders Approved badge` | Approved status with verified icon |
| `renders Broken badge` | Broken status displays correctly |
| `renders Rejected badge` | Rejected status with cancel icon |
| `renders nothing for unknown status` | Unknown status handled gracefully |
| `renders correct icon for Approved` | Verified icon shown |
| `renders correct icon for Rejected` | Cancel icon shown |

### MaterialSymbol (`MaterialSymbol.test.tsx`) — 6 tests

| Test | What it verifies |
|------|-----------------|
| `renders icon name as text` | Icon text content correct |
| `applies default size of 24` | Default font-size 24px |
| `applies custom size` | Size prop works |
| `applies custom color` | Color prop works |
| `includes material-symbols-outlined class` | CSS class applied |
| `appends custom className` | Additional classes supported |

### ErrorBoundary (`ErrorBoundary.test.tsx`) — 7 tests

| Test | What it verifies |
|------|-----------------|
| `renders children normally` | No interference when no error |
| `catches errors and shows fallback` | Error boundary catches component crashes |
| `shows label in fallback` | Section label included in error message |
| `shows inline fallback with inline prop` | Compact error display works |
| `shows inline fallback with label` | Inline + label combined |
| `retry button resets error state` | Recovery on retry click (full mode) |
| `retry button on inline also resets` | Recovery on retry click (inline mode) |

---

## Coverage Summary

| Area | Test Files | Approx. Tests | Notes |
|------|-----------|--------------|-------|
| Backend API (integration) | 33 | ~500 | CRUD + permission checks + edge cases for all endpoints |
| Backend Core (unit) | 2 | ~29 | JWT, encryption — no database needed |
| Backend Services | 7 | ~100 | Business logic, parsing, formulas |
| Frontend Hooks | 8 | ~58 | Auth, metamodel, permissions, SSE, currency |
| Frontend Components | 4 | ~34 | Badges, icons, error boundaries |
| **Total** | **54** | **~720** | |

### Well-Covered Areas

- Authentication and authorization (JWT, RBAC, permissions, edge cases)
- Card CRUD operations with hierarchy, history, bulk update, CSV export
- Metamodel management (types, relations, fields)
- Calculation engine (all 15+ built-in functions)
- BPMN XML parsing
- BPM workflow (draft/pending/published/archived state machine)
- BPM reports (dashboard, matrices, heatmap, process map, dependencies)
- Encryption and security
- All report endpoints (landscape, portfolio, matrix, roadmap, cost, dependencies, data quality)
- Stakeholder role management and card-level assignments
- ServiceNow integration (connection CRUD, auth validation)
- Survey workflow (send, respond, close, apply lifecycle)
- EOL proxy endpoints (search, fuzzy match, mass search)
- Relation constraint validation (duplicates, filtering, nonexistent cards)

### Lower-Coverage Areas

- Frontend page components (complex UI flows)
- ServiceNow sync operations (pull/push/staging)
- Diagram sync and DrawIO integration
