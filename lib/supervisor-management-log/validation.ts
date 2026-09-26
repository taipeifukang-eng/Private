const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SYSTEM_FIELDS = new Set([
  'id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'deleted_at',
  'deleted_by',
  'deletion_reason',
]);

const CASE_TARGET_TYPES = new Set(['STORE', 'EMPLOYEE', 'AREA', 'CROSS_DEPARTMENT', 'OTHER']);
const CASE_STATUSES = new Set(['OPEN', 'FOLLOW_UP', 'IMPROVING', 'RESOLVED', 'CLOSED', 'CANCELLED']);
const CASE_PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const RECORD_TYPES = new Set(['MANAGEMENT', 'FOLLOW_UP', 'RESULT', 'NOTE']);
const FOLLOWUP_STATUSES = new Set(['IMPROVED', 'IMPROVING', 'NOT_IMPROVED', 'POSTPONED', 'CLOSED']);
const DAILY_PLAN_STATUSES = new Set(['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

type AnyRecord = Record<string, unknown>;

function assertPlainObject(value: unknown, name: string): asserts value is AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} 必須是 JSON object`);
  }
}

function rejectSystemFields(payload: AnyRecord) {
  for (const field of Object.keys(payload)) {
    if (SYSTEM_FIELDS.has(field)) {
      throw new Error(`欄位 ${field} 不可由 Client 指定`);
    }
  }
}

function optionalText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function requiredText(value: unknown, label: string) {
  const text = optionalText(value);
  if (!text) throw new Error(`請輸入${label}`);
  return text;
}

function optionalUuid(value: unknown, label: string) {
  const text = optionalText(value);
  if (!text) return null;
  if (!UUID_RE.test(text)) throw new Error(`${label}格式錯誤`);
  return text;
}

export function validateUuid(value: unknown, label: string) {
  const text = requiredText(value, label);
  if (!UUID_RE.test(text)) throw new Error(`${label}格式錯誤`);
  return text;
}

function enumValue(value: unknown, values: Set<string>, label: string, fallback?: string) {
  const text = optionalText(value)?.toUpperCase() || fallback;
  if (!text || !values.has(text)) throw new Error(`${label}錯誤`);
  return text;
}

function optionalDate(value: unknown, label: string) {
  const text = optionalText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label}格式錯誤`);
  return text;
}

function optionalTimestamp(value: unknown, label: string) {
  const text = optionalText(value);
  if (!text) return null;
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new Error(`${label}格式錯誤`);
  return new Date(time).toISOString();
}

function optionalMetadata(value: unknown) {
  if (value === undefined || value === null) return {};
  assertPlainObject(value, 'metadata');
  return value;
}

export function validateCasePayload(body: unknown, options: { partial?: boolean } = {}) {
  assertPlainObject(body, '督導管理案件資料');
  rejectSystemFields(body);

  const targetType = body.target_type !== undefined || !options.partial
    ? enumValue(body.target_type, CASE_TARGET_TYPES, '目標類型', 'STORE')
    : undefined;
  const storeId = optionalUuid(body.store_id, '門市 id');
  const employeeId = optionalUuid(body.employee_id, '員工 id');

  if (targetType === 'STORE' && !storeId) throw new Error('門市目標必須選擇門市');
  if (targetType === 'EMPLOYEE' && !employeeId) throw new Error('人員目標必須選擇員工');

  const payload: AnyRecord = {
    ...(body.case_no !== undefined ? { case_no: optionalText(body.case_no) } : {}),
    ...(body.title !== undefined || !options.partial ? { title: requiredText(body.title, '案件標題') } : {}),
    ...(body.category_id !== undefined ? { category_id: optionalUuid(body.category_id, '分類 id') } : {}),
    ...(body.assigned_user_id !== undefined ? { assigned_user_id: optionalUuid(body.assigned_user_id, '指派人員 id') } : {}),
    ...(targetType ? { target_type: targetType } : {}),
    ...(body.store_id !== undefined || !options.partial ? { store_id: storeId } : {}),
    ...(body.employee_id !== undefined || !options.partial ? { employee_id: employeeId } : {}),
    ...(body.target_name_snapshot !== undefined || !options.partial
      ? { target_name_snapshot: requiredText(body.target_name_snapshot, '管理對象') }
      : {}),
    ...(body.status !== undefined ? { status: enumValue(body.status, CASE_STATUSES, '案件狀態') } : {}),
    ...(body.priority !== undefined || !options.partial ? { priority: enumValue(body.priority, CASE_PRIORITIES, '優先程度', 'NORMAL') } : {}),
    ...(body.next_follow_up_at !== undefined ? { next_follow_up_at: optionalDate(body.next_follow_up_at, '下次追蹤日期') } : {}),
    ...(body.summary !== undefined ? { summary: optionalText(body.summary) } : {}),
    ...(body.metadata !== undefined ? { metadata: optionalMetadata(body.metadata) } : {}),
  };

  return payload;
}

