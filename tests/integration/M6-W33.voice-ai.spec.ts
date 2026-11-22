import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Supervisor, runIdOrThrow, setupM6Users, slName, testStoreIds, type M6User } from '../support/m6-fixtures';
import {
  alertLevels, arrangeMonth, assertMockOpenAi, clearAlerts, currentMonthKey, FUTURE_MONTH, ledgerCount, mockAudio, monthSpent, restoreVoiceState, seedSpend,
  setCapDb, snapshotVoiceState, upload, VOICE_API, type Snapshot,
} from '../support/m6-voice';
import { estimateDraft, estimateTranscribe, FALLBACK_LABEL, NOTICE_VERSION, toMicro } from '../../lib/supervisor-management-log/voice-ai-rules';

/**
 * M6 第三批 3b W33：督導語音與 AI 摘要 workspace API（測試站用假的 OpenAI，不連真實 OpenAI）。
 * 涵蓋：同意（E5）、轉文字與音檔限制（E7）、草稿（AI 與本機規則退回）、儲存與逐字稿可見範圍（E6）、每月 US$30 上限的估算費用／80%／100% 通知／自動停用／月份歸零／管理員調整、首頁提醒只給系統管理員。
 * 帳號（臨時 m6-test-sl-*）：sl_sup_a（督導 A，建立／改自己／追蹤，管轄 VW001）、sl_sup_b（督導 B，管轄 VW002）、sl_team（只有看團隊）、
 *   sl_manager（只有管理）、sl_viewer（只有看自己，沒有語音權限）、sl_none（無權限）；另用 admin（系統管理員，應用層後備）。
 * 月額度情境直接在 workspace_ai_* 資料表塞帶標記（model = M6W33-seed）的估算費用列；測完還原每月上限、刪除測試期間新增的列。
 */
const db = adminDb();
const KEYS = ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_manager', 'sl_viewer', 'sl_none'];
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
let snap: Snapshot;
const apis: Record<string, APIRequestContext> = {};

test.beforeAll(async () => {
  runIdOrThrow();
  snap = await snapshotVoiceState(db);
  await cleanupM6Supervisor();
  ({ users, teardown } = await setupM6Users(KEYS));
  sid = await testStoreIds();
  apis.admin = await apiAs('admin');
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k]);
  await assertMockOpenAi(apis.admin);
  await setCapDb(30, db);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  await cleanupM6Supervisor(db, Object.values(users || {}).map((u) => u.id));
  if (snap) await restoreVoiceState(snap, db);
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});
test.beforeEach(() => test.setTimeout(180_000));

