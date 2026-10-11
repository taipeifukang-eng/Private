# Product Definition: Prescription Report

## Scope
The dedicated monthly prescription report inside 業績管理. This module does not replace the existing monthly performance or monthly staff-status workflows.

## Product Promise
Authorized users can review annual trends across visible stores and maintain each store's prescription counts and point values by month in a dedicated report, with total chronic prescription count calculated consistently.

## Users And Context
| User | Situation | Frequency | Device | Constraints |
|---|---|---:|---|---|
| General affairs / performance data entry staff | Enter or verify one month's prescription information across stores | Monthly | Desktop, sometimes tablet | Must compare stores quickly and avoid duplicate sources |
| Authorized managers | Review visible stores' monthly values | Monthly | Desktop / mobile | Store visibility follows existing performance access scope |

## Core Tasks
1. In single-month view, select a year and month, download the store template, enter the four values in Excel, and import the completed workbook. Authorized users may also make a focused correction in the report table.
2. Read total chronic prescription count without manual calculation.
3. Confirm which stores are blank, partially entered, or complete.
4. In annual view, compare all 12 months for each visible store and open a selected month to enter or correct its values.

## Information And System States
- Source of truth for this report: `monthly_prescription_reports`, independent from `monthly_store_summary` and monthly staff status.
- Values: regular prescription count and point value, chronic prescription count and point value. Excel imports and focused edits write only to this report table.
- Derived value: `round(regular prescription count / 4, 1) + chronic prescription count`; never manually editable.
- Store list and access scope follow active stores and the existing performance manager scope.
- Annual view reads the report table for all 12 months and does not read or update monthly staff-status prescription values.
- Annual view is for comparison and is read-only. Selecting a month heading opens that month's single-month view for editing.
- The annual table keeps the store column fixed and exposes a draggable month-position slider fixed to the viewport bottom, synchronized with horizontal table scrolling while vertically scrolling stores.
- Loading, empty/error, partial-entry, complete, saved, unsaved, and read-only states must be explicit.

## Non-Functional Requirements
- Counts are non-negative integers. Point values are non-negative decimals with at most four fractional digits.
- Excel import validates authorization, month, store scope, duplicate stores, and all values before writing any rows.
- Blank cells in an imported store row clear that field; an invalid workbook is rejected without partial writes.
- Inputs must not change from mouse-wheel scrolling.
- Use a horizontally scrollable, labeled table on narrow screens; retain readable row labels.
- Size annual month columns so a typical desktop view shows about 2–3 months at once; all months remain reachable horizontally.
- Audit the user and timestamp of the latest prescription-data save.

## Must Not Happen
- Do not read or write prescription-report data through monthly staff-status or monthly store-statistics records.
- Do not let the displayed total drift from the documented formula.
- Do not silently treat missing values as completed zeroes.
- Do not show or modify stores outside the user's allowed scope.

## Existing Constraints
- Next.js 14, React, Supabase, Tailwind CSS, lucide-react.
- Existing page: `app/admin/performance/page.tsx`.
- Existing permissions: `performance.view` and `performance.edit`.
- Existing monthly store summary rows also support the monthly staff-status workflow; this report must not modify them.

## Decisions And Assumptions
- Decision: Use a month-by-store ledger rather than a per-store annual chart because the routine is monthly entry and cross-store verification.
- Decision: Store all report values in a dedicated `monthly_prescription_reports` table, independent from monthly staff status and monthly store statistics.
- Decision: Support both a downloadable selected-month Excel template/import workflow and focused edits in the single-month table.
- Decision: Keep both single-month entry and annual comparison views. The annual view presents all 12 months in a horizontally scrollable store-by-month ledger.
- Decision: Keep annual view read-only; use a month heading to enter that month in the existing single-month workflow.
- Decision: Point values are displayed as points; no currency conversion or exchange-rate interpretation is applied.
- Assumption: Users with `performance.edit` may edit prescription report values; users with `performance.view` may view them.
- Decision: A one-time migration copies rows previously entered through the prescription report into the new table when their report audit timestamp exists; future changes never write back to the old summary table.

## Acceptance Criteria
- [ ] 業績管理 has a dedicated 處方箋 tab.
- [ ] Separate year and month filters list only active stores visible to the signed-in user.
- [ ] Users can switch between single-month and annual views without changing the underlying data source.
- [ ] Annual view shows all 12 months, with roughly 2–3 months visible at once on desktop, a frozen store column, and a bottom-fixed month-position slider synchronized with the table.
- [ ] Selecting a month in annual view opens that month's single-month view.
- [ ] The report shows general count, general point value, chronic count, chronic point value, and computed total.
- [ ] The report has no read/write coupling to monthly staff status or monthly store statistics.
- [ ] Authorized editors can download a selected-month Excel template and import one month's store values.
- [ ] An invalid workbook is rejected before any rows are written; blank imported cells are treated as empty values.
- [ ] Total is calculated to one decimal place and cannot be edited directly.
- [ ] View-only users cannot edit; unauthorized users cannot call the API to read or save.
- [ ] Blank, partial, invalid, saving, success, and error states are understandable.