export function validateRecordPayload(body: unknown) {
  assertPlainObject(body, '督導管理紀錄資料');
  rejectSystemFields(body);

  return {
    record_type: enumValue(body.record_type, RECORD_TYPES, '紀錄類型', 'MANAGEMENT'),
    record_date: optionalDate(body.record_date, '紀錄日期') || new Date().toISOString().slice(0, 10),
    store_id: optionalUuid(body.store_id, '門市 id'),
    employee_id: optionalUuid(body.employee_id, '員工 id'),
    category_id: optionalUuid(body.category_id, '分類 id'),
    target_name_snapshot: requiredText(body.target_name_snapshot, '管理對象'),
    observation: requiredText(body.observation, '發現或觀察'),
    judgment: requiredText(body.judgment, '管理判斷'),
    action_summary: requiredText(body.action_summary, '管理動作'),
    action_options: Array.isArray(body.action_options) ? body.action_options.map(String).map((item) => item.trim()).filter(Boolean) : [],
    requires_follow_up: body.requires_follow_up === true,
    follow_up_date: optionalDate(body.follow_up_date, '追蹤日期'),
    follow_up_owner_id: optionalUuid(body.follow_up_owner_id, '追蹤負責人 id'),
    expected_result: optionalText(body.expected_result),
    follow_up_method: optionalText(body.follow_up_method)?.toUpperCase() || null,
    ai_generated: body.ai_generated === true,
    ai_confirmed_by: optionalUuid(body.ai_confirmed_by, 'AI 確認人員 id'),
    metadata: optionalMetadata(body.metadata),
  };
}

export function validateFollowupPayload(body: unknown) {
  assertPlainObject(body, '督導追蹤紀錄資料');
  rejectSystemFields(body);

  return {
    source_record_id: optionalUuid(body.source_record_id, '來源紀錄 id'),
    follow_up_date: optionalDate(body.follow_up_date, '追蹤日期') || new Date().toISOString().slice(0, 10),
    result_status: enumValue(body.result_status, FOLLOWUP_STATUSES, '追蹤結果'),
    result_notes: requiredText(body.result_notes, '追蹤結果說明'),
    next_follow_up_date: optionalDate(body.next_follow_up_date, '下次追蹤日期'),
    metadata: optionalMetadata(body.metadata),
  };
}

export function validateDailyPlanPayload(body: unknown, options: { partial?: boolean } = {}) {
  assertPlainObject(body, '今日管理規劃資料');
  rejectSystemFields(body);

  const targetType = body.target_type !== undefined || !options.partial
    ? enumValue(body.target_type, CASE_TARGET_TYPES, '目標類型', 'STORE')
    : undefined;
  const storeId = optionalUuid(body.store_id, '門市 id');
  const employeeId = optionalUuid(body.employee_id, '員工 id');

  if (targetType === 'STORE' && !storeId) throw new Error('門市目標必須選擇門市');
  if (targetType === 'EMPLOYEE' && !employeeId) throw new Error('人員目標必須選擇員工');

  const payload: AnyRecord = {
    ...(body.plan_date !== undefined || !options.partial ? { plan_date: optionalDate(body.plan_date, '規劃日期') || new Date().toISOString().slice(0, 10) } : {}),
    ...(targetType ? { target_type: targetType } : {}),
    ...(body.store_id !== undefined || !options.partial ? { store_id: storeId } : {}),
    ...(body.employee_id !== undefined || !options.partial ? { employee_id: employeeId } : {}),
    ...(body.target_name_snapshot !== undefined || !options.partial
      ? { target_name_snapshot: requiredText(body.target_name_snapshot, '管理對象') }
      : {}),
    ...(body.category_id !== undefined ? { category_id: optionalUuid(body.category_id, '分類 id') } : {}),
    ...(body.title !== undefined || !options.partial ? { title: requiredText(body.title, '今日管理事項') } : {}),
    ...(body.status !== undefined ? { status: enumValue(body.status, DAILY_PLAN_STATUSES, '規劃狀態') } : {}),
    ...(body.started_at !== undefined ? { started_at: optionalTimestamp(body.started_at, '開始時間') } : {}),
    ...(body.completed_at !== undefined ? { completed_at: optionalTimestamp(body.completed_at, '完成時間') } : {}),
    ...(body.linked_case_id !== undefined ? { linked_case_id: optionalUuid(body.linked_case_id, '關聯案件 id') } : {}),
    ...(body.linked_record_id !== undefined ? { linked_record_id: optionalUuid(body.linked_record_id, '關聯管理紀錄 id') } : {}),
    ...(body.notes !== undefined ? { notes: optionalText(body.notes) } : {}),
    ...(body.metadata !== undefined ? { metadata: optionalMetadata(body.metadata) } : {}),
  };

  return payload;
}

export function validateDeletionReason(body: unknown) {
  assertPlainObject(body, '刪除資料');
  return requiredText(body.deletion_reason, '刪除原因');
}
