export const ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION =
  'organization.calendar.company.create' as const;

export const ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION =
  'organization.calendar.company.edit' as const;

export const ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION =
  'organization.calendar.holiday.manage' as const;

export const ORGANIZATION_CALENDAR_EVENT_TYPES = [
  'meeting',
  'activity',
  'important',
] as const;

export type OrganizationCalendarEventType = typeof ORGANIZATION_CALENDAR_EVENT_TYPES[number];

export const ORGANIZATION_CALENDAR_EVENT_TYPE_LABELS: Record<OrganizationCalendarEventType, string> = {
  meeting: '會議',
  activity: '活動',
  important: '重要事項',
};

export const ORGANIZATION_CALENDAR_HOLIDAY_TYPES = [
  'national_holiday',
  'substitute_holiday',
  'makeup_workday',
] as const;

export type OrganizationCalendarHolidayType = typeof ORGANIZATION_CALENDAR_HOLIDAY_TYPES[number];

export const ORGANIZATION_CALENDAR_HOLIDAY_TYPE_LABELS: Record<OrganizationCalendarHolidayType, string> = {
  national_holiday: '國定假日',
  substitute_holiday: '補假日',
  makeup_workday: '補行上班',
};

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function cleanCalendarText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export async function readCalendarRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
