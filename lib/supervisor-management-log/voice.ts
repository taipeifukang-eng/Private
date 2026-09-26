import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_TRANSCRIPT_LENGTH = 6000;

const ACTION_OPTIONS = [
  '現場說明',
  '主管約談',
  '教育訓練',
  '限期改善',
  '跨部門協調',
  '文件補正',
  '持續追蹤',
];

const FOLLOW_UP_METHODS = new Set(['ONSITE', 'PHONE', 'MESSAGE', 'MEETING', 'SYSTEM', 'OTHER']);

export type VoiceDraftMode = 'RECORD_DRAFT' | 'FOLLOWUP_DRAFT';

export type VoiceDraft = {
  mode: VoiceDraftMode;
  record_type: 'MANAGEMENT' | 'FOLLOW_UP' | 'RESULT' | 'NOTE';
  record_date: string;
  target_name_snapshot: string;
  observation: string;
  judgment: string;
  action_summary: string;
  action_options: string[];
  requires_follow_up: boolean;
  follow_up_date: string | null;
  follow_up_method: string | null;
  expected_result: string | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  notes: string | null;
};

export type EntityMention = {
  type: 'STORE' | 'EMPLOYEE';
  text: string;
};

export type EntityMatch = {
  type: 'STORE' | 'EMPLOYEE';
  mention: string;
  status: 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND';
  confidence: number;
  candidates: Array<{
    id: string;
    label: string;
    code?: string | null;
    store_id?: string | null;
    store_label?: string | null;
    score: number;
  }>;
};

type StoreCandidate = {
  id: string;
  store_code?: string | null;
  store_name?: string | null;
  short_name?: string | null;
};

type EmployeeCandidate = {
  id: string;
  store_id?: string | null;
  employee_code?: string | null;
  employee_name?: string | null;
  current_position?: string | null;
  position?: string | null;
};

type AIParseResult = {
  draft?: Partial<VoiceDraft>;
  entity_mentions?: EntityMention[];
  confirmation_questions?: string[];
  warnings?: string[];
};

export function normalizeTranscript(value: unknown) {
  const transcript = String(value || '').trim();
  if (!transcript) throw new Error('請輸入口述文字稿');
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) throw new Error(`口述文字稿不可超過 ${MAX_TRANSCRIPT_LENGTH} 字`);
  return transcript;
}

export function todayTaipeiDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

function normalizeText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。,.、；;：:()（）［\]\[\-_/]/g, '');
}

function firstSentence(transcript: string) {
  return transcript.split(/[。！？!?；;]/).map((item) => item.trim()).find(Boolean) || transcript.slice(0, 120);
}

function compactText(transcript: string, max = 120) {
  const text = transcript.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function inferActionOptions(transcript: string) {
  const options = new Set<string>();
  if (/說明|提醒|告知|溝通/.test(transcript)) options.add('現場說明');
  if (/約談|面談|主管/.test(transcript)) options.add('主管約談');
  if (/教育|訓練|教學|示範/.test(transcript)) options.add('教育訓練');
  if (/限期|期限|改善|要求/.test(transcript)) options.add('限期改善');
  if (/跨部門|總部|營業部|商品部|人資/.test(transcript)) options.add('跨部門協調');
  if (/文件|表單|照片|補件|補正/.test(transcript)) options.add('文件補正');
  if (/追蹤|下次|後續|再確認|持續/.test(transcript)) options.add('持續追蹤');
  return Array.from(options).filter((item) => ACTION_OPTIONS.includes(item));
}

function inferFollowUpMethod(transcript: string) {
  if (/現場|巡店|到店/.test(transcript)) return 'ONSITE';
  if (/電話|通話/.test(transcript)) return 'PHONE';
  if (/line|訊息|簡訊|群組/i.test(transcript)) return 'MESSAGE';
  if (/會議|開會/.test(transcript)) return 'MEETING';
  return null;
}

export function buildLocalDraft(transcript: string, mode: VoiceDraftMode): AIParseResult {
  const actionOptions = inferActionOptions(transcript);
  const requiresFollowUp = /追蹤|下次|明天|下週|後續|改善|再確認|期限/.test(transcript);

  return {
    draft: {
      mode,
      record_type: mode === 'FOLLOWUP_DRAFT' ? 'FOLLOW_UP' : 'MANAGEMENT',
      record_date: todayTaipeiDate(),
      target_name_snapshot: '',
      observation: firstSentence(transcript),
      judgment: /判斷|原因|因為|主要是/.test(transcript)
        ? compactText(transcript, 140)
        : '需人工確認管理判斷',
      action_summary: /要求|提醒|已|請|安排|追蹤|改善/.test(transcript)
        ? compactText(transcript, 140)
        : '依口述內容建立管理紀錄草稿，請人工補齊管理動作。',
      action_options: actionOptions,
      requires_follow_up: requiresFollowUp,
      follow_up_date: null,
      follow_up_method: requiresFollowUp ? inferFollowUpMethod(transcript) : null,
      expected_result: requiresFollowUp ? '請確認後續改善狀況' : null,
      confidence: 'LOW',
      notes: '未使用 AI 模型，已用本機規則產生草稿，請人工確認。',
    },
    entity_mentions: extractEntityMentions(transcript),
    confirmation_questions: ['請確認管理對象、管理判斷與管理動作是否正確。'],
    warnings: ['OPENAI_API_KEY 未設定或 AI 解析不可用時，系統只會產生本機規則草稿。'],
  };
}

export function extractEntityMentions(transcript: string): EntityMention[] {
  const mentions: EntityMention[] = [];
  const employeeCodes = transcript.match(/FK\d{3,5}/gi) || [];
  for (const code of employeeCodes) {
    mentions.push({ type: 'EMPLOYEE', text: code.toUpperCase() });
  }

  const storeCodeMatches = transcript.match(/(?:門市|店號|店)\s*([A-Z]{0,3}\d{2,5})/gi) || [];
  for (const raw of storeCodeMatches) {
    const text = raw.replace(/門市|店號|店|\s/gi, '').toUpperCase();
    if (text) mentions.push({ type: 'STORE', text });
  }

  return mentions;
}

function scoreCandidate(mention: string, values: unknown[]) {
  const m = normalizeText(mention);
  if (!m) return 0;
  let best = 0;
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (normalized === m) best = Math.max(best, 1);
    else if (normalized.includes(m) || m.includes(normalized)) best = Math.max(best, 0.82);
    else if (normalized.startsWith(m) || m.startsWith(normalized)) best = Math.max(best, 0.72);
  }
  return best;
}

