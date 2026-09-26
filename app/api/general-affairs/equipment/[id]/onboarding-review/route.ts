import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageEquipment } from '@/lib/general-affairs/equipment/access';
import { validateUuid } from '@/lib/general-affairs/equipment/validation';

export const dynamic = 'force-dynamic';

type ReviewAction = 'approve' | 'reject';
type RejectedPhotoRequirements = {
  primary: boolean;
  label: boolean;
};

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '設備建檔複核失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function normalizeReviewAction(value: unknown): ReviewAction {
  const action = String(value || '').trim();
  if (action !== 'approve' && action !== 'reject') {
    throw new Error('複核動作錯誤');
  }
  return action;
}

function normalizeReviewNote(value: unknown, action: ReviewAction) {
  const note = String(value || '').trim();
  if (action === 'reject' && !note) {
    throw new Error('退回重拍時必須填寫原因');
  }
  if (note.length > 500) {
    throw new Error('複核說明不可超過 500 字');
  }
  return note || null;
}

function normalizeRejectedPhotoRequirements(body: any, action: ReviewAction): RejectedPhotoRequirements {
  if (action === 'approve') return { primary: false, label: false };

  const primary = body?.reject_required_primary_photo === true;
  const label = body?.reject_required_label_photo === true;
  if (!primary && !label) {
    throw new Error('退回重拍時必須選擇要重補的照片');
  }
  return { primary, label };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageEquipment()) return jsonError('沒有設備管理權限', 403);

    const equipmentId = validateUuid(params.id, '設備 id');
    const body = await request.json().catch(() => ({}));
    const action = normalizeReviewAction(body?.action);
    const note = normalizeReviewNote(body?.note, action);
    const rejectedPhotoRequirements = normalizeRejectedPhotoRequirements(body, action);

    const { data: equipment, error: loadError } = await supabase
      .from('ga_equipment')
      .select('id, onboarding_status')
      .eq('id', equipmentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!equipment) return jsonError('找不到設備資料', 404);
    if (equipment.onboarding_status !== 'PENDING_GA_REVIEW') {
      return jsonError('此設備目前不是待總務複核狀態', 409);
    }

    const nextStatus = action === 'approve'
      ? 'COMPLETED'
      : rejectedPhotoRequirements.primary
        ? 'NEEDS_EQUIPMENT_PHOTO'
        : 'NEEDS_LABEL_PHOTO';
    const reviewNote = action === 'approve' ? note || '照片正確，完成建檔。' : note;

    const { data, error } = await supabase
      .from('ga_equipment')
      .update({
        onboarding_status: nextStatus,
        onboarding_requires_primary_photo: rejectedPhotoRequirements.primary,
        onboarding_requires_label_photo: rejectedPhotoRequirements.label,
        onboarding_review_note: reviewNote,
        onboarding_reviewed_at: new Date().toISOString(),
        onboarding_reviewed_by: user.id,
        updated_by: user.id,
      })
      .eq('id', equipmentId)
      .is('deleted_at', null)
      .select(`
        *,
        store:stores(id, store_code, store_name, short_name),
        category:ga_equipment_categories(id, name, code),
        template:ga_equipment_templates(id, name, brand, model)
      `)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}
