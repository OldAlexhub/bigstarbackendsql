-- Generated relational schema for BigStar on Microsoft Fabric Warehouse.
-- Application uniqueness and references are enforced by the API because Fabric constraints are NOT ENFORCED.

IF SCHEMA_ID(N'dbo') IS NULL
  EXEC(N'CREATE SCHEMA [dbo]');

IF OBJECT_ID(N'[dbo].[bigstar_write_lock]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[bigstar_write_lock] (
    lock_name varchar(32) NOT NULL,
    lock_version bigint NOT NULL,
    updated_at datetime2(6) NOT NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM [dbo].[bigstar_write_lock] WHERE lock_name = 'global')
  INSERT INTO [dbo].[bigstar_write_lock] (lock_name, lock_version, updated_at)
  VALUES ('global', 0, SYSUTCDATETIME());

  IF OBJECT_ID(N'[dbo].[change_logs]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[change_logs] (
      [entity_type] varchar(max) NOT NULL,
      [entity_id] varchar(128) NOT NULL,
      [field] varchar(max) NOT NULL,
      [changed_by] varchar(128) NULL,
      [changed_at] datetime2(6) NOT NULL,
      [id] varchar(128) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[change_logs_old_value_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[change_logs_old_value_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[change_logs_new_value_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[change_logs_new_value_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[corrective_action_plans]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[corrective_action_plans] (
      [division] varchar(128) NOT NULL,
      [kpi_key] varchar(max) NOT NULL,
      [trigger_month] varchar(max) NOT NULL,
      [first_entered_at] datetime2(6) NOT NULL,
      [value_at_cap_date] float NOT NULL,
      [target_at_cap] float NOT NULL,
      [red_cutoff_at_cap] float NOT NULL,
      [direction_at_cap] varchar(max) NOT NULL,
      [variance_at_cap] float NOT NULL,
      [latest_month] varchar(max) NOT NULL,
      [latest_value] float NULL,
      [latest_kpi_status] varchar(max) NOT NULL,
      [status] varchar(max) NOT NULL,
      [active_episode] bit NOT NULL,
      [assigned_manager] varchar(128) NULL,
      [root_cause] varchar(max) NOT NULL,
      [corrective_action] varchar(max) NOT NULL,
      [owner_user] varchar(128) NULL,
      [owner_name] varchar(max) NOT NULL,
      [planned_recovery_date] datetime2(6) NULL,
      [recovery_candidate_month] varchar(max) NULL,
      [recovery_candidate_value] float NULL,
      [recovery_candidate_date] datetime2(6) NULL,
      [value_at_recovery] float NULL,
      [date_recovery_met] datetime2(6) NULL,
      [recovered_at] datetime2(6) NULL,
      [recovered_by] varchar(128) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[corrective_action_plans_updates]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[corrective_action_plans_updates] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [text] varchar(max) NOT NULL,
      [author] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [id] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[corrective_action_plans_audit]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[corrective_action_plans_audit] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [action] varchar(max) NOT NULL,
      [changed_by] varchar(128) NULL,
      [changed_at] datetime2(6) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[corrective_action_plans_audit_details_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[corrective_action_plans_audit_details_values] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[customer_service_entries]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[customer_service_entries] (
      [division] varchar(128) NOT NULL,
      [month] varchar(max) NOT NULL,
      [complaints] float NOT NULL,
      [compliments] float NOT NULL,
      [created_by] varchar(128) NOT NULL,
      [updated_by] varchar(128) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[daily_issue_logs]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[daily_issue_logs] (
      [date] datetime2(6) NOT NULL,
      [division] varchar(128) NOT NULL,
      [route] varchar(128) NULL,
      [operator] varchar(128) NULL,
      [disruption_type] varchar(max) NOT NULL,
      [notes] varchar(max) NOT NULL,
      [created_by] varchar(128) NULL,
      [run_cut_day] varchar(128) NULL,
      [auto_sync_tag] varchar(max) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[deployment_activity_logs]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[deployment_activity_logs] (
      [division] varchar(128) NOT NULL,
      [user] varchar(128) NULL,
      [username] varchar(max) NOT NULL,
      [name] varchar(max) NOT NULL,
      [action] varchar(max) NOT NULL,
      [summary] varchar(max) NOT NULL,
      [route] varchar(max) NOT NULL,
      [reason] varchar(max) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[deployment_activity_logs_changes]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[deployment_activity_logs_changes] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [field] varchar(max) NULL,
      [from] varchar(max) NOT NULL,
      [to] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[divisions]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[divisions] (
      [code] varchar(max) NOT NULL,
      [name] varchar(max) NOT NULL,
      [type] varchar(max) NOT NULL,
      [timezone] varchar(max) NOT NULL,
      [parent_division] varchar(128) NULL,
      [active] bit NOT NULL,
      [thresholds_break_minutes] float NOT NULL,
      [thresholds_revenue_ratio] float NOT NULL,
      [pullout_address_rules_standby_keeps_route_address] bit NOT NULL,
      [pullout_address_rules_editable_in_live_schedule] bit NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[division_threshold_changes]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[division_threshold_changes] (
      [division] varchar(128) NOT NULL,
      [effective_date] datetime2(6) NOT NULL,
      [break_minutes] float NOT NULL,
      [revenue_ratio] float NOT NULL,
      [created_by] varchar(128) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[login_rate_limit_counters]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[login_rate_limit_counters] (
      [id] varchar(128) NOT NULL,
      [total_hits] float NOT NULL,
      [expires_at] datetime2(6) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries] (
      [division] varchar(128) NOT NULL,
      [source] varchar(max) NOT NULL,
      [date] varchar(max) NOT NULL,
      [route] varchar(128) NOT NULL,
      [submission] varchar(128) NOT NULL,
      [metrics_completed_trips] float NOT NULL,
      [metrics_reported_service_hours] float NULL,
      [metrics_reported_revenue_hours] float NULL,
      [metrics_tpsh] float NULL,
      [metrics_otp_pct] float NULL,
      [matching_manually_resolved] bit NOT NULL,
      [operational_outcome] varchar(max) NOT NULL,
      [zero_trip_zero_component_count] float NOT NULL,
      [zero_trip_classification] varchar(max) NOT NULL,
      [zero_trip_deployment_conflict] bit NOT NULL,
      [deployment_run_cut_day] varchar(128) NULL,
      [deployment_canonical_route] varchar(max) NOT NULL,
      [deployment_route_type] varchar(max) NULL,
      [deployment_operator] varchar(128) NULL,
      [deployment_operator_name] varchar(max) NULL,
      [deployment_provider] varchar(128) NULL,
      [deployment_provider_name] varchar(max) NULL,
      [deployment_scheduled_service_hours] float NULL,
      [deployment_scheduled_revenue_hours] float NULL,
      [deployment_status] varchar(max) NULL,
      [deployment_disposition] varchar(max) NULL,
      [deployment_late_to_first] float NULL,
      [deployment_late_deploy] float NULL,
      [deployment_warning] varchar(max) NULL,
      [deployment_assignment_warning] varchar(max) NULL,
      [assignment_override_operator] varchar(128) NULL,
      [assignment_override_operator_name] varchar(max) NULL,
      [assignment_override_provider] varchar(128) NULL,
      [assignment_override_provider_name] varchar(max) NULL,
      [assignment_override_updated_by] varchar(128) NOT NULL,
      [assignment_override_updated_at] datetime2(6) NOT NULL,
      [updated_by] varchar(128) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL,
      [assignment_override_present] bit NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries_source_route_codes]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries_source_route_codes] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries_components]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries_components] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [source_row] float NULL,
      [source_route] varchar(max) NULL,
      [source_operator] varchar(max) NULL,
      [completed_trips] float NOT NULL,
      [reported_service_hours] float NULL,
      [reported_revenue_hours] float NULL,
      [tpsh] float NULL,
      [otp_pct] float NULL,
      [pickup_otp_pct] float NULL,
      [dropoff_otp_pct] float NULL,
      [zero_trips] bit NOT NULL,
      [match_method] varchar(max) NULL,
      [manually_resolved] bit NOT NULL,
      [operational_outcome] varchar(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries_components_source_fields_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries_components_source_fields_values] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries_matching_methods]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries_matching_methods] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries_deployment_provenance_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries_deployment_provenance_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_kpi_entries_assignment_audit_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_kpi_entries_assignment_audit_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_route_aliases]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_route_aliases] (
      [division] varchar(128) NOT NULL,
      [source] varchar(max) NOT NULL,
      [normalized_source_route] varchar(max) NOT NULL,
      [source_route] varchar(max) NOT NULL,
      [route] varchar(128) NOT NULL,
      [confirmed_by] varchar(128) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions] (
      [source] varchar(max) NOT NULL,
      [status] varchar(max) NOT NULL,
      [division] varchar(128) NULL,
      [created_by] varchar(128) NOT NULL,
      [confirmed_by] varchar(128) NULL,
      [confirmed_at] datetime2(6) NULL,
      [removed_by] varchar(128) NULL,
      [removed_at] datetime2(6) NULL,
      [reopened_from] varchar(128) NULL,
      [counts_source_rows] float NOT NULL,
      [counts_automatic_matches] float NOT NULL,
      [counts_route_blockers] float NOT NULL,
      [counts_zero_trip_rows] float NOT NULL,
      [counts_created] float NOT NULL,
      [counts_updated] float NOT NULL,
      [counts_removed] float NOT NULL,
      [counts_excluded] float NOT NULL,
      [counts_incomplete_enrichment] float NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_files]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_files] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [kind] varchar(max) NOT NULL,
      [name] varchar(max) NOT NULL,
      [size] float NOT NULL,
      [sha256] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_report_dates]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_report_dates] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_warnings]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_warnings] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_division_candidates_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_division_candidates_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_parsed_rows_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_parsed_rows_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_preview_rows_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_preview_rows_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_blocked_dates_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_blocked_dates_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[network_submissions_change_audit_values]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[network_submissions_change_audit_values] (
      parent_id varchar(128) NOT NULL,
      node_order int NOT NULL,
      parent_node_order int NULL,
      path_key varchar(512) NULL,
      array_index int NULL,
      value_type varchar(16) NOT NULL,
      string_value varchar(max) NULL,
      number_value float NULL,
      boolean_value bit NULL,
      date_value datetime2(6) NULL,
      binary_value varbinary(max) NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[operations_kpi_results]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[operations_kpi_results] (
      [division] varchar(128) NOT NULL,
      [kpi_key] varchar(max) NOT NULL,
      [month] varchar(max) NOT NULL,
      [value] float NULL,
      [numerator] float NULL,
      [denominator] float NULL,
      [status] varchar(max) NOT NULL,
      [base_status] varchar(max) NOT NULL,
      [closed] bit NOT NULL,
      [setting_enabled] bit NULL,
      [setting_direction] varchar(max) NULL,
      [setting_target] float NULL,
      [setting_red_cutoff] float NULL,
      [setting_effective_month] varchar(max) NULL,
      [setting_assigned_manager] varchar(128) NULL,
      [recalculated_at] datetime2(6) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[operations_kpi_settings]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[operations_kpi_settings] (
      [division] varchar(128) NOT NULL,
      [kpi_key] varchar(max) NOT NULL,
      [effective_month] varchar(max) NOT NULL,
      [enabled] bit NOT NULL,
      [direction] varchar(max) NOT NULL,
      [target] float NOT NULL,
      [red_cutoff] float NOT NULL,
      [assigned_manager] varchar(128) NULL,
      [created_by] varchar(128) NULL,
      [updated_by] varchar(128) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[operators]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[operators] (
      [name] varchar(max) NOT NULL,
      [division] varchar(128) NOT NULL,
      [pullout_address] varchar(max) NOT NULL,
      [employee_id] varchar(max) NULL,
      [provider] varchar(128) NULL,
      [active] bit NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[providers]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[providers] (
      [name] varchar(max) NOT NULL,
      [manager] varchar(max) NOT NULL,
      [active] bit NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[reallocation_requests]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[reallocation_requests] (
      [division] varchar(128) NOT NULL,
      [run_cut] varchar(128) NOT NULL,
      [route] varchar(128) NOT NULL,
      [route_code] varchar(max) NOT NULL,
      [destination_run_cut] varchar(128) NULL,
      [destination_route] varchar(128) NULL,
      [destination_route_code] varchar(max) NOT NULL,
      [destination_original_operator_name] varchar(max) NOT NULL,
      [destination_original_vehicle_code] varchar(max) NOT NULL,
      [destination_original_pullout_address] varchar(max) NOT NULL,
      [original_operator_name] varchar(max) NOT NULL,
      [original_vehicle_code] varchar(max) NOT NULL,
      [original_pullout_address] varchar(max) NOT NULL,
      [requested_operator_name] varchar(max) NOT NULL,
      [requested_vehicle_code] varchar(max) NOT NULL,
      [requested_pullout_address] varchar(max) NOT NULL,
      [effective_date] datetime2(6) NOT NULL,
      [status] varchar(max) NOT NULL,
      [open] bit NOT NULL,
      [requested_by] varchar(128) NOT NULL,
      [requested_by_name] varchar(max) NOT NULL,
      [requested_by_username] varchar(max) NOT NULL,
      [reviewed_by] varchar(128) NULL,
      [reviewed_by_name] varchar(max) NOT NULL,
      [reviewed_by_username] varchar(max) NOT NULL,
      [reviewed_at] datetime2(6) NULL,
      [applied_at] datetime2(6) NULL,
      [application_error] varchar(max) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[reallocation_requests_involved_run_cuts]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[reallocation_requests_involved_run_cuts] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[reallocation_requests_network_seen_by]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[reallocation_requests_network_seen_by] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[retention_cleanup_logs]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[retention_cleanup_logs] (
      [timestamp] datetime2(6) NOT NULL,
      [records_deleted] float NOT NULL,
      [records_cleaned] float NOT NULL,
      [success] bit NOT NULL,
      [id] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[retention_cleanup_logs_errors]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[retention_cleanup_logs_errors] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[routes]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[routes] (
      [division] varchar(128) NOT NULL,
      [code] varchar(max) NOT NULL,
      [active] bit NOT NULL,
      [type] varchar(max) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[run_cuts]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[run_cuts] (
      [division] varchar(128) NOT NULL,
      [route] varchar(128) NOT NULL,
      [operator] varchar(128) NULL,
      [vehicle] varchar(128) NULL,
      [pullout_address] varchar(max) NOT NULL,
      [start_time] varchar(max) NULL,
      [end_time] varchar(max) NULL,
      [status] varchar(max) NOT NULL,
      [service_hours] float NOT NULL,
      [revenue_hours] float NOT NULL,
      [client_notes] varchar(max) NOT NULL,
      [disruption_type] varchar(max) NULL,
      [disruption_notes] varchar(max) NOT NULL,
      [updated_by] varchar(128) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[run_cuts_days_of_week]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[run_cuts_days_of_week] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[run_cut_days]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[run_cut_days] (
      [division] varchar(128) NOT NULL,
      [route] varchar(128) NOT NULL,
      [date] datetime2(6) NOT NULL,
      [operator] varchar(128) NULL,
      [operator_standby_day] varchar(128) NULL,
      [operator_before_standby] varchar(128) NULL,
      [operator_override_before_standby] bit NOT NULL,
      [vehicle] varchar(128) NULL,
      [vehicle_standby_day] varchar(128) NULL,
      [vehicle_before_standby] varchar(128) NULL,
      [vehicle_override_before_standby] bit NOT NULL,
      [pullout_address] varchar(max) NOT NULL,
      [pullout_address_standby_day] varchar(128) NULL,
      [pullout_address_before_standby] varchar(max) NOT NULL,
      [pullout_address_override_before_standby] bit NOT NULL,
      [start_time] varchar(max) NULL,
      [end_time] varchar(max) NULL,
      [status] varchar(max) NOT NULL,
      [service_hours] float NOT NULL,
      [revenue_hours] float NOT NULL,
      [client_notes] varchar(max) NOT NULL,
      [disruption_type] varchar(max) NULL,
      [disruption_notes] varchar(max) NOT NULL,
      [disposition] varchar(max) NULL,
      [disposition_source] varchar(max) NULL,
      [disposition_standby_day] varchar(128) NULL,
      [route_state_standby_day] varchar(128) NULL,
      [status_before_standby] varchar(max) NULL,
      [status_override_before_standby] bit NOT NULL,
      [service_hours_before_standby] float NULL,
      [revenue_hours_before_standby] float NULL,
      [disposition_before_standby] varchar(max) NULL,
      [disposition_source_before_standby] varchar(max) NULL,
      [disposition_standby_day_before_standby] varchar(128) NULL,
      [deployed] bit NOT NULL,
      [covering_route] varchar(128) NULL,
      [is_extra] bit NOT NULL,
      [overrides_operator] bit NOT NULL,
      [overrides_vehicle] bit NOT NULL,
      [overrides_pullout_address] bit NOT NULL,
      [overrides_start_time] bit NOT NULL,
      [overrides_end_time] bit NOT NULL,
      [overrides_status] bit NOT NULL,
      [overrides_client_notes] bit NOT NULL,
      [overrides_disruption] bit NOT NULL,
      [updated_by] varchar(128) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[safety_entries]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[safety_entries] (
      [division] varchar(128) NOT NULL,
      [month] varchar(max) NOT NULL,
      [miles] float NOT NULL,
      [preventable_accidents] float NOT NULL,
      [non_preventable_accidents] float NOT NULL,
      [created_by] varchar(128) NOT NULL,
      [updated_by] varchar(128) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[safety_score_entries]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[safety_score_entries] (
      [division] varchar(128) NOT NULL,
      [month] varchar(max) NOT NULL,
      [score] float NOT NULL,
      [created_by] varchar(128) NOT NULL,
      [updated_by] varchar(128) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[settings]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[settings] (
      [osr_advance_days] float NOT NULL,
      [schedule_history_lookback_weeks] float NOT NULL,
      [operations_reporting_start_month] varchar(max) NOT NULL,
      [data_retention_enabled] bit NOT NULL,
      [data_retention_operational_history_value] float NOT NULL,
      [data_retention_operational_history_unit] varchar(max) NOT NULL,
      [data_retention_audit_logs_value] float NOT NULL,
      [data_retention_audit_logs_unit] varchar(max) NOT NULL,
      [data_retention_team_posts_value] float NOT NULL,
      [data_retention_team_posts_unit] varchar(max) NOT NULL,
      [data_retention_network_submission_staging_value] float NOT NULL,
      [data_retention_network_submission_staging_unit] varchar(max) NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[team_posts]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[team_posts] (
      [division] varchar(128) NOT NULL,
      [from_section] varchar(max) NOT NULL,
      [to_section] varchar(max) NOT NULL,
      [purpose] varchar(max) NOT NULL,
      [title] varchar(max) NOT NULL,
      [body] varchar(max) NOT NULL,
      [response_requested] bit NOT NULL,
      [status] varchar(max) NOT NULL,
      [sent_by] varchar(128) NOT NULL,
      [sent_by_name] varchar(max) NOT NULL,
      [sent_by_username] varchar(max) NOT NULL,
      [response_body] varchar(max) NOT NULL,
      [responded_by] varchar(128) NULL,
      [responded_by_name] varchar(max) NOT NULL,
      [responded_by_username] varchar(max) NOT NULL,
      [responded_at] datetime2(6) NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[team_posts_received_seen_by]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[team_posts_received_seen_by] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[team_posts_response_seen_by]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[team_posts_response_seen_by] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[users]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[users] (
      [username] varchar(max) NOT NULL,
      [password] varchar(max) NOT NULL,
      [name] varchar(max) NOT NULL,
      [email] varchar(max) NULL,
      [phone] varchar(max) NOT NULL,
      [title] varchar(max) NOT NULL,
      [department] varchar(max) NOT NULL,
      [active] bit NOT NULL,
      [role] varchar(max) NOT NULL,
      [page_access_configured] bit NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[users_sections]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[users_sections] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[users_page_access]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[users_page_access] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[users_page_access_levels]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[users_page_access_levels] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [page] varchar(max) NOT NULL,
      [level] varchar(max) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[users_division_access]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[users_division_access] (
      parent_id varchar(128) NOT NULL,
      item_order int NOT NULL,
      [value] varchar(128) NOT NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[vehicles]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vehicles] (
      [code] varchar(max) NOT NULL,
      [division] varchar(128) NOT NULL,
      [active] bit NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;

  IF OBJECT_ID(N'[dbo].[weekly_division_summaries]', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[weekly_division_summaries] (
      [division] varchar(128) NOT NULL,
      [week_start] datetime2(6) NOT NULL,
      [revenue_hours_scheduled] float NOT NULL,
      [revenue_hours_covered] float NOT NULL,
      [duties_deployed] float NOT NULL,
      [duties_scheduled] float NOT NULL,
      [duties_suspended] float NOT NULL,
      [duties_unassigned] float NOT NULL,
      [volunteer_duties] float NOT NULL,
      [standby_available] float NOT NULL,
      [standby_deployed] float NOT NULL,
      [coverage_pct] float NOT NULL,
      [finalized] bit NOT NULL,
      [id] varchar(128) NOT NULL,
      [created_at] datetime2(6) NOT NULL,
      [updated_at] datetime2(6) NOT NULL,
      [version] float NULL
    );
  END;
-- Fabric Warehouse supports relationship constraints only as NOT ENFORCED metadata.

IF OBJECT_ID(N'[dbo].[pk_bigstar_write_lock]', N'PK') IS NULL
  ALTER TABLE [dbo].[bigstar_write_lock] ADD CONSTRAINT [pk_bigstar_write_lock] PRIMARY KEY NONCLUSTERED ([lock_name]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_change_logs]', N'PK') IS NULL
  ALTER TABLE [dbo].[change_logs] ADD CONSTRAINT [pk_change_logs] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_change_logs_old_value_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[change_logs_old_value_values] ADD CONSTRAINT [pk_change_logs_old_value_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_change_logs_old_value_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[change_logs_old_value_values] ADD CONSTRAINT [fk_change_logs_old_value_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[change_logs] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_change_logs_new_value_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[change_logs_new_value_values] ADD CONSTRAINT [pk_change_logs_new_value_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_change_logs_new_value_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[change_logs_new_value_values] ADD CONSTRAINT [fk_change_logs_new_value_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[change_logs] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_corrective_action_plans]', N'PK') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans] ADD CONSTRAINT [pk_corrective_action_plans] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_corrective_action_plans_updates]', N'PK') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans_updates] ADD CONSTRAINT [pk_corrective_action_plans_updates] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_corrective_action_plans_updates_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans_updates] ADD CONSTRAINT [fk_corrective_action_plans_updates_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[corrective_action_plans] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_corrective_action_plans_audit]', N'PK') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans_audit] ADD CONSTRAINT [pk_corrective_action_plans_audit] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_corrective_action_plans_audit_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans_audit] ADD CONSTRAINT [fk_corrective_action_plans_audit_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[corrective_action_plans] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_corrective_action_plans_audit_details_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans_audit_details_values] ADD CONSTRAINT [pk_corrective_action_plans_audit_details_values] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_corrective_action_plans_audit_details_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[corrective_action_plans_audit_details_values] ADD CONSTRAINT [fk_corrective_action_plans_audit_details_values_parent] FOREIGN KEY ([parent_id], [item_order]) REFERENCES [dbo].[corrective_action_plans_audit] ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_customer_service_entries]', N'PK') IS NULL
  ALTER TABLE [dbo].[customer_service_entries] ADD CONSTRAINT [pk_customer_service_entries] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_daily_issue_logs]', N'PK') IS NULL
  ALTER TABLE [dbo].[daily_issue_logs] ADD CONSTRAINT [pk_daily_issue_logs] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_deployment_activity_logs]', N'PK') IS NULL
  ALTER TABLE [dbo].[deployment_activity_logs] ADD CONSTRAINT [pk_deployment_activity_logs] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_deployment_activity_logs_changes]', N'PK') IS NULL
  ALTER TABLE [dbo].[deployment_activity_logs_changes] ADD CONSTRAINT [pk_deployment_activity_logs_changes] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_deployment_activity_logs_changes_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[deployment_activity_logs_changes] ADD CONSTRAINT [fk_deployment_activity_logs_changes_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[deployment_activity_logs] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_divisions]', N'PK') IS NULL
  ALTER TABLE [dbo].[divisions] ADD CONSTRAINT [pk_divisions] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_division_threshold_changes]', N'PK') IS NULL
  ALTER TABLE [dbo].[division_threshold_changes] ADD CONSTRAINT [pk_division_threshold_changes] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_login_rate_limit_counters]', N'PK') IS NULL
  ALTER TABLE [dbo].[login_rate_limit_counters] ADD CONSTRAINT [pk_login_rate_limit_counters] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries] ADD CONSTRAINT [pk_network_kpi_entries] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries_source_route_codes]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_source_route_codes] ADD CONSTRAINT [pk_network_kpi_entries_source_route_codes] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_kpi_entries_source_route_codes_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_source_route_codes] ADD CONSTRAINT [fk_network_kpi_entries_source_route_codes_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_kpi_entries] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries_components]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_components] ADD CONSTRAINT [pk_network_kpi_entries_components] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_kpi_entries_components_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_components] ADD CONSTRAINT [fk_network_kpi_entries_components_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_kpi_entries] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries_components_source_fields_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_components_source_fields_values] ADD CONSTRAINT [pk_network_kpi_entries_components_source_fields_values] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_kpi_entries_components_source_fields_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_components_source_fields_values] ADD CONSTRAINT [fk_network_kpi_entries_components_source_fields_values_parent] FOREIGN KEY ([parent_id], [item_order]) REFERENCES [dbo].[network_kpi_entries_components] ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries_matching_methods]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_matching_methods] ADD CONSTRAINT [pk_network_kpi_entries_matching_methods] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_kpi_entries_matching_methods_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_matching_methods] ADD CONSTRAINT [fk_network_kpi_entries_matching_methods_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_kpi_entries] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries_deployment_provenance_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_deployment_provenance_values] ADD CONSTRAINT [pk_network_kpi_entries_deployment_provenance_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_kpi_entries_deployment_provenance_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_deployment_provenance_values] ADD CONSTRAINT [fk_network_kpi_entries_deployment_provenance_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_kpi_entries] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_kpi_entries_assignment_audit_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_assignment_audit_values] ADD CONSTRAINT [pk_network_kpi_entries_assignment_audit_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_kpi_entries_assignment_audit_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_kpi_entries_assignment_audit_values] ADD CONSTRAINT [fk_network_kpi_entries_assignment_audit_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_kpi_entries] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_route_aliases]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_route_aliases] ADD CONSTRAINT [pk_network_route_aliases] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions] ADD CONSTRAINT [pk_network_submissions] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_files]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_files] ADD CONSTRAINT [pk_network_submissions_files] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_files_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_files] ADD CONSTRAINT [fk_network_submissions_files_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_report_dates]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_report_dates] ADD CONSTRAINT [pk_network_submissions_report_dates] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_report_dates_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_report_dates] ADD CONSTRAINT [fk_network_submissions_report_dates_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_warnings]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_warnings] ADD CONSTRAINT [pk_network_submissions_warnings] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_warnings_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_warnings] ADD CONSTRAINT [fk_network_submissions_warnings_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_division_candidates_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_division_candidates_values] ADD CONSTRAINT [pk_network_submissions_division_candidates_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_division_candidates_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_division_candidates_values] ADD CONSTRAINT [fk_network_submissions_division_candidates_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_parsed_rows_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_parsed_rows_values] ADD CONSTRAINT [pk_network_submissions_parsed_rows_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_parsed_rows_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_parsed_rows_values] ADD CONSTRAINT [fk_network_submissions_parsed_rows_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_preview_rows_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_preview_rows_values] ADD CONSTRAINT [pk_network_submissions_preview_rows_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_preview_rows_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_preview_rows_values] ADD CONSTRAINT [fk_network_submissions_preview_rows_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_blocked_dates_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_blocked_dates_values] ADD CONSTRAINT [pk_network_submissions_blocked_dates_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_blocked_dates_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_blocked_dates_values] ADD CONSTRAINT [fk_network_submissions_blocked_dates_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_network_submissions_change_audit_values]', N'PK') IS NULL
  ALTER TABLE [dbo].[network_submissions_change_audit_values] ADD CONSTRAINT [pk_network_submissions_change_audit_values] PRIMARY KEY NONCLUSTERED ([parent_id], [node_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_network_submissions_change_audit_values_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[network_submissions_change_audit_values] ADD CONSTRAINT [fk_network_submissions_change_audit_values_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[network_submissions] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_operations_kpi_results]', N'PK') IS NULL
  ALTER TABLE [dbo].[operations_kpi_results] ADD CONSTRAINT [pk_operations_kpi_results] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_operations_kpi_settings]', N'PK') IS NULL
  ALTER TABLE [dbo].[operations_kpi_settings] ADD CONSTRAINT [pk_operations_kpi_settings] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_operators]', N'PK') IS NULL
  ALTER TABLE [dbo].[operators] ADD CONSTRAINT [pk_operators] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_providers]', N'PK') IS NULL
  ALTER TABLE [dbo].[providers] ADD CONSTRAINT [pk_providers] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_reallocation_requests]', N'PK') IS NULL
  ALTER TABLE [dbo].[reallocation_requests] ADD CONSTRAINT [pk_reallocation_requests] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_reallocation_requests_involved_run_cuts]', N'PK') IS NULL
  ALTER TABLE [dbo].[reallocation_requests_involved_run_cuts] ADD CONSTRAINT [pk_reallocation_requests_involved_run_cuts] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_reallocation_requests_involved_run_cuts_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[reallocation_requests_involved_run_cuts] ADD CONSTRAINT [fk_reallocation_requests_involved_run_cuts_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[reallocation_requests] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_reallocation_requests_network_seen_by]', N'PK') IS NULL
  ALTER TABLE [dbo].[reallocation_requests_network_seen_by] ADD CONSTRAINT [pk_reallocation_requests_network_seen_by] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_reallocation_requests_network_seen_by_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[reallocation_requests_network_seen_by] ADD CONSTRAINT [fk_reallocation_requests_network_seen_by_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[reallocation_requests] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_retention_cleanup_logs]', N'PK') IS NULL
  ALTER TABLE [dbo].[retention_cleanup_logs] ADD CONSTRAINT [pk_retention_cleanup_logs] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_retention_cleanup_logs_errors]', N'PK') IS NULL
  ALTER TABLE [dbo].[retention_cleanup_logs_errors] ADD CONSTRAINT [pk_retention_cleanup_logs_errors] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_retention_cleanup_logs_errors_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[retention_cleanup_logs_errors] ADD CONSTRAINT [fk_retention_cleanup_logs_errors_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[retention_cleanup_logs] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_routes]', N'PK') IS NULL
  ALTER TABLE [dbo].[routes] ADD CONSTRAINT [pk_routes] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_run_cuts]', N'PK') IS NULL
  ALTER TABLE [dbo].[run_cuts] ADD CONSTRAINT [pk_run_cuts] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_run_cuts_days_of_week]', N'PK') IS NULL
  ALTER TABLE [dbo].[run_cuts_days_of_week] ADD CONSTRAINT [pk_run_cuts_days_of_week] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_run_cuts_days_of_week_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[run_cuts_days_of_week] ADD CONSTRAINT [fk_run_cuts_days_of_week_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[run_cuts] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_run_cut_days]', N'PK') IS NULL
  ALTER TABLE [dbo].[run_cut_days] ADD CONSTRAINT [pk_run_cut_days] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_safety_entries]', N'PK') IS NULL
  ALTER TABLE [dbo].[safety_entries] ADD CONSTRAINT [pk_safety_entries] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_safety_score_entries]', N'PK') IS NULL
  ALTER TABLE [dbo].[safety_score_entries] ADD CONSTRAINT [pk_safety_score_entries] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_settings]', N'PK') IS NULL
  ALTER TABLE [dbo].[settings] ADD CONSTRAINT [pk_settings] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_team_posts]', N'PK') IS NULL
  ALTER TABLE [dbo].[team_posts] ADD CONSTRAINT [pk_team_posts] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_team_posts_received_seen_by]', N'PK') IS NULL
  ALTER TABLE [dbo].[team_posts_received_seen_by] ADD CONSTRAINT [pk_team_posts_received_seen_by] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_team_posts_received_seen_by_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[team_posts_received_seen_by] ADD CONSTRAINT [fk_team_posts_received_seen_by_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[team_posts] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_team_posts_response_seen_by]', N'PK') IS NULL
  ALTER TABLE [dbo].[team_posts_response_seen_by] ADD CONSTRAINT [pk_team_posts_response_seen_by] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_team_posts_response_seen_by_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[team_posts_response_seen_by] ADD CONSTRAINT [fk_team_posts_response_seen_by_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[team_posts] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_users]', N'PK') IS NULL
  ALTER TABLE [dbo].[users] ADD CONSTRAINT [pk_users] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_users_sections]', N'PK') IS NULL
  ALTER TABLE [dbo].[users_sections] ADD CONSTRAINT [pk_users_sections] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_users_sections_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[users_sections] ADD CONSTRAINT [fk_users_sections_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[users] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_users_page_access]', N'PK') IS NULL
  ALTER TABLE [dbo].[users_page_access] ADD CONSTRAINT [pk_users_page_access] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_users_page_access_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[users_page_access] ADD CONSTRAINT [fk_users_page_access_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[users] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_users_page_access_levels]', N'PK') IS NULL
  ALTER TABLE [dbo].[users_page_access_levels] ADD CONSTRAINT [pk_users_page_access_levels] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_users_page_access_levels_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[users_page_access_levels] ADD CONSTRAINT [fk_users_page_access_levels_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[users] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_users_division_access]', N'PK') IS NULL
  ALTER TABLE [dbo].[users_division_access] ADD CONSTRAINT [pk_users_division_access] PRIMARY KEY NONCLUSTERED ([parent_id], [item_order]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[fk_users_division_access_parent]', N'F') IS NULL
  ALTER TABLE [dbo].[users_division_access] ADD CONSTRAINT [fk_users_division_access_parent] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[users] ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_vehicles]', N'PK') IS NULL
  ALTER TABLE [dbo].[vehicles] ADD CONSTRAINT [pk_vehicles] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

IF OBJECT_ID(N'[dbo].[pk_weekly_division_summaries]', N'PK') IS NULL
  ALTER TABLE [dbo].[weekly_division_summaries] ADD CONSTRAINT [pk_weekly_division_summaries] PRIMARY KEY NONCLUSTERED ([id]) NOT ENFORCED;