const call = async (key: string, method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown) => {
  const res = await apis[key][method](`${VOICE_API}/${path}`, data === undefined ? undefined : method === 'get' ? { params: data as Record<string, string> } : { data });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as any };
};
const consent = (key: string) => call(key, 'post', 'voice/consent', { accept: true, version: NOTICE_VERSION });
const draft = (key: string, transcript: string, mode = 'RECORD_DRAFT') => call(key, 'post', 'voice/draft', { transcript, mode });
const makeCase = async (key: string, tag: string, store: 'VW001' | 'VW002' = 'VW001') => {
  const r = await call(key, 'post', 'cases', { title: slName(tag), target_type: 'STORE', store_id: sid[store], target_name_snapshot: `${store} 測試門市`, priority: 'NORMAL' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
};
const voiceRecord = (over: Record<string, unknown> = {}, voice: Record<string, unknown> | null = { transcript: '今天巡店，陳列不整齊。', ai_provider: 'OPENAI' }) => ({
  observation: '發現陳列不整齊', judgment: '需要持續關注', action_summary: '已提醒店長', ...(voice ? { voice } : {}), ...over,
});
const dbRecord = async (id: string) => (await db.from('supervisor_management_records').select('*').eq('id', id).single()).data as any;
const dbTranscript = async (recordId: string) => (await db.from('workspace_supervisor_voice_transcripts').select('*').eq('record_id', recordId).maybeSingle()).data as any;

test('權限與狀態：有建立或編輯權限者可使用語音；只有看自己、看團隊、沒權限者 403；非管理員看不到金額', async () => {
  const expected: Record<string, number> = { sl_none: 403, sl_viewer: 403, sl_team: 403, sl_sup_a: 200, sl_sup_b: 200, sl_manager: 200, admin: 200 };
  for (const [key, want] of Object.entries(expected)) {
    expect((await call(key, 'get', 'voice/status')).status, `${key} voice/status`).toBe(want);
    expect((await draft(key, '今天巡店。')).status === 403, `${key} voice/draft 403`).toBe(want === 403);
    expect((await call(key, 'post', 'voice/consent', { accept: true, version: NOTICE_VERSION })).status === 403, `${key} consent 403`).toBe(want === 403);
  }
  const a = await call('sl_sup_a', 'get', 'voice/status');
  expect(a.body.data).toMatchObject({ ai_available: true, ai_mode: 'mock', is_system_admin: false, fallback_label: FALLBACK_LABEL });
  expect(a.body.data.limits).toMatchObject({ max_seconds: 600, max_bytes: 10 * 1024 * 1024 });
  expect(a.body.data.consent).toMatchObject({ version: NOTICE_VERSION });
  expect(a.body.data.consent.notice).toContain('OpenAI');
  expect(JSON.stringify(a.body.data)).not.toMatch(/spent|cap_usd|monthly/);
  expect((await call('admin', 'get', 'voice/status')).body.data.is_system_admin).toBe(true);
  // 未登入
  const bare = await pwRequest.newContext({ baseURL: 'http://localhost:3002' });
  try {
    expect((await bare.get(`${VOICE_API}/voice/status`)).status()).toBe(401);
    expect((await bare.get(`${VOICE_API}/ai-usage`)).status()).toBe(401);
  } finally {
    await bare.dispose();
  }
});

test('E5 同意：沒同意不能轉文字（403 CONSENT_REQUIRED、不花費用）；同意要勾選且是最新版告知；同意只記一筆', async () => {
  await db.from('workspace_ai_consents').delete().in('user_id', [users.sl_sup_a.id, users.sl_sup_b.id]);
  expect((await call('sl_sup_a', 'get', 'voice/status')).body.data.consent.accepted).toBe(false);
  const before = await ledgerCount();
  const r = await upload(apis.sl_sup_a, mockAudio('未同意不該轉'), { seconds: '5' });
  expect(r.status).toBe(403);
  expect(r.body.code).toBe('CONSENT_REQUIRED');
  expect(await ledgerCount(), '未同意不可花費用').toBe(before);
  // 沒勾選、版本不對
  expect((await call('sl_sup_a', 'post', 'voice/consent', { accept: false, version: NOTICE_VERSION })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'voice/consent', { version: NOTICE_VERSION })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'voice/consent', { accept: true, version: '2000-01-01' })).status).toBe(400);
  expect((await call('sl_sup_a', 'get', 'voice/status')).body.data.consent.accepted).toBe(false);
  // 同意（送兩次只有一筆）
  expect((await consent('sl_sup_a')).status).toBe(200);
  expect((await consent('sl_sup_a')).status).toBe(200);
  const rows = ((await db.from('workspace_ai_consents').select('*').eq('user_id', users.sl_sup_a.id)).data || []) as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].notice_version).toBe(NOTICE_VERSION);
  expect((await call('sl_sup_a', 'get', 'voice/status')).body.data.consent.accepted).toBe(true);
  // 別人不受影響
  expect((await call('sl_sup_b', 'get', 'voice/status')).body.data.consent.accepted).toBe(false);
});

