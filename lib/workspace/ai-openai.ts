import { parseDraftWithOpenAI, type VoiceDraftMode } from "../supervisor-management-log/voice";

// M6 W33：workspace 呼叫 OpenAI 的唯一出口（語音轉文字、草稿整理）。
// - 測試站（tests/support/start-test-server.cjs 設 WORKSPACE_OPENAI_MOCK=true）一律走這裡的假 fetch，不連真實 OpenAI，也不讀 OPENAI_API_KEY。
// - 正式環境的 OPENAI_API_KEY 由 Vercel 管理，這裡只讀、不改；模型沿用舊版環境變數。
// - 不保存 OpenAI 的原始回應與標頭：只回傳需要的文字，錯誤只丟出固定文字。音檔不存檔，只在這次請求的記憶體內。

export const aiMockEnabled = () => process.env.WORKSPACE_OPENAI_MOCK === "true";
export const aiConfigured = () => aiMockEnabled() || !!process.env.OPENAI_API_KEY;
export const draftModel = () => process.env.OPENAI_SML_VOICE_DRAFT_MODEL || "gpt-4o-mini";
export const transcribeModel = () => process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
export const AI_TIMEOUT_MS = 60_000;

export class AiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/* ── 假的 OpenAI（只在 WORKSPACE_OPENAI_MOCK=true 使用） ──
 * 音檔內容以 "MOCK-TRANSCRIPT:" 開頭 -> 轉文字結果就是冒號後面的文字；以 "MOCK-FAIL" 開頭 -> 回 500；其他內容 -> 固定的測試文字稿。
 * 草稿：文字稿含 "MOCK-AI-FAIL" -> 回 500；否則依文字稿回傳 JSON 草稿（內容加 "AI 整理：" 前綴，方便測試辨識是 AI 路徑）。 */
export const MOCK_DEFAULT_TRANSCRIPT = "今天到 VW001 測試門市巡店，發現陳列不整齊，已提醒店長，下週再追蹤。";
export const mockCalls = { transcribe: 0, draft: 0 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const mockFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/audio/transcriptions")) {
    mockCalls.transcribe += 1;
    const form = init?.body as FormData;
    const file = form.get("file") as File;
    const head = Buffer.from(await file.arrayBuffer()).subarray(0, 2000).toString("utf8");
    if (head.startsWith("MOCK-FAIL")) return json(500, { error: { message: "mock upstream failure" } });
    if (head.startsWith("MOCK-TRANSCRIPT:")) return json(200, { text: head.slice("MOCK-TRANSCRIPT:".length).trim() });
    return json(200, { text: MOCK_DEFAULT_TRANSCRIPT });
  }
  if (url.endsWith("/chat/completions")) {
    mockCalls.draft += 1;
    const body = JSON.parse(String(init?.body || "{}"));
    const user = JSON.parse(body.messages?.[1]?.content || "{}");
    const transcript = String(user.transcript || "");
    if (transcript.includes("MOCK-AI-FAIL")) return json(500, { error: { message: "mock upstream failure" } });
    const first = transcript.split(/[。！？!?；;]/).map((s) => s.trim()).find(Boolean) || transcript.slice(0, 60);
    const mentions = (transcript.match(/VW\d{3}|ZT\d{2}/g) || []).map((text) => ({ type: "STORE", text }));
    const draft = {
      mode: user.mode,
      record_type: user.mode === "FOLLOWUP_DRAFT" ? "FOLLOW_UP" : "MANAGEMENT",
      record_date: user.today,
      target_name_snapshot: "",
      observation: `AI 整理：${first}`,
      judgment: "AI 整理：依口述內容，需要持續關注現場狀況",
      action_summary: "AI 整理：已提醒現場人員並安排後續追蹤",
      action_options: ["現場說明", "持續追蹤"],
      requires_follow_up: /追蹤/.test(transcript),
      follow_up_date: null,
      follow_up_method: null,
      expected_result: /追蹤/.test(transcript) ? "確認改善" : null,
      confidence: "MEDIUM",
      notes: null,
    };
    return json(200, { choices: [{ message: { content: JSON.stringify({ draft, entity_mentions: mentions, confirmation_questions: [], warnings: [] }) } }] });
  }
  return json(404, { error: { message: "mock: unknown endpoint" } });
};

const realOrMock = (): typeof fetch => (aiMockEnabled() ? mockFetch : fetch);

/** 語音轉文字（音檔只在這次請求的記憶體內）。失敗丟 AiError（固定文字，不含上游回應內容）。 */
export async function transcribeAudio(file: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, fileName || "voice.webm");
  form.append("model", transcribeModel());
  form.append("language", "zh");
  let res: Response;
  try {
    res = await realOrMock()("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${aiMockEnabled() ? "mock" : process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch {
    throw new AiError("AI 語音轉文字連線失敗或逾時");
  }
  if (!res.ok) throw new AiError("AI 語音轉文字失敗", res.status);
  const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
  const text = String(body?.text || "").trim();
  if (!text) throw new AiError("AI 沒有辨識出任何文字");
  return text;
}

/** 草稿整理：沿用舊版 parseDraftWithOpenAI 的提示與解析（不重寫），只換 fetch（測試）與限制輸出 token（估算費用用）。 */
export async function draftFromTranscript(params: { transcript: string; mode: VoiceDraftMode; categories: Array<{ code: string; name: string }>; maxTokens: number }) {
  try {
    const result = await parseDraftWithOpenAI(
      { transcript: params.transcript, mode: params.mode, categories: params.categories },
      { fetchImpl: realOrMock(), apiKey: aiMockEnabled() ? "mock" : process.env.OPENAI_API_KEY, maxTokens: params.maxTokens, timeoutMs: AI_TIMEOUT_MS },
    );
    if (!result) throw new AiError("尚未設定 AI 服務");
    return result;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("AI 草稿整理失敗");
  }
}
