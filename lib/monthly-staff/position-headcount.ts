/**
 * 每月門市職位人數統計：純函式（不依賴 React / Supabase，之後可原樣搬到新版）。
 *
 * 資料來源：monthly_staff_status（每月人員狀態）。唯讀統計，不修改任何資料。
 *
 * ── 月底在職判斷（依 monthly_status CHECK 約束的 10 個值逐一列出）──
 *   計入（月底仍在該門市）：
 *     full_month 整月在職 / new_hire 到職（本月新進） / transferred_in 調入 / promoted 升職 /
 *     leave_return 留停復職 / dual_store_manager 擔任雙店長
 *   不計入：
 *     resigned 離職 / leave_of_absence 留停（另有舊別名 leave_without_pay 留職停薪） /
 *     transferred_out 調出（不算在原門市；新門市由其「調入」那筆計入） /
 *     support_rotation 支援卡班（不算在被支援門市）
 *   未知狀態（空白或不在上表）：不丟掉，照常計入，並列入「狀態待確認」名單。
 *
 * ── 督導卡班（優先於 monthly_status）──
 *   is_supervisor_rotation=true（每月人員狀態編輯頁「督導卡班」勾選）的那一筆不計入人數
 *   （門市、督導區小計、全公司合計、近 12 個月趨勢都不算），列入「不計入」名單，原因「督導卡班」。
 *   即使 monthly_status 是 full_month 也排除（判斷順序：督導卡班 > monthly_status）。
 *   同一位督導同月在其他門市沒勾卡班的正常資料，照常計入（若兩間都計入，依下方跨店規則只算主要歸屬一間）。
 *   督導卡班同時是代理店長（is_acting_manager=true 或 position=督導(代理店長)）：同樣不計入，
 *   但在該門市（及其督導區小計、全公司合計）的「代理店長」欄標註「督導卡班代理 N 位」，
 *   與「其中 N 位由督導代理」並列、不加進代理店長人數；點開名單可看到是誰。
 *
 * ── 欄位歸類 ──
 *   行政：newbie_level=過階行政 → 行政（過階）；未過階行政 → 行政（未過階）；空白/無法辨識 → 階段未登記
 *   新人：未過階新人 / 一階新人 / 二階新人；空白/無法辨識 → 階段未登記（不猜測）
 *   專員、組長、店長：同名欄位
 *   主任、副店長：該月 is_acting_manager=true → 只算「代理店長」，不算主任/副店長
 *   position=代理店長 → 代理店長
 *   督導：算「督導」；若 is_acting_manager=true 或 position=督導(代理店長) → 仍算督導，
 *         並在代理店長欄標註「其中 N 位由督導代理」（不加進代理店長人數）
 *   position 的「-雙」後綴（雙店長/雙職）先移除再歸類
 *   其他任何職位（兼職助理、兼職藥師、資深專員、空白…）→ 「其他／兼職」，可點開看職位
 *
 * ── 跨店：每人每月只算在一間「主要歸屬門市」（2026-11 起）──
 *   同一人同月在 2 間以上門市有「計入」的登記時，只有主要歸屬門市那（幾）筆計入；
 *   其他門市的登記改列「不計入」名單，原因「已計入 {門市代號} {門市名稱}」。套用到所有人（督導、雙店長、雙職…）。
 *   主要歸屬門市依序比較（先分出高下者勝）：
 *     1. 該月在那間是代理店長的登記優先（is_acting_manager=true、position=督導(代理店長)、或歸類為代理店長欄）
 *     2. 屬於他自己督導區的門市優先（門市督導員編 = 此人員編，大小寫/空白正規化後比對）
 *     3. 非雙店長/非雙職優先（is_dual_position、monthly_status=dual_store_manager、position 帶「-雙」者為雙）
 *     4. 職等較高的欄位優先（RANK_ORDER）
 *     5. 門市代號較小者（確保結果固定）
 *   督導卡班那筆（原因「督導卡班」）早已不計入，不參與主要歸屬選擇。
 *
 * ── 去重與三層一致 ──
 *   門市層：同一人在同一門市、同一欄只算一次。
 *   督導區小計、全公司合計：同樣只算一次（同一人、同一欄）。
 *   因為每人只剩一間門市計入，所以「各門市明細加總 = 督導區小計」「各督導區小計加總 = 全公司合計」（人數與各欄皆然）。
 *   同一人在「同一間」主要歸屬門市有兩筆不同職位時，兩欄都保留（維持原行為），總人數仍只算一人。
 *   跨店的人在主要歸屬那筆的備註標「跨店，另於 X 不計入」。
 */