test('轉文字（假的 OpenAI）：回傳文字稿並記一筆估算費用；音檔不存檔；失敗時 200 且 fallback，費用仍保守計入', async () => {
  await consent('sl_sup_a');
  const before = await ledgerCount();
  const spent0 = await monthSpent();
  const audio = mockAudio('今天到 VW001 巡店，陳列不整齊。', 2000);
  const r = await upload(apis.sl_sup_a, audio, { seconds: '12' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data).toMatchObject({ transcript: expect.stringContaining('今天到 VW001 巡店'), ai_provider: 'OPENAI', fallback: false });
  expect(await ledgerCount()).toBe(before + 1);
  const est = estimateTranscribe({ bytes: audio.length, clientSeconds: 12 });
  expect(await monthSpent()).toBe(spent0 + est.microUsd);
  const row = ((await db.from('workspace_ai_usage_ledger').select('*').eq('user_id', users.sl_sup_a.id).order('created_at', { ascending: false }).limit(1)).data || [])[0];
  expect(row).toMatchObject({ kind: 'transcribe', est_cost_micro_usd: est.microUsd, month_key: currentMonthKey() });
  expect(Object.keys(row).some((k) => /audio_(data|blob|url)|raw|header/.test(k)), '帳本沒有音檔或原始回應欄位').toBe(false);
  // 假的上游失敗：200 + fallback，AI 沒有結果，但費用保守計入
  const spent1 = await monthSpent();
  const f = await upload(apis.sl_sup_a, Buffer.from('MOCK-FAIL'), { seconds: '3' });
  expect(f.status).toBe(200);
  expect(f.body.data).toMatchObject({ transcript: null, fallback: true, fallback_reason: 'AI_ERROR', fallback_label: FALLBACK_LABEL });
  expect(JSON.stringify(f.body)).not.toContain('mock upstream failure');
  expect(await monthSpent()).toBe(spent1 + estimateTranscribe({ bytes: 9, clientSeconds: 3 }).microUsd);
});

test('E7 音檔限制：空檔、超過 10MB、超過 10 分鐘、不支援格式、缺檔都 400，且不花費用；剛好 10MB 可以', async () => {
  await consent('sl_sup_a');
  const before = await ledgerCount();
  expect((await upload(apis.sl_sup_a, Buffer.alloc(0))).status).toBe(400);
  const big = await upload(apis.sl_sup_a, mockAudio('x', 10 * 1024 * 1024), { seconds: '30' });
  expect(big.status).toBe(400);
  expect(big.body.error).toContain('10MB');
  const long = await upload(apis.sl_sup_a, mockAudio('x'), { seconds: '700' });
  expect(long.status).toBe(400);
  expect(long.body.error).toContain('10 分鐘');
  const bad = await upload(apis.sl_sup_a, mockAudio('x'), { type: 'audio/ogg', seconds: '5', name: 'a.ogg' });
  expect(bad.status).toBe(400);
  expect(bad.body.error).toContain('不支援');
  const noSec = await apis.sl_sup_a.post(`${VOICE_API}/voice/transcribe`, { multipart: { audio: { name: 'a.webm', mimeType: 'audio/webm', buffer: mockAudio('x') } } });
  expect(noSec.status(), '一律要求回報錄音秒數').toBe(400);
  const noFile = await apis.sl_sup_a.post(`${VOICE_API}/voice/transcribe`, { multipart: { duration_seconds: '5' } });
  expect(noFile.status()).toBe(400);
  expect(await ledgerCount(), '被拒絕的請求不可花費用').toBe(before);
  // 剛好 10MB 與 600 秒可以
  const edgeText = '邊界測試';
  const edge = await upload(apis.sl_sup_a, mockAudio(edgeText, 10 * 1024 * 1024 - 'MOCK-TRANSCRIPT:'.length - Buffer.byteLength(edgeText)), { seconds: '600' });
  expect(edge.status, JSON.stringify(edge.body)).toBe(200);
  expect(edge.body.data.transcript.startsWith(edgeText)).toBe(true);
  // 10MB 以最低位元率（16kbps）估算約 88 分鐘、US$0.53：把這筆估算列刪掉，免得吃掉後面月額度測試要安排的額度
  await db.from('workspace_ai_usage_ledger').delete().eq('scope', 'supervisor_voice').gte('est_cost_micro_usd', 500_000);
  // 各種允許的格式
  for (const type of ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm;codecs=opus']) expect((await upload(apis.sl_sup_a, mockAudio('格式'), { type, seconds: '3' })).status, type).toBe(200);
});

test('草稿（AI）：回待確認草稿，review_required 固定為 true，不寫任何紀錄；門市與員工比對只含自己管轄的', async () => {
  await consent('sl_sup_a');
  await consent('sl_manager');
  const recordsBefore = (await db.from('supervisor_management_records').select('id', { count: 'exact', head: true }).like('observation', 'AI 整理%')).count || 0;
  const text = '今天到 VW001 與 VW002 巡店，陳列不整齊。下週再追蹤。';
  const r = await draft('sl_sup_a', text);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const d = r.body.data;
  expect(d).toMatchObject({ ai_provider: 'OPENAI', review_required: true, fallback: false, fallback_label: null });
  expect(d.draft.observation).toContain('AI 整理');
  expect(d.draft.requires_follow_up).toBe(true);
  expect(Array.isArray(d.blocking_fields)).toBe(true);
  // 督導 A 只管 VW001：VW002 比對不到候選
  const matches = d.entity_matches as { mention: string; status: string; candidates: { label: string }[] }[];
  expect(matches.find((m) => m.mention === 'VW001')?.candidates.some((c) => c.label.includes('VW001'))).toBe(true);
  expect(matches.find((m) => m.mention === 'VW002')?.candidates.some((c) => c.label.includes('VW002')) ?? false).toBe(false);
  // 管理者看得到兩間
  const m = (await draft('sl_manager', text)).body.data.entity_matches as typeof matches;
  expect(m.find((x) => x.mention === 'VW002')?.candidates.some((c) => c.label.includes('VW002'))).toBe(true);
  // 沒有任何 id 進入草稿
  expect(JSON.stringify(d.draft)).not.toMatch(/store_id|employee_id|profile_id/);
  // AI 草稿沒有寫入任何資料
  expect(((await db.from('supervisor_management_records').select('id', { count: 'exact', head: true }).like('observation', 'AI 整理%')).count || 0)).toBe(recordsBefore);
  // 費用：草稿也有估算
  const row = ((await db.from('workspace_ai_usage_ledger').select('*').eq('user_id', users.sl_sup_a.id).eq('kind', 'draft').order('created_at', { ascending: false }).limit(1)).data || [])[0];
  expect(row.est_cost_micro_usd).toBe(estimateDraft({ transcriptChars: text.length, model: row.model }).microUsd);
});

test('E7 草稿退回：沒同意、AI 失敗、輸入錯誤；退回時用本機規則並標示「這份草稿未經 AI 整理」', async () => {
  await consent('sl_sup_a');
  await db.from('workspace_ai_consents').delete().eq('user_id', users.sl_sup_b.id);
  // 沒同意：不送 OpenAI，本機規則
  const nc = (await draft('sl_sup_b', '今天巡店，陳列不整齊。已提醒店長。')).body.data;
  expect(nc).toMatchObject({ ai_provider: 'LOCAL_RULE_FALLBACK', fallback: true, fallback_reason: 'NO_CONSENT', fallback_label: FALLBACK_LABEL, review_required: true });
  expect(nc.draft.observation).not.toContain('AI 整理');
  // AI 失敗：本機規則；費用仍計入（保守）
  const spent0 = await monthSpent();
  const fail = (await draft('sl_sup_a', '含 MOCK-AI-FAIL 的文字稿。已提醒店長。')).body.data;
  expect(fail).toMatchObject({ ai_provider: 'LOCAL_RULE_FALLBACK', fallback: true, fallback_reason: 'AI_ERROR', fallback_label: FALLBACK_LABEL });
  expect(fail.warnings.join('')).toContain('AI 服務暫時無法使用');
  expect(await monthSpent()).toBeGreaterThan(spent0);
  // 即使退回，三欄缺漏也要列出（本機規則的判斷欄位固定提示人工補齊）
  expect(fail.review_required).toBe(true);
  // 輸入錯誤
  expect((await draft('sl_sup_a', '')).status).toBe(400);
  expect((await draft('sl_sup_a', '   ')).status).toBe(400);
  expect((await draft('sl_sup_a', 'x'.repeat(6001))).status).toBe(400);
  expect((await draft('sl_sup_a', '今天巡店。', 'BAD_MODE')).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'voice/draft', 'not-json')).status).toBe(400);
  // FOLLOWUP_DRAFT 模式
  expect((await draft('sl_sup_a', '電話追蹤改善狀況。', 'FOLLOWUP_DRAFT')).body.data.draft.record_type).toBe('FOLLOW_UP');
});

