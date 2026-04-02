import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getAuthorizedStores,
  getCurrentUserId,
  parseNumber,
  parseRocDateToIso,
  toYearMonth,
} from '../../_lib';

export const runtime = 'nodejs';

type ParsedClaimItem = {
  lineNo: number;
  healthInsuranceCode: string;
  drugName: string;
  qty: number;
};

type ParseDebugStats = {
  scannedRows: number;
  acceptedRows: number;
  skippedClinicLine: number;
  skippedEmpty: number;
  skippedHeaderOrCount: number;
  skippedNoInsuranceCode: number;
  skippedNoQty: number;
  skippedExcludedCode: number;
  skippedInvalidCode: number;
};

const EXCLUDED_HEALTH_INSURANCE_CODES = new Set([
  'A100000100',
  'B200000100',
  'A400000100',
  'B100000100',
  'B000000100',
  'A900000100',
]);

function parseClinicInfo(text: string): { code: string; name: string } | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/診所別[:：]\s*([^\s]+)\s+(.+)/);
  if (!m) return null;
  return { code: m[1].trim(), name: m[2].trim() };
}

function parsePeriod(text: string): { start: string | null; end: string | null } {
  const m = text.match(/(\d{7})\s*[~～-]\s*(\d{7})/);
  if (!m) return { start: null, end: null };
  return {
    start: parseRocDateToIso(m[1]),
    end: parseRocDateToIso(m[2]),
  };
}

function parseClinicCodeFromRange(text: string): string | null {
  const m = text.match(/診所區間[:：]\s*([0-9A-Za-z]+)/);
  return m ? m[1].trim() : null;
}

function parseClaimQty(row: any[]) {
  const qtyCols = [12, 11, 10, 9, 13]; // 優先 M/L/K，再回退 J/N
  for (const col of qtyCols) {
    const raw = row?.[col];
    const parsed = parseNumber(raw);
    if (parsed > 0) return parsed;

    // 相容格式：例如含單位、空白、逗號等字串
    const text = String(raw ?? '').replace(/,/g, '').trim();
    if (!text) continue;
    const m = text.match(/-?\d+(?:\.\d+)?/);
    if (!m) continue;
    const loose = Number(m[0]);
    if (Number.isFinite(loose) && loose > 0) return loose;
  }

  return 0;
}

