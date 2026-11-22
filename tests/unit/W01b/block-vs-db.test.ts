import { describe, expect, it } from 'vitest';
import { calculateBonusBlock, previewBonusBlock, type BlockInput } from '../../../lib/monthly-staff/block';
import { dbBonusBlocks } from '../../support/w01b-db';

// W01b-q1：預計獎金區塊必須與資料庫 calculate_bonus_block 一致。
// 本檔在 DEV 以 RPC 呼叫 DB 函式（純計算，不讀寫資料表），同一組輸入逐筆比對前端 calculateBonusBlock。
// DB 函式定義：supabase/migration_fix_block4_acting_manager.sql（最新版）；DEV 套用檔：supabase/workspace-dev/20261103010000_vue_monthly_bonus_block.sql。

const base: BlockInput = {
  employment_type: 'full_time',
  monthly_status: 'full_month',
  is_pharmacist: false,
  position: '專員',
  is_dual_position: false,
  is_supervisor_rotation: false,
  work_days: 30,
  extra_tasks: null,
  is_acting_manager: false,
};
const c = (name: string, expected: number, patch: Partial<BlockInput>): [string, number, BlockInput] => [name, expected, { ...base, ...patch }];

// 手寫期望值（依規則表）：逐條覆蓋區塊 1–6 與優先順序。
const TABLE: [string, number, BlockInput][] = [
  c('正職整月專員 → 1', 1, {}),
  c('正職整月店長 → 1', 1, { position: '店長' }),
  c('督導(代理店長) 非雙職 整月 → 1', 1, { position: '督導(代理店長)' }),
  c('督導卡班 → 2', 2, { is_supervisor_rotation: true }),
  c('督導卡班優先於兼職 → 2', 2, { is_supervisor_rotation: true, employment_type: 'part_time' }),
  c('督導卡班優先於外務 → 2', 2, { is_supervisor_rotation: true, extra_tasks: ['長照外務'] }),
  c('正職新進（非整月）→ 3', 3, { monthly_status: 'new_hire' }),
  c('正職離職 → 3', 3, { monthly_status: 'resigned' }),
  c('正職留停 → 3', 3, { monthly_status: 'leave_of_absence' }),
  c('整月但上班天數 0 → 3', 3, { work_days: 0 }),
  c('整月且天數為 null（不存天數）→ 1', 1, { work_days: null }),
  c('店長-雙 → 3', 3, { position: '店長', is_dual_position: true }),
  c('代理店長-雙 → 3', 3, { position: '代理店長', is_dual_position: true }),
  c('區經理(代理店長)-雙 → 3', 3, { position: '區經理(代理店長)', is_dual_position: true }),
  c('督導(代理店長)-雙 → 4', 4, { position: '督導(代理店長)', is_dual_position: true, work_days: null }),
  c('督導 + 雙職 + 勾選擔任代理店長 → 4', 4, { position: '督導', is_dual_position: true, is_acting_manager: true }),
  c('督導 + 雙職 未勾代理店長 → 非 4（整月 → 1）', 1, { position: '督導', is_dual_position: true }),
  c('督導(店長)-雙：DB 不含督導於區塊 3 → 整月 1', 1, { position: '督導(店長)', is_dual_position: true }),
  c('督導(店長)-雙 非整月 → 3', 3, { position: '督導(店長)', is_dual_position: true, monthly_status: 'new_hire' }),
  c('督導(店長)-雙 + 擔任代理店長 → 4', 4, { position: '督導(店長)', is_dual_position: true, is_acting_manager: true }),
  c('長照外務 → 4', 4, { extra_tasks: ['長照外務'] }),
  c('診所業務 → 4', 4, { extra_tasks: ['診所業務'] }),
  c('兩種外務 → 4', 4, { extra_tasks: ['長照外務', '診所業務'] }),
  c('外務優先於店長-雙 → 4', 4, { position: '店長', is_dual_position: true, extra_tasks: ['長照外務'] }),
  c('外務優先於非整月 → 4', 4, { monthly_status: 'new_hire', extra_tasks: ['診所業務'] }),
  c('兼職藥師 → 5', 5, { employment_type: 'part_time', is_pharmacist: true, work_days: null }),
  c('兼職專員 → 5', 5, { employment_type: 'part_time', position: '兼職專員', work_days: null }),
  c('兼職助理 → 6', 6, { employment_type: 'part_time', position: '助理', work_days: null }),
  c('兼職優先於外務 → 6', 6, { employment_type: 'part_time', position: '助理', work_days: null, extra_tasks: ['長照外務'] }),
  c('藥師但正職整月 → 1', 1, { is_pharmacist: true }),
  c('正職升職狀態 → 3', 3, { monthly_status: 'promoted' }),
];

// 決定性偽隨機：mulberry32，固定種子，失敗可重現。
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const POSITIONS = ['專員', '店長', '代理店長', '督導', '督導(代理店長)', '督導(店長)', '區經理(代理店長)', '區經理(店長)', '兼職專員', '助理', '新人', '行政'];
const STATUSES = ['full_month', 'new_hire', 'resigned', 'leave_of_absence', 'transferred_in', 'transferred_out', 'promoted', 'support_rotation', 'dual_store_manager', 'leave_return'];
const TASKS: (string[] | null)[] = [null, null, ['長照外務'], ['診所業務'], ['長照外務', '診所業務']];

function sampled(count: number): BlockInput[] {
  const r = rng(20261103);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  return Array.from({ length: count }, () => ({
    employment_type: r() < 0.3 ? 'part_time' : 'full_time',
    monthly_status: pick(STATUSES),
    is_pharmacist: r() < 0.25,
    position: pick(POSITIONS),
    is_dual_position: r() < 0.4,
    is_supervisor_rotation: r() < 0.1,
    work_days: pick([null, 0, 0.5, 15, 29, 30, 31]),
    extra_tasks: pick(TASKS),
    is_acting_manager: r() < 0.3,
  }));
}

