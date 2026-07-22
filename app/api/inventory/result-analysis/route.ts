import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const REQUIRED_COLUMNS = [
  '店號',
  '店名',
  '盤點單號',
  '結案?',
  '品號',
  '品名',
  '單位',
  '儲位1',
  '儲位2',
  '盤差量',
  '盤差額(會員)',
  '成本',
  '單位成本',
  '庫存量',
  '庫存額',
] as const;

const PRODUCT_CATEGORY_MAP: Record<string, string> = {
  '01': '處方藥品',
  '02': '保健食品',
  '03': 'OTC藥品',
  '04': '醫美產品',
  '05': '奶製品',
  '06': '醫療器材/輔具',
  '07': '護具/護理用品/醫療用耗材/隱形眼鏡',
  '08': '生活用品',
  '09': '一般食品',
  '10': '婦嬰用品',
  '11': '寵物用品',
  '12': '尿布',
  '97': '庶務類消耗品',
  '98': '虛擬產品',
  '99': '贈品與展示品',
};
const EXCLUDED_CATEGORY_CODES = new Set(['01', '97', '98', '99']);
const INVENTORY_LEGACY_VIEW_PERMISSIONS = [
  'inventory.inventory.access',
  'inventory.inventory.view',
  'inventory.manage',
];
const INVENTORY_RESULT_ANALYSIS_OWN_VIEW_PERMISSION = 'inventory.result_analysis.view_own';
const INVENTORY_RESULT_ANALYSIS_IMPORT_PERMISSION = 'inventory.result_analysis.import';
const INVENTORY_RESULT_ANALYSIS_DELETE_PERMISSION = 'inventory.result_analysis.delete';
const DIFFERENCE_REASON_THRESHOLD_SETTING_KEY = 'difference_reason_cost_threshold';
const DEFAULT_DIFFERENCE_REASON_COST_THRESHOLD = 100;

function normalizeStoreCode(code: unknown): string {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getStoreCodeBase(code: string): string {
  const normalized = normalizeStoreCode(code);
  const match = normalized.match(/^\d+/);
  return match ? match[0] : normalized;
}

function getStr(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value).trim();
}

function getNum(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProductCode(code: unknown): string {
  const raw = String(code || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw.padStart(8, '0');
  if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '').padStart(8, '0');
  const numeric = Number(raw.replace(/,/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.trunc(numeric)).padStart(8, '0');
  }
  return raw;
}

function getProductCategory(productCode: string): { code: string; name: string } {
  const code = productCode.slice(0, 2);
  return { code, name: PRODUCT_CATEGORY_MAP[code] || '未分類' };
}

function getItemCategory(item: any): { code: string; name: string } {
  const productCode = normalizeProductCode(item.product_code || '');
  if (productCode) {
    return getProductCategory(productCode);
  }
  if (item.category_code) {
    return {
      code: item.category_code,
      name: item.category_name || PRODUCT_CATEGORY_MAP[item.category_code] || '未分類',
    };
  }
  return { code: 'NA', name: '未分類' };
}

function isSummaryRow(row: Record<string, unknown>): boolean {
  const productCode = getStr(row, '品號');
  const productName = getStr(row, '品名');
  const unit = getStr(row, '單位');
  const storage1 = getStr(row, '儲位1');
  const storage2 = getStr(row, '儲位2');
  const hasSummaryAmount = getNum(row, '盤差額(會員)') !== 0 || getNum(row, '成本') !== 0;
  return !productCode && !productName && !unit && !storage1 && !storage2 && hasSummaryAmount;
}

function isValidYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getFileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || '未命名盤點結果';
}

