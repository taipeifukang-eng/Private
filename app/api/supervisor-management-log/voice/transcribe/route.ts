import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canCreateSupervisorManagementLog,
  canUpdateSupervisorManagementLog,
} from '@/lib/supervisor-management-log/access';

export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
]);

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '口述轉文字失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

async function canUseVoice(userId: string) {
  return (await canCreateSupervisorManagementLog(userId)) || (await canUpdateSupervisorManagementLog(userId));
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canUseVoice(user.id)) return jsonError('沒有使用督導口述紀錄權限', 403);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonError('尚未設定 OPENAI_API_KEY，請先使用手動文字稿產生草稿。', 503);
    }

    const formData = await request.formData();
    const audio = formData.get('audio');
    if (!(audio instanceof File)) return jsonError('請上傳口述音檔', 400);
    if (audio.size <= 0) return jsonError('口述音檔不可為空', 400);
    if (audio.size > MAX_AUDIO_BYTES) return jsonError('口述音檔不可超過 20MB', 400);
    if (audio.type && !ALLOWED_AUDIO_TYPES.has(audio.type)) {
      return jsonError('不支援的音檔格式，請使用 WebM、MP3、M4A 或 WAV。', 400);
    }

    const upstreamForm = new FormData();
    upstreamForm.append('file', audio, audio.name || 'voice.webm');
    upstreamForm.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe');
    upstreamForm.append('language', 'zh');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: upstreamForm,
    });

    const json = await response.json();
    if (!response.ok) {
      return jsonError(json?.error?.message || '口述轉文字失敗', response.status >= 500 ? 502 : 400);
    }

    return NextResponse.json({
      success: true,
      data: {
        transcript: String(json.text || '').trim(),
        language: 'zh-TW',
        duration_seconds: null,
        warnings: [],
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
