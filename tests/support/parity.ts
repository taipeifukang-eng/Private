/**
 * 雙版本對等框架核心（T02）。
 *
 * 內容：
 * - parity map（tests/parity/map/<page>.json）與白名單（tests/parity/allowlist.json）的載入與驗證
 * - parity-report.json 的累積與寫出（tests/reports/<runId>/parity-report.json）
 * - 四種比對機制的可重用 helper：
 *     (1) compareApiRead       API 讀取對等（同角色分別呼叫舊 API 與 workspace API）
 *     (2) compareSideEffects   寫入後以 service role 回讀 DB，比對副作用（readRowsAsServiceRole 只讀）
 *     (3) compareTables        UI 擷取或匯出檔（xlsx / csv）逐欄比對（extractTableFromPage、readWorkbookRows）
 *     (4) 導覽可見性對等        見 tests/support/parity-nav.ts
 *
 * 規則（D07）：任何未列入白名單的差異都是 FAIL；列入白名單但 approvedBy 為 null 的差異標為
 * 「待核可」(pending-approval)，不算通過；只有 approvedBy 有值才算 allowed。
 *
 * 規則（decision: "fix"）：使用者裁定「必須改回舊行為」的差異，在白名單以 decision:'fix' + fixIn:'Wxx'
 * 登記（approvedBy 必須為 null；它不是被允許的差異）。命中者標為 must-fix（排序：fail > must-fix > pending-approval），
 * 報告 summary.mustFix 與 mustFix 清單會列出並附 fixIn，verdict 只要有 must-fix 就不是 PASS。
 * 為了不擋住無關工作項：must-fix 只有在環境變數 PARITY_ENFORCE_FIX 含該 fixIn（逗號分隔）或等於 all 時才讓測試失敗，
 * 否則只在測試加註解（annotation）。`npm run test:page -- <id>` 會自動設 PARITY_ENFORCE_FIX=<id>；
 * 最終回歸 F01 使用 `--enforce-fix all`。沒有 match 的 fix 條目只作登記，不自動套用。
 *
 * 此檔不 import @playwright/test 的執行期程式（只有型別），可直接在 Vitest 單元測試。
 * 不輸出任何金鑰、cookie、密碼；專案 ref 一律遮罩。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  compareRowSets,
  diffNormalized,
  normalize,
  normalizeRows,
  pick,
  type NormalizeRules,
  type RowSetComparison,
  type ValueDiff,
} from './normalize';

const nodeRequire = createRequire(path.join(__dirname, 'parity.ts'));

export const ROOT = path.resolve(__dirname, '..', '..');
export const PARITY_DIR = path.join(ROOT, 'tests', 'parity');
export const MAP_DIR = path.join(PARITY_DIR, 'map');
export const ALLOWLIST_FILE = path.join(PARITY_DIR, 'allowlist.json');
export const REPORTS_DIR = path.join(ROOT, 'tests', 'reports');

export type Mechanism = 'api-read' | 'write-readback' | 'ui-extract' | 'navigation';
export const MECHANISMS: readonly Mechanism[] = ['api-read', 'write-readback', 'ui-extract', 'navigation'];

// ---------------------------------------------------------------------------
// parity map
// ---------------------------------------------------------------------------

export interface LegacyApiSource {
  method?: string;
  /** 舊版 REST 路徑（app/api/**，非 workspace）。 */
  path: string;
  query?: Record<string, string>;
  /** 回應中要比對的子路徑（點路徑），省略代表整個回應。 */
  pick?: string;
}

export interface LegacyServerAction {
  /** 舊版 server action 檔案與名稱，例如 app/store/actions.ts#getMonthlyStaff。無 REST，需改走機制二或三。 */
  file: string;
  name: string;
}

export interface LegacyUiSource {
  /** 舊頁路由，例如 /monthly-status。 */
  route: string;
  /** 表格擷取選擇器。 */
  rowSelector: string;
  cellSelector?: string;
  headerSelector?: string;
}

export interface NativeApiSource {
  method?: string;
  /** /api/workspace/... */
  path: string;
  query?: Record<string, string>;
  pick?: string;
}

export interface ParityMapEntry {
  /** 此項目的短名，同一 map 內唯一。 */
  id: string;
  mechanism: Mechanism;
  description?: string;
  legacy: {
    api?: LegacyApiSource;
    serverAction?: LegacyServerAction;
    ui?: LegacyUiSource;
    /** 非 REST 來源的說明（例如 Navbar 權限碼規則所在檔案）。 */
    source?: string;
  };
  native: {
    api?: NativeApiSource;
    source?: string;
  };
  /** 比較鍵（單一欄位或複合鍵）。省略代表整體 deep equal。 */
  compareKey?: string | string[];
  /** 欄位對照（UI / xlsx 逐欄比對用）。 */
  columns?: ColumnSpec[];
  normalize?: NormalizeRules;
  /** 預期兩邊狀態碼不同的角色對照，僅供文件；實際差異仍需列入白名單。 */
  notes?: string;
}

