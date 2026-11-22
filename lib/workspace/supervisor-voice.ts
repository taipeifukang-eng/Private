import { checked, respond, WorkspaceError, type Context } from "./server";
import { canCreateCase, canEnter, canUpdateAny } from "../supervisor-management-log/workspace-rules";
import { loadCase, loadRecord, viewerOf } from "./supervisor-log";
import {
  buildLocalDraft,
  getBlockingFields,
  matchEntitiesFromCandidates,
  normalizeDraft,
  normalizeTranscript,
  type EmployeeCandidate,
  type EntityMention,
  type StoreCandidate,
  type VoiceDraftMode,
} from "../supervisor-management-log/voice";
import {
  AI_SCOPE,
  DEFAULT_MONTHLY_CAP_USD,
  DRAFT_MAX_OUTPUT_TOKENS,
  estimateDraft,
  estimateTranscribe,
  FALLBACK_LABEL,
  FALLBACK_REASON_TEXT,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MAX_TRANSCRIPT_LENGTH,
  microToUsd,
  NOTICE_TEXT,
  NOTICE_VERSION,
  parseCap,
  taipeiMonthKey,
  usageState,
  validateAudio,
  type AiFallbackReason,
} from "../supervisor-management-log/voice-ai-rules";
import { aiConfigured, aiMockEnabled, AiError, draftFromTranscript, draftModel, transcribeAudio } from "./ai-openai";

// M6 W33：督導語音與 AI 摘要的伺服端邏輯（路由接在 app/api/workspace/supervisor-management/[[...path]] 的 voice/*、ai-usage、ai-settings）。
// 沿用舊版 lib/supervisor-management-log/voice.ts 的提示、草稿整理與驗證，不重寫；這裡加上：同意紀錄（E5）、逐字稿可見範圍（E6）、
// AI 失敗與月額度用完的退回（E7、老闆 2026-11-22 問卷）、每月 US$30 估算費用上限與 80%／100% 的系統管理員通知。
// 原則：AI 永遠不直接寫入任何紀錄（本檔只產生草稿；儲存一律走人工送出的新增紀錄）；音檔不存；不保存 OpenAI 原始回應與標頭。

const T = { settings: "workspace_ai_settings", ledger: "workspace_ai_usage_ledger", alerts: "workspace_ai_alerts", consents: "workspace_ai_consents", transcripts: "workspace_supervisor_voice_transcripts", categories: "supervisor_management_categories" } as const;
const MODES = new Set(["RECORD_DRAFT", "FOLLOWUP_DRAFT"]);
const num = (v: unknown) => Number(v) || 0;

/* ───────────── 月額度 ───────────── */

export async function loadCapUsd(ctx: Context): Promise<number> {
  const row = checked(await ctx.admin.from(T.settings).select("monthly_cap_usd").eq("scope", AI_SCOPE).maybeSingle()) as { monthly_cap_usd: number | string } | null;
  return row ? num(row.monthly_cap_usd) : DEFAULT_MONTHLY_CAP_USD;
}
async function monthSpentMicro(ctx: Context, monthKey: string): Promise<number> {
  return num(checked(await ctx.admin.rpc("workspace_ai_month_spent", { p_month_key: monthKey })));
}
/** 本月（台北）用量快照：累計估算費用、上限、百分比、層級、通知紀錄。 */
export async function usageSnapshot(ctx: Context, now: Date = new Date()) {
  const monthKey = taipeiMonthKey(now);
  const [capUsd, spent] = await Promise.all([loadCapUsd(ctx), monthSpentMicro(ctx, monthKey)]);
  const state = usageState(spent, capUsd);
  return { monthKey, state };
}
async function aiAvailability(ctx: Context, now: Date = new Date()): Promise<{ available: boolean; reason: AiFallbackReason | null }> {
  if (!aiConfigured()) return { available: false, reason: "NO_KEY" };
  const { state } = await usageSnapshot(ctx, now);
  return state.aiEnabled ? { available: true, reason: null } : { available: false, reason: "CAP_REACHED" };
}
type Estimate = { microUsd: number; audioSeconds?: number; inputTokens?: number; outputTokens?: number };
/** 預約額度（資料庫函式在同一交易內加鎖：已達上限就拒絕，否則寫入估算費用，並記錄第一次達 80%／100% 的通知）。 */
async function reserve(ctx: Context, kind: "transcribe" | "draft", model: string, est: Estimate, now: Date = new Date()): Promise<boolean> {
  const out = checked(
    await ctx.admin.rpc("workspace_ai_reserve", {
      p_month_key: taipeiMonthKey(now), p_kind: kind, p_model: model, p_cost_micro: est.microUsd, p_user: ctx.user.id,
      p_audio_seconds: est.audioSeconds ?? null, p_input_tokens: est.inputTokens ?? null, p_output_tokens: est.outputTokens ?? null,
    }),
  ) as { ok: boolean } | null;
  return !!out?.ok;
}

