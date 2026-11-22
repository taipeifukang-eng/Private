// M6 W33 督導語音與 AI 摘要的共用規則：純函式，無相依；月份一律以 Asia/Taipei 計算，現在時間由呼叫端注入（方便單元測試）。
//
// 老闆 2026-11-22 問卷決定（取代 Z5「金額待提供」）：
//   - 每月 OpenAI 費用上限 = 30 美元（以美元存放，不換匯；系統管理員可在頁面調整）。
//   - 估算費用達 80% 通知系統管理員；達 100% 自動停用 AI，退回手動文字稿與本機規則，再通知系統管理員。
//   - 只通知系統管理員（首頁提醒）。計數每月 1 日（台北時間）歸零（以月份鍵分開累計，不需要排程）。
//   - 費用「每次呼叫事前估算」並偏保守（一律無條件進位）；絕不呼叫 OpenAI 帳單 API。
// E5 告知與同意、E6 逐字稿可見範圍、E7 失敗退回與錄音上限也在這裡定義常數與驗證。

export const AI_SCOPE = "supervisor_voice";
export const DEFAULT_MONTHLY_CAP_USD = 30;
export const MAX_MONTHLY_CAP_USD = 10000;
/** 達此比例通知系統管理員（80%）。 */
export const WARN_PERCENT = 80;

/** E7：錄音上限約 10 分鐘或 10MB（兩者任一超過就拒絕）。 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 600;
/** 瀏覽器計時與實際長度可能差幾秒，容許少量誤差。 */
export const AUDIO_SECONDS_TOLERANCE = 3;
export const MAX_TRANSCRIPT_LENGTH = 6000;
/** 音檔格式維持 WebM、MP3、M4A、WAV（與舊版相同，加上 MediaRecorder 在 Safari 會產生的 audio/mp4）。 */
export const ALLOWED_AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a"];

export const FALLBACK_LABEL = "這份草稿未經 AI 整理";
/** E5：告知文字版本；告知內容改了就要換版本，使用者需要重新同意。 */
export const NOTICE_VERSION = "2026-11-22";
export const NOTICE_TEXT = [
  "錄音會暫存在這台裝置，上傳後送到 OpenAI 轉成文字，音檔不會存在富康系統，也不會保存 OpenAI 的原始回應。",
  "轉出的逐字稿可能含有門市與員工姓名，會再送到 OpenAI 整理成管理紀錄草稿；這屬於個人資料外送，請只錄與管理紀錄相關的內容。",
  "逐字稿會保存在管理紀錄中，只有建立者與管理者看得到。",
  "AI 草稿不會自動儲存，一定要由你確認後才會存成管理紀錄；AI 不可用時會改用手動文字稿與本機規則，並標示「這份草稿未經 AI 整理」。",
].join("\n");

export type AiFallbackReason = "CAP_REACHED" | "NO_KEY" | "AI_ERROR" | "NO_CONSENT";
export const FALLBACK_REASON_TEXT: Record<AiFallbackReason, string> = {
  CAP_REACHED: "本月 AI 額度已用完，已自動停用 AI，請改用手動文字稿與本機規則（下個月 1 日自動恢復）。",
  NO_KEY: "尚未設定 AI 服務，請改用手動文字稿與本機規則。",
  AI_ERROR: "AI 服務暫時無法使用，請改用手動文字稿與本機規則，或稍後重試。",
  NO_CONSENT: "尚未同意語音與 AI 告知，未使用 AI。",
};

