import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';
import { normalizeAlias } from '@/lib/performance/prescription-import';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(id: string) {
  const context = await getPrescriptionReportContext();
  if ('response' in context) return { response: context.response };
  if (!(await hasPermission(context.user.id, 'performance.edit'))) {
    return { response: NextResponse.json({ error: '沒有修改門市簡稱對照表的權限' }, { status: 403 }) };
  }
  if (!UUID.test(id)) return { response: NextResponse.json({ error: '簡稱編號不正確' }, { status: 400 }) };
  const { data: existing, error } = await context.admin
    .from('prescription_store_aliases').select('id, alias, store_id').eq('id', id).maybeSingle();
  if (error) return { response: NextResponse.json({ error: '讀取簡稱失敗' }, { status: 500 }) };
  if (!existing) return { response: NextResponse.json({ error: '找不到這個簡稱' }, { status: 404 }) };
  // 只能動自己門市範圍內的簡稱
  if (!context.stores.some(store => store.id === existing.store_id)) {
    return { response: NextResponse.json({ error: '這個簡稱對應的門市不在你的管理範圍內' }, { status: 403 }) };
  }
  return { context, existing };
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authorize(params.id);
    if ('response' in auth) return auth.response;
    const { context } = auth;
    const body = await request.json().catch(() => null);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body?.alias !== undefined) {
      const alias = normalizeAlias(String(body.alias));
      if (!alias || alias.length > 40) return NextResponse.json({ error: '簡稱不可空白，且最多 40 字' }, { status: 400 });
      update.alias = alias;
    }
    if (body?.store_id !== undefined) {
      if (!context.stores.some(store => store.id === String(body.store_id))) {
        return NextResponse.json({ error: '找不到或無權限的門市' }, { status: 400 });
      }
      update.store_id = String(body.store_id);
    }
    if (Object.keys(update).length === 1) return NextResponse.json({ error: '沒有要修改的內容' }, { status: 400 });
    const { error } = await context.admin.from('prescription_store_aliases').update(update).eq('id', params.id);
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: '這個簡稱已經有對照了，一個簡稱只能對一家門市' }, { status: 409 });
      console.error('[Prescription report] alias update failed:', error);
      return NextResponse.json({ error: '修改簡稱失敗' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '修改簡稱失敗' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authorize(params.id);
    if ('response' in auth) return auth.response;
    const { error } = await auth.context.admin.from('prescription_store_aliases').delete().eq('id', params.id);
    if (error) {
      console.error('[Prescription report] alias delete failed:', error);
      return NextResponse.json({ error: '刪除簡稱失敗' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '刪除簡稱失敗' }, { status: 500 });
  }
}
