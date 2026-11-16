import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';
import { buildImportPlan, planIsImportable, YEAR_MONTH_PATTERN } from '@/lib/performance/prescription-import';
import { loadAliasRecords, toAliasMap } from '@/lib/performance/prescription-import-server';

// 處方箋 Excel 匯入。mode=preview：只解析並回傳預覽，不寫入；mode=commit：伺服端重新解析（不信任前端資料）後整批原子寫入。
// 支援兩種格式：Google Sheet（每店三列、每月一組張數／金額）與舊的一門市一列範本，由程式自動判斷。
export async function POST(request: NextRequest) {
  try {
    const context = await getPrescriptionReportContext();
    if ('response' in context) return context.response;

    const canEdit = await hasPermission(context.user.id, 'performance.edit');
    if (!canEdit) return NextResponse.json({ error: '沒有匯入處方箋資料的權限' }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get('file');
    const selectedMonth = String(formData.get('year_month') || '');
    const mode = String(formData.get('mode') || 'preview');
    if (mode !== 'preview' && mode !== 'commit') return NextResponse.json({ error: '不支援的匯入模式' }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: '請選擇 Excel 檔案' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: '檔案不可超過 10 MB' }, { status: 400 });
    if (!YEAR_MONTH_PATTERN.test(selectedMonth)) {
      return NextResponse.json({ error: '請先選擇正確的匯入年月' }, { status: 400 });
    }

    // 預覽也接受使用者目前的選擇，這樣選完門市後畫面可以即時重算；寫入一律在 commit 時用伺服端重算的結果
    let selections: Record<string, string> = {};
    const rawSelections = formData.get('selections');
    if (typeof rawSelections === 'string' && rawSelections.trim()) {
      try {
        const parsed = JSON.parse(rawSelections);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && value) selections[key] = value;
        }
      } catch {
        return NextResponse.json({ error: '門市選擇資料格式不正確' }, { status: 400 });
      }
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    } catch {
      return NextResponse.json({ error: '無法讀取這個檔案，請確認是 Excel（.xlsx）檔' }, { status: 400 });
    }

    const aliasResult = await loadAliasRecords(context.admin);
    if (aliasResult.error) return NextResponse.json({ error: aliasResult.error }, { status: 500 });

    const built = buildImportPlan(workbook, selectedMonth, context.stores, toAliasMap(aliasResult.data), selections);
    if (!built.ok) return NextResponse.json({ success: false, error: built.error }, { status: 400 });
    const { plan } = built;
    const importable = planIsImportable(plan);

    if (mode === 'preview') {
      return NextResponse.json({ success: true, mode, plan, importable, stores: context.stores });
    }

    if (!importable) {
      const errors = plan.rows.flatMap(row => {
        const label = `${row.label}（第 ${row.rowNo} 列）`;
        if (row.errors.length) return row.errors.map(message => `${label}：${message}`);
        if (!row.store) return [`${label}：還沒有選擇對應的門市`];
        return [];
      });
      return NextResponse.json({
        success: false,
        error: plan.rows.length === 0 ? '檔案裡沒有可匯入的門市資料' : `有 ${errors.length} 項需要處理，未匯入任何資料`,
        errors: errors.slice(0, 50),
        error_count: errors.length,
      }, { status: 400 });
    }

    const reports = plan.rows.map(row => ({
      store_id: row.store!.id,
      regular_prescription_count: row.regular.count,
      regular_prescription_point_value: row.regular.points,
      chronic_prescription_count: row.chronic.count,
      chronic_prescription_point_value: row.chronic.points,
    }));
    // 只把使用者這次手動選的門市存進對照表（自動對上或對照表已有的不重存）
    const aliases = plan.format === 'gsheet'
      ? plan.rows.filter(row => row.status === 'matched').map(row => ({ alias: row.key, store_id: row.store!.id }))
      : [];

    const { data, error } = await context.admin.rpc('import_prescription_report_batch', {
      p_year_month: selectedMonth,
      p_reports: reports,
      p_aliases: aliases,
      p_user: context.user.id,
    });
    if (error) {
      console.error('[Prescription report] Excel import failed:', error);
      return NextResponse.json({ error: '處方箋 Excel 寫入失敗，資料未匯入' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      mode,
      imported: typeof data === 'number' ? data : reports.length,
      year_month: selectedMonth,
      saved_aliases: aliases.length,
      mismatch_count: plan.rows.filter(row => row.mismatches.length > 0).length,
    });
  } catch (error: any) {
    console.error('[Prescription report] Excel import error:', error);
    return NextResponse.json({ error: error.message || '處方箋 Excel 匯入失敗' }, { status: 500 });
  }
}
