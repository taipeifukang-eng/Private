// 第 4 批 G27（D20、D21）：發起轉移與「更正所屬門市」確認視窗的告知文字、搬走明細的整理（純函式）。
export type MovePreview = {
  moving: { request_id: string; request_no: string; title: string; main_status: string; has_work_order: boolean }[];
  moving_count: number;
  staying: { request_id: string; request_no: string; title: string; main_status: string; request_type: string }[];
  staying_count: number;
  unlinked_work_orders: { work_order_id: string; title: string; status: string }[];
  unlinked_count: number;
};
export type MovedRow = {
  id: string; kind: "REQUEST" | "WORK_ORDER" | "UNLINKED_WORK_ORDER"; moved: boolean; request_id: string | null; work_order_id: string | null;
  doc_no: string | null; doc_title: string | null; doc_status: string | null; from_store_id: string; to_store_id: string; created_at: string;
};

/** 確認視窗固定告知句（D21）；toName 空白時用「新門市」。 */
export function moveHeadline(toName?: string | null): string {
  return `進行中的單會一起轉到新門市${toName ? `（${toName}）` : ""}，由新門市店長接手。`;
}

/** 受影響張數的白話說明；沒有任何單時也明講，避免總務以為沒檢查。 */
export function moveSummary(p: Pick<MovePreview, "moving_count" | "staying_count" | "unlinked_count"> | null | undefined): string[] {
  if (!p) return [];
  const lines: string[] = [];
  lines.push(p.moving_count ? `會一起轉走 ${p.moving_count} 張進行中的維修單（含它們的工單）。` : "目前沒有進行中的維修單需要一起轉走。");
  if (p.staying_count) lines.push(`另有 ${p.staying_count} 張添購等其他類型的單留在原門市。`);
  if (p.unlinked_count) lines.push(`有 ${p.unlinked_count} 張沒連到需求單的舊式工單不會自動轉，轉移後請人工處理。`);
  return lines;
}

/** 搬單結果（接收成功或更正完成後的回應）的白話訊息。 */
export function moveResultText(d: { moved_request_count?: number; unlinked_work_order_count?: number } | null | undefined): string {
  const n = d?.moved_request_count ?? 0;
  const u = d?.unlinked_work_order_count ?? 0;
  return (n ? `，${n} 張進行中的維修單已一起轉到新門市` : "") + (u ? `，另有 ${u} 張舊式工單需人工處理` : "");
}

export function groupMoved(rows: MovedRow[]) {
  const requests = rows.filter((r) => r.kind === "REQUEST");
  const unlinked = rows.filter((r) => r.kind === "UNLINKED_WORK_ORDER");
  const orderOf = (requestId: string | null) => rows.find((w) => w.kind === "WORK_ORDER" && w.request_id === requestId) || null;
  return { requests: requests.map((r) => ({ ...r, work_order: orderOf(r.request_id) })), unlinked };
}