test('儲存語音草稿：仍是人工送出的新增紀錄，三欄缺漏被拒；OpenAI 路徑標 AI 且確認人是送出者；逐字稿另存', async () => {
  await consent('sl_sup_a');
  const caseId = await makeCase('sl_sup_a', 'SAVE');
  // 三欄缺漏 -> 400、沒有紀錄、沒有逐字稿
  for (const missing of ['observation', 'judgment', 'action_summary']) {
    const r = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({ [missing]: '' }));
    expect(r.status, missing).toBe(400);
  }
  expect(((await db.from('supervisor_management_records').select('id').eq('case_id', caseId)).data || []).length).toBe(0);
  expect(((await db.from('workspace_supervisor_voice_transcripts').select('id').eq('case_id', caseId)).data || []).length).toBe(0);
  // OpenAI 路徑
  const ok = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, { transcript: '今天巡店，陳列不整齊。已提醒店長。', ai_provider: 'OPENAI' }));
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  expect(ok.body.data.transcript_saved).toBe(true);
  const rec = await dbRecord(ok.body.data.id);
  expect(rec).toMatchObject({ ai_generated: true, ai_confirmed_by: users.sl_sup_a.id, created_by: users.sl_sup_a.id });
  expect(rec.metadata.voice).toEqual({ source: 'AI', ai_provider: 'OPENAI' });
  expect(rec.metadata.voice.transcript, '紀錄本身不放逐字稿').toBeUndefined();
  const t = await dbTranscript(ok.body.data.id);
  expect(t).toMatchObject({ transcript: '今天巡店，陳列不整齊。已提醒店長。', source: 'AI', ai_provider: 'OPENAI', created_by: users.sl_sup_a.id, case_id: caseId });
  // 本機規則路徑：不標 AI
  const fb = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, { transcript: '手動文字稿。', ai_provider: 'LOCAL_RULE_FALLBACK' }));
  expect(fb.status).toBe(201);
  expect(await dbRecord(fb.body.data.id)).toMatchObject({ ai_generated: false, ai_confirmed_by: null });
  expect((await dbTranscript(fb.body.data.id)).source).toBe('MANUAL');
  // 前端不能自己指定確認人，也不能讓非 AI 路徑標成 AI
  const forge = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({ ai_generated: true, ai_confirmed_by: users.sl_manager.id }, { transcript: '偽造。', ai_provider: 'LOCAL_RULE_FALLBACK' }));
  expect(forge.status).toBe(201);
  expect(await dbRecord(forge.body.data.id), '本機規則路徑不能被標成 AI，確認人也不能由前端指定').toMatchObject({ ai_generated: false, ai_confirmed_by: null });
  // 不是語音流程的紀錄：沒有逐字稿
  const plain = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, null));
  expect(plain.status).toBe(201);
  expect(plain.body.data.transcript_saved).toBeUndefined();
  expect(await dbTranscript(plain.body.data.id)).toBeNull();
  // 語音資料格式錯誤
  expect((await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, { transcript: '', ai_provider: 'OPENAI' }))).status).toBe(400);
  expect((await call('sl_sup_a', 'post', `cases/${caseId}/records`, { ...voiceRecord({}, null), voice: 'x' })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, { transcript: 'x'.repeat(6001), ai_provider: 'OPENAI' }))).status).toBe(400);
});

