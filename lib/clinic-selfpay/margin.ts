// 診所自費藥毛利計算（純函式）。沿用舊版 batches/import 與 batches/[id]：
// 單列金額取小數 2 位（toFixed(2)）、批次合計取小數 1 位（roundTo1）；成本與會員價在匯入當下存成快照，之後匯入或關帳不回頭改動舊批次。
import type { ParsedClaimItem } from './claim-parser';

export function roundTo1(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

export type PriceEntry = {
  id?: string;
  health_insurance_code?: string | null;
  product_code?: string | null;
  member_price?: number | string | null;
  cost_price?: number | string | null;
};

export type ClaimItemRow = {
  batch_id?: string;
  line_no: number;
  health_insurance_code: string;
  drug_name: string;
  qty: number;
  matched_price_entry_id: string | null;
  matched_product_code: string | null;
  matched_member_price: number | null;
  matched_cost_price: number | null;
  billing_amount: number;
  gross_profit_amount: number;
  match_status: 'matched' | 'unmatched';
};

export function buildPriceMap<T extends PriceEntry>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  rows.forEach((row) => {
    map.set(String(row.health_insurance_code || '').toUpperCase(), row);
  });
  return map;
}

/** 價格主檔找不到的藥品（同健保碼加藥名只列一次，保留第一次出現的順序）。 */
export function findUnmatched(items: ParsedClaimItem[], priceMap: Map<string, PriceEntry>) {
  const unmatchedMap = new Map<string, { code: string; name: string }>();
  items.forEach((item) => {
    const matched = priceMap.get(item.healthInsuranceCode.toUpperCase());
    if (!matched) {
      const key = `${item.healthInsuranceCode.toUpperCase()}|${item.drugName || ''}`;
      if (!unmatchedMap.has(key)) {
        unmatchedMap.set(key, { code: item.healthInsuranceCode, name: item.drugName || '未提供藥品名稱' });
      }
    }
  });
  return Array.from(unmatchedMap.values());
}

export function noPriceMessage(targetYearMonth: string) {
  return `尚未有${targetYearMonth.slice(5)}月成本、會員價的月度紀錄請聯繫營業部匯入`;
}

export function unmatchedMessage(unmatched: { code: string; name: string }[]) {
  const lines = unmatched.map((u) => `健保代碼${u.code} 藥品名稱:${u.name}`);
  return `尚未有DPOS商品資訊，請將此訊息之藥品內容複製給營業部匯入DPOS商品主檔資訊\n${lines.join('\n')}`;
}

export function buildClaimItems(items: ParsedClaimItem[], priceMap: Map<string, PriceEntry>): ClaimItemRow[] {
  return items.map((item) => {
    const matched = priceMap.get(item.healthInsuranceCode.toUpperCase());
    const memberPrice = matched ? Number(matched.member_price || 0) : 0;
    const costPrice = matched ? Number(matched.cost_price || 0) : 0;
    const billingAmount = Number((memberPrice * item.qty).toFixed(2));
    const grossProfitAmount = Number(((memberPrice - costPrice) * item.qty).toFixed(2));

    return {
      line_no: item.lineNo,
      health_insurance_code: item.healthInsuranceCode,
      drug_name: item.drugName,
      qty: item.qty,
      matched_price_entry_id: matched?.id || null,
      matched_product_code: matched?.product_code || null,
      matched_member_price: matched ? memberPrice : null,
      matched_cost_price: matched ? costPrice : null,
      billing_amount: billingAmount,
      gross_profit_amount: grossProfitAmount,
      match_status: matched ? 'matched' : 'unmatched',
    };
  });
}

export type Summary = {
  itemCount: number;
  matchedCount: number;
  unmatchedCount: number;
  totalQty: number;
  totalBilling: number;
  totalGrossProfit: number;
};

/** 彙總：未四捨五入前的累加；呼叫端用 roundSummary 取批次合計（小數 1 位）。 */
export function summarize(rows: { qty?: unknown; billing_amount?: unknown; gross_profit_amount?: unknown; match_status?: string }[]): Summary {
  return rows.reduce(
    (acc, row) => {
      acc.itemCount += 1;
      acc.totalQty += Number(row.qty || 0);
      acc.totalBilling += Number(row.billing_amount || 0);
      acc.totalGrossProfit += Number(row.gross_profit_amount || 0);
      if (row.match_status === 'matched') acc.matchedCount += 1;
      else acc.unmatchedCount += 1;
      return acc;
    },
    { itemCount: 0, matchedCount: 0, unmatchedCount: 0, totalQty: 0, totalBilling: 0, totalGrossProfit: 0 } as Summary,
  );
}

export function roundSummary(summary: Summary): Summary {
  return { ...summary, totalBilling: roundTo1(summary.totalBilling), totalGrossProfit: roundTo1(summary.totalGrossProfit) };
}

/** D3：檔案期間推得的年月與畫面選的年月不同時要確認；沒有推得年月則不需要。 */
export function periodMismatch(fileYearMonth: string | null, selectedYearMonth: string) {
  return !!fileYearMonth && fileYearMonth !== selectedYearMonth;
}

function monthLabel(ym: string, sameYearAs: string) {
  const [y, m] = ym.split('-');
  const month = Number(m);
  return y === sameYearAs.split('-')[0] ? `${month} 月` : `${y} 年 ${month} 月`;
}

/** D3 確認提示：「檔案是 X 月，與你選的 Y 月不同，確定嗎？」（跨年時加年份以免看不出差異）。 */
export function periodMismatchMessage(fileYearMonth: string, selectedYearMonth: string) {
  return `檔案是 ${monthLabel(fileYearMonth, selectedYearMonth)}，與你選的 ${monthLabel(selectedYearMonth, fileYearMonth)}不同，確定嗎？`;
}