function parseCodeAndNameFromColA(raw: string) {
  const text = String(raw || '').replace(/\u3000/g, ' ').trim();
  if (!text) {
    return { code: '', nameFromA: '' };
  }

  const firstToken = text.split(/\s+/)[0] || '';
  const code = firstToken
    .toUpperCase()
    .replace(/[\s'"`]/g, '')
    .replace(/[^A-Z0-9]/g, '');

  const nameFromA = text.slice(firstToken.length).trim();
  return { code, nameFromA };
}

function parseClaimDrugName(row: any[], fallbackNameFromA: string) {
  // 兼容不同匯出格式：藥品名稱可能落在 B~I 欄任一位置
  const nameCols = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const col of nameCols) {
    const value = String(row?.[col] ?? '').trim();
    if (!value) continue;
    if (/^診所別[:：]/.test(value)) continue;
    return value;
  }
  return fallbackNameFromA || '';
}

function buildRowDebugSample(rows: any[][]) {
  return rows
    .map((row, idx) => {
      const colA = String(row?.[0] || '').trim();
      const colB = String(row?.[1] || '').trim();
      const colC = String(row?.[2] || '').trim();
      const colD = String(row?.[3] || '').trim();
      const rawK = row?.[10] ?? '';
      const rawL = row?.[11] ?? '';
      const rawM = row?.[12] ?? '';
      if (!colA && !colB && String(rawK).trim() === '' && String(rawL).trim() === '' && String(rawM).trim() === '') {
        return null;
      }
      return {
        lineNo: idx + 1,
        colA,
        colB,
        colC,
        colD,
        colK: rawK,
        colL: rawL,
        colM: rawM,
        qtyParsed: parseClaimQty(row || []),
        drugNameParsed: parseClaimDrugName(row || [], parseCodeAndNameFromColA(colA).nameFromA),
        codeParsed: parseCodeAndNameFromColA(colA).code,
      };
    })
    .filter(Boolean)
    .slice(0, 25);
}

function extractItems(rows: any[][]): {
  clinicCode: string | null;
  clinicName: string | null;
  sourceB2Text: string;
  sourceB4Text: string;
  periodStart: string | null;
  periodEnd: string | null;
  items: ParsedClaimItem[];
  debugStats: ParseDebugStats;
} {
  const sourceB2Text = String(rows[1]?.[1] || '').trim();
  const sourceB4Text = String(rows[3]?.[1] || '').trim();
  const sourceB6Text = String(rows[5]?.[1] || '').trim();
  const sourceB7Text = String(rows[6]?.[1] || '').trim();

  let clinicCode: string | null = null;
  let clinicName: string | null = null;

  clinicCode = parseClinicCodeFromRange(sourceB6Text) || parseClinicCodeFromRange(sourceB7Text);

  const clinicFromB14 = parseClinicInfo(String(rows[13]?.[1] || ''));
  if (clinicFromB14) {
    if (!clinicCode) clinicCode = clinicFromB14.code;
    clinicName = clinicFromB14.name;
  }

  const period = parsePeriod(sourceB4Text);
  const items: ParsedClaimItem[] = [];
  const debugStats: ParseDebugStats = {
    scannedRows: rows.length,
    acceptedRows: 0,
    skippedClinicLine: 0,
    skippedEmpty: 0,
    skippedHeaderOrCount: 0,
    skippedNoInsuranceCode: 0,
    skippedNoQty: 0,
    skippedExcludedCode: 0,
    skippedInvalidCode: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();
    const parsedColA = parseCodeAndNameFromColA(colA);
    const drugName = parseClaimDrugName(row, parsedColA.nameFromA);
    const qty = parseClaimQty(row);
    const normalizedCode = parsedColA.code;

    const clinicLine = parseClinicInfo(colB);
    if (clinicLine) {
      clinicCode = clinicLine.code;
      clinicName = clinicLine.name;
      debugStats.skippedClinicLine += 1;
      continue;
    }

    if (!colA) {
      debugStats.skippedEmpty += 1;
      continue;
    }
    if (/^健保代號/.test(colA) || /^count\s*[:：]/i.test(colA)) {
      debugStats.skippedHeaderOrCount += 1;
      continue;
    }
    if (normalizedCode === '無健保碼') {
      debugStats.skippedNoInsuranceCode += 1;
      continue;
    }
    if (qty <= 0) {
      debugStats.skippedNoQty += 1;
      continue;
    }
    if (EXCLUDED_HEALTH_INSURANCE_CODES.has(normalizedCode)) {
      debugStats.skippedExcludedCode += 1;
      continue;
    }

    const looksLikeCode = /^[A-Z0-9]{4,}$/.test(normalizedCode);
    if (!looksLikeCode) {
      debugStats.skippedInvalidCode += 1;
      continue;
    }

    items.push({
      lineNo: i + 1,
      healthInsuranceCode: normalizedCode,
      drugName: drugName || '未提供藥品名稱',
      qty,
    });
    debugStats.acceptedRows += 1;
  }

  return {
    clinicCode,
    clinicName,
    sourceB2Text,
    sourceB4Text,
    periodStart: period.start,
    periodEnd: period.end,
    items,
    debugStats,
  };
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const form = await request.formData();
    const storeId = String(form.get('store_id') || '');
    const yearMonth = String(form.get('year_month') || '');
    const file = form.get('file') as File | null;
    const screenshot = form.get('screenshot') as File | null;

    if (!storeId || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, error: '請提供正確的門市與年月' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ success: false, error: '缺少診所自費藥檔案' }, { status: 400 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === storeId)) {
      return NextResponse.json({ success: false, error: '無此門市操作權限' }, { status: 403 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

    const parsed = extractItems(rows);
    if (!parsed.items.length) {
      return NextResponse.json(
        {
          success: false,
          error: '未解析出藥品明細，請確認檔案格式',
          debug: {
            fileName: file.name,
            sheetName: workbook.SheetNames[0] || '',
            totalRows: rows.length,
            source: {
              b2: parsed.sourceB2Text,
              b4: parsed.sourceB4Text,
              periodStart: parsed.periodStart,
              periodEnd: parsed.periodEnd,
            },
            parseStats: parsed.debugStats,
            rowSample: buildRowDebugSample(rows),
          },
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const periodStart = parsed.periodStart;
    const periodEnd = parsed.periodEnd;
    const inferredYearMonth = toYearMonth(periodStart);
    const targetYearMonth = inferredYearMonth || yearMonth;

    const { data: priceRows, error: priceError } = await admin
      .from('clinic_selfpay_price_entries')
      .select('id, health_insurance_code, product_code, member_price, cost_price')
      .eq('store_id', storeId)
      .eq('year_month', targetYearMonth);

    if (priceError) {
      return NextResponse.json({ success: false, error: priceError.message }, { status: 500 });
    }

    if (!priceRows || priceRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `尚未有${targetYearMonth.slice(5)}月成本、會員價的月度紀錄請聯繫營業部匯入`,
          debug: {
            targetYearMonth,
            sourceYearMonth: inferredYearMonth,
            selectedYearMonth: yearMonth,
            itemCount: parsed.items.length,
          },
        },
        { status: 400 }
      );
    }

    const priceMap = new Map<string, any>();
    (priceRows || []).forEach((row) => {
      priceMap.set(String(row.health_insurance_code || '').toUpperCase(), row);
    });

    const unmatchedMap = new Map<string, { code: string; name: string }>();
    parsed.items.forEach((item) => {
      const matched = priceMap.get(item.healthInsuranceCode.toUpperCase());
      if (!matched) {
        const key = `${item.healthInsuranceCode.toUpperCase()}|${item.drugName || ''}`;
        if (!unmatchedMap.has(key)) {
          unmatchedMap.set(key, {
            code: item.healthInsuranceCode,
            name: item.drugName || '未提供藥品名稱',
          });
        }
      }
    });

    if (unmatchedMap.size > 0) {
      const lines = Array.from(unmatchedMap.values()).map(
        (u) => `健保代碼${u.code} 藥品名稱:${u.name} 尚未有DPOS商品資訊，請將此訊息之藥品內容複製給營業部匯入DPOS商品主檔資訊`
      );
      return NextResponse.json(
        {
          success: false,
          error: lines.join('\n'),
          unmatched: Array.from(unmatchedMap.values()),
          debug: {
            unmatchedCount: unmatchedMap.size,
            matchedPriceRows: priceRows.length,
            targetYearMonth,
          },
        },
        { status: 400 }
      );
    }

    let screenshotPath: string | null = null;
    if (screenshot && screenshot.size > 0) {
      const ext = (screenshot.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${storeId}/${targetYearMonth}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const screenshotBytes = await screenshot.arrayBuffer();
      const { error: uploadError } = await admin.storage
        .from('clinic-selfpay-screenshots')
        .upload(path, Buffer.from(screenshotBytes), {
          contentType: screenshot.type || 'image/jpeg',
          upsert: false,
        });
      if (uploadError) {
        return NextResponse.json({ success: false, error: `截圖上傳失敗: ${uploadError.message}` }, { status: 500 });
      }
      screenshotPath = path;
    }

    const { data: batch, error: batchError } = await admin
      .from('clinic_selfpay_claim_batches')
      .insert({
        store_id: storeId,
        year_month: targetYearMonth,
        clinic_code: parsed.clinicCode,
        clinic_name: parsed.clinicName,
        period_start: periodStart,
        period_end: periodEnd,
        screenshot_path: screenshotPath,
        source_file_name: file.name,
        source_b2_text: parsed.sourceB2Text,
        source_b4_text: parsed.sourceB4Text,
        imported_by: userId,
      })
      .select('id, clinic_code, clinic_name, year_month')
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ success: false, error: batchError?.message || '建立批次失敗' }, { status: 500 });
    }

    const claimItems = parsed.items.map((item) => {
      const matched = priceMap.get(item.healthInsuranceCode.toUpperCase());
      const memberPrice = matched ? Number(matched.member_price || 0) : 0;
      const costPrice = matched ? Number(matched.cost_price || 0) : 0;
      const billingAmount = Number((memberPrice * item.qty).toFixed(2));
      const grossProfitAmount = Number(((memberPrice - costPrice) * item.qty).toFixed(2));

      return {
        batch_id: batch.id,
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

    const { error: itemError } = await admin
      .from('clinic_selfpay_claim_items')
      .insert(claimItems);

    if (itemError) {
      return NextResponse.json({ success: false, error: itemError.message }, { status: 500 });
    }

    const summary = claimItems.reduce(
      (acc, row) => {
        acc.itemCount += 1;
        acc.totalQty += Number(row.qty || 0);
        acc.totalBilling += Number(row.billing_amount || 0);
        acc.totalGrossProfit += Number(row.gross_profit_amount || 0);
        if (row.match_status === 'matched') acc.matchedCount += 1;
        else acc.unmatchedCount += 1;
        return acc;
      },
      {
        itemCount: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        totalQty: 0,
        totalBilling: 0,
        totalGrossProfit: 0,
      }
    );

    const { error: updateBatchError } = await admin
      .from('clinic_selfpay_claim_batches')
      .update({
        item_count: summary.itemCount,
        total_qty: summary.totalQty,
        total_billing_amount: summary.totalBilling,
        total_gross_profit_amount: summary.totalGrossProfit,
      })
      .eq('id', batch.id);

    if (updateBatchError) {
      return NextResponse.json({ success: false, error: updateBatchError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      clinicCode: batch.clinic_code,
      clinicName: batch.clinic_name,
      sourceYearMonth: inferredYearMonth,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