export type ColumnKey =
  | 'admin_pass'
  | 'admin_not_pass'
  | 'newbie_0'
  | 'newbie_1'
  | 'newbie_2'
  | 'specialist'
  | 'leader'
  | 'director'
  | 'deputy'
  | 'acting'
  | 'manager'
  | 'supervisor'
  | 'other'
  | 'unregistered';

export const HEADCOUNT_COLUMNS: { key: ColumnKey; label: string; group: '行政' | '門市人員' | '其他' }[] = [
  { key: 'admin_pass', label: '行政（過階）', group: '行政' },
  { key: 'admin_not_pass', label: '行政（未過階）', group: '行政' },
  { key: 'newbie_0', label: '新人未過階', group: '門市人員' },
  { key: 'newbie_1', label: '新人一階', group: '門市人員' },
  { key: 'newbie_2', label: '新人二階', group: '門市人員' },
  { key: 'specialist', label: '專員', group: '門市人員' },
  { key: 'leader', label: '組長', group: '門市人員' },
  { key: 'director', label: '主任', group: '門市人員' },
  { key: 'deputy', label: '副店長', group: '門市人員' },
  { key: 'acting', label: '代理店長', group: '門市人員' },
  { key: 'manager', label: '店長', group: '門市人員' },
  { key: 'supervisor', label: '督導', group: '門市人員' },
  { key: 'other', label: '其他／兼職', group: '其他' },
  { key: 'unregistered', label: '階段未登記', group: '其他' },
];

export const COLUMN_LABELS = Object.fromEntries(HEADCOUNT_COLUMNS.map((c) => [c.key, c.label])) as Record<ColumnKey, string>;

/** 全公司合計「主要歸屬」用：越前面職等越高。 */
export const RANK_ORDER: ColumnKey[] = [
  'supervisor', 'manager', 'acting', 'deputy', 'director', 'leader', 'specialist',
  'newbie_2', 'newbie_1', 'newbie_0', 'admin_pass', 'admin_not_pass', 'other', 'unregistered',
];

export const MONTHLY_STATUS_LABELS_ZH: Record<string, string> = {
  full_month: '整月在職',
  new_hire: '到職（本月新進）',
  resigned: '離職',
  leave_of_absence: '留停',
  leave_without_pay: '留職停薪',
  transferred_in: '調入',
  transferred_out: '調出',
  promoted: '升職',
  support_rotation: '支援卡班',
  dual_store_manager: '擔任雙店長',
  leave_return: '留停復職',
};

/** 月底仍在該門市（計入）的狀態 */
export const COUNTED_STATUSES = ['full_month', 'new_hire', 'transferred_in', 'promoted', 'leave_return', 'dual_store_manager'];
/** 不計入的狀態與原因 */
export const EXCLUDED_STATUSES: Record<string, string> = {
  resigned: '當月離職',
  leave_of_absence: '留職停薪',
  leave_without_pay: '留職停薪',
  transferred_out: '調出（不算在原門市）',
  support_rotation: '支援卡班（不算在被支援門市）',
};

export interface HeadcountRecord {
  year_month: string;
  store_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  position: string | null;
  newbie_level: string | null;
  monthly_status: string | null;
  is_acting_manager?: boolean | null;
  is_dual_position?: boolean | null;
  is_supervisor_rotation?: boolean | null;
  employment_type?: string | null;
}

export interface HeadcountStore {
  id: string;
  store_code: string;
  store_name: string;
  supervisor_id?: string | null;
  supervisor_name?: string | null;
  /** 門市督導的員編（profiles.employee_code），判斷「屬於自己督導區」用 */
  supervisor_employee_code?: string | null;
}