/* ───────────── 同意（E5） ───────────── */

async function hasConsent(ctx: Context): Promise<boolean> {
  const row = checked(await ctx.admin.from(T.consents).select("user_id").eq("user_id", ctx.user.id).eq("notice_version", NOTICE_VERSION).maybeSingle());
  return !!row;
}
async function voiceViewer(ctx: Context) {
  const v = await viewerOf(ctx);
  if (!(canCreateCase(v.caps) || canUpdateAny(v.caps))) throw new WorkspaceError(403, "沒有使用督導口述紀錄權限");
  return v;
}
const fallbackBody = (reason: AiFallbackReason) => ({ fallback: true, fallback_reason: reason, fallback_label: FALLBACK_LABEL, message: FALLBACK_REASON_TEXT[reason] });

/** GET voice/status：AI 目前能不能用、同意狀態與告知文字、上限（給畫面決定要不要顯示錄音）。非管理員看不到金額。 */
export async function voiceStatus(ctx: Context) {
  await voiceViewer(ctx);
  const [ai, consent] = await Promise.all([aiAvailability(ctx), hasConsent(ctx)]);
  return respond({
    success: true,
    data: {
      ai_available: ai.available,
      ai_unavailable_reason: ai.reason,
      ai_unavailable_message: ai.reason ? FALLBACK_REASON_TEXT[ai.reason] : null,
      consent: { accepted: consent, version: NOTICE_VERSION, notice: NOTICE_TEXT },
      limits: { max_seconds: MAX_AUDIO_SECONDS, max_bytes: MAX_AUDIO_BYTES, formats: ["WebM", "MP3", "M4A", "WAV"], max_transcript_chars: MAX_TRANSCRIPT_LENGTH },
      fallback_label: FALLBACK_LABEL,
      /** 畫面據此決定要不要顯示「AI 用量」頁籤（真正的權限仍在 ai-usage／ai-settings API 檢查）。 */
      is_system_admin: !!ctx.isAdmin,
      /** mock＝測試站假的 OpenAI（不連外）；live＝有設定真實金鑰；none＝沒有設定。測試靠這個確認不會打到真實 OpenAI。不含任何金鑰內容。 */
      ai_mode: aiMockEnabled() ? "mock" : process.env.OPENAI_API_KEY ? "live" : "none",
    },
  });
}

/** POST voice/consent：記錄「已讀告知並同意」（本人、這一版告知；重複送出不會新增）。 */
export async function voiceConsent(ctx: Context, request: Request) {
  await voiceViewer(ctx);
  const body = (await request.json().catch(() => null)) as { accept?: unknown; version?: unknown } | null;
  if (body?.accept !== true) throw new WorkspaceError(400, "請勾選同意後再送出");
  if (body.version !== NOTICE_VERSION) throw new WorkspaceError(400, "告知內容已更新，請重新閱讀後再同意");
  checked(await ctx.admin.from(T.consents).upsert({ user_id: ctx.user.id, notice_version: NOTICE_VERSION }, { onConflict: "user_id,notice_version", ignoreDuplicates: true }));
  return respond({ success: true, data: { accepted: true, version: NOTICE_VERSION } });
}

/* ───────────── 語音轉文字 ───────────── */

/**
 * POST voice/transcribe（multipart：audio、duration_seconds）。
 * 未同意 -> 403 CONSENT_REQUIRED；超過上限或格式不符 -> 400；AI 不可用（額度用完、沒設定、服務失敗）-> 200 且 fallback:true（畫面改手動文字稿）。
 * 音檔只在這次請求的記憶體內，轉完即丟，不存檔；OpenAI 原始回應不保存。
 */