function dedupeMentions(mentions: EntityMention[]) {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    const key = `${mention.type}:${normalizeText(mention.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadCandidates(supabase: SupabaseClient) {
  const [storesResult, employeesResult] = await Promise.all([
    supabase
      .from('stores')
      .select('id, store_code, store_name, short_name')
      .eq('is_active', true)
      .limit(300),
    supabase
      .from('store_employees')
      .select('id, store_id, employee_code, employee_name, current_position, position, is_active')
      .eq('is_active', true)
      .limit(800),
  ]);

  if (storesResult.error) throw storesResult.error;
  if (employeesResult.error) throw employeesResult.error;

  return {
    stores: (storesResult.data || []) as StoreCandidate[],
    employees: (employeesResult.data || []) as EmployeeCandidate[],
  };
}

export async function matchEntities(
  supabase: SupabaseClient,
  transcript: string,
  aiMentions: EntityMention[] = []
): Promise<EntityMatch[]> {
  const { stores, employees } = await loadCandidates(supabase);
  const storeLabelById = new Map(stores.map((store) => [
    store.id,
    [store.store_code, store.short_name || store.store_name].filter(Boolean).join(' '),
  ]));
  const mentions = dedupeMentions([
    ...extractEntityMentions(transcript),
    ...aiMentions.filter((mention) => mention?.text && (mention.type === 'STORE' || mention.type === 'EMPLOYEE')),
  ]);

  const matches: EntityMatch[] = [];

  for (const mention of mentions) {
    if (mention.type === 'STORE') {
      const candidates = stores
        .map((store) => ({
          id: store.id,
          label: [store.store_code, store.short_name || store.store_name].filter(Boolean).join(' '),
          code: store.store_code || null,
          score: scoreCandidate(mention.text, [store.store_code, store.store_name, store.short_name]),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const topScore = candidates[0]?.score || 0;
      const status = topScore >= 0.95 && candidates.filter((item) => item.score === topScore).length === 1
        ? 'MATCHED'
        : candidates.length > 0
          ? 'AMBIGUOUS'
          : 'NOT_FOUND';
      matches.push({ type: 'STORE', mention: mention.text, status, confidence: topScore, candidates });
    }

    if (mention.type === 'EMPLOYEE') {
      const candidates = employees
        .map((employee) => ({
          id: employee.id,
          label: [employee.employee_code, employee.employee_name, employee.current_position || employee.position].filter(Boolean).join(' '),
          code: employee.employee_code || null,
          store_id: employee.store_id || null,
          store_label: employee.store_id ? storeLabelById.get(employee.store_id) || null : null,
          score: scoreCandidate(mention.text, [employee.employee_code, employee.employee_name]),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const topScore = candidates[0]?.score || 0;
      const status = topScore >= 0.95 && candidates.filter((item) => item.score === topScore).length === 1
        ? 'MATCHED'
        : candidates.length > 0
          ? 'AMBIGUOUS'
          : 'NOT_FOUND';
      matches.push({ type: 'EMPLOYEE', mention: mention.text, status, confidence: topScore, candidates });
    }
  }

  return matches;
}

function sanitizeAIJson(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

export async function parseDraftWithOpenAI(params: {
  transcript: string;
  mode: VoiceDraftMode;
  categories: Array<{ code: string; name: string }>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_SML_VOICE_DRAFT_MODEL || 'gpt-4o-mini';
  const system = [
    '你是督導管理紀錄整理助手。你只把中文口述轉成 JSON 草稿。',
    '不得產生 store_id、employee_id、profile_id 或任何正式資料庫 ID。',
    '只能輸出 transcript 中可追溯的內容，不得補充口述沒有說的事。',
    '正式 Entity Matching 由 application layer 完成，你只能列 entity_mentions。',
    '只輸出 JSON，不要 markdown。',
  ].join('\n');
  const user = {
    mode: params.mode,
    today: todayTaipeiDate(),
    allowed_action_options: ACTION_OPTIONS,
    allowed_follow_up_methods: Array.from(FOLLOW_UP_METHODS),
    active_categories: params.categories,
    transcript: params.transcript,
    expected_json_shape: {
      draft: {
        mode: params.mode,
        record_type: 'MANAGEMENT',
        record_date: 'YYYY-MM-DD',
        target_name_snapshot: '',
        observation: '',
        judgment: '',
        action_summary: '',
        action_options: [],
        requires_follow_up: false,
        follow_up_date: null,
        follow_up_method: null,
        expected_result: null,
        confidence: 'LOW|MEDIUM|HIGH',
        notes: null,
      },
      entity_mentions: [{ type: 'STORE|EMPLOYEE', text: '' }],
      confirmation_questions: [],
      warnings: [],
    },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      temperature: 0.1,
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || 'AI 結構化草稿產生失敗');
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 未回傳草稿內容');
  return JSON.parse(sanitizeAIJson(content)) as AIParseResult;
}

export function normalizeDraft(raw: Partial<VoiceDraft> | undefined, mode: VoiceDraftMode, transcript: string): VoiceDraft {
  const local = buildLocalDraft(transcript, mode).draft as VoiceDraft;
  const actionOptions = Array.isArray(raw?.action_options)
    ? raw.action_options.map(String).filter((item) => ACTION_OPTIONS.includes(item))
    : local.action_options;
  const followUpMethod = raw?.follow_up_method ? String(raw.follow_up_method).toUpperCase() : null;

  return {
    mode,
    record_type: raw?.record_type && ['MANAGEMENT', 'FOLLOW_UP', 'RESULT', 'NOTE'].includes(raw.record_type) ? raw.record_type : local.record_type,
    record_date: raw?.record_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.record_date) ? raw.record_date : todayTaipeiDate(),
    target_name_snapshot: String(raw?.target_name_snapshot || '').trim(),
    observation: String(raw?.observation || local.observation).trim().slice(0, 2000),
    judgment: String(raw?.judgment || local.judgment).trim().slice(0, 2000),
    action_summary: String(raw?.action_summary || local.action_summary).trim().slice(0, 2000),
    action_options: actionOptions,
    requires_follow_up: raw?.requires_follow_up === true,
    follow_up_date: raw?.follow_up_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.follow_up_date) ? raw.follow_up_date : null,
    follow_up_method: followUpMethod && FOLLOW_UP_METHODS.has(followUpMethod) ? followUpMethod : null,
    expected_result: raw?.expected_result ? String(raw.expected_result).trim().slice(0, 500) : null,
    confidence: raw?.confidence && ['LOW', 'MEDIUM', 'HIGH'].includes(raw.confidence) ? raw.confidence : local.confidence,
    notes: raw?.notes ? String(raw.notes).trim().slice(0, 500) : local.notes,
  };
}

export function getBlockingFields(draft: VoiceDraft, entityMatches: EntityMatch[]) {
  const fields: string[] = [];
  if (!draft.target_name_snapshot.trim() && entityMatches.length === 0) fields.push('管理對象');
  if (!draft.observation.trim()) fields.push('發現或觀察');
  if (!draft.judgment.trim()) fields.push('管理判斷');
  if (!draft.action_summary.trim()) fields.push('管理動作');
  if (draft.requires_follow_up && !draft.follow_up_date) fields.push('追蹤日期');
  return fields;
}
