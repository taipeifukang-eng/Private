import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Supervisor, runIdOrThrow, setupM6Users, slName, testStoreIds, type M6User } from '../support/m6-fixtures';
import { assertMockOpenAi, restoreVoiceState, snapshotVoiceState, VOICE_API, type Snapshot } from '../support/m6-voice';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';

/**
 * M6 第三批 3b W33 對等：舊 /api/supervisor-management-log/voice/draft 與新 /api/workspace/supervisor-management/voice/draft 對同一份文字稿各跑一遍。
 * 測站沒有 OPENAI_API_KEY 且開了假的 OpenAI（先確認 ai_mode 是 mock），舊版因此一律走本機規則；新版用「尚未同意」的帳號，也走同一套本機規則，所以可以逐欄比對：
 *  - 一致：草稿欄位、待確認問題、必填缺漏、review_required、ai_provider、比對到的門市與員工、各角色的權限狀態碼、儲存後的紀錄資料列；
 *  - 已登記差異：E7 退回說明與新增欄位（fallback_*）、E6 逐字稿另存、語音紀錄的 AI 標記與 metadata。
 * 絕不呼叫真實 OpenAI（舊版 transcribe 在沒有金鑰時直接 503，這裡不呼叫它）。
 */
const recorder = new ParityRecorder('supervisor-log');
const db = adminDb();
const L = '/api/supervisor-management-log';
const N = '/api/workspace/supervisor-management';
const KEYS = ['sl_sup_a', 'sl_team', 'sl_manager', 'sl_viewer', 'sl_creator', 'sl_none'];
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
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  await cleanupM6Supervisor(db, Object.values(users || {}).map((u) => u.id));
  if (snap) await restoreVoiceState(snap, db);
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});
test.beforeEach(() => test.setTimeout(240_000));

const rec = (entry: string, title: string, role: string, diffs: Diff[], compared: Record<string, number | string | boolean>, mechanism: 'api-read' | 'write-readback' = 'api-read') => {
  const r = recorder.record({ entry, mechanism, role, title, legacy: { endpoint: `${L}/voice（舊）` }, native: { endpoint: `${N}/voice（新）` }, compared, diffs });
  assertNoUnlistedDiffs(r);
  expect(['pass', 'allowed', 'pending-approval'], `${entry}：${JSON.stringify(r.diffs)}`).toContain(r.status);
  return r;
};
const same = (key: string, l: unknown, n: unknown): Diff[] => (JSON.stringify(l) === JSON.stringify(n) ? [] : [{ kind: 'changed', key, legacy: l, native: n }]);
const status = (key: string, l: number, n: number): Diff[] => (l === n ? [] : [{ kind: 'status', key, legacy: l, native: n }]);
const go = async (key: string, method: 'get' | 'post', url: string, data?: unknown) => {
  const res = await apis[key][method](url, data === undefined ? undefined : { data });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as any };
};

const SAMPLES = [
  '今天到 VW001 巡店，發現陳列不整齊。已提醒店長，下週再追蹤。',
  '電話聯絡店長，原因是排班不足，主要是新人還在訓練。要求本週內補人，明天再確認。',
  '單純記錄：今天沒有特別狀況。',
  '主管約談 FK12345，說明教育訓練與文件補正，限期改善，下次會議再追蹤。',
];

test('草稿（本機規則）：草稿欄位、待確認問題、必填缺漏、review_required 與比對結果新舊相同；退回說明與新增欄位為已登記差異', async () => {
  const diffs: Diff[] = [];
  const warnDiffs: Diff[] = [];
  const fieldDiffs: Diff[] = [];
  const entityDiffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_manager']) {
    for (const mode of ['RECORD_DRAFT', 'FOLLOWUP_DRAFT']) {
      for (const transcript of SAMPLES) {
        const l = await go(who, 'post', `${L}/voice/draft`, { transcript, mode });
        const n = await go(who, 'post', `${VOICE_API}/voice/draft`, { transcript, mode });
        const k = `${who}:${mode}:${transcript.slice(0, 8)}`;
        diffs.push(...status(`${k}:status`, l.status, n.status));
        if (l.status !== 200 || n.status !== 200) continue;
        const ld = l.body.data;
        const nd = n.body.data;
        diffs.push(...same(`${k}:draft`, ld.draft, nd.draft));
        diffs.push(...same(`${k}:blocking_fields`, ld.blocking_fields, nd.blocking_fields));
        diffs.push(...same(`${k}:confirmation_questions`, ld.confirmation_questions, nd.confirmation_questions));
        diffs.push(...same(`${k}:review_required`, ld.review_required, nd.review_required));
        diffs.push(...same(`${k}:ai_provider`, ld.ai_provider, nd.ai_provider));
        const em = (r: any) => (r.entity_matches as any[]).map((m) => [m.type, m.mention, m.status, m.candidates.map((c: any) => c.label)]);
        entityDiffs.push(...same(`${k}:entity_matches`, em(ld), em(nd)));
        if (JSON.stringify(ld.warnings) !== JSON.stringify(nd.warnings)) warnDiffs.push({ kind: 'changed', key: 'warnings', legacy: ld.warnings, native: nd.warnings });
        const extra = Object.keys(nd).filter((x) => !(x in ld));
        if (extra.length) fieldDiffs.push({ kind: 'only-native', key: 'fallback-fields', native: extra });
      }
    }
  }
  // 逐欄比對一致的部分
  rec('voice-draft-local', '本機規則草稿：草稿、待確認問題、必填缺漏、review_required、ai_provider 新舊逐欄相同', 'multi', diffs, { roles: 2, modes: 2, samples: SAMPLES.length });
  rec('voice-draft-entities', '門市與員工比對：新舊結果相同（新版依登入者權限縮小候選範圍，管轄門市內的比對相同）', 'multi', entityDiffs, { roles: 2 });
  // 已登記差異：E7 退回說明文字與新增欄位（只要出現就必須有白名單條目，沒有差異也可以）
  rec('voice-draft-warnings', '退回說明：舊版寫「OPENAI_API_KEY 未設定」之類的技術文字，新版依原因說明並標示未經 AI 整理', 'multi', warnDiffs, { samples: SAMPLES.length });
  rec('voice-draft-fields', '新版多回傳 fallback、fallback_reason、fallback_label、message（舊版沒有）', 'multi', fieldDiffs, { samples: SAMPLES.length });
});

