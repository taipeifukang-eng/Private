// W18 設定規則（M4 Q6–Q8、Q5）的純函式。
export type BonusRule = {
  id?: string | null;
  day_from: number;
  day_to: number;
  is_active: boolean;
};
/** Q7：啟用中的回補規則天數範圍不能重疊（空缺允許）。回傳第一組重疊的規則，沒有則 null。 */
export function findBonusOverlap(
  rules: BonusRule[],
  candidate: BonusRule,
): BonusRule | null {
  if (!candidate.is_active) return null;
  return (
    rules.find(
      (r) =>
        r.is_active &&
        (!candidate.id || r.id !== candidate.id) &&
        r.day_from <= candidate.day_to &&
        r.day_to >= candidate.day_from,
    ) || null
  );
}
/** Q8：所有啟用檢查項目的滿分總和（只警告，不阻擋；評分仍固定從 220 起算）。 */
export const INSPECTION_BASE_SCORE = 220;
export function activeMaxScoreTotal(
  templates: { is_active: boolean; max_score: number | string }[],
) {
  const sum = templates
    .filter((t) => t.is_active)
    .reduce((n, t) => n + Number(t.max_score || 0), 0);
  return Math.round(sum * 10) / 10;
}
export function maxScoreWarning(total: number) {
  return total === INSPECTION_BASE_SCORE
    ? null
    : `啟用項目的滿分總和為 ${total} 分，不等於 ${INSPECTION_BASE_SCORE} 分。評分仍固定從 ${INSPECTION_BASE_SCORE} 分起算，不會因此改變滿分。`;
}
/** Q6：回補規則儲存前顯示的影響說明（N 為目前等待改善的項目數）。 */
export function bonusImpactNotice(pending: number) {
  return `目前有 ${pending} 筆等待改善的項目會受影響：這些項目日後回報「已改善」時，依回報當下啟用的規則計算；已改善完成的不受影響。`;
}
