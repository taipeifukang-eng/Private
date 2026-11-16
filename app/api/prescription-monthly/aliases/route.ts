import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';
import { normalizeAlias } from '@/lib/performance/prescription-import';
import { loadAliasRecords } from '@/lib/performance/prescription-import-server';

// 門市簡稱對照表：GET 列出（可查看業績者）、POST 新增（performance.edit）。修改與刪除見 [id]。
export async function GET() {
  const context = await getPrescriptionReportContext();
  if ('response' in context) return context.response;
  const result = await loadAliasRecords(context.admin);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

  const allowed = new Map(context.stores.map(store => [store.id, store]));
  const missingIds = Array.from(new Set(result.data.map(r => r.store_id).filter(id => !allowed.has(id))));
  const others = new Map<string, { store_code: string; store_name: string }>();
  if (missingIds.length > 0) {
    const { data } = await context.admin.from('stores').select('id, store_code, store_name').in('id', missingIds);
    (data || []).forEach(store => others.set(store.id, store));
  }
  const canEdit = await hasPermission(context.user.id, 'performance.edit');
  return NextResponse.json({
    success: true,
    can_edit: canEdit,
    aliases: result.data.map(record => {
      const store = allowed.get(record.store_id) || others.get(record.store_id);
      return {
        ...record,
        store_code: store?.store_code ?? '',
        store_name: store?.store_name ?? '（門市已不存在或已停用）',
        editable: allowed.has(record.store_id),
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const context = await getPrescriptionReportContext();
    if ('response' in context) return context.response;
    if (!(await hasPermission(context.user.id, 'performance.edit'))) {
      return NextResponse.json({ error: '沒有修改門市簡稱對照表的權限' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const alias = normalizeAlias(String(body?.alias ?? ''));
    const storeId = String(body?.store_id ?? '');
    if (!alias || alias.length > 40) return NextResponse.json({ error: '簡稱不可空白，且最多 40 字' }, { status: 400 });
    if (!context.stores.some(store => store.id === storeId)) {
      return NextResponse.json({ error: '找不到或無權限的門市' }, { status: 400 });
    }
    const { data, error } = await context.admin
      .from('prescription_store_aliases')
      .insert({ alias, store_id: storeId, created_by: context.user.id })
      .select('id, alias, store_id, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: `簡稱「${alias}」已經有對照了，一個簡稱只能對一家門市` }, { status: 409 });
      console.error('[Prescription report] alias insert failed:', error);
      return NextResponse.json({ error: '新增簡稱失敗' }, { status: 500 });
    }
    return NextResponse.json({ success: true, alias: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '新增簡稱失敗' }, { status: 500 });
  }
}
