/**
 * 機制四：導覽可見性對等（T02）。
 *
 * 舊版 Navbar 的可見性規則（hooks/useNavbarPermissions.ts + components/Navbar.tsx）在瀏覽器端計算，沒有 REST，
 * 所以規則表放在 tests/parity/map/navigation.json（navRules / navFlags / codeSets / legacyFacts），
 * 這裡依「舊版事實」（有效權限、profiles.role、角色碼、總務服務中心入口 API）求值，
 * 再和新版 /api/workspace/session 的 navigation href 集合逐項比對。
 * 規則表是否與原始碼漂移，由 tests/unit/T02/navigation-map.test.ts 檢查。
 */
import { compareRowSets } from './normalize';
import { rowSetToDiffs, type Diff, type ParityMap, type ParityRecorder } from './parity';

export interface NavRule {
  href: string;
  label: string;
  /** 不需任何權限（首頁、年度行事曆）。 */
  always?: boolean;
  /** 權限碼任一即可；「@NAME」展開為 codeSets[NAME]。 */
  anyOf?: string[];
  /** 另外以 navFlags 的旗標（任一為真）判斷。 */
  anyOfFlags?: string[];
  /** 預設 true：isAdminLike 一律可見（hasPermissionCode 的 admin 捷徑）。 */
  adminBypass?: boolean;
  storeManagerBypass?: boolean;
  /** 以舊版 API 結果判斷（目前只有 generalAffairsAccess）。 */
  api?: 'generalAffairsAccess' | 'campaignEntryAccess';
  /** 只在 api 事實為真時才算數的權限碼（例如活動檢視：view_own / 舊 view 還要有任命才進得去）；僅供漂移檢查比對，不單獨放行。 */
  apiCodes?: string[];
}

export type NavFlag = Omit<NavRule, 'href' | 'label'>;

export interface NavMapData {
  codeSets: Record<string, string[]>;
  legacyFacts: { adminProfileRoles: string[]; adminRoleCodes: string[]; storeManagerRoleCodes: string[] };
  navFlags: Record<string, NavFlag>;
  navRules: NavRule[];
}

export interface LegacyNavFacts {
  /** /api/permissions/user 的有效權限碼。 */
  permissions: string[];
  /** /api/user/profile 的 profile.role。 */
  profileRole: string | null;
  /** 使用者被指派的角色碼（來源：role-matrix 的 roleCode + systemRoles）。 */
  roleCodes: string[];
  /** /api/general-affairs/access 的 allowed。 */
  generalAffairsAccess: boolean;
  /** /api/campaigns/entry-access 的 canEnter（活動檢視入口：view_all，或 view_own 且有任命／盤點組）。 */
  campaignEntryAccess?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
}

export function expandCodes(codes: string[] | undefined, sets: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const c of codes || []) {
    if (c.startsWith('@')) {
      const set = sets[c.slice(1)];
      if (!set) throw new Error(`navigation map 引用了不存在的 codeSet：${c}`);
      out.push(...set);
    } else out.push(c);
  }
  return out;
}

export function isAdminLike(facts: LegacyNavFacts, data: NavMapData): boolean {
  return (
    (facts.profileRole !== null && data.legacyFacts.adminProfileRoles.includes(facts.profileRole)) ||
    facts.roleCodes.some((c) => data.legacyFacts.adminRoleCodes.includes(c))
  );
}

export function isStoreManager(facts: LegacyNavFacts, data: NavMapData): boolean {
  return facts.roleCodes.some((c) => data.legacyFacts.storeManagerRoleCodes.includes(c));
}

export function ruleVisible(rule: NavFlag, facts: LegacyNavFacts, data: NavMapData): boolean {
  if (rule.always) return true;
  if (rule.adminBypass !== false && isAdminLike(facts, data)) return true;
  if (rule.storeManagerBypass && isStoreManager(facts, data)) return true;
  if (rule.api === 'generalAffairsAccess' && facts.generalAffairsAccess) return true;
  if (rule.api === 'campaignEntryAccess' && facts.campaignEntryAccess) return true;
  const have = new Set(facts.permissions);
  if (expandCodes(rule.anyOf, data.codeSets).some((c) => have.has(c))) return true;
  for (const flag of rule.anyOfFlags || []) {
    const f = data.navFlags[flag];
    if (!f) throw new Error(`navigation map 引用了不存在的旗標：${flag}`);
    if (ruleVisible(f, facts, data)) return true;
  }
  return false;
}