export async function transcribe(ctx: Context, request: Request) {
  await voiceViewer(ctx);
  if (!(await hasConsent(ctx))) return respond({ error: "請先閱讀並同意語音與 AI 告知後再錄音", code: "CONSENT_REQUIRED" }, 403);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new WorkspaceError(400, "請上傳口述音檔");
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new WorkspaceError(400, "請上傳口述音檔");
  const secondsRaw = form.get("duration_seconds");
  const seconds = secondsRaw === null || secondsRaw === "" ? null : Number(secondsRaw);
  // 後端不解析音檔長度，所以一律要求前端回報秒數（10 分鐘上限與費用估算都靠它；費用另以最低位元率由大小反推下限）
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) throw new WorkspaceError(400, "請提供錄音秒數（duration_seconds）");
  const bad = validateAudio({ size: audio.size, type: audio.type, durationSeconds: seconds });
  if (bad) throw new WorkspaceError(400, bad);

  const ai = await aiAvailability(ctx);
  if (!ai.available) return respond({ success: true, data: { transcript: null, ai_provider: "NONE", ...fallbackBody(ai.reason!) } });
  const est = estimateTranscribe({ bytes: audio.size, clientSeconds: seconds });
  if (!(await reserve(ctx, "transcribe", "transcribe", { microUsd: est.microUsd, audioSeconds: est.audioSeconds }))) {
    return respond({ success: true, data: { transcript: null, ai_provider: "NONE", ...fallbackBody("CAP_REACHED") } });
  }
  try {
    const text = await transcribeAudio(audio, audio.name || "voice.webm");
    return respond({ success: true, data: { transcript: text.slice(0, MAX_TRANSCRIPT_LENGTH), ai_provider: "OPENAI", fallback: false, duration_seconds: seconds, warnings: [] } });
  } catch (e) {
    if (!(e instanceof AiError)) throw e;
    return respond({ success: true, data: { transcript: null, ai_provider: "NONE", ...fallbackBody("AI_ERROR") } });
  }
}

/* ───────────── 草稿 ───────────── */

/** 比對候選依登入者權限縮小（管理者全部；其他人只有自己管轄門市與其員工）。 */
async function candidatesFor(ctx: Context, manage: boolean): Promise<{ stores: StoreCandidate[]; employees: EmployeeCandidate[] }> {
  let storeIds: string[] | null = null;
  if (!manage) {
    const mine = (checked(await ctx.admin.from("store_managers").select("store_id").eq("user_id", ctx.user.id)) as { store_id: string }[] | null) || [];
    storeIds = Array.from(new Set(mine.map((r) => r.store_id).filter(Boolean)));
    if (!storeIds.length) return { stores: [], employees: [] };
  }
  let sq: any = ctx.admin.from("stores").select("id, store_code, store_name, short_name").eq("is_active", true).limit(1000);
  let eq: any = ctx.admin.from("store_employees").select("id, store_id, employee_code, employee_name, current_position, position").eq("is_active", true).limit(800);
  if (storeIds) {
    sq = sq.in("id", storeIds);
    eq = eq.in("store_id", storeIds);
  }
  const [stores, employees] = await Promise.all([sq, eq]);
  return { stores: (checked(stores) as StoreCandidate[] | null) || [], employees: (checked(employees) as EmployeeCandidate[] | null) || [] };
}

/**
 * POST voice/draft { transcript, mode }：把文字稿整理成「待人工確認」的草稿；不寫入任何資料。
 * 能用 AI 就用 AI（先預約月額度）；沒同意、沒設定、額度用完或 AI 失敗時，退回本機規則草稿並標示「這份草稿未經 AI 整理」（E7）。
 * review_required 永遠為 true；發現、判斷、動作三欄缺漏會列在 blocking_fields，儲存時伺服端也會拒絕。
 */