describe('W01b-q1 預覽區塊 vs 資料庫 calculate_bonus_block（DEV RPC）', () => {
  it('手寫案例（≥20 筆）：期望值、前端函式、DB 函式三者一致', async () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(20);
    const db = await dbBonusBlocks(TABLE.map(([, , input]) => input));
    TABLE.forEach(([name, expected, input], i) => {
      expect(calculateBonusBlock(input), `前端：${name}`).toBe(expected);
      expect(db[i], `DB：${name}`).toBe(expected);
    });
  }, 60_000);

  it('決定性抽樣 300 組全欄位組合：前端與 DB 完全一致', async () => {
    const inputs = sampled(300);
    const db = await dbBonusBlocks(inputs);
    const mismatches = inputs
      .map((input, i) => ({ input, front: calculateBonusBlock(input), db: db[i] }))
      .filter((x) => x.front !== x.db);
    expect(mismatches.slice(0, 5)).toEqual([]);
    // 抽樣必須涵蓋 0–6 每個區塊，否則這個測試等於沒測某條規則
    const seen = new Set(db);
    for (const b of [1, 2, 3, 4, 5, 6]) expect(seen.has(b), `抽樣沒有出現區塊 ${b}`).toBe(true);
  }, 120_000);

  it('previewBonusBlock 以「儲存後的天數」計算：兼職與督導(代理店長)-雙不存 work_days', async () => {
    const forms = [
      { employment_type: 'part_time', monthly_status: 'full_month', is_pharmacist: false, position: '助理', is_dual_position: false, is_supervisor_rotation: false, is_acting_manager: false, work_days: 0, extra_tasks: [] },
      { employment_type: 'full_time', monthly_status: 'full_month', is_pharmacist: false, position: '督導(代理店長)', is_dual_position: true, is_supervisor_rotation: false, is_acting_manager: false, work_days: 0, extra_tasks: [] },
      { employment_type: 'full_time', monthly_status: 'full_month', is_pharmacist: false, position: '專員', is_dual_position: false, is_supervisor_rotation: false, is_acting_manager: false, work_days: '', extra_tasks: [] },
      { employment_type: 'full_time', monthly_status: 'full_month', is_pharmacist: false, position: '專員', is_dual_position: false, is_supervisor_rotation: false, is_acting_manager: false, work_days: 0, extra_tasks: [] },
    ];
    expect(forms.map((f) => previewBonusBlock(f))).toEqual([6, 4, 3, 3]); // 正職天數空白送出前轉 0（同舊版），所以空白與 0 同為區塊 3
  });
});

// 舊版編輯頁預覽（app/monthly-status/edit/[id]/page.tsx calculateBlock，逐字抄錄邏輯）當作對照，說明 W01b-q1 的差異只在已知範圍。
function legacyPreview(i: BlockInput & { loadedIsPharmacist: boolean; workDaysState: number }): number {
  const { position, employment_type: empType, monthly_status: monthlyStatus } = i;
  if (i.is_supervisor_rotation) return 2;
  if (empType === 'part_time' && (i.loadedIsPharmacist || position.includes('兼職專員'))) return 5;
  if (empType === 'part_time') return 6;
  const extraTasks = i.extra_tasks || [];
  if (
    (position.includes('督導') && i.is_dual_position && (position.includes('代理店長') || i.is_acting_manager)) ||
    (extraTasks.length > 0 && (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')))
  )
    return 4;
  if (empType === 'full_time' && (monthlyStatus !== 'full_month' || i.workDaysState === 0)) return 3;
  if (i.is_dual_position && (position.includes('店長') || position.includes('代理店長'))) return 3;
  if (empType === 'full_time' && monthlyStatus === 'full_month') return 1;
  return 0;
}

describe('W01b-q1 與舊版預覽的差異範圍（供白名單說明）', () => {
  it('舊版預覽與 DB 只在三類情況不同：督導(店長)-雙、天數空白的正職整月、藥師勾選未生效', () => {
    const inputs = [...sampled(6000), { ...base, position: "督導(店長)", is_dual_position: true }];
    let classA = 0;
    let classB = 0;
    for (const d of inputs) {
      const legacy = legacyPreview({ ...d, loadedIsPharmacist: d.is_pharmacist, workDaysState: d.work_days ?? 0 });
      const db = calculateBonusBlock(d);
      if (legacy === db) continue;
      // A：舊版把「店長-雙」規則套到含督導的職位（督導(店長)-雙），DB 明確排除督導
      const isA = d.position.includes('督導') && d.position.includes('店長') && d.is_dual_position && legacy === 3;
      // B：天數為空白的正職整月，舊版 work_days || 0 當 0 → 區塊 3；DB 的 NULL = 0 不成立 → 區塊 1
      const isB = d.work_days === null && d.employment_type === 'full_time' && legacy === 3 && db === 1;
      expect(isA || isB, JSON.stringify(d)).toBe(true);
      if (isA) classA += 1;
      if (isB) classB += 1;
    }
    expect(classA).toBeGreaterThan(0);
    expect(classB).toBeGreaterThan(0);
  });

  it('舊版預覽用「載入時」的藥師狀態，勾選或取消藥師不會更新預覽；DB 用儲存後的值', () => {
    const input: BlockInput = { ...base, employment_type: 'part_time', position: '助理', work_days: null, is_pharmacist: true };
    const legacyAfterTick = legacyPreview({ ...input, loadedIsPharmacist: false, workDaysState: 0 });
    expect(legacyAfterTick).toBe(6);
    expect(calculateBonusBlock(input)).toBe(5);
  });
});
