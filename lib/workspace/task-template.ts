import { WorkspaceError, uuid } from "./server";
/** A.6：該成員是否是這個區段明確標記的「跨部門支援人員」。 */
export function isSupportMember(
  sections: any[] | null | undefined,
  sectionId: string | null | undefined,
  userId: string,
) {
  const section = (sections || []).find((s: any) => s.id === sectionId);
  return !!section && Array.isArray(section.support_users) && section.support_users.includes(userId);
}
export function normalizeTaskTemplate(
  raw: any,
  people: { id: string; department: string | null }[],
) {
  const fail = (message: string): never => {
    throw new WorkspaceError(400, message);
  };
  const text = (v: any, max: number, required = false) => {
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
      return fail("名稱或說明格式不符");
    return v.trim();
  };
  const date = (v: any) => {
    if (v === null || v === undefined || v === "") return null;
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v
    )
      return fail("日期格式不符");
    return v;
  };
  const range = (item: any) => {
    const planned_start_date = date(item.planned_start_date),
      planned_end_date = date(item.planned_end_date);
    if (
      planned_start_date &&
      planned_end_date &&
      planned_start_date > planned_end_date
    )
      fail("預計起始日不可晚於結束日");
    return { planned_start_date, planned_end_date };
  };
  if (
    !raw ||
    !Array.isArray(raw.sections) ||
    raw.sections.length < 1 ||
    raw.sections.length > 50
  )
    fail("請設定 1 至 50 個部門區段");
  const ids = new Set<string>(),
    sectionIds = new Set<string>();
  let count = 0;
  const identity = (v: any, seen: Set<string>) => {
    if (
      typeof v !== "string" ||
      !v.length ||
      v.length > 100 ||
      ["__proto__", "constructor", "prototype"].includes(v) ||
      seen.has(v)
    )
      return fail("項目或區段編號重複或無效");
    seen.add(v);
    return v;
  };
  const step = (v: any, sub = false): any => {
    if (!v || ++count > 1000) fail("項目數量或內容不符");
    const result: any = {
      id: identity(v.id, ids),
      label: text(v.label, 300, true),
      description: text(v.description ?? "", 5000),
      required: v.required === true,
      ...range(v),
    };
    if (!sub) {
      if (v.subSteps !== undefined && !Array.isArray(v.subSteps))
        fail("子項目格式不符");
      result.subSteps = (v.subSteps || []).map((s: any) => step(s, true));
    }
    return result;
  };
  const sections = raw.sections.map((s: any) => {
    if (
      !s ||
      !Array.isArray(s.assigned_users) ||
      !s.assigned_users.length ||
      !Array.isArray(s.steps) ||
      !s.steps.length
    )
      fail("每個部門區段需要執行人員及工作項目");
    const department = text(s.department, 200, true),
      assigned_users = Array.from(new Set<string>(s.assigned_users));
    if (
      s.support_users !== undefined &&
      (!Array.isArray(s.support_users) ||
        s.support_users.some((id: any) => typeof id !== "string"))
    )
      fail("跨部門支援人員格式不符");
    const requested = new Set<string>(s.support_users || []);
    if (assigned_users.some((id) => !uuid(id) || !people.some((p) => p.id === id)))
      fail("執行人員不存在或已不屬於所選部門");
    if (
      Array.from(requested).some(
        (id) => !assigned_users.includes(id),
      )
    )
      fail("跨部門支援人員必須同時是執行人員");
    // 只有明確勾選的人才能跨部門；其他人必須屬於所選部門。
    if (
      assigned_users.some((id) => {
        const p = people.find((x) => x.id === id)!;
        return p.department !== department && !(requested.has(id) && !!p.department);
      })
    )
      fail("執行人員不屬於所選部門；若是跨部門支援，請明確勾選「跨部門支援人員」");
    const support_users = assigned_users.filter((id) => {
      const p = people.find((x) => x.id === id)!;
      return requested.has(id) && p.department !== department;
    });
    return {
      id: identity(s.id, sectionIds),
      department,
      assigned_users,
      support_users,
      steps: s.steps.map((s: any) => step(s)),
    };
  });
  return {
    title: text(raw.title, 300, true),
    description: text(raw.description ?? "", 10000),
    ...range(raw),
    sections,
  };
}