export interface HeadcountEntry {
  key: string;
  employee_code: string;
  employee_name: string;
  store_id: string;
  store_code: string;
  store_name: string;
  /** 已去除「-雙」後綴的職位 */
  position: string;
  newbie_level: string;
  monthly_status: string;
  statusLabel: string;
  column: ColumnKey;
  columnLabel: string;
  isDual: boolean;
  supervisorActing: boolean;
  unknownStatus: boolean;
  crossStore: boolean;
  /** 是否為該人當月的主要歸屬那一筆（跨店時其他門市的登記不計入） */
  isPrimary: boolean;
  /** 該月在此筆是否為代理店長（is_acting_manager、督導(代理店長)、代理店長欄） */
  isActingEntry: boolean;
  /** 跨店備註：主要歸屬那筆記錄「另於 X 不計入」 */
  crossStoreNote: string;
  /** 不計入時的原因（計入者為空字串） */
  excludedReason: string;
  /** 督導卡班（is_supervisor_rotation=true）：不計入人數 */
  isRotation: boolean;
  /** 督導卡班且同時代理店長：不計入，但在代理店長欄標註「督導卡班代理 N 位」 */
  rotationActing: boolean;
}

export interface HeadcountGroup {
  people: Record<ColumnKey, HeadcountEntry[]>;
  /** 督導兼代理店長（已算在「督導」欄，不在代理店長人數內） */
  actingBySupervisor: HeadcountEntry[];
  /** 督導卡班且代理店長（不計入人數，只在代理店長欄標註） */
  rotationActing: HeadcountEntry[];
  totalPeople: number;
}

export interface StoreHeadcount extends HeadcountGroup {
  store: HeadcountStore;
}

export interface AreaHeadcount {
  key: string;
  name: string;
  stores: StoreHeadcount[];
  subtotal: HeadcountGroup;
}

export interface MonthHeadcount {
  yearMonth: string;
  company: HeadcountGroup;
  areas: AreaHeadcount[];
  unknownStatusPeople: HeadcountEntry[];
  /** 當月有登記但月底不計入的人（離職、留停、調出、支援卡班、督導卡班） */
  excluded: HeadcountEntry[];
  /** 所有計入的門市層級筆數（已做門市層去重），供匯出「人員明細」 */
  storeEntries: HeadcountEntry[];
}

export const UNASSIGNED_AREA_KEY = '__none__';
export const UNASSIGNED_AREA_NAME = '未分區';

// ───────────────────────── 分類 ─────────────────────────

/** 移除「-雙」後綴、統一括號、去空白 */
export function normalizeHeadcountPosition(raw: string | null | undefined): { position: string; hadDualSuffix: boolean } {
  let p = String(raw ?? '').trim().replace(/（/g, '(').replace(/）/g, ')');
  let hadDualSuffix = false;
  const m = p.match(/\s*[-－–—]\s*雙\s*$/);
  if (m) {
    hadDualSuffix = true;
    p = p.slice(0, m.index).trim();
  }
  return { position: p, hadDualSuffix };
}

export function emptyPeople(): Record<ColumnKey, HeadcountEntry[]> {
  return Object.fromEntries(HEADCOUNT_COLUMNS.map((c) => [c.key, [] as HeadcountEntry[]])) as Record<ColumnKey, HeadcountEntry[]>;
}

export function classifyHeadcountRecord(rec: Pick<HeadcountRecord, 'position' | 'newbie_level' | 'is_acting_manager' | 'is_dual_position'>): {
  column: ColumnKey;
  position: string;
  supervisorActing: boolean;
  isDual: boolean;
} {
  const { position, hadDualSuffix } = normalizeHeadcountPosition(rec.position);
  const level = String(rec.newbie_level ?? '').trim();
  const acting = rec.is_acting_manager === true;
  const isDual = rec.is_dual_position === true || hadDualSuffix;
  const out = (column: ColumnKey, supervisorActing = false) => ({ column, position, supervisorActing, isDual });

  switch (position) {
    case '督導(代理店長)':
      return out('supervisor', true);
    case '督導':
      return out('supervisor', acting);
    case '代理店長':
      return out('acting');
    case '主任':
      return out(acting ? 'acting' : 'director');
    case '副店長':
      return out(acting ? 'acting' : 'deputy');
    case '店長':
      return out('manager');
    case '組長':
      return out('leader');
    case '專員':
      return out('specialist');
    case '新人':
      if (level === '未過階新人') return out('newbie_0');
      if (level === '一階新人') return out('newbie_1');
      if (level === '二階新人') return out('newbie_2');
      return out('unregistered');
    case '行政':
      if (level === '過階行政') return out('admin_pass');
      if (level === '未過階行政') return out('admin_not_pass');
      return out('unregistered');
    case '行政(過階)':
      return out('admin_pass');
    case '行政(未過階)':
      return out('admin_not_pass');
    default:
      return out('other');
  }
}

