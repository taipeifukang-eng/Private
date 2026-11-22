import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiConfigured, aiMockEnabled, AiError, draftFromTranscript, MOCK_DEFAULT_TRANSCRIPT, transcribeAudio } from '../../../lib/workspace/ai-openai';

/**
 * M6 W33：workspace 呼叫 OpenAI 的出口。測試一律走假的 OpenAI；這裡證明「開了 mock 就絕不會呼叫全域 fetch（真實網路）」，
 * 以及沒有金鑰也沒有 mock 時是安全的「未設定」狀態。
 */
const KEYS = ['WORKSPACE_OPENAI_MOCK', 'OPENAI_API_KEY'] as const;
let saved: Record<string, string | undefined>;
let realFetch: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  realFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('測試不可連真實網路');
  });
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  realFetch.mockRestore();
});

const blob = (text: string) => new Blob([text], { type: 'audio/webm' });

describe('mock 模式：不碰真實網路、不讀 OPENAI_API_KEY', () => {
  beforeEach(() => {
    process.env.WORKSPACE_OPENAI_MOCK = 'true';
    process.env.OPENAI_API_KEY = 'sk-should-never-be-used';
  });
  it('aiMockEnabled 與 aiConfigured 為 true', () => {
    expect(aiMockEnabled()).toBe(true);
    expect(aiConfigured()).toBe(true);
  });
  it('語音轉文字：MOCK-TRANSCRIPT 開頭的音檔回傳冒號後的文字；其他內容回固定文字', async () => {
    expect(await transcribeAudio(blob('MOCK-TRANSCRIPT:今天巡店發現陳列不整齊'), 'a.webm')).toBe('今天巡店發現陳列不整齊');
    expect(await transcribeAudio(blob('random-bytes'), 'a.webm')).toBe(MOCK_DEFAULT_TRANSCRIPT);
    expect(realFetch).not.toHaveBeenCalled();
  });
  it('語音轉文字失敗：丟固定文字的 AiError，不帶上游回應內容', async () => {
    const err = await transcribeAudio(blob('MOCK-FAIL'), 'a.webm').catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toBe('AI 語音轉文字失敗');
    expect(String(err.message)).not.toContain('mock upstream failure');
    expect(err.status).toBe(500);
    expect(realFetch).not.toHaveBeenCalled();
  });
  it('草稿：沿用舊版提示與解析，回傳 draft 與 entity_mentions；不含任何資料庫 id', async () => {
    const r = await draftFromTranscript({ transcript: '今天到 VW001 巡店，陳列不整齊。下週再追蹤。', mode: 'RECORD_DRAFT', categories: [], maxTokens: 1500 });
    expect(r.draft?.observation).toContain('AI 整理');
    expect(r.entity_mentions).toEqual([{ type: 'STORE', text: 'VW001' }]);
    expect(JSON.stringify(r)).not.toMatch(/store_id|employee_id|profile_id/);
    expect(realFetch).not.toHaveBeenCalled();
  });
  it('草稿失敗：丟 AiError，錯誤文字固定', async () => {
    const err = await draftFromTranscript({ transcript: '含 MOCK-AI-FAIL 的文字', mode: 'RECORD_DRAFT', categories: [], maxTokens: 1500 }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toBe('AI 草稿整理失敗');
    expect(realFetch).not.toHaveBeenCalled();
  });
  it('草稿請求帶 max_tokens（費用估算的輸出上限）；請求內容只含文字稿，不含音檔', async () => {
    // 直接用舊版函式與假 fetch 驗證請求內容
    const { parseDraftWithOpenAI } = await import('../../../lib/supervisor-management-log/voice');
    let sent: any = null;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"draft":{}}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await parseDraftWithOpenAI({ transcript: '測試', mode: 'RECORD_DRAFT', categories: [] }, { fetchImpl: fake, apiKey: 'k', maxTokens: 1500 });
    expect(sent.max_tokens).toBe(1500);
    expect(sent.model).toBeTruthy();
    expect(JSON.stringify(sent)).not.toContain('audio');
  });
});

describe('沒有 mock、沒有金鑰：未設定（會走本機規則）', () => {
  beforeEach(() => {
    delete process.env.WORKSPACE_OPENAI_MOCK;
    delete process.env.OPENAI_API_KEY;
  });
  it('aiConfigured 為 false；草稿丟「尚未設定」且不連網', async () => {
    expect(aiMockEnabled()).toBe(false);
    expect(aiConfigured()).toBe(false);
    const err = await draftFromTranscript({ transcript: '文字', mode: 'RECORD_DRAFT', categories: [], maxTokens: 1500 }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(realFetch).not.toHaveBeenCalled();
  });
});

describe('舊版草稿函式的行為不變（沒有第二個參數時）', () => {
  it('沒有金鑰回 null；不傳 options 不會多帶 max_tokens', async () => {
    delete process.env.OPENAI_API_KEY;
    const { parseDraftWithOpenAI } = await import('../../../lib/supervisor-management-log/voice');
    expect(await parseDraftWithOpenAI({ transcript: 'x', mode: 'RECORD_DRAFT', categories: [] })).toBeNull();
    process.env.OPENAI_API_KEY = 'sk-test';
    let body: any = null;
    realFetch.mockImplementation((async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    }) as any);
    await parseDraftWithOpenAI({ transcript: 'x', mode: 'RECORD_DRAFT', categories: [] });
    expect(body).not.toHaveProperty('max_tokens');
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect(String(realFetch.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions');
  });
});
