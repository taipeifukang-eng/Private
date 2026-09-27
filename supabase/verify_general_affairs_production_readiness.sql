-- General Affairs production readiness audit (read only).
-- Run in the Production Supabase SQL Editor before applying any forward fix.

WITH checks AS (
  SELECT 'table'::text AS check_type, object_name,
         to_regclass('public.' || object_name) IS NOT NULL AS is_ready
  FROM unnest(ARRAY[
    'ga_service_categories',
    'ga_service_regions',
    'ga_vendors',
    'ga_equipment_categories',
    'ga_equipment_templates',
    'ga_equipment',
    'ga_facility_categories',
    'ga_facilities',
    'ga_facility_templates',
    'ga_part_categories',
    'ga_parts',
    'ga_part_compatibilities',
    'ga_part_target_compatibilities',
    'ga_inventory_locations',
    'ga_inventory_location_parts',
    'ga_inventory_balances',
    'ga_inventory_transactions',
    'ga_inventory_transfers',
    'ga_inventory_transfer_items',
    'ga_inventory_holding_allocations',
    'ga_inventory_holding_events',
    'ga_service_requests',
    'ga_service_request_events',
    'ga_service_request_comments',
    'ga_purchase_reviews',
    'ga_part_fulfillments',
    'ga_part_fulfillment_documents',
    'ga_part_fulfillment_events',
    'ga_resource_attachments',
    'ga_utility_bills'
  ]) AS object_name

  UNION ALL

  SELECT 'column', table_name || '.' || column_name,
         EXISTS (
           SELECT 1
           FROM information_schema.columns c
           WHERE c.table_schema = 'public'
             AND c.table_name = required_columns.table_name
             AND c.column_name = required_columns.column_name
         )
  FROM (VALUES
    ('maintenance_requests', 'ga_service_request_id'),
    ('ga_service_requests', 'maintenance_request_id'),
    ('ga_equipment', 'qr_token'),
    ('ga_equipment', 'onboarding_status'),
    ('ga_equipment', 'onboarding_review_note'),
    ('ga_facilities', 'facility_template_id'),
    ('ga_facilities', 'purchased_at'),
    ('ga_facilities', 'purchase_unit_amount'),
    ('ga_facilities', 'purchase_amount'),
    ('ga_utility_bills', 'electricity_kwh'),
    ('ga_utility_bills', 'service_identifier'),
    ('ga_utility_bills', 'equipment_serial'),
    ('ga_utility_bills', 'service_label')
  ) AS required_columns(table_name, column_name)

  UNION ALL

  SELECT 'permission', permission_code,
         EXISTS (
           SELECT 1
           FROM public.permissions p
           WHERE p.code = permission_code
             AND p.is_active = true
         )
  FROM unnest(ARRAY[
    'general_affairs.service_center.access',
    'general_affairs.request.create',
    'general_affairs.request.view_own_store',
    'general_affairs.request.view_all',
    'general_affairs.request.manage',
    'general_affairs.work_order.view_own_store',
    'general_affairs.work_order.view_all',
    'general_affairs.work_order.manage',
    'general_affairs.part_fulfillment.view',
    'general_affairs.part_fulfillment.manage',
    'general_affairs.inventory_transfer.view',
    'general_affairs.inventory_transfer.manage',
    'general_affairs.equipment.view',
    'general_affairs.equipment.manage',
    'general_affairs.facility.view',
    'general_affairs.facility.manage',
    'general_affairs.part.view',
    'general_affairs.part.manage',
    'general_affairs.utility_bill.view',
    'general_affairs.utility_bill.manage'
  ]) AS permission_code
)
SELECT
  check_type,
  object_name,
  CASE WHEN is_ready THEN 'OK' ELSE 'MISSING' END AS status
FROM checks
ORDER BY is_ready, check_type, object_name;

-- Expected summary: missing_count = 0.
WITH required_tables AS (
  SELECT unnest(ARRAY[
    'ga_service_requests',
    'ga_part_fulfillments',
    'ga_inventory_transfers',
    'ga_facility_templates',
    'ga_inventory_holding_allocations',
    'ga_utility_bills'
  ]) AS table_name
)
SELECT count(*) FILTER (WHERE to_regclass('public.' || table_name) IS NULL) AS missing_count
FROM required_tables;