/** 不計入名單顯示用的原因：督導卡班兼代理店長者註明「（兼代理店長）」 */
export function excludedReasonLabel(e: Pick<HeadcountEntry, 'excludedReason' | 'isRotation' | 'rotationActing'>): string {
  if (e.isRotation && e.rotationActing) return '督導卡班（兼代理店長）';
  return e.excludedReason || (e.isRotation ? '督導卡班' : '');
}

export function resolveStatus(status: string | null | undefined): { counted: boolean; unknown: boolean; label: string; excludedReason: string } {
  const s = String(status ?? '').trim();
  if (COUNTED_STATUSES.includes(s)) return { counted: true, unknown: false, label: MONTHLY_STATUS_LABELS_ZH[s] || s, excludedReason: '' };
  if (s in EXCLUDED_STATUSES) return { counted: false, unknown: false, label: MONTHLY_STATUS_LABELS_ZH[s] || s, excludedReason: EXCLUDED_STATUSES[s] };
  return { counted: true, unknown: true, label: s || '（空白）', excludedReason: '' };
}

// ───────────────────────── 去重與合計 ─────────────────────────

function personKey(rec: HeadcountRecord, idx: number): string {
  const code = String(rec.employee_code ?? '').trim().toUpperCase();
  if (code) return code;
  const name = String(rec.employee_name ?? '').trim();
  return `?${rec.store_id ?? ''}|${name || `row${idx}`}`;
}

function buildGroup(entries: HeadcountEntry[], dedupeBy: (e: HeadcountEntry) => string, rotationEntries: HeadcountEntry[] = []): HeadcountGroup {
  const people = emptyPeople();
  const seen = new Set<string>();
  const keys = new Set<string>();
  const acting: HeadcountEntry[] = [];
  for (const e of entries) {
    const dk = `${dedupeBy(e)}|${e.column}|${e.key}`;
    if (seen.has(dk)) continue;
    seen.add(dk);
    people[e.column].push(e);
    keys.add(e.key);
    if (e.column === 'supervisor' && e.supervisorActing) acting.push(e);
  }
  const rotSeen = new Set<string>();
  const rotationActing: HeadcountEntry[] = [];
  for (const e of rotationEntries) {
    if (!e.rotationActing) continue;
    const dk = `${dedupeBy(e)}|${e.key}`;
    if (rotSeen.has(dk)) continue;
    rotSeen.add(dk);
    rotationActing.push(e);
  }
  return { people, actingBySupervisor: acting, rotationActing, totalPeople: keys.size };
}

export function groupCount(g: HeadcountGroup, col: ColumnKey): number {
  return g.people[col].length;
}

function normCode(c: string | null | undefined): string {
  return String(c ?? '').replace(/s+/g, '').toUpperCase();
}

function storeLabel(e: Pick<HeadcountEntry, 'store_code' | 'store_name'>): string {
  return `${e.store_code} ${e.store_name}`.trim();
}

/** 主要歸屬比較：負數表示 a 較優先 */
function comparePrimary(a: HeadcountEntry, b: HeadcountEntry, ownArea: (e: HeadcountEntry) => boolean): number {
  if (a.isActingEntry !== b.isActingEntry) return a.isActingEntry ? -1 : 1;
  const oa = ownArea(a);
  const ob = ownArea(b);
  if (oa !== ob) return oa ? -1 : 1;
  if (a.isDual !== b.isDual) return a.isDual ? 1 : -1;
  const ra = RANK_ORDER.indexOf(a.column);
  const rb = RANK_ORDER.indexOf(b.column);
  if (ra !== rb) return ra - rb;
  return a.store_code.localeCompare(b.store_code) || a.store_id.localeCompare(b.store_id);
}

