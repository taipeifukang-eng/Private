# DEV Supabase Bootstrap

This folder is a draft baseline for a brand-new DEV Supabase project only. Do not run these seed files in Production.

## Purpose

Task 1A depends on a small public schema foundation before `supabase/migration_general_affairs_category_foundation.sql` can run:

- `profiles`
- RBAC tables: `roles`, `permissions`, `role_permissions`, `user_roles`
- RBAC functions: `has_permission()`, `get_user_permissions()`
- `stores`
- `store_managers`

The baseline keeps legacy display fields such as `profiles.role`, `department`, and `job_title`, but new General Affairs authorization must use RBAC only: `roles`, `permissions`, `role_permissions`, `user_roles`, and `has_permission()`.

## Execution Order

Run these in Supabase SQL Editor against the new DEV project:

1. `001_profiles.sql`
2. `002_rbac_tables.sql`
3. `003_rbac_functions.sql`
4. `004_stores.sql`
5. `005_store_managers.sql`
6. `006_dev_base_seed.sql`
7. Create DEV Auth users in Supabase Dashboard.
8. Update fake emails in `007_dev_user_role_mapping.sql` if needed, then run it.
9. Run `../migration_general_affairs_category_foundation.sql`.
10. Run `008_task1a_test_role_permissions.sql`.
11. Run `../test_general_affairs_category_foundation.sql`.

## Create Auth Test Users

Create these users manually in the DEV Supabase Dashboard under Authentication:

- `dev-no-ga@example.test`
- `dev-ga-access@example.test`
- `dev-ga-view@example.test`
- `dev-ga-manage@example.test`

Use DEV-only passwords. Do not commit passwords, service role keys, or generated sessions to Git.

If you prefer different fake emails, update `007_dev_user_role_mapping.sql` before running it. The script intentionally fails when any listed email does not exist in `auth.users`.

## Task 1A Insertion Point

Task 1A migration must run after baseline files `001` through `007`.

`006_dev_base_seed.sql` creates only the existing entry permission:

- `general_affairs.service_center.access`

The six Task 1A category permissions must be created by `../migration_general_affairs_category_foundation.sql`, then assigned by `008_task1a_test_role_permissions.sql`.

## Confirm Project Ref Is Not Production

Before running any SQL, confirm the DEV project ref:

1. Check Supabase Dashboard project name and URL.
2. Check your local environment value `NEXT_PUBLIC_SUPABASE_URL`.
3. If using Supabase CLI, check `supabase/.temp/project-ref`.
4. The ref must not match the known Production ref.

Never rely on browser tab title alone. The SQL Editor target project must be the DEV project.

## RLS Test Roles

The seed creates four DEV roles:

- `dev_no_ga_access`: no General Affairs permission.
- `dev_ga_access_only`: `general_affairs.service_center.access`.
- `dev_ga_category_view`: service center access plus the three `category.view` permissions after `008`.
- `dev_ga_category_manage`: service center access plus the three `category.manage` permissions after `008`.

Use each Auth user to sign in and directly query Supabase tables with that user's JWT.

Expected behavior after Task 1A:

- No access: cannot read/write category tables.
- Service center access only: can read active categories on active paths only.
- Category view: can read active categories on active paths only.
- Category manage: can read active and inactive non-deleted categories, and can insert/update through allowed API/RLS paths.
- No authenticated user can hard delete category rows.

## has_permission() Security Assumptions

`has_permission()` is `SECURITY DEFINER` and pins `search_path` to `public, pg_temp`.

Admin bypass is based only on the trusted RBAC role code `admin`, which is the highest management role present in the existing project seed. It does not trust email allowlists or `profiles.role`.

The function returns `false` for null users, calls where `p_user_id` is not the current `auth.uid()`, missing roles, inactive roles, expired role assignments, inactive permissions, or denied/missing permissions. It reads RBAC tables as a definer function so RLS policies can call it without recursive table access.

`get_user_permissions()` only returns permissions for `auth.uid()` itself. It must not be used to inspect another user's permissions from a normal authenticated session.

## Clear DEV Test Data

For DEV reset only, run in this order:

```sql
DELETE FROM public.store_managers WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN (
    'dev-no-ga@example.test',
    'dev-ga-access@example.test',
    'dev-ga-view@example.test',
    'dev-ga-manage@example.test'
  )
);

DELETE FROM public.user_roles WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN (
    'dev-no-ga@example.test',
    'dev-ga-access@example.test',
    'dev-ga-view@example.test',
    'dev-ga-manage@example.test'
  )
);

DELETE FROM public.profiles WHERE email IN (
  'dev-no-ga@example.test',
  'dev-ga-access@example.test',
  'dev-ga-view@example.test',
  'dev-ga-manage@example.test'
);

DELETE FROM public.stores WHERE store_code IN ('DEV001', 'DEV002');
```

Delete Auth users separately from the Supabase Dashboard.

## Production Warning

Do not run `006_dev_base_seed.sql`, `007_dev_user_role_mapping.sql`, or `008_task1a_test_role_permissions.sql` in Production. These files create DEV-only roles, fake stores, and test mappings.
