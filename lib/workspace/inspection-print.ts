// M4 W16 A4 列印報表的純規則（Q20 照舊版版面加改善回報結果、Q21 印系統期限日期與回補級距）。
import { improvementDeadline, tierLabels, type BonusRule } from "./improvement-rules";

/** 舊版報告編號：巡店 id 前 8 碼大寫（components/PrintInspectionReport.tsx）。 */
export const reportNumber = (id: string) => String(id || "").slice(0, 8).toUpperCase();

/** 舊版得分率：總分大於 0 才算，一位小數加 %。 */
export const scoreRate = (total: unknown, max: unknown) =>
  Number(max) > 0 ? ((Number(total) / Number(max)) * 100).toFixed(1) : "0.0";

/** 分數並列：原始得分、改善回補、最終得分（回補已加進總分，不是還要再加一次）。 */
export function scoreTrio(record: { total_score?: unknown; improvement_bonus?: unknown }) {
  const final = Number(record.total_score) || 0;
  const bonus = Number(record.improvement_bonus) || 0;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return { original: round1(final - bonus), bonus: round1(bonus), final: round1(final) };
}

/** Q21：改印系統算出的具體期限日期並附回補級距；取代舊版「3 個工作日內」。 */
export function followupNotice(input: { inspectionDate: string; deadline?: string | null; rules: BonusRule[] }) {
  const deadline = (input.deadline || improvementDeadline(input.inspectionDate.slice(0, 10), input.rules)).slice(0, 10);
  const tiers = tierLabels(input.rules);
  return {
    deadline,
    tiers,
    text: `請於 ${deadline} 前回報${tiers.length ? `；${tiers.join("、")}` : ""}`,
  };
}

/** 舊版待改善彙整的來源：標記需改善的明細；另補上沒有對應明細的改善項目。 */
export function printFindings(results: any[], improvements: any[]) {
  const related = (r: any) =>
    improvements.filter((i) => (i.inspection_result_id ? i.inspection_result_id === r.id : i.template_id && i.template_id === r.template_id));
  const items = results
    .filter((r) => r.is_improvement || related(r).length)
    .map((r) => ({ result: r, improvements: related(r) }));
  const used = new Set(items.flatMap((x) => x.improvements.map((i) => i.id)));
  for (const i of improvements.filter((x) => !used.has(x.id))) {
    items.push({
      result: {
        id: `improvement-${i.id}`,
        template: { section_name: i.section_name, item_name: i.item_name },
        notes: i.issue_description,
        photo_urls: i.issue_photo_urls,
        deduction_amount: i.deduction_amount,
        selected_items: [],
        is_improvement: true,
      },
      improvements: [i],
    });
  }
  return items;
}
