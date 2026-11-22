import { type TaskStep } from "./task-state";
const DAY = 86400000,
  WEEK = DAY * 7;
function date(value: unknown) {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10),
    n = Date.parse(day + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(n) &&
    new Date(n).toISOString().slice(0, 10) === day
    ? n
    : null;
}
function monday(n: number) {
  const day = new Date(n).getUTCDay();
  return n - ((day + 6) % 7) * DAY;
}
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
export function taskSchedule(record: any) {
  const sections = record.sections?.length
    ? record.sections
    : [
        {
          id: "main",
          department: record.department || "未分部門",
          steps: record.steps || [],
          assigned_users: (record.collaborators || []).map(
            (c: any) => c.user_id,
          ),
        },
      ];
  const rows = sections.map((s: any) => ({
    ...s,
    items: (s.steps || []).flatMap((step: TaskStep) => [
      { ...step, sub: false },
      ...(step.subSteps || []).map((child) => ({ ...child, sub: true })),
    ]),
  }));
  const dates: number[] = rows
    .flatMap((s: any) =>
      s.items.flatMap((i: any) => [
        date(i.planned_start_date),
        date(i.planned_end_date),
      ]),
    )
    .filter((n: any) => n !== null)
    .sort((a: number, b: number) => a - b);
  const plannedStart = date(record.planned_start_date),
    plannedEnd = date(record.planned_end_date);
  const explicit =
    plannedStart !== null && plannedEnd !== null && plannedStart <= plannedEnd;
  const start = explicit
    ? plannedStart
    : (dates[0] ?? date(record.created_at) ?? 0);
  const end = explicit ? plannedEnd : (dates[dates.length - 1] ?? start);
  const base = monday(start),
    count = Math.max(1, Math.floor((monday(end) - base) / WEEK) + 1);
  const clamp = (index: number) => Math.min(count - 1, Math.max(0, index));
  const state = record.state || {};
  return {
    start: iso(start),
    end: iso(end),
    explicit,
    count,
    weeks: Array.from({ length: count }, (_, i) => ({
      label: `第 ${i + 1} 週`,
      start: iso(base + i * WEEK),
      end: iso(base + i * WEEK + 6 * DAY),
    })),
    sections: rows
      .filter((s: any) => s.items.length)
      .map((s: any) => {
        const firstPending = s.items.findIndex((i: any) => !(i.id in state));
        return {
          ...s,
          people: (s.assigned_users || []).map(
            (id: string) =>
              (record.collaborators || []).find((c: any) => c.user_id === id)
                ?.name || "未指定",
          ),
          items: s.items.map((item: any, index: number) => {
            const from = date(item.planned_start_date),
              to = date(item.planned_end_date);
            const first =
              from === null
                ? clamp(Math.floor((index * count) / s.items.length))
                : clamp(Math.floor((monday(from) - base) / WEEK));
            const last =
              from !== null && to !== null
                ? Math.max(first, clamp(Math.floor((monday(to) - base) / WEEK)))
                : first;
            return {
              ...item,
              first,
              last,
              estimated: from === null,
              status:
                item.id in state
                  ? "已完成"
                  : index === firstPending
                    ? "進行中"
                    : "待處理",
            };
          }),
        };
      }),
  };
}