/** 台北時間的月份鍵 YYYY-MM；每月 1 日 00:00（台北）起算新的一個月。 */
export function taipeiMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}`;
}

/* ── 費用估算（micro-USD 整數；1 美元 = 1,000,000） ── */
export const MICRO = 1_000_000;
export const toMicro = (usd: number) => Math.round(usd * MICRO);
export const microToUsd = (micro: number) => micro / MICRO;
export const formatUsd = (micro: number) => `US$ ${(micro / MICRO).toFixed(micro % 10_000 === 0 ? 2 : 4)}`;

/** 每分鐘語音轉文字：用較貴的 whisper-1 價格 US$0.006/分（gpt-4o-mini-transcribe 約 US$0.003/分），偏保守；不足一分鐘以一分鐘計。 */
export const TRANSCRIBE_MICRO_PER_MINUTE = 6000;
/** 每百萬 token 的美元價格（美元，方便對照 OpenAI 價目表）。沒列出的模型一律用最貴的 gpt-4o 價格估算（保守）。 */
export const CHAT_PRICE_PER_M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};
export const CHAT_PRICE_UNKNOWN = { input: 2.5, output: 10 };
/** 草稿請求的固定提示與 JSON 結構約占的 token，加上逐字稿；中文一字以 2 token 估（實際約 1 到 1.5），輸出以上限估。 */
export const DRAFT_PROMPT_OVERHEAD_TOKENS = 1200;
export const DRAFT_TOKENS_PER_CHAR = 2;
export const DRAFT_MAX_OUTPUT_TOKENS = 1500;

/** 後端看不到音檔真實長度（音檔不解析、不保存），所以取「前端回報的秒數」與「依大小反推的最短秒數（每秒最多 2KB，約 16kbps，涵蓋常見 WebM/Opus 低位元率（24kbps 以上））」較大者。 */
export function estimateTranscribe(input: { bytes: number; clientSeconds?: number | null }) {
  const bySize = Math.ceil(Math.max(0, input.bytes) / 2000);
  const seconds = Math.max(bySize, Math.ceil(Math.max(0, Number(input.clientSeconds) || 0)), 1);
  const minutes = Math.ceil(seconds / 60);
  return { audioSeconds: seconds, billedMinutes: minutes, microUsd: minutes * TRANSCRIBE_MICRO_PER_MINUTE };
}
export function estimateDraft(input: { transcriptChars: number; model: string }) {
  const price = CHAT_PRICE_PER_M[input.model] || CHAT_PRICE_UNKNOWN;
  // 價格換成「每百萬 token 的 micro-USD」整數再算，避免浮點誤差讓進位多跳一格
  const inRate = Math.round(price.input * MICRO);
  const outRate = Math.round(price.output * MICRO);
  const inputTokens = DRAFT_PROMPT_OVERHEAD_TOKENS + Math.ceil(Math.max(0, input.transcriptChars) * DRAFT_TOKENS_PER_CHAR);
  const outputTokens = DRAFT_MAX_OUTPUT_TOKENS;
  return { inputTokens, outputTokens, microUsd: Math.ceil((inputTokens * inRate + outputTokens * outRate) / MICRO) };
}

/* ── 月額度狀態 ── */
export type UsageLevel = "ok" | "warn" | "capped";
export type UsageState = {
  capUsd: number;
  capMicro: number;
  spentMicro: number;
  remainingMicro: number;
  /** 已用百分比（四捨五入到小數 1 位；上限 cap 為 0 時視為 100）。 */
  percent: number;
  level: UsageLevel;
  /** 達 100% 之前都可用；達 100% 自動停用（不含 NO_KEY，那是另一個原因）。 */
  aiEnabled: boolean;
};
export function usageState(spentMicro: number, capUsd: number): UsageState {
  const capMicro = toMicro(capUsd);
  const spent = Math.max(0, Math.round(spentMicro));
  const capped = spent >= capMicro; // 上限為 0 時一開始就是 capped
  const warn = !capped && spent * 100 >= capMicro * WARN_PERCENT;
  const percent = capMicro <= 0 ? 100 : Math.round((spent / capMicro) * 1000) / 10;
  return { capUsd, capMicro, spentMicro: spent, remainingMicro: Math.max(0, capMicro - spent), percent, level: capped ? "capped" : warn ? "warn" : "ok", aiEnabled: !capped };
}
/** 這次花費讓累計從 before 變成 after，是否第一次跨過 80%／100%（用於通知）。 */
export function crossedLevels(beforeMicro: number, afterMicro: number, capUsd: number): ("warn80" | "cap100")[] {
  const capMicro = toMicro(capUsd);
  const out: ("warn80" | "cap100")[] = [];
  const was = usageState(beforeMicro, capUsd).level;
  const now = usageState(afterMicro, capUsd).level;
  if (was === "ok" && (now === "warn" || now === "capped") && capMicro > 0) out.push("warn80");
  if (was !== "capped" && now === "capped") out.push("cap100");
  return out;
}

/** 系統管理員設定的月上限：0 到 10000 美元，小數最多 2 位；0 代表停用 AI。 */
export function parseCap(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("每月上限請填數字（美元）");
  if (n < 0 || n > MAX_MONTHLY_CAP_USD) throw new Error(`每月上限必須介於 0 到 ${MAX_MONTHLY_CAP_USD} 美元`);
  if (Math.round(n * 100) / 100 !== n) throw new Error("每月上限最多到小數 2 位");
  return n;
}

/** E7：音檔驗證（大小、格式、長度）；回傳錯誤文字，沒有問題回 null。 */
export function validateAudio(input: { size: number; type: string; durationSeconds?: number | null }): string | null {
  if (!(input.size > 0)) return "口述音檔不可為空";
  if (input.size > MAX_AUDIO_BYTES) return "口述音檔不可超過 10MB（約 10 分鐘），請分段錄音或改用手動文字稿";
  const base = String(input.type || "").split(";")[0].trim().toLowerCase();
  if (base && !ALLOWED_AUDIO_TYPES.includes(base)) return "不支援的音檔格式，請使用 WebM、MP3、M4A 或 WAV。";
  const d = input.durationSeconds;
  if (d !== null && d !== undefined && Number.isFinite(d) && d > MAX_AUDIO_SECONDS + AUDIO_SECONDS_TOLERANCE) return "錄音不可超過 10 分鐘，請分段錄音或改用手動文字稿";
  return null;
}