/** 依舊版規則算出該使用者在舊 Navbar 會看到的入口。 */
export function legacyNavItems(facts: LegacyNavFacts, data: NavMapData): NavItem[] {
  return data.navRules.filter((r) => ruleVisible(r, facts, data)).map((r) => ({ href: r.href, label: r.label }));
}

/** 取 /api/workspace/session 的 navigation（群組 → 項目）攤平成入口清單。 */
export function nativeNavItems(navigation: unknown): NavItem[] {
  const groups = (Array.isArray(navigation) ? navigation : []) as { items?: { href: string; label: string }[] }[];
  return groups.flatMap((g) => (g.items || []).map((i) => ({ href: i.href, label: i.label })));
}

export function navDataFromMap(map: ParityMap): NavMapData {
  const m = map as unknown as Partial<NavMapData>;
  if (!m.codeSets || !m.legacyFacts || !m.navFlags || !m.navRules) {
    throw new Error('navigation map 缺少 codeSets / legacyFacts / navFlags / navRules');
  }
  return m as NavMapData;
}

/** 比較兩邊入口，產生差異（純函式）。 */
export function diffNavItems(legacy: NavItem[], native: NavItem[]): Diff[] {
  const cmp = compareRowSets(
    legacy as unknown as Record<string, unknown>[],
    native as unknown as Record<string, unknown>[],
    'href',
  );
  return rowSetToDiffs(cmp)
    .filter((d) => !(d.kind === 'count' && d.key === '(rows)')) // 筆數差異已由 only-* 表達
    .map((d) => {
      if (d.kind === 'only-legacy') return { ...d, detail: '舊 Navbar 顯示、新版導覽沒有' };
      if (d.kind === 'only-native') return { ...d, detail: '新版導覽有、舊 Navbar 不顯示' };
      return d;
    });
}

export interface NavCompareInput {
  recorder: ParityRecorder;
  map: ParityMap;
  entry: string;
  title: string;
  role: string;
  facts: LegacyNavFacts;
  /** /api/workspace/session 回應的 navigation 欄位。 */
  nativeNavigation: unknown;
}

export interface NavItemsCompareInput {
  recorder: ParityRecorder;
  entry: string;
  title: string;
  role: string;
  /** 舊版來源說明（例如 Navbar DOM 或規則表）。 */
  legacyEndpoint: string;
  nativeEndpoint: string;
  legacyItems: NavItem[];
  nativeItems: NavItem[];
}

/** 已經擷取好兩邊入口清單（DOM 或規則表），直接比對並寫入報告。 */
export function compareNavItems(input: NavItemsCompareInput) {
  return input.recorder.record({
    entry: input.entry,
    mechanism: 'navigation',
    role: input.role,
    title: input.title,
    legacy: { endpoint: input.legacyEndpoint },
    native: { endpoint: input.nativeEndpoint },
    compared: { legacyItems: input.legacyItems.length, nativeItems: input.nativeItems.length },
    diffs: diffNavItems(input.legacyItems, input.nativeItems),
  });
}

/**
 * 逐角色比對導覽入口：
 * - only-legacy：舊 Navbar 會顯示、新版沒有的入口（權限缺口）。
 * - only-native：新版多出的入口（可能放寬權限）。
 * - changed（key=href#label）：同一入口兩邊名稱不同。
 */
export function compareNavigation(input: NavCompareInput) {
  const data = navDataFromMap(input.map);
  const legacy = legacyNavItems(input.facts, data);
  const native = nativeNavItems(input.nativeNavigation);
  return input.recorder.record({
    entry: input.entry,
    mechanism: 'navigation',
    role: input.role,
    title: input.title,
    legacy: { endpoint: 'Navbar 規則表（tests/parity/map/navigation.json）' },
    native: { endpoint: 'GET /api/workspace/session -> navigation' },
    compared: { legacyItems: legacy.length, nativeItems: native.length },
    diffs: diffNavItems(legacy, native),
  });
}