function buildEntries(records: HeadcountRecord[], stores: HeadcountStore[], yearMonth: string) {
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const counted: HeadcountEntry[] = [];
  const excluded: HeadcountEntry[] = [];
  records.forEach((rec, idx) => {
    if (rec.year_month !== yearMonth) return;
    const store = rec.store_id ? storeMap.get(rec.store_id) : undefined;
    const cls = classifyHeadcountRecord(rec);
    const st0 = resolveStatus(rec.monthly_status);
    // 督導卡班優先於 monthly_status：一律不計入
    const isRotation = rec.is_supervisor_rotation === true;
    const st = isRotation ? { ...st0, counted: false, unknown: false, excludedReason: '督導卡班' } : st0;
    const entry: HeadcountEntry = {
      key: personKey(rec, idx),
      employee_code: String(rec.employee_code ?? '').trim(),
      employee_name: String(rec.employee_name ?? '').trim(),
      store_id: rec.store_id ?? '',
      store_code: store?.store_code ?? '',
      store_name: store?.store_name ?? '（未知門市）',
      position: cls.position,
      newbie_level: String(rec.newbie_level ?? '').trim(),
      monthly_status: String(rec.monthly_status ?? '').trim(),
      statusLabel: st.label,
      column: cls.column,
      columnLabel: COLUMN_LABELS[cls.column],
      isDual: cls.isDual || String(rec.monthly_status ?? '').trim() === 'dual_store_manager',
      supervisorActing: cls.supervisorActing,
      unknownStatus: st.unknown,
      crossStore: false,
      isPrimary: false,
      isActingEntry: rec.is_acting_manager === true || cls.supervisorActing || cls.column === 'acting',
      crossStoreNote: '',
      excludedReason: st.excludedReason,
      isRotation,
      rotationActing: isRotation && (rec.is_acting_manager === true || cls.supervisorActing),
    };
    (st.counted ? counted : excluded).push(entry);
  });

  // 跨店：每人只算在一間主要歸屬門市，其他門市的計入筆改列不計入
  const ownArea = (e: HeadcountEntry) => {
    const sup = normCode(storeMap.get(e.store_id)?.supervisor_employee_code);
    return !!sup && sup === normCode(e.employee_code);
  };
  const byPerson = new Map<string, HeadcountEntry[]>();
  for (const e of counted) {
    if (!byPerson.has(e.key)) byPerson.set(e.key, []);
    byPerson.get(e.key)!.push(e);
  }
  const keptCounted: HeadcountEntry[] = [];
  byPerson.forEach((list) => {
    const best = [...list].sort((x, y) => comparePrimary(x, y, ownArea))[0];
    best.isPrimary = true;
    const kept = list.filter((e) => e.store_id === best.store_id);
    const demoted = list.filter((e) => e.store_id !== best.store_id);
    keptCounted.push(...kept);
    if (demoted.length > 0) {
      const others = Array.from(new Set(demoted.map((d) => storeLabel(d) || '（未知門市）')));
      for (const e of kept) {
        e.crossStore = true;
        e.crossStoreNote = `另於 ${others.join('、')} 不計入`;
      }
      for (const d of demoted) {
        d.crossStore = true;
        d.excludedReason = `已計入 ${storeLabel(best) || '（未知門市）'}`;
        excluded.push(d);
      }
    }
  });
  counted.length = 0;
  counted.push(...keptCounted);
  return { counted, excluded, storeMap, rotationActing: excluded.filter((e) => e.rotationActing) };
}