test('E6 逐字稿可見範圍：只有建立者與管理者；團隊檢視者看得到紀錄但看不到逐字稿，也不知道有沒有；看不到案件者 404', async () => {
  await consent('sl_sup_a');
  const caseId = await makeCase('sl_sup_a', 'E6');
  const ok = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, { transcript: '逐字稿內容含員工姓名王小明。', ai_provider: 'OPENAI' }));
  const rid = ok.body.data.id as string;
  const read = (key: string) => call(key, 'get', `cases/${caseId}/records/${rid}/transcript`);
  const mine = await read('sl_sup_a');
  expect(mine.status).toBe(200);
  expect(mine.body.data).toMatchObject({ transcript: '逐字稿內容含員工姓名王小明。', source: 'AI', ai_provider: 'OPENAI' });
  expect((await read('sl_manager')).status, '管理者').toBe(200);
  expect((await read('admin')).status, '系統管理員（應用層後備）').toBe(200);
  const team = await read('sl_team');
  expect(team.status, '團隊檢視者（與沒有逐字稿同一答案）').toBe(404);
  expect(JSON.stringify(team.body)).not.toContain('王小明');
  expect((await read('sl_sup_b')).status, '看不到案件').toBe(404);
  expect((await read('sl_none')).status, '無權限').toBe(403);
  // 案件詳情的 has_transcript：建立者與管理者 true，團隊檢視者 false（也不洩漏）
  const flag = async (key: string) => ((await call(key, 'get', `cases/${caseId}`)).body.data.records as any[]).find((r) => r.id === rid)?.has_transcript;
  expect(await flag('sl_sup_a')).toBe(true);
  expect(await flag('sl_manager')).toBe(true);
  expect(await flag('sl_team')).toBe(false);
  const teamDetail = JSON.stringify((await call('sl_team', 'get', `cases/${caseId}`)).body);
  expect(teamDetail).not.toContain('王小明');
  // 另一位督導（有權限）無法讀取別人的逐字稿：案件是 VW001，但 sl_sup_b 管轄 VW002 -> 404；
  // 同店的非建立者督導用「管理者以外」的角色也 403（sl_team 已驗證）。沒有逐字稿的紀錄 404。
  const plain = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, null));
  expect((await call('sl_sup_a', 'get', `cases/${caseId}/records/${plain.body.data.id}/transcript`)).status).toBe(404);
  expect((await call('sl_sup_a', 'get', `cases/${caseId}/records/not-a-uuid/transcript`)).status).toBe(400);
  // 非建立者（看團隊）與「沒有逐字稿」回同一個答案，無從探測有沒有逐字稿
  const teamRes = await call('sl_team', 'get', `cases/${caseId}/records/${rid}/transcript`);
  const noneRes = await call('sl_team', 'get', `cases/${caseId}/records/${plain.body.data.id}/transcript`);
  expect([teamRes.status, teamRes.body.error]).toEqual([noneRes.status, noneRes.body.error]);
  expect(teamRes.status).toBe(404);
  // 資料表沒有給登入者的存取：用督導 A 自己的登入身分直接查，一列都讀不到
  const { userDb } = await import('../support/m6-fixtures');
  const asUser = await userDb(users.sl_sup_a);
  const direct = await asUser.from('workspace_supervisor_voice_transcripts').select('transcript');
  expect((direct.data || []).length, '登入者直接查資料表看不到').toBe(0);
  const directLedger = await asUser.from('workspace_ai_usage_ledger').select('id');
  expect((directLedger.data || []).length).toBe(0);
  expect((await asUser.rpc('workspace_ai_month_spent', { p_month_key: currentMonthKey() })).error, '登入者不能呼叫用量函式').toBeTruthy();
});