export interface ParityMap {
  page: string;
  /** 舊版頁面路由（對應 route-inventory.json 的 legacyRoute）。 */
  legacyRoute?: string;
  /** 對應 README 的工作項 ID（如 P06）。 */
  workItem?: string;
  entries: ParityMapEntry[];
  /** 頁面專屬的額外資料（例如導覽規則表），由各 parity 測試自行解讀。 */
  [extra: string]: unknown;
}

export function loadMap(page: string, mapDir = MAP_DIR): ParityMap {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(page)) throw new Error(`parity map 名稱不合法：${page}`);
  const file = path.join(mapDir, `${page}.json`);
  const map = JSON.parse(fs.readFileSync(file, 'utf8')) as ParityMap;
  const errors = validateMap(map, page);
  if (errors.length) throw new Error(`parity map ${page}.json 不合法：\n- ${errors.join('\n- ')}`);
  return map;
}

export function listMaps(mapDir = MAP_DIR): string[] {
  if (!fs.existsSync(mapDir)) return [];
  return fs
    .readdirSync(mapDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function validateMap(map: ParityMap, expectedPage?: string): string[] {
  const errors: string[] = [];
  if (!map || typeof map !== 'object') return ['map 不是物件'];
  if (typeof map.page !== 'string' || !map.page) errors.push('缺少 page');
  if (expectedPage && map.page !== expectedPage) errors.push(`page(${map.page}) 與檔名(${expectedPage}) 不一致`);
  if (!Array.isArray(map.entries) || map.entries.length === 0) errors.push('entries 必須是非空陣列');
  const ids = new Set<string>();
  for (const [i, e] of Array.from((map.entries || []).entries())) {
    const tag = `entries[${i}]${e?.id ? `(${e.id})` : ''}`;
    if (!e?.id) errors.push(`${tag} 缺少 id`);
    else if (ids.has(e.id)) errors.push(`${tag} id 重複`);
    else ids.add(e.id);
    if (!MECHANISMS.includes(e?.mechanism)) errors.push(`${tag} mechanism 不合法：${String(e?.mechanism)}`);
    if (!e?.legacy || typeof e.legacy !== 'object') errors.push(`${tag} 缺少 legacy`);
    else if (!e.legacy.api && !e.legacy.serverAction && !e.legacy.ui && !e.legacy.source) {
      errors.push(`${tag} legacy 必須至少有 api / serverAction / ui / source 其中之一`);
    }
    if (!e?.native || typeof e.native !== 'object') errors.push(`${tag} 缺少 native`);
    else if (!e.native.api && !e.native.source) errors.push(`${tag} native 必須有 api 或 source`);
    if (e?.native?.api && !/^\/api\/workspace\//.test(e.native.api.path)) {
      errors.push(`${tag} native.api.path 必須以 /api/workspace/ 開頭`);
    }
    if (e?.legacy?.api && /^\/api\/workspace\//.test(e.legacy.api.path)) {
      errors.push(`${tag} legacy.api.path 不可是 /api/workspace/（那是新版）`);
    }
    if (e?.legacy?.api && e.legacy.api.method && !/^(GET|HEAD)$/i.test(e.legacy.api.method) && e.mechanism === 'api-read') {
      errors.push(`${tag} api-read 機制只允許 GET/HEAD`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 白名單
// ---------------------------------------------------------------------------

export interface AllowlistMatch {
  /** 差異類型，如 only-native、only-legacy、status、changed、count、type。 */
  kind?: string;
  /** 差異鍵（導覽為 href；API 為欄位路徑；列集合為比較鍵）。 */
  key?: string;
  /** 限定機制。 */
  mechanism?: Mechanism;
  /** 限定角色（role-matrix 的 account key）；省略代表所有角色。 */
  roles?: string[];
  /** 限定 map entry id。 */
  entry?: string;
}

export interface AllowlistEntry {
  id: string;
  page: string;
  description: string;
  reason: string;
  /** 使用者核可前為 null；null 的差異在報告中標為「待核可」。 */
  approvedBy: string | null;
  /** 此差異留待哪個工作項（例如 W25）以機制一／二驗證後再補 match；只登記、不自動套用。 */
  deferredTo?: string;
  /** 'fix'：使用者裁定必須改回舊行為（不是被允許的差異）。需搭配 fixIn，且 approvedBy 必須為 null。 */
  decision?: 'fix';
  /** decision 為 'fix' 時，應在哪個工作項（例如 W07）修正；該工作項執行時 PARITY_ENFORCE_FIX 會讓差異變成失敗。 */
  fixIn?: string;
  /** 自動套用條件。沒有 match 的條目只作登記，不會自動套用到任何差異。 */
  match?: AllowlistMatch;
}

export function validateAllowlist(list: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(list)) return ['allowlist 必須是陣列'];
  const ids = new Set<string>();
  list.forEach((e: Partial<AllowlistEntry>, i) => {
    const tag = `allowlist[${i}]${e?.id ? `(${e.id})` : ''}`;
    if (!e || typeof e !== 'object') {
      errors.push(`${tag} 不是物件`);
      return;
    }
    for (const f of ['id', 'page', 'description', 'reason'] as const) {
      if (typeof e[f] !== 'string' || !(e[f] as string).trim()) errors.push(`${tag} 缺少 ${f}`);
    }
    if (!('approvedBy' in e)) errors.push(`${tag} 缺少 approvedBy（未核可請填 null）`);
    else if (e.approvedBy !== null && (typeof e.approvedBy !== 'string' || !e.approvedBy.trim())) {
      errors.push(`${tag} approvedBy 必須是非空字串或 null`);
    }
    if (e.deferredTo !== undefined && (typeof e.deferredTo !== 'string' || !e.deferredTo.trim())) {
      errors.push(`${tag} deferredTo 必須是非空字串（工作項 ID）`);
    }
    if (e.decision !== undefined && e.decision !== 'fix') errors.push(`${tag} decision 目前只接受 "fix"`);
    if (e.fixIn !== undefined && (typeof e.fixIn !== 'string' || !e.fixIn.trim())) {
      errors.push(`${tag} fixIn 必須是非空字串（工作項 ID）`);
    }
    if (e.decision === 'fix') {
      if (typeof e.fixIn !== 'string' || !e.fixIn.trim()) errors.push(`${tag} decision 為 fix 時 fixIn 必須是非空字串`);
      if (e.approvedBy !== null) errors.push(`${tag} decision 為 fix 時 approvedBy 必須為 null（必須修正的差異不可標為已核可）`);
    }
    if (e.id) {
      if (ids.has(e.id)) errors.push(`${tag} id 重複`);
      ids.add(e.id);
    }
    if (e.match !== undefined) {
      if (typeof e.match !== 'object' || e.match === null) errors.push(`${tag} match 必須是物件`);
      else {
        if (e.match.mechanism && !MECHANISMS.includes(e.match.mechanism)) errors.push(`${tag} match.mechanism 不合法`);
        if (e.match.roles && !Array.isArray(e.match.roles)) errors.push(`${tag} match.roles 必須是陣列`);
        if (!e.match.kind && !e.match.key && !e.match.entry) errors.push(`${tag} match 至少要有 kind / key / entry 其中之一，避免範圍過大`);
      }
    }
  });
  return errors;
}

export function loadAllowlist(file = ALLOWLIST_FILE): AllowlistEntry[] {
  const list = JSON.parse(fs.readFileSync(file, 'utf8')) as AllowlistEntry[];
  const errors = validateAllowlist(list);
  if (errors.length) throw new Error(`allowlist.json 不合法：\n- ${errors.join('\n- ')}`);
  return list;
}

export type AllowlistStatus = 'approved' | 'pending-approval' | 'must-fix';

export interface Diff {
  /** status：HTTP 狀態不一致；count：筆數不一致；其餘同 DiffKind；column-missing：欄位在其中一邊不存在。 */
  kind: string;
  /** 差異鍵：導覽為 href、欄位差異為欄位路徑、列差異為比較鍵。 */
  key: string;
  legacy?: unknown;
  native?: unknown;
  detail?: string;
  allowlistId?: string;
  allowlistStatus?: AllowlistStatus;
  /** allowlistStatus 為 must-fix 時，應修正的工作項。 */
  fixIn?: string;
}

export interface DiffContext {
  page: string;
  mechanism: Mechanism;
  entry?: string;
  role?: string;
}

export function matchAllowlist(diff: Diff, ctx: DiffContext, allowlist: AllowlistEntry[]): AllowlistEntry | null {
  for (const a of allowlist) {
    if (a.page !== ctx.page || !a.match) continue;
    const m = a.match;
    if (m.mechanism && m.mechanism !== ctx.mechanism) continue;
    if (m.entry && m.entry !== ctx.entry) continue;
    if (m.kind && m.kind !== diff.kind) continue;
    // key 可為完整差異鍵，或欄位路徑（比對任何列的 `<列鍵>#<欄位>`）。
    if (m.key && m.key !== diff.key && !diff.key.endsWith(`#${m.key}`)) continue;
    if (m.roles && (!ctx.role || !m.roles.includes(ctx.role))) continue;
    return a;
  }
  return null;
}

export type EntryStatus = 'pass' | 'allowed' | 'pending-approval' | 'must-fix' | 'fail';

/** 把每個差異標上白名單狀態，回傳整體狀態。未命中白名單 = fail；命中但未核可 = pending-approval。 */
export function classify(diffs: Diff[], ctx: DiffContext, allowlist: AllowlistEntry[]): { status: EntryStatus; diffs: Diff[] } {
  const marked = diffs.map((d) => {
    const hit = matchAllowlist(d, ctx, allowlist);
    if (!hit) return { ...d };
    if (hit.decision === 'fix') {
      return { ...d, allowlistId: hit.id, allowlistStatus: 'must-fix' as AllowlistStatus, fixIn: hit.fixIn };
    }
    return { ...d, allowlistId: hit.id, allowlistStatus: (hit.approvedBy ? 'approved' : 'pending-approval') as AllowlistStatus };
  });
  let status: EntryStatus = 'pass';
  if (marked.some((d) => !d.allowlistId)) status = 'fail';
  else if (marked.some((d) => d.allowlistStatus === 'must-fix')) status = 'must-fix';
  else if (marked.some((d) => d.allowlistStatus === 'pending-approval')) status = 'pending-approval';
  else if (marked.length) status = 'allowed';
  return { status, diffs: marked };
}

// ---------------------------------------------------------------------------
// 報告
// ---------------------------------------------------------------------------

export interface ParityEntryResult {
  /** 唯一識別：page/entry/role。 */
  id: string;
  page: string;
  entry: string;
  mechanism: Mechanism;
  role?: string;
  title: string;
  legacy: { endpoint: string; status?: number | string };
  native: { endpoint: string; status?: number | string };
  /** 比對的資料量（筆數、導覽項目數等）。 */
  compared: Record<string, number | string | boolean>;
  status: EntryStatus;
  diffs: Diff[];
  durationMs?: number;
}

export interface ParityReport {
  runId: string;
  generatedAt: string;
  environment: 'DEV';
  verdict: 'PASS' | 'PENDING_APPROVAL' | 'MUST_FIX' | 'FAIL';
  summary: { total: number; pass: number; allowed: number; pendingApproval: number; mustFix: number; fail: number };
  /** 本次執行出現過、狀態為待核可的白名單條目（供使用者核可）。 */
  pendingAllowlist: { id: string; page: string; description: string; hits: number }[];
  /** 本次執行出現過、decision 為 fix 的白名單條目（必須在 fixIn 工作項改回舊行為）。 */
  mustFix: { id: string; page: string; description: string; fixIn: string; hits: number }[];
  entries: ParityEntryResult[];
}

export function summarize(entries: ParityEntryResult[]): ParityReport['summary'] {
  const s = { total: entries.length, pass: 0, allowed: 0, pendingApproval: 0, mustFix: 0, fail: 0 };
  for (const e of entries) {
    if (e.status === 'pass') s.pass += 1;
    else if (e.status === 'allowed') s.allowed += 1;
    else if (e.status === 'pending-approval') s.pendingApproval += 1;
    else if (e.status === 'must-fix') s.mustFix += 1;
    else s.fail += 1;
  }
  return s;
}

export function buildReport(runId: string, entries: ParityEntryResult[], allowlist: AllowlistEntry[], now = new Date()): ParityReport {
  const summary = summarize(entries);
  const hits = new Map<string, number>();
  const fixHits = new Map<string, number>();
  for (const e of entries) {
    for (const d of e.diffs) {
      if (d.allowlistId && d.allowlistStatus === 'pending-approval') hits.set(d.allowlistId, (hits.get(d.allowlistId) || 0) + 1);
      if (d.allowlistId && d.allowlistStatus === 'must-fix') fixHits.set(d.allowlistId, (fixHits.get(d.allowlistId) || 0) + 1);
    }
  }
  const pendingAllowlist = allowlist
    .filter((a) => hits.has(a.id))
    .map((a) => ({ id: a.id, page: a.page, description: a.description, hits: hits.get(a.id) as number }));
  const mustFix = allowlist
    .filter((a) => fixHits.has(a.id))
    .map((a) => ({ id: a.id, page: a.page, description: a.description, fixIn: a.fixIn as string, hits: fixHits.get(a.id) as number }));
  return {
    runId,
    generatedAt: now.toISOString(),
    environment: 'DEV',
    verdict: summary.fail ? 'FAIL' : summary.mustFix ? 'MUST_FIX' : summary.pendingApproval ? 'PENDING_APPROVAL' : 'PASS',
    summary,
    pendingAllowlist,
    mustFix,
    entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const RUN_ID_RE = /^T\d{8}-[a-z0-9]{4}$/;

export function currentRunId(): string {
  const id = process.env.TEST_RUN_ID;
  if (!id) throw new Error('TEST_RUN_ID 未設定（請經由 playwright.config.ts 或 tests/run-all.cjs 執行）');
  if (!RUN_ID_RE.test(id)) throw new Error(`TEST_RUN_ID 格式不正確：${id}`);
  return id;
}

export function reportPath(runId: string, reportsDir = REPORTS_DIR): string {
  if (!RUN_ID_RE.test(runId)) throw new Error(`runId 格式不正確：${runId}`);
  return path.join(reportsDir, runId, 'parity-report.json');
}

/**
 * 以 id 合併寫入 parity-report.json（同 id 後寫者覆蓋），讓多個 spec 檔／重啟的 worker 能累積到同一份報告。
 * 寫出後重算 summary / verdict。
 */
export function writeParityEntries(
  results: ParityEntryResult[],
  opts: { runId?: string; reportsDir?: string; allowlist?: AllowlistEntry[] } = {},
): ParityReport {
  const runId = opts.runId || currentRunId();
  const file = reportPath(runId, opts.reportsDir);
  let existing: ParityEntryResult[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ParityReport;
    if (Array.isArray(parsed.entries)) existing = parsed.entries;
  } catch {
    // 尚無報告
  }
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const r of results) byId.set(r.id, r);
  const allowlist = opts.allowlist || loadAllowlist();
  const report = buildReport(runId, Array.from(byId.values()), allowlist);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return report;
}

/** 累積結果並在每次 add 後寫出，測試中途失敗也不會丟失已比對的內容。 */
export class ParityRecorder {
  private readonly allowlist: AllowlistEntry[];

  constructor(
    private readonly page: string,
    private readonly opts: { runId?: string; reportsDir?: string; allowlist?: AllowlistEntry[] } = {},
  ) {
    this.allowlist = opts.allowlist || loadAllowlist();
  }

  get allowlistEntries(): AllowlistEntry[] {
    return this.allowlist;
  }

  /** 以差異清單建立結果並寫入報告。 */
  record(input: Omit<ParityEntryResult, 'id' | 'page' | 'status' | 'diffs'> & { diffs: Diff[] }): ParityEntryResult {
    const ctx: DiffContext = { page: this.page, mechanism: input.mechanism, entry: input.entry, role: input.role };
    const { status, diffs } = classify(input.diffs, ctx, this.allowlist);
    const result: ParityEntryResult = {
      ...input,
      id: [this.page, input.entry, input.role || '-'].join('/'),
      page: this.page,
      status,
      diffs,
    };
    writeParityEntries([result], { ...this.opts, allowlist: this.allowlist });
    return result;
  }
}

/** 解析 PARITY_ENFORCE_FIX（逗號分隔的 fixIn，或 all）。 */
export function parseEnforceFix(raw: string | undefined): { all: boolean; ids: Set<string> } {
  const ids = new Set(
    String(raw || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
  return { all: ids.has('all'), ids };
}

export function isFixEnforced(fixIn: string | undefined, raw: string | undefined = process.env.PARITY_ENFORCE_FIX): boolean {
  const e = parseEnforceFix(raw);
  return e.all || (!!fixIn && e.ids.has(fixIn));
}

export interface AssertOptions {
  /** 預設讀 process.env.PARITY_ENFORCE_FIX。 */
  enforceFix?: string;
  /** must-fix 未被強制時的註解輸出；預設加到目前的 Playwright test（不在 test 內則忽略）。 */
  annotate?: (a: { type: string; description: string }) => void;
}

function defaultAnnotate(a: { type: string; description: string }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pw = nodeRequire('@playwright/test') as { test: { info(): { annotations: { type: string; description?: string }[] } } };
    pw.test.info().annotations.push(a);
  } catch {
    // 不在 Playwright test 內（例如單元測試）：略過
  }
}

/**
 * 斷言：fail 讓測試失敗；pending-approval 不算通過但不擋 CI，由報告 verdict 呈現。
 * must-fix 只有在 PARITY_ENFORCE_FIX 含其 fixIn（或 all）時才失敗，否則只加註解、不失敗。
 */
export function assertNoUnlistedDiffs(result: ParityEntryResult, opts: AssertOptions = {}): void {
  if (result.status === 'fail') {
    const lines = result.diffs
      .filter((d) => !d.allowlistId)
      .slice(0, 20)
      .map((d) => `  [${d.kind}] ${d.key}${d.detail ? ` — ${d.detail}` : ''}`);
    throw new Error(`對等比對失敗 ${result.id}：${result.diffs.filter((d) => !d.allowlistId).length} 項未列白名單差異\n${lines.join('\n')}`);
  }
  const fixes = result.diffs.filter((d) => d.allowlistStatus === 'must-fix');
  if (!fixes.length) return;
  const raw = opts.enforceFix !== undefined ? opts.enforceFix : process.env.PARITY_ENFORCE_FIX;
  const enforced = fixes.filter((d) => isFixEnforced(d.fixIn, raw));
  if (enforced.length) {
    const lines = enforced.slice(0, 20).map((d) => `  [${d.kind}] ${d.key}（${d.allowlistId}，須於 ${d.fixIn} 修正）${d.detail ? ` — ${d.detail}` : ''}`);
    throw new Error(`對等比對失敗 ${result.id}：${enforced.length} 項「必須改回舊行為」的差異尚未修正\n${lines.join('\n')}`);
  }
  const pending = Array.from(new Set(fixes.map((d) => `${d.allowlistId}→${d.fixIn}`)));
  (opts.annotate || defaultAnnotate)({ type: 'must-fix', description: `必須於對應工作項修正的差異（未強制）：${pending.join(', ')}` });
}

// ---------------------------------------------------------------------------
// 共用：ValueDiff / RowSetComparison 轉 Diff
// ---------------------------------------------------------------------------

export function valueDiffsToDiffs(diffs: ValueDiff[], prefix = ''): Diff[] {
  return diffs.map((d) => ({
    kind: d.kind,
    key: prefix ? `${prefix}${d.path.startsWith('[') ? '' : '.'}${d.path}` : d.path,
    legacy: d.legacy,
    native: d.native,
  }));
}

export function rowSetToDiffs(cmp: RowSetComparison): Diff[] {
  const out: Diff[] = [];
  if (cmp.legacyCount !== cmp.nativeCount) {
    out.push({ kind: 'count', key: '(rows)', legacy: cmp.legacyCount, native: cmp.nativeCount });
  }
  for (const k of cmp.onlyLegacy) out.push({ kind: 'only-legacy', key: k, detail: '舊版有、新版沒有的列' });
  for (const k of cmp.onlyNative) out.push({ kind: 'only-native', key: k, detail: '新版有、舊版沒有的列' });
  for (const d of cmp.duplicateKeys) out.push({ kind: 'duplicate-key', key: d.key, detail: `${d.side} 比較鍵重複` });
  for (const f of cmp.fieldDiffs) {
    for (const d of f.diffs) out.push({ kind: d.kind, key: `${f.key}#${d.path}`, legacy: d.legacy, native: d.native });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 機制一：API 讀取對等
// ---------------------------------------------------------------------------

/** APIRequestContext 的最小子集合，方便以假物件做單元測試。 */
export interface ApiLike {
  fetch(
    url: string,
    options?: { method?: string; params?: Record<string, string>; data?: unknown },
  ): Promise<{ status(): number; text(): Promise<string> }>;
}

async function callJson(api: ApiLike, src: { method?: string; path: string; query?: Record<string, string> }) {
  const res = await api.fetch(src.path, { method: src.method || 'GET', params: src.query });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __nonJson: text.slice(0, 200) };
  }
  return { status: res.status(), body };
}

export interface ApiReadInput {
  recorder: ParityRecorder;
  entry: string;
  title: string;
  role: string;
  legacyApi: ApiLike;
  /** 預設與 legacyApi 同一個（integrated 模式 cookie 共用）。 */
  nativeApi?: ApiLike;
  legacy: LegacyApiSource;
  native: NativeApiSource;
  rules?: NormalizeRules;
  /** 兩邊都是物件陣列時的比較鍵。 */
  compareKey?: string | string[];
}

/**
 * 同一個角色分別呼叫舊 API 與 workspace API：
 * 1. 狀態碼必須一致（不一致 → kind=status）。
 * 2. 都是 2xx 時，取 pick 子路徑、正規化後做深度比對；兩邊是陣列且有 compareKey 時，以鍵配對逐欄比對並比對筆數。
 */
export async function compareApiRead(input: ApiReadInput) {
  const started = Date.now();
  const nativeApi = input.nativeApi || input.legacyApi;
  const [l, n] = await Promise.all([callJson(input.legacyApi, input.legacy), callJson(nativeApi, input.native)]);
  const diffs: Diff[] = [];
  const compared: Record<string, number | string | boolean> = {};

  if (l.status !== n.status) {
    diffs.push({ kind: 'status', key: 'http-status', legacy: l.status, native: n.status, detail: `舊 ${l.status} / 新 ${n.status}` });
  } else if (l.status >= 200 && l.status < 300) {
    const rules = input.rules || {};
    const lv = normalize(pick(l.body, input.legacy.pick), rules);
    const nv = normalize(pick(n.body, input.native.pick), rules);
    if (Array.isArray(lv) && Array.isArray(nv)) {
      compared.legacyRows = lv.length;
      compared.nativeRows = nv.length;
      if (input.compareKey) {
        diffs.push(...rowSetToDiffs(compareRowSets(lv as Record<string, unknown>[], nv as Record<string, unknown>[], input.compareKey)));
      } else {
        diffs.push(...valueDiffsToDiffs(diffNormalized(lv, nv)));
      }
    } else {
      diffs.push(...valueDiffsToDiffs(diffNormalized(lv, nv)));
    }
  } else {
    compared.bothStatus = l.status;
  }

  return input.recorder.record({
    entry: input.entry,
    mechanism: 'api-read',
    role: input.role,
    title: input.title,
    legacy: { endpoint: `${input.legacy.method || 'GET'} ${input.legacy.path}`, status: l.status },
    native: { endpoint: `${input.native.method || 'GET'} ${input.native.path}`, status: n.status },
    compared,
    diffs,
    durationMs: Date.now() - started,
  });
}

// ---------------------------------------------------------------------------
// 機制二：寫入後以 service role 回讀 DB 比對副作用
// ---------------------------------------------------------------------------

export interface SideEffectTable {
  /** 表名（報告用）。 */
  table: string;
  /** 舊版寫入後回讀的列。 */
  legacyRows: Record<string, unknown>[];
  /** 新版寫入後回讀的列。 */
  nativeRows: Record<string, unknown>[];
  /** 比較鍵（必須是兩份 fixture 之間對應的業務鍵，例如員編後綴，不是 uuid）。 */
  key: string | string[];
  /** 正規化規則：務必 ignore 兩份 fixture 之間必然不同的欄位（id、created_at、fixture 標記…）。 */
  rules?: NormalizeRules;
}

export interface SideEffectsInput {
  recorder: ParityRecorder;
  entry: string;
  title: string;
  role?: string;
  /** 描述寫入動作，報告用，例如 'POST /api/employees' 與 'POST /api/workspace/employees'。 */
  legacyAction: string;
  nativeAction: string;
  tables: SideEffectTable[];
}

/**
 * 兩份相同 fixture（A 走舊版寫入、B 走新版寫入）寫完後，比對業務欄位與附帶副作用
 * （例如 employee_movement_history、monthly_staff_status、audit/log）。本函式本身不連線、不寫入，
 * 資料由呼叫端以 readRowsAsServiceRole 回讀後傳入。
 */
export function compareSideEffects(input: SideEffectsInput) {
  const diffs: Diff[] = [];
  const compared: Record<string, number | string | boolean> = {};
  for (const t of input.tables) {
    const rules = t.rules || {};
    const l = normalizeRows(t.legacyRows, rules);
    const n = normalizeRows(t.nativeRows, rules);
    compared[`${t.table}.legacyRows`] = l.length;
    compared[`${t.table}.nativeRows`] = n.length;
    for (const d of rowSetToDiffs(compareRowSets(l, n, t.key))) {
      diffs.push({ ...d, key: `${t.table}:${d.key}` });
    }
  }
  return input.recorder.record({
    entry: input.entry,
    mechanism: 'write-readback',
    role: input.role,
    title: input.title,
    legacy: { endpoint: input.legacyAction },
    native: { endpoint: input.nativeAction },
    compared,
    diffs,
  });
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const SELECT_RE = /^[a-z_*][a-z0-9_*,.:()!\s]*$/i;

export interface ReadRowsOptions {
  /** PostgREST select 字串，預設 *。 */
  select?: string;
  /** 等於條件。 */
  eq?: Record<string, string | number | boolean>;
  /** in 條件。 */
  in?: Record<string, (string | number)[]>;
  /** like 條件（用於 fixture 標記前綴，例如 { employee_id: 'ZT20261102%' }）。 */
  like?: Record<string, string>;
  order?: string;
  limit?: number;
  /** 注入測試用 client，跳過守衛與連線。 */
  client?: SupabaseReadClient;
}

export interface SupabaseReadClient {
  from(table: string): {
    select(columns: string): ReadQuery;
  };
}
interface ReadQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  eq(col: string, v: unknown): ReadQuery;
  in(col: string, v: unknown[]): ReadQuery;
  like(col: string, v: string): ReadQuery;
  order(col: string): ReadQuery;
  limit(n: number): ReadQuery;
}

/**
 * 只讀回讀：用通過 DEV 守衛的 service role 做 SELECT。沒有任何寫入路徑；表名、欄位名一律檢查字元。
 * 為避免誤讀大表，必須至少給一個 eq / in / like 條件。
 */
export async function readRowsAsServiceRole(table: string, opts: ReadRowsOptions): Promise<Record<string, unknown>[]> {
  if (!IDENT_RE.test(table)) throw new Error(`不合法的表名：${table}`);
  const select = opts.select || '*';
  if (!SELECT_RE.test(select)) throw new Error('select 字串含不允許的字元');
  const conds = [opts.eq, opts.in, opts.like].filter((c) => c && Object.keys(c).length);
  if (!conds.length) throw new Error('回讀必須至少有一個 eq / in / like 條件，避免全表掃描');
  for (const group of [opts.eq, opts.in, opts.like]) {
    for (const col of Object.keys(group || {})) if (!IDENT_RE.test(col)) throw new Error(`不合法的欄位名：${col}`);
  }

  let client = opts.client;
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
    const { env } = guard.assertDevEnvironment({ root: ROOT });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => SupabaseReadClient };
    client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  let q = client.from(table).select(select);
  for (const [c, v] of Object.entries(opts.eq || {})) q = q.eq(c, v);
  for (const [c, v] of Object.entries(opts.in || {})) q = q.in(c, v);
  for (const [c, v] of Object.entries(opts.like || {})) q = q.like(c, v);
  if (opts.order) q = q.order(opts.order);
  const limit = opts.limit ?? 1000;
  // 多取一列：若實際列數超過 limit，代表結果被截斷，直接 throw，避免以不完整資料比對。
  q = q.limit(limit + 1);
  const { data, error } = await q;
  if (error) throw new Error(`回讀 ${table} 失敗：${error.message}`);
  const rows = (data || []) as Record<string, unknown>[];
  if (rows.length > limit) {
    throw new Error(`回讀 ${table} 的列數超過 limit=${limit}，結果會被截斷；請縮小 eq / in / like 條件，或明確調高 limit`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 機制三：UI 擷取或匯出檔逐欄比對
// ---------------------------------------------------------------------------

export interface ColumnSpec {
  /** 比對用的正規欄位名。 */
  canonical: string;
  /** 舊版表頭／欄位名（UI 表頭文字或 xlsx 第一列）。 */
  legacy: string;
  /** 新版表頭／欄位名；省略代表與 legacy 相同。 */
  native?: string;
  type?: 'string' | 'number' | 'date' | 'datetime' | 'boolean';
}

export function columnsToRules(columns: ColumnSpec[], base: NormalizeRules = {}): NormalizeRules {
  const pickBy = (t: ColumnSpec['type']) => columns.filter((c) => c.type === t).map((c) => c.canonical);
  return {
    ...base,
    dateFields: [...(base.dateFields || []), ...pickBy('date')],
    datetimeFields: [...(base.datetimeFields || []), ...pickBy('datetime')],
    numberFields: [...(base.numberFields || []), ...pickBy('number')],
    booleanFields: [...(base.booleanFields || []), ...pickBy('boolean')],
  };
}

/** 把「表頭 → 值」的列依 ColumnSpec 轉成正規欄位名；回報表頭缺漏。 */
export function mapColumns(
  rows: Record<string, unknown>[],
  columns: ColumnSpec[],
  side: 'legacy' | 'native',
): { rows: Record<string, unknown>[]; missing: string[] } {
  const headers = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) headers.add(k);
  const missing: string[] = [];
  const nameOf = (c: ColumnSpec) => (side === 'native' ? c.native || c.legacy : c.legacy);
  for (const c of columns) if (rows.length && !headers.has(nameOf(c))) missing.push(nameOf(c));
  const out = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of columns) o[c.canonical] = r[nameOf(c)];
    return o;
  });
  return { rows: out, missing };
}

export interface TablesInput {
  recorder: ParityRecorder;
  entry: string;
  title: string;
  role?: string;
  legacySource: string;
  nativeSource: string;
  legacyRows: Record<string, unknown>[];
  nativeRows: Record<string, unknown>[];
  columns: ColumnSpec[];
  /** 比較鍵（正規欄位名）。 */
  key: string | string[];
  rules?: NormalizeRules;
}

/** 兩邊表格（UI 擷取或 xlsx）逐欄比對：表頭缺漏、筆數、以鍵配對後逐欄差異。 */
export function compareTables(input: TablesInput) {
  const diffs: Diff[] = [];
  const l = mapColumns(input.legacyRows, input.columns, 'legacy');
  const n = mapColumns(input.nativeRows, input.columns, 'native');
  for (const m of l.missing) diffs.push({ kind: 'column-missing', key: m, detail: '舊版缺少此欄' });
  for (const m of n.missing) diffs.push({ kind: 'column-missing', key: m, detail: '新版缺少此欄' });
  const rules = columnsToRules(input.columns, input.rules);
  const lr = normalizeRows(l.rows, rules);
  const nr = normalizeRows(n.rows, rules);
  diffs.push(...rowSetToDiffs(compareRowSets(lr, nr, input.key)));
  return input.recorder.record({
    entry: input.entry,
    mechanism: 'ui-extract',
    role: input.role,
    title: input.title,
    legacy: { endpoint: input.legacySource },
    native: { endpoint: input.nativeSource },
    compared: { legacyRows: lr.length, nativeRows: nr.length, columns: input.columns.length },
    diffs,
  });
}

/** Playwright Page 的最小子集合。 */
export interface PageLike {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/**
 * 從頁面的 HTML 表格／列表擷取資料：回傳「表頭 → 儲存格文字」的列。
 * headerSelector 省略時，以 rowSelector 第一列的儲存格當表頭。
 */
export async function extractTableFromPage(
  page: PageLike,
  sel: { rowSelector: string; cellSelector?: string; headerSelector?: string },
): Promise<Record<string, string>[]> {
  return page.evaluate(
    ({ rowSelector, cellSelector, headerSelector }) => {
      const cellSel = cellSelector || 'th,td';
      const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const rowEls = Array.from(document.querySelectorAll(rowSelector));
      let headers: string[];
      let dataRows: Element[];
      if (headerSelector) {
        headers = Array.from(document.querySelectorAll(headerSelector)).map(text);
        dataRows = rowEls;
      } else {
        headers = rowEls.length ? Array.from(rowEls[0].querySelectorAll(cellSel)).map(text) : [];
        dataRows = rowEls.slice(1);
      }
      return dataRows.map((row) => {
        const cells = Array.from(row.querySelectorAll(cellSel)).map(text);
        const o: Record<string, string> = {};
        headers.forEach((h, i) => {
          o[h] = cells[i] ?? '';
        });
        return o;
      });
    },
    sel,
  );
}

/** 讀 xlsx / csv（Buffer 或路徑）→ 以第一列為表頭的列。值以顯示文字讀取（raw:false），與使用者看到的一致。 */
export function readWorkbookRows(
  source: Buffer | string,
  opts: { sheet?: string | number; headerRow?: number } = {},
): Record<string, unknown>[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = nodeRequire('xlsx') as typeof import('xlsx');
  const buf = typeof source === 'string' ? fs.readFileSync(source) : source;
  // xlsx(zip: PK) / xls(OLE: D0CF) 以二進位讀取；其餘視為 UTF-8 文字（csv），避免中文被當成 latin1。
  const isBinary = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf);
  const wb = isBinary ? XLSX.read(buf, { type: 'buffer', cellDates: false }) : XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', cellDates: false });
  const name = typeof opts.sheet === 'string' ? opts.sheet : wb.SheetNames[opts.sheet ?? 0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`找不到工作表：${String(opts.sheet ?? 0)}`);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
  const headerIdx = opts.headerRow ?? 0;
  const headers = (aoa[headerIdx] || []).map((h) => String(h ?? '').trim());
  return aoa.slice(headerIdx + 1).map((row) => {
    const o: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) o[h] = row[i] ?? '';
    });
    return o;
  });
}
