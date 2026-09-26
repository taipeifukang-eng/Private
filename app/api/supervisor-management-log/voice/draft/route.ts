import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canCreateSupervisorManagementLog,
  canUpdateSupervisorManagementLog,
} from '@/lib/supervisor-management-log/access';
import {
  buildLocalDraft,
  getBlockingFields,
  matchEntities,
  normalizeDraft,
  normalizeTranscript,
  parseDraftWithOpenAI,
  type EntityMention,
  type VoiceDraftMode,
} from '@/lib/supervisor-management-log/voice';

export const dynamic = 'force-dynamic';

const MODES = new Set(['RECORD_DRAFT', 'FOLLOWUP_DRAFT']);

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '口述草稿產生失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

async function canUseVoice(userId: string) {
  return (await canCreateSupervisorManagementLog(userId)) || (await canUpdateSupervisorManagementLog(userId));
}

function parseMode(value: unknown): VoiceDraftMode {
  const mode = String(value || 'RECORD_DRAFT').trim().toUpperCase();
  if (!MODES.has(mode)) throw new Error('口述草稿模式錯誤');
  return mode as VoiceDraftMode;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canUseVoice(user.id)) return jsonError('沒有使用督導口述紀錄權限', 403);

    const body = await request.json();
    const transcript = normalizeTranscript(body?.transcript);
    const mode = parseMode(body?.mode);

    const { data: categories, error: categoryError } = await supabase
      .from('supervisor_management_categories')
      .select('code, name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .limit(100);
    if (categoryError) throw categoryError;

    let aiResult = null;
    const warnings: string[] = [];
    try {
      aiResult = await parseDraftWithOpenAI({
        transcript,
        mode,
        categories: categories || [],
      });
      if (!aiResult) warnings.push('OPENAI_API_KEY 未設定，已使用本機規則產生草稿。');
    } catch (error) {
      warnings.push(error instanceof Error ? `AI 草稿產生失敗，已改用本機規則：${error.message}` : 'AI 草稿產生失敗，已改用本機規則。');
    }

    const fallback = buildLocalDraft(transcript, mode);
    const source = aiResult || fallback;
    const draft = normalizeDraft(source.draft, mode, transcript);
    const aiMentions = Array.isArray(source.entity_mentions)
      ? source.entity_mentions as EntityMention[]
      : [];
    const entityMatches = await matchEntities(supabase, transcript, aiMentions);
    const blockingFields = getBlockingFields(draft, entityMatches);

    return NextResponse.json({
      success: true,
      data: {
        draft,
        entity_matches: entityMatches,
        review_required: true,
        blocking_fields: blockingFields,
        confirmation_questions: source.confirmation_questions || fallback.confirmation_questions || [],
        warnings: [...warnings, ...(source.warnings || [])],
        ai_provider: aiResult ? 'OPENAI' : 'LOCAL_RULE_FALLBACK',
      },
    });
  } catch (error) {
    return jsonError(error, error instanceof Error && /權限|未登入|請輸入|錯誤/.test(error.message) ? 400 : 500);
  }
}
