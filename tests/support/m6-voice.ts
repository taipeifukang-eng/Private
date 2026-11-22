import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { adminDb } from './m6-fixtures';
import { taipeiMonthKey } from '../../lib/supervisor-management-log/voice-ai-rules';

/**
 * M6 第三批 3b W33（督導語音與 AI 摘要）測試共用工具。
 * 規則：絕不呼叫真實 OpenAI——測試站由 start-test-server.cjs 開 WORKSPACE_OPENAI_MOCK（假的 OpenAI 在伺服器內），這裡每個測試開始前都先確認 voice/status 的 ai_mode 是 mock，否則整組中止。
 * 月額度相關測試直接在 DEV 的 workspace_ai_* 資料表塞「帶標記」的估算費用列（model = M6W33-seed）控制進度，測完只刪自己的（標記或測試期間新增的列），並還原原本的每月上限與通知紀錄。
 * 年度 2038 的月份鍵（2038-01）只用在「月份歸零」測試：塞很大的金額，確認不會算進本月。
 */
export const SEED_MODEL = 'M6W33-seed';
export const currentMonthKey = () => taipeiMonthKey(new Date());
export const FUTURE_MONTH = '2038-01';
export const VOICE_API = '/api/workspace/supervisor-management';

export type Snapshot = { startedAt: string; cap: number | null; alerts: string[]; consentUsers: string[] };

/** 測試開始前的狀態（用來測完還原）。 */
export async function snapshotVoiceState(db: any = adminDb()): Promise<Snapshot> {
  const cap = (await db.from('workspace_ai_settings').select('monthly_cap_usd').eq('scope', 'supervisor_voice').maybeSingle()).data;
  const alerts = ((await db.from('workspace_ai_alerts').select('month_key, level').eq('scope', 'supervisor_voice')).data || []) as { month_key: string; level: string }[];
  const consents = ((await db.from('workspace_ai_consents').select('user_id')).data || []) as { user_id: string }[];
  return { startedAt: new Date(Date.now() - 2000).toISOString(), cap: cap ? Number(cap.monthly_cap_usd) : null, alerts: alerts.map((a) => `${a.month_key}/${a.level}`), consentUsers: consents.map((c) => c.user_id) };
}
/** 還原：刪除測試期間新增的估算列、通知與同意，並把每月上限改回原值。 */
export async function restoreVoiceState(snap: Snapshot, db: any = adminDb()): Promise<void> {
  await db.from('workspace_ai_usage_ledger').delete().eq('scope', 'supervisor_voice').gte('created_at', snap.startedAt);
  await db.from('workspace_ai_usage_ledger').delete().eq('model', SEED_MODEL);
  const alerts = ((await db.from('workspace_ai_alerts').select('month_key, level').eq('scope', 'supervisor_voice')).data || []) as { month_key: string; level: string }[];
  for (const a of alerts) if (!snap.alerts.includes(`${a.month_key}/${a.level}`)) await db.from('workspace_ai_alerts').delete().eq('scope', 'supervisor_voice').eq('month_key', a.month_key).eq('level', a.level);
  const consents = ((await db.from('workspace_ai_consents').select('user_id')).data || []) as { user_id: string }[];
  for (const c of consents) if (!snap.consentUsers.includes(c.user_id)) await db.from('workspace_ai_consents').delete().eq('user_id', c.user_id);
  if (snap.cap !== null) await db.from('workspace_ai_settings').upsert({ scope: 'supervisor_voice', monthly_cap_usd: snap.cap }, { onConflict: 'scope' });
}
export async function setCapDb(usd: number, db: any = adminDb()) {
  const r = await db.from('workspace_ai_settings').upsert({ scope: 'supervisor_voice', monthly_cap_usd: usd }, { onConflict: 'scope' });
  if (r.error) throw new Error(`設定月上限失敗：${r.error.message}`);
}
/** 刪除前面測試留下的帶標記估算列（讓每個測試從乾淨的月份開始安排情境）。 */
export async function clearSeeds(db: any = adminDb()) {
  await db.from('workspace_ai_usage_ledger').delete().eq('model', SEED_MODEL);
}
export async function monthSpent(month: string = currentMonthKey(), db: any = adminDb()): Promise<number> {
  const r = await db.rpc('workspace_ai_month_spent', { p_month_key: month });
  if (r.error) throw new Error(`讀取累計失敗：${r.error.message}`);
  return Number(r.data);
}
export async function ledgerCount(month: string = currentMonthKey(), db: any = adminDb()): Promise<number> {
  const r = await db.from('workspace_ai_usage_ledger').select('id', { count: 'exact', head: true }).eq('scope', 'supervisor_voice').eq('month_key', month);
  return r.count || 0;
}
export async function seedSpend(micro: number, month: string = currentMonthKey(), db: any = adminDb()) {
  if (micro <= 0) return;
  const r = await db.from('workspace_ai_usage_ledger').insert({ scope: 'supervisor_voice', month_key: month, kind: 'draft', model: SEED_MODEL, est_cost_micro_usd: micro });
  if (r.error) throw new Error(`塞入估算費用失敗：${r.error.message}`);
}
/**
 * 把「本月累計」調到剛好 percent（相對於 capUsd）：先把月上限設成 capUsd，再補一列估算費用。
 * 回傳補完後的累計（micro-USD）。原本累計超過目標時丟錯（不會刪別人的資料）。
 */
export async function arrangeMonth(capUsd: number, targetMicro: number, db: any = adminDb()): Promise<number> {
  await setCapDb(capUsd, db);
  const base = await monthSpent(undefined, db);
  if (base > targetMicro) throw new Error(`本月累計 ${base} 已超過目標 ${targetMicro}，無法安排測試情境`);
  await seedSpend(targetMicro - base, undefined, db);
  return monthSpent(undefined, db);
}
export async function alertLevels(month: string = currentMonthKey(), db: any = adminDb()): Promise<string[]> {
  const r = await db.from('workspace_ai_alerts').select('level').eq('scope', 'supervisor_voice').eq('month_key', month).order('level');
  return ((r.data || []) as { level: string }[]).map((x) => x.level);
}
export async function clearAlerts(month: string = currentMonthKey(), db: any = adminDb()) {
  await db.from('workspace_ai_alerts').delete().eq('scope', 'supervisor_voice').eq('month_key', month);
}

/** 假音檔：內容以 MOCK-TRANSCRIPT: 開頭，測試站的假 OpenAI 會把冒號後的文字當成轉出來的文字稿。 */
export const mockAudio = (text: string, pad = 0) => Buffer.concat([Buffer.from(`MOCK-TRANSCRIPT:${text}`), Buffer.alloc(pad)]);
export async function upload(api: APIRequestContext, audio: Buffer, opts: { type?: string; seconds?: string; name?: string } = {}) {
  const res = await api.post(`${VOICE_API}/voice/transcribe`, {
    multipart: { audio: { name: opts.name || 'voice.webm', mimeType: opts.type || 'audio/webm', buffer: audio }, ...(opts.seconds === undefined ? {} : { duration_seconds: opts.seconds }) },
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as any };
}
/** 測試開始前確認測試站用的是假的 OpenAI；不是就中止（保證不會呼叫真實 OpenAI）。 */
export async function assertMockOpenAi(api: APIRequestContext) {
  const res = await api.get(`${VOICE_API}/voice/status`);
  expect(res.status(), '取得語音狀態').toBe(200);
  const body = await res.json();
  expect(body.data.ai_mode, '測試站必須用假的 OpenAI（WORKSPACE_OPENAI_MOCK），否則不執行任何語音測試').toBe('mock');
}
