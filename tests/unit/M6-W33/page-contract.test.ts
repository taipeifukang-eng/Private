import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NOTICE_TEXT, NOTICE_VERSION, FALLBACK_LABEL } from '../../../lib/supervisor-management-log/voice-ai-rules';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const voiceLib = read('lib/workspace/supervisor-voice.ts');
const openai = read('lib/workspace/ai-openai.ts');
const route = read('app/api/workspace/supervisor-management/[[...path]]/route.ts');
const sql = read('supabase/workspace-dev/20261122133000_m6_voice_ai.sql');

describe('M6-W33：音檔不存檔、不保存 OpenAI 原始回應', () => {
  it('伺服端沒有任何檔案或儲存體寫入，也沒有把上游回應或標頭寫進資料庫', () => {
    for (const src of [voiceLib, openai]) {
      expect(src).not.toMatch(/\.storage\b|writeFile|createWriteStream|fs\./);
      expect(src).not.toMatch(/console\.(log|info|debug)/);
    }
    // 轉文字只回傳文字；錯誤只丟固定文字
    expect(openai).toContain('AI 語音轉文字失敗');
    expect(openai).not.toMatch(/res\.headers|response\.headers/);
    // 資料表欄位沒有音檔或原始回應
    for (const col of ['audio_data', 'audio_blob', 'audio_url', 'raw_response', 'response_headers', 'bytea']) expect(sql.toLowerCase(), col).not.toContain(col);
  });
  it('錄音只暫存在瀏覽器記憶體：轉完或離開畫面就丟掉，沒有 localStorage／IndexedDB', () => {
    const rec = read('vue-workspace/src/components/VoiceRecorder.vue');
    expect(rec).toContain('URL.revokeObjectURL');
    expect(rec).toContain('onBeforeUnmount');
    expect(rec).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(read('vue-workspace/src/lib/voice-upload.ts')).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe('M6-W33：AI 永遠不直接寫入，一定要人工確認', () => {
  it('草稿與轉文字 API 只讀不寫：本檔對業務資料表沒有任何 insert／update／delete（只寫自己的用量、同意、逐字稿表）', () => {
    const writes = Array.from(voiceLib.matchAll(/\.from\(([^)]+)\)\s*\.(insert|update|delete|upsert)/g)).map((m) => m[1]);
    for (const t of writes) expect(t, t).toMatch(/T\.(consents|transcripts|settings)/);
    expect(voiceLib).not.toMatch(/supervisor_management_(cases|records|followups|daily_plans)/);
  });
  it('草稿回傳 review_required 固定為 true，並列出缺漏欄位；沿用舊版整理函式', () => {
    expect(voiceLib).toContain('review_required: true');
    expect(voiceLib).toContain('getBlockingFields');
    expect(voiceLib).toContain('normalizeDraft');
    expect(voiceLib).not.toContain('review_required: false');
  });
  it('儲存仍走新增紀錄（三欄必填驗證由舊版 validateRecordPayload 把關）；AI 確認人固定為送出者', () => {
    const log = read('lib/workspace/supervisor-log.ts');
    expect(log).toContain('merged.ai_confirmed_by = merged.ai_generated === true ? ctx.user.id : null');
    expect(log).toContain('readVoiceMeta(body.voice)');
    expect(log).toContain("body.ai_generated = voice.ai_provider === \"OPENAI\"");
  });
  it('頁面的「套用」只把草稿帶進紀錄表單，沒有直接送出', () => {
    const flow = read('vue-workspace/src/components/VoiceDraftFlow.vue');
    expect(flow).toContain('還不會儲存');
    expect(flow).not.toMatch(/supervisor-management\/cases/);
    expect(flow).toContain('missing.length > 0');
  });
});

describe('M6-W33：E5 告知與同意、E6 逐字稿、E7 退回與限制', () => {
  it('告知文字說明了外送 OpenAI、音檔不保存、逐字稿保存與可見範圍、AI 不會自動儲存；有版本號', () => {
    expect(NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const k of ['OpenAI', '音檔不會存在', '逐字稿', '建立者與管理者', '不會自動儲存', '個人資料']) expect(NOTICE_TEXT, k).toContain(k);
  });
  it('未同意不能轉文字（403 CONSENT_REQUIRED）；畫面首次使用先顯示告知與勾選，才進錄音', () => {
    expect(voiceLib).toContain('CONSENT_REQUIRED');
    const flow = read('vue-workspace/src/components/VoiceDraftFlow.vue');
    expect(flow).toContain('data-testid="voice-consent"');
    expect(flow).toContain('data-testid="voice-agree"');
    expect(flow.indexOf('voice-consent')).toBeLessThan(flow.indexOf('<VoiceRecorder'));
    expect(flow).toContain('隱私告知');
  });
  it('逐字稿存在獨立資料表，只有建立者與管理者讀得到；資料表沒有任何登入者政策', () => {
    expect(voiceLib).toContain('逐字稿只有建立者與管理者看得到');
    expect(voiceLib).toContain('manage || r.created_by === userId');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.workspace_ai_settings[^;]*FROM PUBLIC, anon, authenticated/);
    expect(route).toContain('transcript');
  });
  it('AI 不可用時標示「這份草稿未經 AI 整理」，並在紀錄表單再標示一次', () => {
    expect(FALLBACK_LABEL).toBe('這份草稿未經 AI 整理');
    expect(read('vue-workspace/src/components/VoiceDraftFlow.vue')).toContain('FALLBACK_LABEL');
    expect(read('vue-workspace/src/pages/SupervisorLog.vue')).toContain('這份草稿未經 AI 整理');
  });
  it('錄音元件有開始／停止／重新錄音／重試上傳，10 分鐘自動停止，32kbps 位元率', () => {
    const rec = read('vue-workspace/src/components/VoiceRecorder.vue');
    for (const id of ['voice-start', 'voice-stop', 'voice-rerecord', 'voice-retry', 'voice-upload', 'voice-timer']) expect(rec, id).toContain(`data-testid="${id}"`);
    expect(rec).toContain('MAX_AUDIO_SECONDS');
    expect(rec).toContain('audioBitsPerSecond: 32000');
  });
});

describe('M6-W33：每月 US$30 上限、80%／100% 只通知系統管理員', () => {
  it('預設 30 美元寫在資料表預設值與插入列', () => {
    expect(sql).toContain('monthly_cap_usd numeric(10,2) NOT NULL DEFAULT 30');
    expect(sql).toContain("('supervisor_voice', 30)");
    expect(sql).toContain("v_after * 10 >= v_cap_micro * 8");
  });
  it('預約額度在資料庫函式內加鎖、同一交易檢查與寫入；用量與費用函式只授權 service_role', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.workspace_ai_reserve[^;]*TO service_role/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.workspace_ai_reserve[^;]*authenticated/);
  });
  it('用量、調整上限只有系統管理員（ctx.isAdmin）；首頁提醒也只有系統管理員', () => {
    expect(voiceLib).toContain('requireSystemAdmin(ctx)');
    expect(voiceLib).toContain('只有系統管理員可以查看或調整 AI 用量');
    expect(voiceLib).toMatch(/homeAiUsage[\s\S]*if \(!ctx\.isAdmin\) return \{ show: false/);
    expect(read('lib/workspace/home.ts')).toContain('homeAiUsage(ctx, now)');
    expect(read('vue-workspace/src/components/HomeView.vue')).toContain('data-home-card="ai-usage"');
  });
  it('不呼叫 OpenAI 帳單 API，費用只用事前估算', () => {
    expect(openai + voiceLib).not.toMatch(/\/v1\/(usage|dashboard|organization\/costs|billing)/);
    expect(voiceLib).toContain('estimateTranscribe');
    expect(voiceLib).toContain('estimateDraft');
  });
  it('額度用完時 AI 自動停用：轉文字與草稿都先檢查可用性並預約額度', () => {
    expect(voiceLib).toContain('aiAvailability(ctx)');
    expect(voiceLib).toContain('CAP_REACHED');
    expect(voiceLib.match(/reserve\(ctx,/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('測試站一律用假的 OpenAI，並清掉真實金鑰', () => {
    const start = read('tests/support/start-test-server.cjs');
    expect(start).toContain("process.env.WORKSPACE_OPENAI_MOCK = 'true'");
    expect(start).toContain('delete process.env.OPENAI_API_KEY');
  });
});

describe('M6-W33：資料庫變更與舊版不動', () => {
  it('DEV 與正式區草稿相同，附 rollback，只新增 W33 自己的資料表與函式', () => {
    const rollback = read('supabase/workspace-dev/20261122133000_m6_voice_ai.rollback.sql');
    expect(read('docs/vue-workspace/parity-plan/m6-sql/20261122133000_m6_voice_ai.sql')).toBe(sql);
    expect(read('docs/vue-workspace/parity-plan/m6-sql/20261122133000_m6_voice_ai.rollback.sql')).toBe(rollback);
    const created = Array.from(sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)).map((m) => m[1]);
    expect(created.sort()).toEqual(['workspace_ai_alerts', 'workspace_ai_consents', 'workspace_ai_settings', 'workspace_ai_usage_ledger', 'workspace_supervisor_voice_transcripts']);
    for (const t of created) expect(rollback, t).toContain(`DROP TABLE IF EXISTS public.${t}`);
    expect(sql).not.toMatch(/ALTER TABLE public\.supervisor_management/i);
    expect(fs.readdirSync(path.join(root, 'supabase/migrations')).some((f) => f.includes('voice_ai'))).toBe(false);
  });
  it('舊版語音路由與頁面沒有被改成新行為（舊路由仍直接用舊函式、不經同意與額度）', () => {
    const legacyDraft = read('app/api/supervisor-management-log/voice/draft/route.ts');
    expect(legacyDraft).toContain("from '@/lib/supervisor-management-log/voice'");
    expect(legacyDraft).not.toMatch(/workspace_ai|voice-ai-rules|supervisor-voice/);
    expect(read('app/api/supervisor-management-log/voice/transcribe/route.ts')).not.toMatch(/workspace_ai|voice-ai-rules|supervisor-voice/);
  });
  it('舊版 voice.ts 只多了不影響原行為的選項參數與可重用的比對函式', () => {
    const v = read('lib/supervisor-management-log/voice.ts');
    expect(v).toContain('export function matchEntitiesFromCandidates');
    expect(v).toContain('options.apiKey ?? process.env.OPENAI_API_KEY');
    expect(v).toContain('} = {}) {');
  });
});
