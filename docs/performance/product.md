# Product Definition: Prescription Report

## Scope
The dedicated monthly prescription report inside 業績管理. This module does not replace the existing monthly performance or monthly staff-status workflows.

## Product Promise
Authorized users can review and maintain each visible store's prescription counts and point values for a selected month, with total chronic prescription count calculated consistently.

## Users And Context
| User | Situation | Frequency | Device | Constraints |
|---|---|---:|---|---|
| General affairs / performance data entry staff | Enter or verify one month's prescription information across stores | Monthly | Desktop, sometimes tablet | Must compare stores quickly and avoid duplicate sources |
| Authorized managers | Review visible stores' monthly values | Monthly | Desktop / mobile | Store visibility follows existing performance access scope |

## Core Tasks
1. Select a month, scan the visible stores, enter or correct four values, and save the changed rows.
2. Read total chronic prescription count without manual calculation.
3. Confirm which stores are blank, partially entered, or complete.

## Information And System States
- Source of truth for prescription counts: `monthly_store_summary.regular_prescription_count` and `monthly_store_summary.chronic_prescription_count`, shared with monthly store statistics.
- Additional values: regular prescription point value and chronic prescription point value, stored on the same monthly store row.
- Derived value: `round(regular prescription count / 4, 1) + chronic prescription count`; never manually editable.
- Store list and access scope follow active stores and the existing performance manager scope.
- Loading, empty/error, partial-entry, complete, saved, unsaved, and read-only states must be explicit.

## Non-Functional Requirements
- Counts are non-negative integers. Point values are non-negative decimals with at most four fractional digits.
- Batch save only changed stores; server validates authorization, month, store scope, and values.
- Inputs must not change from mouse-wheel scrolling.
- Use a horizontally scrollable, labeled table on narrow screens; retain readable row labels.
- Audit the user and timestamp of the latest prescription-data save.

## Must Not Happen
- Do not create a second independently editable source for prescription counts.
- Do not let the displayed total drift from the documented formula.
- Do not silently treat missing values as completed zeroes.
- Do not show or modify stores outside the user's allowed scope.

## Existing Constraints
- Next.js 14, React, Supabase, Tailwind CSS, lucide-react.
- Existing page: `app/admin/performance/page.tsx`.
- Existing permissions: `performance.view` and `performance.edit`.
- Existing monthly store summary rows also support the monthly staff-status workflow; preserve its status and unrelated fields when saving prescription values.

## Decisions And Assumptions
- Decision: Use a month-by-store ledger rather than a per-store annual chart because the routine is monthly entry and cross-store verification.
- Decision: Keep counts on `monthly_store_summary`; add point values and a database-generated total to the same row.
- Assumption: Users with `performance.edit` may edit prescription report values; users with `performance.view` may view them.
- Assumption: Saving a store without an existing monthly summary creates its summary row with the established pending defaults.

## Acceptance Criteria
- [ ] 業績管理 has a dedicated 處方箋 tab.
- [ ] The chosen month lists only active stores visible to the signed-in user.
- [ ] The report shows general count, general point value, chronic count, chronic point value, and computed total.
- [ ] Editing counts here updates the same count fields used by monthly store statistics.
- [ ] Total is calculated to one decimal place and cannot be edited directly.
- [ ] View-only users cannot edit; unauthorized users cannot call the API to read or save.
- [ ] Blank, partial, invalid, saving, success, and error states are understandable.