test('系統管理員的用量與上限 API：只有系統管理員；上限 0 到 10000、最多 2 位小數；預設 30；調整立即生效', async () => {
  await setCapDb(30, db);
  for (const key of ['sl_manager', 'sl_sup_a', 'sl_none']) {
    expect((await call(key, 'get', 'ai-usage')).status, `${key} ai-usage`).toBe(403);
    expect((await call(key, 'patch', 'ai-settings', { monthly_cap_usd: 99 })).status, `${key} ai-settings`).toBe(403);
  }
  const u = await call('admin', 'get', 'ai-usage');
  expect(u.status).toBe(200);
  expect(u.body.data).toMatchObject({ cap_usd: 30, month_key: currentMonthKey(), ai_configured: true });
  expect(u.body.data.note).toContain('每月 1 日');
  for (const bad of [-1, 10000.01, 'abc', '', null, 3.456]) expect((await call('admin', 'patch', 'ai-settings', { monthly_cap_usd: bad })).status, String(bad)).toBe(400);
  expect((await call('admin', 'patch', 'ai-settings', {})).status).toBe(400);
  expect(Number((await db.from('workspace_ai_settings').select('monthly_cap_usd').eq('scope', 'supervisor_voice').single()).data.monthly_cap_usd), '被拒絕的值不會寫入').toBe(30);
  const set = await call('admin', 'patch', 'ai-settings', { monthly_cap_usd: '45.5' });
  expect(set.status).toBe(200);
  expect(set.body.data.cap_usd).toBe(45.5);
  const saved = (await db.from('workspace_ai_settings').select('*').eq('scope', 'supervisor_voice').single()).data;
  expect(Number(saved.monthly_cap_usd)).toBe(45.5);
  expect(saved.updated_by).toBeTruthy();
  await call('admin', 'patch', 'ai-settings', { monthly_cap_usd: 30 });
});

test('80% 通知：跨過 80% 時記一筆通知（每月只一筆），首頁只對系統管理員顯示提醒，AI 仍可用', async () => {
  await consent('sl_sup_a');
  await clearAlerts();
  // 上限 1 美元、累計先調到 79.5%，再做一次語音轉文字（估算 6000 micro = 0.6%）-> 80.1%
  await arrangeMonth(1, 795_000);
  expect(await alertLevels()).toEqual([]);
  let home = (await (await apis.admin.get('/api/workspace/home')).json()).aiUsage;
  expect(home.show, '79.5% 不提醒').toBe(false);
  const r = await upload(apis.sl_sup_a, mockAudio('跨過八成'), { seconds: '5' });
  expect(r.status).toBe(200);
  expect(r.body.data.fallback, '80% 時 AI 仍可用').toBe(false);
  expect(await alertLevels()).toEqual(['warn80']);
  await upload(apis.sl_sup_a, mockAudio('再一次'), { seconds: '5' });
  expect(await alertLevels(), '同一個月 80% 通知只有一筆').toEqual(['warn80']);
  // 首頁：系統管理員看到提醒
  home = (await (await apis.admin.get('/api/workspace/home')).json()).aiUsage;
  expect(home).toMatchObject({ show: true, level: 'warn', cap_usd: 1, month_key: currentMonthKey() });
  expect(home.percent).toBeGreaterThanOrEqual(80);
  expect(home.percent).toBeLessThan(100);
  // 其他人都看不到（含管理者、督導）
  for (const key of ['sl_manager', 'sl_sup_a', 'sl_team', 'sl_none']) {
    const body = await (await apis[key].get('/api/workspace/home')).json();
    expect(body.aiUsage?.show ?? false, `${key} 首頁不該有 AI 提醒`).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/spent_usd|cap_usd/);
  }
  // 管理員用量頁的通知紀錄
  const usage = (await call('admin', 'get', 'ai-usage')).body.data;
  expect(usage.level).toBe('warn');
  expect(usage.ai_enabled).toBe(true);
  expect(usage.alerts.map((a: any) => a.level)).toEqual(['warn80']);
});