export async function voiceDraft(ctx: Context, request: Request) {
  const v = await voiceViewer(ctx);
  const body = (await request.json().catch(() => null)) as { transcript?: unknown; mode?: unknown } | null;
  let transcript: string;
  try {
    transcript = normalizeTranscript(body?.transcript);
  } catch (e) {
    throw new WorkspaceError(400, e instanceof Error ? e.message : "請輸入口述文字稿");
  }
  const mode = String(body?.mode || "RECORD_DRAFT").trim().toUpperCase();
  if (!MODES.has(mode)) throw new WorkspaceError(400, "口述草稿模式錯誤");

  const categories = (checked(await ctx.admin.from(T.categories).select("code, name").eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true }).limit(100)) as { code: string; name: string }[] | null) || [];

  let aiResult: Awaited<ReturnType<typeof draftFromTranscript>> | null = null;
  let reason: AiFallbackReason | null = null;
  if (!(await hasConsent(ctx))) reason = "NO_CONSENT";
  else {
    const ai = await aiAvailability(ctx);
    if (!ai.available) reason = ai.reason;
    else {
      const model = draftModel();
      const est = estimateDraft({ transcriptChars: transcript.length, model });
      if (!(await reserve(ctx, "draft", model, { microUsd: est.microUsd, inputTokens: est.inputTokens, outputTokens: est.outputTokens }))) reason = "CAP_REACHED";
      else {
        try {
          aiResult = await draftFromTranscript({ transcript, mode: mode as VoiceDraftMode, categories, maxTokens: DRAFT_MAX_OUTPUT_TOKENS });
        } catch (e) {
          if (!(e instanceof AiError)) throw e;
          reason = "AI_ERROR";
        }
      }
    }
  }

  const fallback = buildLocalDraft(transcript, mode as VoiceDraftMode);
  const source = aiResult || fallback;
  const draft = normalizeDraft(source.draft, mode as VoiceDraftMode, transcript);
  const aiMentions = aiResult && Array.isArray(aiResult.entity_mentions) ? (aiResult.entity_mentions as EntityMention[]) : [];
  const matches = matchEntitiesFromCandidates(await candidatesFor(ctx, v.caps.manage), transcript, aiMentions);
  return respond({
    success: true,
    data: {
      draft,
      entity_matches: matches,
      review_required: true,
      blocking_fields: getBlockingFields(draft, matches),
      confirmation_questions: source.confirmation_questions || fallback.confirmation_questions || [],
      warnings: aiResult ? aiResult.warnings || [] : reason ? [FALLBACK_REASON_TEXT[reason]] : [],
      ai_provider: aiResult ? "OPENAI" : "LOCAL_RULE_FALLBACK",
      ...(aiResult ? { fallback: false, fallback_reason: null, fallback_label: null } : fallbackBody(reason || "AI_ERROR")),
    },
  });
}

/* ───────────── 逐字稿（E6） ───────────── */

export type VoiceMeta = { transcript: string; source: "AI" | "MANUAL"; ai_provider: string | null };
/** 解析新增紀錄 body.voice；沒有就回 null。 */
export function readVoiceMeta(raw: unknown): VoiceMeta | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new WorkspaceError(400, "語音資料格式不正確");
  const o = raw as Record<string, unknown>;
  const transcript = String(o.transcript || "").trim();
  if (!transcript) throw new WorkspaceError(400, "請輸入口述文字稿");
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) throw new WorkspaceError(400, `口述文字稿不可超過 ${MAX_TRANSCRIPT_LENGTH} 字`);
  const provider = o.ai_provider === "OPENAI" ? "OPENAI" : o.ai_provider === "LOCAL_RULE_FALLBACK" ? "LOCAL_RULE_FALLBACK" : null;
  return { transcript, source: provider === "OPENAI" ? "AI" : "MANUAL", ai_provider: provider };
}
/** 紀錄存好之後保存逐字稿（只由 admin client 寫入；資料表沒有任何登入者可用的政策）。失敗不影響已儲存的紀錄，回傳是否成功。 */
export async function saveTranscript(ctx: Context, caseId: string, recordId: string, meta: VoiceMeta): Promise<boolean> {
  const r = await ctx.admin.from(T.transcripts).insert({ record_id: recordId, case_id: caseId, created_by: ctx.user.id, transcript: meta.transcript, source: meta.source, ai_provider: meta.ai_provider });
  return !r.error;
}
/** 案件詳情用：這個案件哪些紀錄有逐字稿、登入者看不看得到（只有建立者與管理者；其他人完全不會知道有沒有）。 */
export async function viewableTranscriptIds(ctx: Context, caseId: string, userId: string, manage: boolean): Promise<Set<string>> {
  const rows = (checked(await ctx.admin.from(T.transcripts).select("record_id, created_by").eq("case_id", caseId)) as { record_id: string; created_by: string }[] | null) || [];
  return new Set(rows.filter((r) => manage || r.created_by === userId).map((r) => r.record_id));
}
/** GET cases/:id/records/:rid/transcript：只有逐字稿建立者與管理者；紀錄看不到一律 404。 */
export async function getTranscript(ctx: Context, caseId: string, recordId: string) {
  const v = await viewerOf(ctx);
  if (!canEnter(v.caps)) throw new WorkspaceError(403, "沒有督導管理日誌查看權限");
  await loadCase(ctx, v, caseId);
  await loadRecord(ctx, caseId, recordId);
  const row = checked(await ctx.admin.from(T.transcripts).select("transcript, source, ai_provider, created_by, created_at").eq("record_id", recordId).maybeSingle()) as { transcript: string; source: string; ai_provider: string | null; created_by: string; created_at: string } | null;
  // 沒有逐字稿與無權查看回同一個答案，其他人無從探測有沒有逐字稿
  if (!row || !(v.caps.manage || row.created_by === ctx.user.id)) throw new WorkspaceError(404, "沒有逐字稿，或沒有查看權限");
  return respond({ success: true, data: { transcript: row.transcript, source: row.source, ai_provider: row.ai_provider, created_at: row.created_at } });
}