export function computeMonthHeadcount(records: HeadcountRecord[], stores: HeadcountStore[], yearMonth: string): MonthHeadcount {
  const { counted, excluded, storeMap, rotationActing } = buildEntries(records, stores, yearMonth);
  const sortEntries = (list: HeadcountEntry[]) =>
    [...list].sort((a, b) => a.store_code.localeCompare(b.store_code) || a.employee_code.localeCompare(b.employee_code));

  const sortedRotation = sortEntries(rotationActing);
  const company = buildGroup(sortEntries(counted), () => '', sortedRotation);

  // 門市 / 督導區
  const storeIds = new Set<string>();
  for (const e of counted) storeIds.add(e.store_id);
  for (const e of excluded) storeIds.add(e.store_id);
  const storeList: HeadcountStore[] = Array.from(storeIds).map(
    (id) => storeMap.get(id) ?? { id, store_code: '', store_name: '（未知門市）', supervisor_id: null, supervisor_name: null },
  );

  const areaMap = new Map<string, { name: string; stores: HeadcountStore[] }>();
  for (const s of storeList) {
    const key = s.supervisor_id || UNASSIGNED_AREA_KEY;
    const name = s.supervisor_id ? s.supervisor_name || '（未命名督導）' : UNASSIGNED_AREA_NAME;
    if (!areaMap.has(key)) areaMap.set(key, { name, stores: [] });
    areaMap.get(key)!.stores.push(s);
  }

  const sortedCounted = sortEntries(counted);
  const areas: AreaHeadcount[] = Array.from(areaMap.entries())
    .map(([key, a]) => {
      const sortedStores = a.stores.sort((x, y) => x.store_code.localeCompare(y.store_code));
      const storeRows: StoreHeadcount[] = sortedStores.map((store) => ({
        store,
        ...buildGroup(sortedCounted.filter((e) => e.store_id === store.id), (e) => e.store_id, sortedRotation.filter((e) => e.store_id === store.id)),
      }));
      const ids = new Set(sortedStores.map((s) => s.id));
      const subtotal = buildGroup(sortedCounted.filter((e) => ids.has(e.store_id)), () => '', sortedRotation.filter((e) => ids.has(e.store_id)));
      return { key, name: a.name, stores: storeRows, subtotal };
    })
    .sort((a, b) => {
      if (a.key === UNASSIGNED_AREA_KEY) return 1;
      if (b.key === UNASSIGNED_AREA_KEY) return -1;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

  // 狀態待確認：每人每店只列一次
  const unknownSeen = new Set<string>();
  const unknownStatusPeople = sortedCounted.filter((e) => {
    if (!e.unknownStatus) return false;
    const k = `${e.key}|${e.store_id}`;
    if (unknownSeen.has(k)) return false;
    unknownSeen.add(k);
    return true;
  });

  // 門市層明細（去重後）
  const seen = new Set<string>();
  const storeEntries = sortedCounted.filter((e) => {
    const k = `${e.store_id}|${e.column}|${e.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { yearMonth, company, areas, unknownStatusPeople, excluded: sortEntries(excluded), storeEntries };
}

// ───────────────────────── 趨勢 ─────────────────────────

export function monthsEndingAt(endMonth: string, n = 12): string[] {
  const [y, m] = endMonth.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export interface TrendRow {
  yearMonth: string;
  counts: Record<ColumnKey, number>;
  actingBySupervisor: number;
  /** 督導卡班代理（不計入人數，只作標註） */
  rotationActing: number;
  totalPeople: number;
  hasData: boolean;
}

/** 全公司近 N 個月（以 endMonth 為結尾）每月各欄人數（每人只算在主要歸屬門市的全公司口徑） */
export function computeHeadcountTrend(records: HeadcountRecord[], stores: HeadcountStore[], endMonth: string, n = 12): TrendRow[] {
  const byMonth = new Map<string, HeadcountRecord[]>();
  for (const r of records) {
    if (!byMonth.has(r.year_month)) byMonth.set(r.year_month, []);
    byMonth.get(r.year_month)!.push(r);
  }
  return monthsEndingAt(endMonth, n).map((ym) => {
    const recs = byMonth.get(ym) ?? [];
    const { counted, rotationActing } = buildEntries(recs, stores, ym);
    const g = buildGroup(counted, () => '', rotationActing);
    const counts = Object.fromEntries(HEADCOUNT_COLUMNS.map((c) => [c.key, g.people[c.key].length])) as Record<ColumnKey, number>;
    return { yearMonth: ym, counts, actingBySupervisor: g.actingBySupervisor.length, rotationActing: g.rotationActing.length, totalPeople: g.totalPeople, hasData: recs.length > 0 };
  });
}

// ───────────────────────── 定稿 ─────────────────────────

export interface StoreSummaryRow {
  store_id: string;
  store_status: string | null;
}

/**
 * 舊版以 monthly_store_summary.store_status === 'confirmed'（店長送出後由主管「確認」）視為定稿
 * （見 app/store/actions.ts confirmStoreStatus）。該月有人員資料、但門市摘要不是 confirmed（或沒有摘要）者為未定稿。
 */
export function findUnfinalizedStores(records: HeadcountRecord[], stores: HeadcountStore[], summaries: StoreSummaryRow[], yearMonth: string): HeadcountStore[] {
  const confirmed = new Set(summaries.filter((s) => s.store_status === 'confirmed').map((s) => s.store_id));
  const withData = new Set(records.filter((r) => r.year_month === yearMonth && r.store_id).map((r) => r.store_id as string));
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  return Array.from(withData)
    .filter((id) => !confirmed.has(id))
    .map((id) => storeMap.get(id) ?? { id, store_code: '', store_name: '（未知門市）' })
    .sort((a, b) => a.store_code.localeCompare(b.store_code));
}

// ───────────────────────── Excel 列 ─────────────────────────

/** 「人數統計」工作表欄寬：依表頭名稱決定，欄位增減時不會錯位。 */
export function summarySheetColumnWidths(headers: string[]): { wch: number }[] {
  const fixed: Record<string, number> = { 督導區: 14, 門市: 24, 其中由督導代理店長: 18, '督導卡班代理（不計入）': 24, 總人數: 10 };
  return headers.map((h) => ({ wch: fixed[h] ?? 12 }));
}

export function buildHeadcountExportRows(result: MonthHeadcount): {
  summaryRows: Record<string, string | number>[];
  detailRows: Record<string, string | number>[];
} {
  const summaryRows: Record<string, string | number>[] = [];
  const mk = (area: string, store: string, g: HeadcountGroup) => {
    const row: Record<string, string | number> = { 督導區: area, 門市: store };
    for (const c of HEADCOUNT_COLUMNS) row[c.label] = g.people[c.key].length;
    row['其中由督導代理店長'] = g.actingBySupervisor.length;
    row['督導卡班代理（不計入）'] = g.rotationActing.length;
    row['總人數'] = g.totalPeople;
    return row;
  };
  summaryRows.push(mk('全公司', '合計（每人只算一次）', result.company));
  for (const a of result.areas) {
    summaryRows.push(mk(a.name, '督導區小計', a.subtotal));
    for (const s of a.stores) summaryRows.push(mk(a.name, `${s.store.store_code} ${s.store.store_name}`.trim(), s));
  }

  const areaOfStore = new Map<string, string>();
  for (const a of result.areas) for (const s of a.stores) areaOfStore.set(s.store.id, a.name);
  const toRow = (e: HeadcountEntry, counted: boolean) => ({
    督導區: areaOfStore.get(e.store_id) ?? '',
    門市代號: e.store_code,
    門市: e.store_name,
    員編: e.employee_code,
    姓名: e.employee_name,
    職位: e.position,
    新人行政階段: e.newbie_level,
    統計欄位: counted ? e.columnLabel : '',
    月狀態: e.statusLabel,
    是否計入: counted ? '是' : '否',
    不計入原因: excludedReasonLabel(e),
    主要歸屬: counted ? (e.isPrimary ? '是' : '否') : '',
    備註: [e.crossStore ? (e.crossStoreNote ? `跨店，${e.crossStoreNote}` : '跨店') : '', e.isDual ? '雙店長/雙職' : '', e.supervisorActing ? '督導代理店長' : '', e.isRotation ? '督導卡班' : '', e.rotationActing ? '督導卡班代理店長' : '', e.unknownStatus ? '狀態待確認' : '']
      .filter(Boolean)
      .join('、'),
  });
  const detailRows = [...result.storeEntries.map((e) => toRow(e, true)), ...result.excluded.map((e) => toRow(e, false))];
  return { summaryRows, detailRows };
}

/** 只在 payload 屬於目前所選月份時才回傳未定稿門市；切換月份讀取中（payload 還是上個月）回傳空陣列，避免橫幅顯示舊月份資料。 */
export function unfinalizedStoresForMonth(
  payload: { yearMonth: string; unfinalizedStores?: HeadcountStore[] } | null | undefined,
  month: string,
): HeadcountStore[] {
  return payload && payload.yearMonth === month ? payload.unfinalizedStores ?? [] : [];
}