test('100% 自動停用：用完後轉文字與草稿都退回（不呼叫 AI、不再花費用），狀態與通知正確；管理員調高上限後立即恢復', async () => {
  await consent('sl_sup_a');
  await clearAlerts();
  await arrangeMonth(1, 995_000);
  // 轉文字：還沒到 100%，這一次會把累計推過 100%（995000 + 6000 = 1001000）
  const last = await upload(apis.sl_sup_a, mockAudio('最後一次'), { seconds: '5' });
  expect(last.body.data).toMatchObject({ fallback: false, transcript: '最後一次' });
  expect((await alertLevels()).sort()).toEqual(['cap100', 'warn80']);
  const spentAtCap = await monthSpent();
  expect(spentAtCap).toBeGreaterThanOrEqual(1_000_000);
  const n = await ledgerCount();
  // 之後：轉文字退回
  const t = await upload(apis.sl_sup_a, mockAudio('不該轉'), { seconds: '5' });
  expect(t.status).toBe(200);
  expect(t.body.data).toMatchObject({ transcript: null, fallback: true, fallback_reason: 'CAP_REACHED', fallback_label: FALLBACK_LABEL, ai_provider: 'NONE' });
  expect(t.body.data.message).toContain('本月 AI 額度已用完');
  // 草稿退回本機規則，標示未經 AI 整理
  const d = (await draft('sl_sup_a', '今天巡店，陳列不整齊。已提醒店長。')).body.data;
  expect(d).toMatchObject({ ai_provider: 'LOCAL_RULE_FALLBACK', fallback: true, fallback_reason: 'CAP_REACHED', fallback_label: FALLBACK_LABEL, review_required: true });
  expect(d.draft.observation).not.toContain('AI 整理');
  expect(await monthSpent(), '停用後不再增加').toBe(spentAtCap);
  expect(await ledgerCount()).toBe(n);
  // 狀態
  const st = (await call('sl_sup_a', 'get', 'voice/status')).body.data;
  expect(st).toMatchObject({ ai_available: false, ai_unavailable_reason: 'CAP_REACHED' });
  expect(st.ai_unavailable_message).toContain('下個月 1 日自動恢復');
  // 仍可手動儲存人工確認的紀錄（不靠 AI）
  const caseId = await makeCase('sl_sup_a', 'CAP');
  const saved = await call('sl_sup_a', 'post', `cases/${caseId}/records`, voiceRecord({}, { transcript: '額度用完後的手動文字稿。', ai_provider: 'LOCAL_RULE_FALLBACK' }));
  expect(saved.status).toBe(201);
  expect(await dbRecord(saved.body.data.id)).toMatchObject({ ai_generated: false });
  // 首頁：系統管理員看到 100% 提醒，其他人看不到
  const home = (await (await apis.admin.get('/api/workspace/home')).json()).aiUsage;
  expect(home).toMatchObject({ show: true, level: 'capped', cap_usd: 1 });
  expect(home.percent).toBeGreaterThanOrEqual(100);
  for (const key of ['sl_manager', 'sl_sup_a']) expect(((await (await apis[key].get('/api/workspace/home')).json()).aiUsage?.show) ?? false).toBe(false);
  const usage = (await call('admin', 'get', 'ai-usage')).body.data;
  expect(usage).toMatchObject({ level: 'capped', ai_enabled: false, remaining_usd: 0 });
  // 管理員調高上限 -> 立即恢復
  expect((await call('admin', 'patch', 'ai-settings', { monthly_cap_usd: 30 })).status).toBe(200);
  expect((await call('sl_sup_a', 'get', 'voice/status')).body.data.ai_available).toBe(true);
  const back = await upload(apis.sl_sup_a, mockAudio('恢復了'), { seconds: '5' });
  expect(back.body.data).toMatchObject({ fallback: false, transcript: '恢復了' });
  expect(((await (await apis.admin.get('/api/workspace/home')).json()).aiUsage?.show) ?? false).toBe(false);
});

