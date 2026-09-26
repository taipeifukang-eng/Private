import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canUpdateSupervisorManagementLog,
  canViewSupervisorManagementLog,
} from '@/lib/supervisor-management-log/access';
import { validateRecordPayload, validateUuid } from '@/lib/supervisor-management-log/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '督導管理紀錄操作失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const caseId = validateUuid(params.id, '案件 id');
    const { data, error } = await supabase
      .from('supervisor_management_records')
      .select('*')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canUpdateSupervisorManagementLog(user.id)) return jsonError('沒有新增督導管理紀錄權限', 403);

    const caseId = validateUuid(params.id, '案件 id');
    const payload = {
      ...validateRecordPayload(await request.json()),
      case_id: caseId,
    };

    const { error } = await supabase
      .from('supervisor_management_records')
      .insert(payload);

    if (error) throw error;
    return NextResponse.json({ success: true, data: null }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