function parseWorksheetRows(sheet: XLSX.WorkSheet): { rows: Record<string, unknown>[]; actualColumns: string[]; headerRowIndex: number } {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const normalizedRequired = REQUIRED_COLUMNS.map((col) => String(col).trim());

  const headerRowIndex = rawRows.findIndex((row) => {
    const headers = (row || []).map((cell) => String(cell ?? '').trim());
    return normalizedRequired.every((col) => headers.includes(col));
  });

  if (headerRowIndex < 0) {
    const firstNonEmptyRow = rawRows.find((row) => (row || []).some((cell) => String(cell ?? '').trim() !== '')) || [];
    return {
      rows: [],
      actualColumns: firstNonEmptyRow.map((cell) => String(cell ?? '').trim()).filter(Boolean),
      headerRowIndex: -1,
    };
  }

  const actualColumns = (rawRows[headerRowIndex] || []).map((cell) => String(cell ?? '').trim());
  const rows = rawRows.slice(headerRowIndex + 1)
    .filter((row) => (row || []).some((cell) => String(cell ?? '').trim() !== ''))
    .map((row, dataIndex) => {
      const record: Record<string, unknown> = { __excelRowNumber: headerRowIndex + dataIndex + 2 };
      actualColumns.forEach((col, index) => {
        if (col) record[col] = row?.[index] ?? null;
      });
      return record;
    });

  return { rows, actualColumns: actualColumns.filter(Boolean), headerRowIndex };
}

async function hasAnyInventoryLegacyViewPermission(userId: string): Promise<boolean> {
  for (const permissionCode of INVENTORY_LEGACY_VIEW_PERMISSIONS) {
    if (await hasPermission(userId, permissionCode)) return true;
  }
  return false;
}

async function hasInventoryResultAnalysisUnrestrictedPermission(userId: string): Promise<boolean> {
  return (await hasPermission(userId, INVENTORY_RESULT_ANALYSIS_IMPORT_PERMISSION))
    || (await hasPermission(userId, INVENTORY_RESULT_ANALYSIS_DELETE_PERMISSION));
}

async function isInventoryResultAnalysisAdminLike(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.role === 'admin') return true;

  const { data: userRoles, error } = await admin
    .from('user_roles')
    .select('is_active, expires_at, role:roles(code)')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error || !userRoles) return false;

  const now = Date.now();
  return userRoles.some((row: any) => {
    const roleCode = row?.role?.code;
    const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : null;
    const notExpired = expiresAt === null || expiresAt > now;
    return notExpired && ['admin', 'system_admin', 'admin_role'].includes(roleCode);
  });
}

async function isInventoryResultAnalysisFieldRole(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data: profile } = await admin
    .from('profiles')
    .select('role, job_title')
    .eq('id', userId)
    .maybeSingle();

  const role = String(profile?.role || '');
  const jobTitle = String(profile?.job_title || '');
  return role === 'store_manager'
    || role === 'supervisor'
    || role === 'area_manager'
    || jobTitle.includes('店長')
    || jobTitle.includes('督導');
}

async function getAssignedInventoryResultStoreIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from('store_managers')
    .select('store_id')
    .eq('user_id', userId);

  if (error) throw error;

  return Array.from(new Set((data || []).map((row: any) => row.store_id).filter(Boolean)));
}