test('上限 0：一開始就停用 AI；沒有同意的人不會因此多出費用', async () => {
  await consent('sl_sup_a');
  await setCapDb(0, db);
  const st = (await call('sl_sup_a', 'get', 'voice/status')).body.data;
  expect(st).toMatchObject({ ai_available: false, ai_unavailable_reason: 'CAP_REACHED' });
  const n = await ledgerCount();
  expect((await upload(apis.sl_sup_a, mockAudio('x'), { seconds: '3' })).body.data.fallback_reason).toBe('CAP_REACHED');
  expect((await draft('sl_sup_a', '今天巡店。')).body.data.fallback_reason).toBe('CAP_REACHED');
  expect(await ledgerCount()).toBe(n);
  await setCapDb(30, db);
});

test('每月 1 日歸零：以台北月份分開累計，別的月份的累計不影響本月；未來月份的大額不會讓本月停用', async () => {
  await consent('sl_sup_a');
  await setCapDb(30, db);
  const base = await monthSpent();
  await seedSpend(toMicro(500), FUTURE_MONTH, db); // 2038-01 花了 500 美元（遠超上限）
  expect(await monthSpent(FUTURE_MONTH)).toBeGreaterThanOrEqual(toMicro(500));
  expect(await monthSpent(), '本月累計不受其他月份影響').toBe(base);
  expect((await call('sl_sup_a', 'get', 'voice/status')).body.data.ai_available).toBe(true);
  const usage = (await call('admin', 'get', 'ai-usage')).body.data;
  expect(usage.month_key).toBe(currentMonthKey());
  expect(usage.spent_usd).toBeCloseTo(base / 1e6, 6);
  // 資料庫函式用的月份鍵與程式一致：以未來月份預約時，額度檢查只看那個月
  const reserve = await db.rpc('workspace_ai_reserve', { p_month_key: FUTURE_MONTH, p_kind: 'draft', p_model: 'M6W33-seed', p_cost_micro: 10, p_user: null, p_audio_seconds: null, p_input_tokens: null, p_output_tokens: null });
  expect(reserve.data.ok, '2038-01 已超過上限，被拒絕').toBe(false);
  expect(reserve.data.reason).toBe('CAP_REACHED');
  const reserveNow = await db.rpc('workspace_ai_reserve', { p_month_key: '2038-02', p_kind: 'draft', p_model: 'M6W33-seed', p_cost_micro: 10, p_user: null, p_audio_seconds: null, p_input_tokens: null, p_output_tokens: null });
  expect(reserveNow.data.ok, '2038-02 是新的一個月，從 0 開始').toBe(true);
  expect(reserveNow.data.spent_before_micro_usd).toBe(0);
});

test('並行呼叫不會超過上限太多：資料庫函式加鎖，累計最多只比上限多一次呼叫的費用', async () => {
  await consent('sl_sup_a');
  // 上限調到「目前累計補到整數分之後再加 5 分（50000 micro）」，一次呼叫 6000 micro -> 最多 9 次成功
  const base = await monthSpent();
  const filler = (10_000 - (base % 10_000)) % 10_000;
  await seedSpend(filler);
  const start = await monthSpent();
  await setCapDb((start + 50_000) / 1e6, db);
  const results = await Promise.all(Array.from({ length: 14 }, (_, i) => upload(apis.sl_sup_a, mockAudio(`並行${i}`), { seconds: '5' })));
  const okCount = results.filter((r) => r.body.data?.fallback === false).length;
  const capped = results.filter((r) => r.body.data?.fallback_reason === 'CAP_REACHED').length;
  expect(okCount + capped, JSON.stringify(results.map((r) => r.status))).toBe(14);
  expect(okCount).toBe(9);
  expect(await monthSpent()).toBe(start + 9 * 6000);
  await setCapDb(30, db);
});

test('舊版語音路由不受影響：仍然直接可用（不要求同意、不記用量）', async () => {
  const n = await ledgerCount();
  const res = await apis.sl_sup_a.post('/api/supervisor-management-log/voice/draft', { data: { transcript: '今天巡店，陳列不整齊。已提醒店長。', mode: 'RECORD_DRAFT' } });
  // 舊路由在測試站沒有金鑰：本機規則草稿
  expect(res.status()).toBe(200);
  expect((await res.json()).data.ai_provider).toBe('LOCAL_RULE_FALLBACK');
  expect(await ledgerCount(), '舊路由不記新版用量').toBe(n);
});
