import { api } from "../api";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../../../lib/supervisor-management-log/voice-ai-rules";

// M6 W33：督導語音上傳包裝。音檔只在這個瀏覽器的記憶體內暫存（重試用），上傳後由伺服端轉文字即丟，不存檔。
export type VoiceTranscribeResult = {
  transcript: string | null;
  ai_provider: string;
  /** AI 不可用（本月額度用完、沒設定、服務失敗）時為 true，畫面改用手動文字稿（E7）。 */
  fallback: boolean;
  fallback_reason?: "CAP_REACHED" | "NO_KEY" | "AI_ERROR" | "NO_CONSENT";
  message?: string;
};

export type VoiceDraft = {
  record_type: string; record_date: string; observation: string; judgment: string; action_summary: string; action_options: string[];
  requires_follow_up: boolean; follow_up_date: string | null; follow_up_method: string | null; expected_result: string | null; confidence: string; notes: string | null;
};
/** 草稿審核畫面按「套用」時交給紀錄表單的內容（仍要人工按儲存）。 */
export type VoiceApply = { draft: VoiceDraft; voice: { transcript: string; ai_provider: "OPENAI" | "LOCAL_RULE_FALLBACK" } };

/** 上傳前的本機檢查（伺服端仍會再檢查一次）。回傳錯誤文字或 null。 */
export function checkVoiceBlob(blob: Blob, seconds: number): string | null {
  if (!blob.size) return "沒有錄到聲音，請重新錄音";
  if (blob.size > MAX_AUDIO_BYTES) return "錄音超過 10MB，請分段錄音或改用手動文字稿";
  if (seconds > MAX_AUDIO_SECONDS + 3) return "錄音超過 10 分鐘，請分段錄音或改用手動文字稿";
  return null;
}
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/m4a": "m4a", "audio/x-m4a": "m4a" };
export const voiceFileName = (type: string) => `supervisor-voice.${EXT[(type || "").split(";")[0].toLowerCase()] || "webm"}`;

/** 上傳音檔轉成文字稿。轉文字可能要一段時間，逾時放寬到 2 分鐘（預設 30 秒不夠）。 */
export async function uploadVoice(blob: Blob, seconds: number): Promise<VoiceTranscribeResult> {
  const form = new FormData();
  form.append("audio", blob, voiceFileName(blob.type));
  form.append("duration_seconds", String(Math.round(seconds)));
  const res = await api<{ data: VoiceTranscribeResult }>("supervisor-management/voice/transcribe", { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  return res.data;
}