async function getInventoryResultAnalysisAccess(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<{ allowed: boolean; scope: 'all' | 'own'; storeIds: string[] }> {
  const storeIds = await getAssignedInventoryResultStoreIds(admin, userId);
  const isAdminLike = await isInventoryResultAnalysisAdminLike(admin, userId);
  const isFieldRole = await isInventoryResultAnalysisFieldRole(admin, userId);
  const hasUnrestrictedPermission = await hasInventoryResultAnalysisUnrestrictedPermission(userId);
  const canViewOwn = await hasPermission(userId, INVENTORY_RESULT_ANALYSIS_OWN_VIEW_PERMISSION);
  const hasLegacyView = await hasAnyInventoryLegacyViewPermission(userId);

  if (isAdminLike || (hasUnrestrictedPermission && !isFieldRole && storeIds.length === 0)) {
    return { allowed: true, scope: 'all', storeIds: [] };
  }

  // 店長與督導都透過 store_managers 指派門市控管可見範圍。
  // 即使他們同時有舊盤點或匯入/刪除權限，也不得因此看到全部門市的盤點結果。
  if (storeIds.length > 0 && (canViewOwn || hasLegacyView || hasUnrestrictedPermission)) {
    return { allowed: true, scope: 'own', storeIds };
  }

  if (canViewOwn) {
    return { allowed: true, scope: 'own', storeIds: [] };
  }

  if (isFieldRole && (hasLegacyView || hasUnrestrictedPermission)) {
    return { allowed: true, scope: 'own', storeIds: [] };
  }

  // 保留給未綁定門市的盤點後台人員，避免舊 full-view 權限完全失效。
  if (hasLegacyView) {
    return { allowed: true, scope: 'all', storeIds: [] };
  }

  return { allowed: false, scope: 'own', storeIds: [] };
}

async function canImportInventoryResultAnalysis(userId: string): Promise<boolean> {
  return (await hasAnyInventoryLegacyViewPermission(userId))
    || (await hasPermission(userId, INVENTORY_RESULT_ANALYSIS_IMPORT_PERMISSION));
}

async function canDeleteInventoryResultAnalysis(userId: string): Promise<boolean> {
  return (await hasAnyInventoryLegacyViewPermission(userId))
    || (await hasPermission(userId, INVENTORY_RESULT_ANALYSIS_DELETE_PERMISSION));
}

async function canManageDifferenceReasonThreshold(userId: string): Promise<boolean> {
  return hasPermission(userId, 'inventory.manage');
}

async function getDifferenceReasonCostThreshold(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const { data, error } = await admin
    .from('inventory_result_settings')
    .select('value')
    .eq('key', DIFFERENCE_REASON_THRESHOLD_SETTING_KEY)
    .maybeSingle();

  if (error) {
    const message = String(error.message || '');
    if (message.includes('inventory_result_settings') || message.includes('schema cache')) {
      return DEFAULT_DIFFERENCE_REASON_COST_THRESHOLD;
    }
    throw error;
  }

  const amount = Number((data?.value as any)?.amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_DIFFERENCE_REASON_COST_THRESHOLD;
}

async function fetchInventoryResultItems(admin: ReturnType<typeof createAdminClient>, batchId: string): Promise<any[]> {
  const pageSize = 1000;
  const rows: any[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await admin
      .from('inventory_result_items')
      .select('*')
      .eq('batch_id', batchId)
      .order('product_code', { ascending: true, nullsFirst: false })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function getNonExcludedDiffSummary(items: any[]) {
  return items.reduce((summary, item) => {
    const { code } = getItemCategory(item);
    if (EXCLUDED_CATEGORY_CODES.has(code) || (Number(item.difference_qty) || 0) === 0) {
      return summary;
    }

    const differenceQty = Number(item.difference_qty) || 0;
    const cost = Number(item.cost) || 0;
    summary.non_excluded_diff_count += 1;
    summary.non_excluded_diff_net_cost_total += cost;
    if (differenceQty > 0) summary.non_excluded_diff_positive_cost_total += cost;
    if (differenceQty < 0) summary.non_excluded_diff_negative_cost_total += cost;
    return summary;
  }, {
    non_excluded_diff_count: 0,
    non_excluded_diff_positive_cost_total: 0,
    non_excluded_diff_negative_cost_total: 0,
    non_excluded_diff_net_cost_total: 0,
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const admin = createAdminClient();
    const access = await getInventoryResultAnalysisAccess(admin, user.id);
    const canManageSettings = await canManageDifferenceReasonThreshold(user.id);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: '無查看盤點結果分析報表權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const storeKeyword = (searchParams.get('store') || '').trim();
    const orderKeyword = (searchParams.get('order_no') || '').trim();
    const yearMonth = (searchParams.get('year_month') || '').trim();
    const batchId = searchParams.get('batch_id') || '';

    let q = admin
      .from('inventory_result_batches')
      .select(`
        *,
        store:stores(id, store_code, store_name)
      `)
      .order('imported_at', { ascending: false })
      .limit(50);

    if (access.scope === 'own') {
      if (access.storeIds.length === 0) {
        return NextResponse.json({
          success: true,
          batches: [],
          items: [],
          category_summary: [],
          non_excluded_summary: {
            positive_cost_total: 0,
            negative_cost_total: 0,
            net_cost_total: 0,
            stock_amount_total: 0,
            row_count: 0,
          },
          excluded_category_codes: Array.from(EXCLUDED_CATEGORY_CODES),
          selected_batch_id: '',
          access_scope: access.scope,
          difference_reason_cost_threshold: await getDifferenceReasonCostThreshold(admin),
          can_manage_difference_reason_threshold: canManageSettings,
        });
      }
      q = q.in('store_id', access.storeIds);
    }
    if (batchId) q = q.eq('id', batchId);
    if (yearMonth) q = q.eq('year_month', yearMonth);
    if (orderKeyword) q = q.ilike('inventory_order_no', `%${orderKeyword}%`);
    if (storeKeyword) {
      q = q.or(`store_code.ilike.%${storeKeyword}%,store_name.ilike.%${storeKeyword}%`);
    }

    const { data: batches, error: batchError } = await q;
    if (batchError) {
      return NextResponse.json({ success: false, error: batchError.message }, { status: 500 });
    }

    const batchRows = batches || [];
    const batchSummaries = new Map<string, ReturnType<typeof getNonExcludedDiffSummary>>();
    await Promise.all(batchRows.map(async (batch: any) => {
      const batchItems = await fetchInventoryResultItems(admin, batch.id);
      batchSummaries.set(batch.id, getNonExcludedDiffSummary(batchItems));
    }));
    const enrichedBatches = batchRows.map((batch: any) => ({
      ...batch,
      ...(batchSummaries.get(batch.id) || getNonExcludedDiffSummary([])),
    }));

    const selectedBatchId =
      batchId && enrichedBatches.some((batch: any) => batch.id === batchId)
        ? batchId
        : enrichedBatches?.[0]?.id || '';
    let items: any[] = [];
    let allItemsForAnalysis: any[] = [];

    if (selectedBatchId) {
      items = await fetchInventoryResultItems(admin, selectedBatchId);
      allItemsForAnalysis = items;
    }

    const categorySummaryMap = new Map<string, any>();
    const nonExcludedSummary = {
      positive_cost_total: 0,
      negative_cost_total: 0,
      net_cost_total: 0,
      stock_amount_total: 0,
      row_count: 0,
    };

    allItemsForAnalysis.forEach((item: any) => {
      const category = getItemCategory(item);
      const code = category.code || 'NA';
      const differenceQty = Number(item.difference_qty) || 0;
      const cost = Number(item.cost) || 0;
      const stockAmount = Number(item.stock_amount) || 0;
      const current = categorySummaryMap.get(code) || {
        category_code: code,
        category_name: category.name || '未分類',
        row_count: 0,
        total_difference_qty: 0,
        positive_cost_total: 0,
        negative_cost_total: 0,
        net_cost_total: 0,
        stock_amount_total: 0,
        total_difference_amount_member: 0,
        shortage_count: 0,
        surplus_count: 0,
      };
      current.row_count += 1;
      current.total_difference_qty += differenceQty;
      current.net_cost_total += cost;
      current.stock_amount_total += stockAmount;
      if (differenceQty > 0) current.positive_cost_total += cost;
      if (differenceQty < 0) current.negative_cost_total += cost;
      current.total_difference_amount_member += Number(item.difference_amount_member) || 0;
      if (differenceQty < 0) current.shortage_count += 1;
      if (differenceQty > 0) current.surplus_count += 1;
      categorySummaryMap.set(code, current);

      if (!EXCLUDED_CATEGORY_CODES.has(code)) {
        nonExcludedSummary.row_count += 1;
        nonExcludedSummary.net_cost_total += cost;
        nonExcludedSummary.stock_amount_total += stockAmount;
        if (differenceQty > 0) nonExcludedSummary.positive_cost_total += cost;
        if (differenceQty < 0) nonExcludedSummary.negative_cost_total += cost;
      }
    });

    const categorySummary = Array.from(categorySummaryMap.values())
      .sort((a, b) => Math.abs(Number(b.net_cost_total) || 0) - Math.abs(Number(a.net_cost_total) || 0));

    return NextResponse.json({
      success: true,
      batches: enrichedBatches,
      items,
      category_summary: categorySummary,
      non_excluded_summary: nonExcludedSummary,
      excluded_category_codes: Array.from(EXCLUDED_CATEGORY_CODES),
      selected_batch_id: selectedBatchId,
      access_scope: access.scope,
      difference_reason_cost_threshold: await getDifferenceReasonCostThreshold(admin),
      can_manage_difference_reason_threshold: canManageSettings,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const admin = createAdminClient();
    const body = await request.json();
    const action = String(body?.action || '').trim();

    if (action === 'update_threshold') {
      if (!(await canManageDifferenceReasonThreshold(user.id))) {
        return NextResponse.json({ success: false, error: '無調整盤差原因門檻權限' }, { status: 403 });
      }

      const amount = Number(body?.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ success: false, error: '門檻需為 0 以上數字' }, { status: 400 });
      }

      const { error } = await admin
        .from('inventory_result_settings')
        .upsert({
          key: DIFFERENCE_REASON_THRESHOLD_SETTING_KEY,
          value: { amount },
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, difference_reason_cost_threshold: amount });
    }

    if (action === 'update_reason') {
      const itemId = String(body?.item_id || '').trim();
      const reason = String(body?.reason || '').trim();
      if (!itemId) {
        return NextResponse.json({ success: false, error: '缺少明細 ID' }, { status: 400 });
      }

      const access = await getInventoryResultAnalysisAccess(admin, user.id);
      if (!access.allowed) {
        return NextResponse.json({ success: false, error: '無編輯盤差原因權限' }, { status: 403 });
      }

      const { data: item, error: itemError } = await admin
        .from('inventory_result_items')
        .select('id, store_id')
        .eq('id', itemId)
        .single();

      if (itemError || !item) {
        return NextResponse.json({ success: false, error: '找不到盤點明細' }, { status: 404 });
      }

      if (access.scope === 'own' && !access.storeIds.includes(item.store_id)) {
        return NextResponse.json({ success: false, error: '無此門市盤點明細編輯權限' }, { status: 403 });
      }

      const { data: updated, error: updateError } = await admin
        .from('inventory_result_items')
        .update({
          difference_reason: reason || null,
          difference_reason_updated_by: user.id,
          difference_reason_updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .select('id, difference_reason, difference_reason_updated_at')
        .single();

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, item: updated });
    }

    if (action === 'bulk_update_reasons') {
      const batchId = String(body?.batch_id || '').trim();
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (!batchId) {
        return NextResponse.json({ success: false, error: '缺少盤點批次 ID' }, { status: 400 });
      }
      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: '匯入檔案無可更新資料' }, { status: 400 });
      }

      const access = await getInventoryResultAnalysisAccess(admin, user.id);
      if (!access.allowed) {
        return NextResponse.json({ success: false, error: '無編輯盤差原因權限' }, { status: 403 });
      }

      const { data: batch, error: batchError } = await admin
        .from('inventory_result_batches')
        .select('id, store_id')
        .eq('id', batchId)
        .single();

      if (batchError || !batch) {
        return NextResponse.json({ success: false, error: '找不到盤點批次' }, { status: 404 });
      }

      if (access.scope === 'own' && !access.storeIds.includes(batch.store_id)) {
        return NextResponse.json({ success: false, error: '無此門市盤點明細編輯權限' }, { status: 403 });
      }

      const reasonByProductCode = new Map<string, string>();
      rows.forEach((row: any) => {
        const productCode = normalizeProductCode(row?.product_code);
        if (!productCode) return;
        reasonByProductCode.set(productCode, String(row?.difference_reason || '').trim());
      });

      if (reasonByProductCode.size === 0) {
        return NextResponse.json({ success: false, error: '匯入檔案缺少有效品號' }, { status: 400 });
      }

      const updatedItems: any[] = [];
      for (const [productCode, reason] of Array.from(reasonByProductCode.entries())) {
        const { data: updated, error: updateError } = await admin
          .from('inventory_result_items')
          .update({
            difference_reason: reason || null,
            difference_reason_updated_by: user.id,
            difference_reason_updated_at: new Date().toISOString(),
          })
          .eq('batch_id', batchId)
          .eq('product_code', productCode)
          .select('id, product_code, difference_reason, difference_reason_updated_at');

        if (updateError) {
          return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }
        updatedItems.push(...(updated || []));
      }

      return NextResponse.json({
        success: true,
        updated_count: updatedItems.length,
        updated_items: updatedItems,
      });
    }

    return NextResponse.json({ success: false, error: '未知的更新動作' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    if (!(await canImportInventoryResultAnalysis(user.id))) {
      return NextResponse.json({ success: false, error: '無匯入盤點結果分析報表權限' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const yearMonth = String(formData.get('year_month') || '').trim();
    const requestedOrderNo = String(formData.get('inventory_order_no') || '').trim();
    if (!file) return NextResponse.json({ success: false, error: '缺少匯入檔案' }, { status: 400 });
    const sourceFileName = file.name.trim();
    if (!sourceFileName) {
      return NextResponse.json({ success: false, error: '檔案名稱不可為空' }, { status: 400 });
    }
    if (!isValidYearMonth(yearMonth)) {
      return NextResponse.json({ success: false, error: '請選擇正確的資料年月（YYYY-MM）' }, { status: 400 });
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const { rows, actualColumns, headerRowIndex } = parseWorksheetRows(sheet);

    const missingColumns = REQUIRED_COLUMNS.filter((col) => !actualColumns.includes(col));
    if (headerRowIndex < 0 || missingColumns.length > 0) {
      return NextResponse.json({
        success: false,
        error: `缺少必要欄位：${missingColumns.join('、')}`,
        actualColumns,
      }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Excel 無資料' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: stores, error: storesError } = await admin
      .from('stores')
      .select('id, store_code, store_name')
      .eq('is_active', true);

    if (storesError) {
      return NextResponse.json({ success: false, error: storesError.message }, { status: 500 });
    }

    const storeCodeMap = new Map<string, any>();
    const storeBaseMap = new Map<string, any[]>();
    (stores || []).forEach((store: any) => {
      const code = normalizeStoreCode(store.store_code);
      const base = getStoreCodeBase(code);
      storeCodeMap.set(code, store);
      storeBaseMap.set(base, [...(storeBaseMap.get(base) || []), store]);
    });
    storeBaseMap.forEach((candidates, base) => {
      candidates.sort((a: any, b: any) => {
        const aCode = normalizeStoreCode(a.store_code);
        const bCode = normalizeStoreCode(b.store_code);
        const aIsBase = aCode === base;
        const bIsBase = bCode === base;
        if (aIsBase !== bIsBase) return aIsBase ? -1 : 1;
        return aCode.localeCompare(bCode, 'en');
      });
    });

    const resolveStoreByCode = (rawCode: string) => {
      const normalizedCode = normalizeStoreCode(rawCode);
      return storeCodeMap.get(normalizedCode)
        || (storeBaseMap.get(getStoreCodeBase(normalizedCode)) || [])[0]
        || null;
    };

    const groups = new Map<string, { store: any; orderNo: string; rows: Record<string, unknown>[] }>();
    const errors: string[] = [];
    let lastStoreCode = '';
    let lastOrderNo = '';
    const fallbackOrderNo = requestedOrderNo || getFileBaseName(file.name);

    rows.forEach((row, index) => {
      const rowLabel = `第 ${Number(row.__excelRowNumber) || index + headerRowIndex + 2} 列`;
      if (isSummaryRow(row)) {
        return;
      }

      const rawStoreCode = getStr(row, '店號') || lastStoreCode;
      const orderNo = getStr(row, '盤點單號') || lastOrderNo || fallbackOrderNo;

      if (!rawStoreCode) {
        errors.push(`${rowLabel}：缺少店號`);
        return;
      }

      const store = resolveStoreByCode(rawStoreCode);
      if (!store) {
        errors.push(`${rowLabel}：找不到門市店號「${rawStoreCode}」`);
        return;
      }

      lastStoreCode = rawStoreCode;
      lastOrderNo = orderNo;

      const key = `${store.id}|${orderNo}`;
      const group = groups.get(key) || { store, orderNo, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    });

    if (groups.size === 0) {
      return NextResponse.json({ success: false, error: `沒有可匯入資料。${errors.join('；')}` }, { status: 400 });
    }

    const importedBatches: any[] = [];

    const { data: replacedBatches, error: existingBatchError } = await admin
      .from('inventory_result_batches')
      .select('id')
      .eq('year_month', yearMonth)
      .eq('source_file_name', sourceFileName);

    if (existingBatchError) {
      return NextResponse.json({ success: false, error: existingBatchError.message }, { status: 500 });
    }

    if ((replacedBatches || []).length > 0) {
      const { error: deleteExistingError } = await admin
        .from('inventory_result_batches')
        .delete()
        .eq('year_month', yearMonth)
        .eq('source_file_name', sourceFileName);

      if (deleteExistingError) {
        return NextResponse.json({ success: false, error: deleteExistingError.message }, { status: 500 });
      }
    }

    for (const group of Array.from(groups.values())) {
      const rowCount = group.rows.length;
      const totalDifferenceQty = group.rows.reduce((sum: number, row: Record<string, unknown>) => sum + getNum(row, '盤差量'), 0);
      const totalDifferenceAmount = group.rows.reduce((sum: number, row: Record<string, unknown>) => sum + getNum(row, '盤差額(會員)'), 0);
      const totalCost = group.rows.reduce((sum: number, row: Record<string, unknown>) => sum + getNum(row, '成本'), 0);
      const shortageCount = group.rows.filter((row: Record<string, unknown>) => getNum(row, '盤差量') < 0).length;
      const surplusCount = group.rows.filter((row: Record<string, unknown>) => getNum(row, '盤差量') > 0).length;
      const zeroDifferenceCount = group.rows.filter((row: Record<string, unknown>) => getNum(row, '盤差量') === 0).length;
      const closedTexts = Array.from(new Set(group.rows.map((row: Record<string, unknown>) => getStr(row, '結案?')).filter(Boolean)));

      const { data: batch, error: batchError } = await admin
        .from('inventory_result_batches')
        .insert({
          store_id: group.store.id,
          year_month: yearMonth,
          store_code: group.store.store_code,
          store_name: getStr(group.rows[0], '店名') || group.store.store_name,
          inventory_order_no: group.orderNo,
          closed_text: closedTexts.join('、') || null,
          source_file_name: sourceFileName,
          imported_by: user.id,
          imported_at: new Date().toISOString(),
          row_count: rowCount,
          total_difference_qty: totalDifferenceQty,
          total_difference_amount_member: totalDifferenceAmount,
          total_cost: totalCost,
          shortage_count: shortageCount,
          surplus_count: surplusCount,
          zero_difference_count: zeroDifferenceCount,
        })
        .select('id, store_code, store_name, inventory_order_no')
        .single();

      if (batchError) {
        return NextResponse.json({ success: false, error: batchError.message }, { status: 500 });
      }

      const itemPayload = group.rows.map((row: Record<string, unknown>, index: number) => {
        const productCode = normalizeProductCode(getStr(row, '品號'));
        const category = getProductCategory(productCode);
        return {
          batch_id: batch.id,
          store_id: group.store.id,
          row_number: index + 2,
          closed_text: getStr(row, '結案?') || null,
          product_code: productCode,
          product_name: getStr(row, '品名'),
          unit: getStr(row, '單位') || null,
          storage_location_1: getStr(row, '儲位1') || null,
          storage_location_2: getStr(row, '儲位2') || null,
          difference_qty: getNum(row, '盤差量'),
          difference_amount_member: getNum(row, '盤差額(會員)'),
          cost: getNum(row, '成本'),
          unit_cost: getNum(row, '單位成本'),
          stock_qty: getNum(row, '庫存量'),
          stock_amount: getNum(row, '庫存額'),
          category_code: category.code,
          category_name: category.name,
          raw_data: row,
        };
      });

      const { error: itemsError } = await admin
        .from('inventory_result_items')
        .insert(itemPayload);

      if (itemsError) {
        return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
      }

      importedBatches.push({ ...batch, row_count: rowCount });
    }

    return NextResponse.json({
      success: true,
      imported_batches: importedBatches.length,
      imported_rows: rows.length - errors.length,
      replaced_batches: (replacedBatches || []).length,
      batches: importedBatches,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    if (!(await canDeleteInventoryResultAnalysis(user.id))) {
      return NextResponse.json({ success: false, error: '無刪除盤點結果分析報表權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const batchId = (searchParams.get('batch_id') || '').trim();
    if (!batchId) {
      return NextResponse.json({ success: false, error: '缺少匯入批次 ID' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: batch, error: batchError } = await admin
      .from('inventory_result_batches')
      .select('id')
      .eq('id', batchId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ success: false, error: '找不到匯入批次' }, { status: 404 });
    }

    const { error: deleteError } = await admin
      .from('inventory_result_batches')
      .delete()
      .eq('id', batchId);

    if (deleteError) {
      return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