/* ───────────── 系統管理員：用量與月上限 ───────────── */

function requireSystemAdmin(ctx: Context) {
  if (!ctx.isAdmin) throw new WorkspaceError(403, "只有系統管理員可以查看或調整 AI 用量");
}
async function adminView(ctx: Context, now: Date = new Date()) {
  const { monthKey, state } = await usageSnapshot(ctx, now);
  const [calls, alerts] = await Promise.all([
    ctx.admin.from(T.ledger).select("id", { count: "exact", head: true }).eq("scope", AI_SCOPE).eq("month_key", monthKey),
    ctx.admin.from(T.alerts).select("level, spent_micro_usd, cap_usd, created_at").eq("scope", AI_SCOPE).eq("month_key", monthKey).order("created_at", { ascending: true }),
  ]);
  return {
    month_key: monthKey,
    cap_usd: state.capUsd,
    spent_usd: microToUsd(state.spentMicro),
    remaining_usd: microToUsd(state.remainingMicro),
    percent: state.percent,
    level: state.level,
    ai_enabled: state.aiEnabled,
    ai_configured: aiConfigured(),
    calls: calls.count || 0,
    alerts: ((checked(alerts) as any[] | null) || []).map((a) => ({ level: a.level, at: a.created_at, spent_usd: microToUsd(num(a.spent_micro_usd)), cap_usd: num(a.cap_usd) })),
    note: "費用是每次呼叫前的保守估算（不查 OpenAI 帳單）；每月 1 日（台北時間）自動歸零。",
  };
}
/** GET ai-usage：本月用量（只有系統管理員）。 */
export async function aiUsage(ctx: Context) {
  requireSystemAdmin(ctx);
  return respond({ success: true, data: await adminView(ctx) });
}
/** PATCH ai-settings { monthly_cap_usd }：調整每月上限（只有系統管理員；0 代表停用 AI）。 */
export async function setAiSettings(ctx: Context, request: Request) {
  requireSystemAdmin(ctx);
  const body = (await request.json().catch(() => null)) as { monthly_cap_usd?: unknown } | null;
  let cap: number;
  try {
    cap = parseCap(body?.monthly_cap_usd);
  } catch (e) {
    throw new WorkspaceError(400, e instanceof Error ? e.message : "每月上限格式不正確");
  }
  checked(await ctx.admin.from(T.settings).upsert({ scope: AI_SCOPE, monthly_cap_usd: cap, updated_by: ctx.user.id, updated_at: new Date().toISOString() }, { onConflict: "scope" }));
  return respond({ success: true, data: await adminView(ctx) });
}

/** 首頁提醒：只有系統管理員，且本月估算達 80% 或 100% 才顯示。 */
export async function homeAiUsage(ctx: Context, now: Date = new Date()) {
  if (!ctx.isAdmin) return { show: false as const };
  const { monthKey, state } = await usageSnapshot(ctx, now);
  if (state.level === "ok") return { show: false as const };
  return { show: true as const, level: state.level, percent: state.percent, spent_usd: microToUsd(state.spentMicro), cap_usd: state.capUsd, month_key: monthKey };
}