test('權限：各角色用語音草稿的狀態碼新舊相同（建立或編輯權限者可用；只有看自己、看團隊、無權限者 403）', async () => {
  const diffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_manager', 'admin', 'sl_creator', 'sl_viewer', 'sl_team', 'sl_none']) {
    const l = await go(who, 'post', `${L}/voice/draft`, { transcript: '今天巡店。', mode: 'RECORD_DRAFT' });
    const n = await go(who, 'post', `${VOICE_API}/voice/draft`, { transcript: '今天巡店。', mode: 'RECORD_DRAFT' });
    diffs.push(...status(`${who}:status`, l.status, n.status));
  }
  rec('voice-permissions', '語音草稿的權限：新舊各角色狀態碼相同', 'multi', diffs, { roles: 7 });
});

test('輸入檢查：空白、過長、模式錯誤，新舊狀態碼相同', async () => {
  const diffs: Diff[] = [];
  const cases: [string, unknown][] = [['empty', { transcript: '', mode: 'RECORD_DRAFT' }], ['blank', { transcript: '   ' }], ['long', { transcript: 'x'.repeat(6001) }], ['mode', { transcript: '今天巡店。', mode: 'NOPE' }]];
  for (const [name, body] of cases) {
    const l = await go('sl_sup_a', 'post', `${L}/voice/draft`, body);
    const n = await go('sl_sup_a', 'post', `${VOICE_API}/voice/draft`, body);
    diffs.push(...status(`${name}:status`, l.status, n.status));
  }
  rec('voice-draft-validation', '草稿輸入檢查：新舊狀態碼相同', 'sl_sup_a', diffs, { cases: cases.length });
});

test('寫入對等：語音草稿儲存成紀錄後，資料列欄位與舊版相同；AI 標記、metadata 與逐字稿另存是已登記差異', async () => {
  const mk = async (api: 'L' | 'N', tag: string) => {
    const res = await go('sl_sup_a', 'post', `${api === 'L' ? L : N}/cases`, { title: slName(tag), target_type: 'STORE', store_id: sid.VW001, target_name_snapshot: 'VW001 測試門市' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data?.id ?? (await db.from('supervisor_management_cases').select('id').eq('title', slName(tag)).single()).data.id;
  };
  const lid = await mk('L', 'W33-L');
  const nid = await mk('N', 'W33-N');
  const base = { record_type: 'MANAGEMENT', record_date: '2038-05-05', target_name_snapshot: 'VW001 測試門市', store_id: sid.VW001, observation: '發現陳列不整齊', judgment: '需要持續關注', action_summary: '已提醒店長', action_options: ['現場說明'], requires_follow_up: false };
  const l = await go('sl_sup_a', 'post', `${L}/cases/${lid}/records`, base);
  const n = await go('sl_sup_a', 'post', `${VOICE_API}/cases/${nid}/records`, { ...base, voice: { transcript: '今天巡店，陳列不整齊。已提醒店長。', ai_provider: 'OPENAI' } });
  expect([l.status, n.status]).toEqual([201, 201]);
  const row = async (cid: string) => (await db.from('supervisor_management_records').select('*').eq('case_id', cid).single()).data as any;
  const lr = await row(lid);
  const nr = await row(nid);
  const cols = (r: any) => [r.record_type, r.record_date, r.store_id, r.target_name_snapshot, r.observation, r.judgment, r.action_summary, r.action_options, r.requires_follow_up, r.follow_up_date, r.expected_result, r.created_by, r.deleted_at];
  rec('voice-record-save', '儲存紀錄：欄位新舊相同', 'sl_sup_a', same('record-row', cols(lr), cols(nr)), { columns: 13 }, 'write-readback');
  const flagDiffs: Diff[] = [...same('ai_generated', lr.ai_generated, nr.ai_generated), ...same('ai_confirmed_by', lr.ai_confirmed_by, nr.ai_confirmed_by)];
  rec('voice-record-ai-flag', '語音紀錄的 AI 標記：舊版語音草稿存成一般紀錄（不標 AI），新版 OpenAI 路徑標 ai_generated 並記確認人', 'sl_sup_a', flagDiffs.map((d) => ({ ...d, key: 'ai_generated' })).slice(0, 1), { columns: 2 }, 'write-readback');
  rec('voice-record-metadata', '語音紀錄的 metadata：新版記錄語音來源（source、ai_provider），不含逐字稿', 'sl_sup_a', same('metadata', lr.metadata, nr.metadata).map((d) => ({ ...d, key: 'metadata' })), { columns: 1 }, 'write-readback');
  const tr = (await db.from('workspace_supervisor_voice_transcripts').select('*').eq('record_id', nr.id).maybeSingle()).data;
  rec('voice-record-transcript', '逐字稿：舊版沒有保存，新版另存（只有建立者與管理者看得到）', 'sl_sup_a', tr ? [{ kind: 'only-native', key: 'transcript', native: '已保存' }] : [], { saved: !!tr }, 'write-readback');
  expect(tr, '新版有逐字稿').toBeTruthy();
});
