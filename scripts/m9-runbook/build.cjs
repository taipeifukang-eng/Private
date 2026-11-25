#!/usr/bin/env node
/*
 * 正式區資料庫「逐步操作頁」產生器。
 *
 * 讀 docs/vue-workspace/parity-plan/m9-sql/README.md 的「全部正式區執行順序總表」與表中每個 SQL 檔，
 * 輸出單一 HTML（SQL 內容由本程式直接讀檔嵌入，不手抄）。
 * 絕不連資料庫、不讀 .env*、不輸出任何密碼／連線字串／project ref。
 *
 * 用法：node scripts/m9-runbook/build.cjs [輸出路徑]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PLAN_DIR = path.join(REPO, 'docs', 'vue-workspace', 'parity-plan');
const DEFAULT_OUT = 'C:\\Users\\user\\AppData\\Local\\Temp\\claude\\36e794268116a3de\\898eeb0b-3421-41c5-b9bb-ca6fa1ac61a8\\scratchpad\\m9-review\\m9-runbook.html';

/* ------------------------------------------------------------------ 決定（2026-11-24 老闆） */
// R3：不執行的補授權檔（改由權限勾選頁決定）；R4 之後被 m9 取代的舊草稿。
const EXCLUDED_README_STEPS = {
  89: 'm3-sql/grant_task_view_archived_B_grant.sql',
  90: 'm3-sql/grant_task_manage_B_grant.sql',
  91: 'm4-sql/w17_B_apply.sql',
  92: 'm4-sql/w18_B_apply.sql',
};
const OPTIONAL_README_STEPS = new Set([5, 88]);

const TITLES = {
  18: '補建缺少的權限碼（只建立、不授權）',
  1: '檢查舊版已涵蓋的項目', 2: '找出職位和升職紀錄不一致的員工', 3: '比對誰能打開別人的任務', 4: '查哪些主管缺「看封存任務」權限',
  5: '預覽要補「任務管理」權限的名單', 6: '看改善回補函式現況', 7: '看評級對照與範本總分', 8: '查舊版能回報改善、新版不能的人',
  9: '活動、部門、行事曆等上線前名單（15 份）', 10: '看盤點權限持有人數', 11: '總務上線準備度檢查', 12: '總務第 1 批：套用前現況',
  13: '查已停用但仍有啟用項目的分類', 14: '查料件庫存與重複名單',
  19: '建立「回舊版」備援開關', 20: '員工表加「階段」欄位', 21: '預覽階段回填', 22: '回填員工階段',
  23: '組織與部門職掌（表與函式）', 24: '門市、店長、督導（權限碼與函式）', 25: '活動版本與營運', 26: '任務核心',
  27: '任務刪除與代理', 28: '巡店改善加分', 29: '巡店評級設定與快照', 30: '巡店寫入核心',
  31: '員工管理與員編規則', 32: '門市升遷申請與生效佇列', 33: '調店確認與更正', 34: '異動批次與每月人員名冊',
  35: '關係會員銷售匯入', 36: '商品主檔操作紀錄', 37: '缺貨回覆與刪除回報', 39: '督導日誌軟刪除',
  40: '語音與 AI（每月用量上限）', 41: '自費診所截圖私有桶', 42: '處方箋門市簡稱對照',
  45: '總務第 1 批：分類與料件規則', 46: '總務第 2 批：套用前預覽', 47: '總務第 2 批：異動紀錄與轉移單', 48: '總務第 2 批：設施上線貼標',
  49: '總務第 2 批：Excel 匯入批次', 50: '總務第 2 批：進行中轉移單擋報廢', 51: '總務第 2 批：歷史顯示目前門市',
  52: '總務第 3 批：套用前預覽', 53: '總務第 3 批：庫存位置規則', 54: '總務第 3 批：庫存過帳', 55: '總務第 3 批：調撥', 56: '總務第 3 批：分類保留停用',
  57: '總務第 4 批：套用前預覽', 58: '總務第 4 批：請購規則', 59: '總務第 4 批：採購單', 60: '總務第 4 批：到貨驗入與配發', 61: '總務第 4 批：資產移轉搬單',
  62: '總務第 5 批：套用前預覽', 63: '總務第 5 批：工單規則', 64: '總務第 5 批：請購補件同步', 65: '總務第 5 批：工單領用料件', 66: '總務第 5 批：工單權限收緊',
  67: '總務第 6 批：套用前預覽', 68: '總務第 6 批：廠商欄位與固定資料', 69: '總務第 6 批：廠商函式', 70: '總務第 6 批：統編唯一索引',
  71: '總務第 6 批：工單廠商檢查', 72: '總務第 6 批：水電帳單', 73: '總務第 6 批：績效與首頁徽章', 74: '總務第 6 批：效能調整', 75: '總務第 6 批：廠商權限收緊',
  76: '總務第 4.5 批：套用前預覽', 77: '總務第 4.5 批：進貨明細回填未稅金額', 78: '總務第 4.5 批：請款單', 79: '總務第 4.5 批：廠商銀行欄位',
  80: '總務第 4.5 批：附件類型', 81: '總務第 4.5 批：新權限碼', 82: '總務第 4.5 批：函式', 83: '總務第 4.5 批：待請款與分析',
  84: '總務第 4.5 批：作廢進貨', 85: '總務第 4.5 批追加：廠商銀行異動紀錄', 86: '總務第 4.5 批追加：請款規則', 87: '總務第 4.5 批追加：草稿過期',
  88: '把誤停用的活動改回啟用',
  15: '正式區物件有沒有（239 項，唯讀）', 16: '舊版 migration 有沒有套用（唯讀）', 17: '舊版 migration 內容有沒有套用（唯讀）',
  38: '督導管理日誌整組補建（舊版從沒套用）', 43: '設備與設施 QR 作廢觸發器補建',
  44: '舊版庫存與附件補漏（函式與授權）',
};

/* ------------------------------------------------------------------ README 解析 */
function readUtf8(p) { return fs.readFileSync(p, 'utf8'); }
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return s.split('|').map((c) => c.trim());
}

function parseReadme(text) {
  const startIdx = text.indexOf('## 全部正式區執行順序總表');
  if (startIdx < 0) throw new Error('README 找不到「全部正式區執行順序總表」');
  const rest = text.slice(startIdx);
  const endIdx = rest.indexOf('\n---');
  const section = endIdx > 0 ? rest.slice(0, endIdx) : rest;
  const stages = [];
  const steps = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const c = splitRow(line);
    if (/^\*\*階段/.test(c[0])) {
      stages.push({ title: c[0].replace(/\*/g, '').replace(/\s+/g, ' ').trim() });
    } else if (/^\d+$/.test(c[0])) {
      if (c.length < 7) throw new Error('README 第 ' + c[0] + ' 步欄位不足 7 欄');
      steps.push({ no: Number(c[0]), stageIdx: stages.length - 1, fileCell: c[1], what: c[2], nature: c[3], backup: c[4], rollback: c[5], verify: c[6] });
    }
  }
  const claim = section.match(/合計\s*\*\*(\d+)\s*步\*\*/);
  if (!claim) throw new Error('README 找不到「合計 N 步」');
  if (Number(claim[1]) !== steps.length) {
    throw new Error('README 寫合計 ' + claim[1] + ' 步，但總表實際解析到 ' + steps.length + ' 步');
  }
  steps.forEach((s, i) => { if (s.no !== i + 1) throw new Error('README 步驟序號不連續：預期 ' + (i + 1) + ' 實際 ' + s.no); });
  return { stages, steps, claimed: Number(claim[1]) };
}

/* ------------------------------------------------------------------ 檔案解析 */
function must(planDir, rel) {
  const abs = path.join(planDir, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('總表步驟對應的檔案不存在：' + rel);
  return abs;
}
function fileBlock(planDir, rel, label, note) {
  const abs = must(planDir, rel);
  return { label, file: rel.replace(/\\/g, '/'), sql: readUtf8(abs), ...(note ? { note } : {}) };
}
function resolvePrefix(planDir, dir, name) {
  const all = fs.readdirSync(path.join(planDir, dir)).filter((f) => f.endsWith('.sql'));
  const exact = all.filter((f) => f === name + '.sql');
  if (exact.length === 1) return dir + '/' + exact[0];
  const pre = all.filter((f) => f.startsWith(name + '_') || f.startsWith(name + '-'));
  if (pre.length !== 1) throw new Error('總表列出的檔名無法唯一對應：' + dir + '/' + name + '（找到 ' + pre.length + ' 個）');
  return dir + '/' + pre[0];
}
function resolveMainFiles(planDir, step) {
  const toks = [...step.fileCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (!toks.length) throw new Error('README 第 ' + step.no + ' 步沒有檔案欄位');
  if (toks.length === 1 && toks[0].endsWith('/')) {
    const dir = toks[0].replace(/\/$/, '');
    const afterColon = step.fileCell.split(/[：:]/).slice(1).join(':');
    const names = afterColon.split('、').map((x) => x.replace(/`/g, '').trim()).filter(Boolean);
    if (!names.length) throw new Error('README 第 ' + step.no + ' 步沒列出檔名');
    return names.map((n) => resolvePrefix(planDir, dir, n));
  }
  return toks.map((t) => { must(planDir, t); return t; });
}
function siblingPaths(rel) {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel, '.sql');
  return {
    backup: dir + '/' + base + '.backup.sql',
    preview: dir + '/' + base + '.preview.sql',
    verify: dir + '/' + base + '.verify.sql',
    rollbackA: dir + '/' + base + '.rollback.sql',
    rollbackB: dir + '/' + base + '-rollback.sql',
  };
}
const EXISTS = (planDir, rel) => fs.existsSync(path.join(planDir, rel));

/* ------------------------------------------------------------------ SQL 工具 */
function needsCommit(sql) {
  return /^\s*BEGIN\s*;/im.test(sql) && !/^\s*COMMIT\s*;/im.test(sql);
}
function selfBackup(sql) {
  return /pg_get_functiondef|_backup\b|zz_bak|m9_bak|m9_.*_backup|m5_w19_campaign_backup/i.test(sql);
}

/* ------------------------------------------------------------------ 自寫（非檔案）區塊 */
const R4_CHECK_SQL = `-- R4 判斷（唯讀，只有 SELECT）：舊草稿 w17_B／w18_B 之前有沒有在正式區跑過
WITH f AS (
  SELECT
    to_regclass('public.m4_w17_backup') IS NOT NULL AS w17_backup_table,
    to_regclass('public.m4_w18_backup') IS NOT NULL AS w18_backup_table,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'calculate_improvement_bonus'
              AND p.prosrc LIKE '%Asia/Taipei%' AND p.prosrc LIKE '%deadline%') AS w17_function_is_new,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'inspection_masters' AND column_name = 'grade_thresholds') AS w18_column_exists,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspace_01_grade_snapshot' AND NOT tgisinternal) AS w18_trigger_exists,
    to_regclass('public.m9_improvements_backup') IS NOT NULL AS m9_55_backup_exists,
    to_regclass('public.m9_inspection_settings_backup') IS NOT NULL AS m9_90_backup_exists
)
SELECT f.*,
       (w17_backup_table OR (w17_function_is_new AND NOT m9_55_backup_exists)) AS w17_B_looks_applied,
       (w18_backup_table OR w18_column_exists OR w18_trigger_exists) AS w18_B_looks_applied,
       CASE
         WHEN m9_55_backup_exists OR m9_90_backup_exists THEN 'STOP：55 或 90 的備份表已存在，表示之前跑過，請停下來聯絡 Claude'
         WHEN (w17_backup_table OR w17_function_is_new) OR (w18_backup_table OR w18_column_exists OR w18_trigger_exists) THEN 'STOP：舊草稿 w17_B 或 w18_B 疑似跑過，請停下來聯絡 Claude'
         ELSE 'OK：兩份舊草稿都沒跑過，可以繼續'
       END AS conclusion
FROM f;
`;
const CRON_ENABLE_CHECK_SQL = `-- 檢查 pg_cron 是否已啟用（唯讀）
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
`;
const CRON_SCHEDULE_SQL = `-- 每天台北時間 00:05 執行 workspace_apply_due_promotions()（讓「生效日已到」的升遷自動生效）。
-- 注意：pg_cron 用 UTC。台北 00:05 = UTC 16:05（前一天），所以排程寫 '5 16 * * *'。
-- 可重複執行：先取消同名排程再重建（若 pg_cron 先前已裝，草稿 30 建的每分鐘排程也是這個名字，會一起被換掉）。
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'workspace-promotion-activation';
  PERFORM cron.schedule('workspace-promotion-activation', '5 16 * * *', 'SELECT public.workspace_apply_due_promotions();');
END $$;
`;
const CRON_CHECK_SQL = `-- 檢查排程（唯讀）：應該剛好 1 列，schedule 是 5 16 * * *，active 是 true
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'workspace-promotion-activation';
`;
const CRON_RUNS_SQL = `-- 隔天（12/8）早上再看一次：最近幾次執行結果（唯讀）。status 應為 succeeded。
SELECT status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'workspace-promotion-activation')
ORDER BY start_time DESC
LIMIT 5;
`;
const CRON_UNSCHEDULE_SQL = `-- 撤回：取消這個排程（之後未來生效的升遷要手動呼叫 workspace_apply_due_promotions()）
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'workspace-promotion-activation';
`;
const BACKUP_GA_VENDORS_SQL = `-- 備份 ga_vendors（整張複製；表已存在就不會覆蓋舊備份）。確認上線穩定後再自行 DROP。
CREATE TABLE IF NOT EXISTS public.zz_bak_b6_ga_vendors AS SELECT * FROM public.ga_vendors;
SELECT (SELECT count(*) FROM public.ga_vendors) AS source_rows, (SELECT count(*) FROM public.zz_bak_b6_ga_vendors) AS backup_rows;
`;
const BUCKET_STATE_SQL = `-- 記錄「自費診所截圖」桶套用前的設定（唯讀）。要撤回時，依這份記錄人工調回原設定。
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'clinic-selfpay-screenshots';
`;
const COMMIT_SQL = 'COMMIT;\n';
const ROLLBACK_SQL = 'ROLLBACK;\n';

function extractB45Backup(planDir) {
  const text = readUtf8(path.join(planDir, 'm7m8-sql', 'README.md'));
  const m = text.match(/CREATE TABLE public\.zz_bak_b45_receipts AS SELECT \* FROM public\.ga_purchase_receipts;[^`]*?public\.zz_bak_b45_receipt_items AS SELECT \* FROM public\.ga_purchase_receipt_items;/);
  if (!m) throw new Error('m7m8-sql/README.md 找不到第 4.5 批備份指令');
  return m[0].replace(/;\s+CREATE/g, ';\nCREATE') + '\n';
}

/* ------------------------------------------------------------------ 每步的白話補充 */
const READONLY_DEFAULT = '查詢能跑完、沒有紅色錯誤訊息。這是「現況名單」，不是對錯題：有名單就截圖留給 Claude 對照，沒有名單也正常。';
const STATUS_JUDGE = '結果裡的 status 欄不應該出現 MISSING；出現就停下。WARN 與 ALREADY 請截圖給 Claude，其餘 OK、INFO 是正常資訊。';
const VERIFY_STOP = { where: 'verify', title: '檢查不通過就停下', body: '只要有一列 ok 不是 true、或出現紅色錯誤，就停下來，不要做下一步；截圖給 Claude，需要撤回時照下面「撤回」那一段，先問 Claude 再貼。' };
const VERIFY_DEFAULT = '每一列的 ok 都是 true（沒有 false）。';

const EXPECT = {
  1: '每一列的 ok 都是 true；只有最後兩列（has_permission 語意）預期是 false。其他任何一列是 false，代表正式區少了一支舊版 migration，要停下。',
  2: '只跑第一段（職位比對），第二段先不要跑。查詢能跑完、沒有紅色錯誤訊息即可。正式區 2026-11-25 預演第一段結果是 12 筆「員工主檔職位和最新升職異動不一致」，這是需要人工核對的名單，不是停止點：不要自動修正，把名單截圖給 Claude，逐位核對後再決定怎麼處理。上線當天筆數若和 12 差很多也請截圖回報。',
  3: READONLY_DEFAULT, 4: READONLY_DEFAULT,
  5: '這份是選用，可以略過（補授權改由權限勾選頁處理）。要預覽才需要先在檔內填名單；不做也不影響後面的步驟。',
  6: '看得出函式現況與「UTC 少算一天」的筆數即可，數字截圖給 Claude；沒有紅字就算對。正式區 2026-11-25 預演結果：最後一段「已逾期仍 pending」有 238 筆，這是預期現象（舊版沒有逾期保護，套用 55 後逾期一律可補報但回補 0），不是停止點。',
  7: '正式區 2026-11-25 預演結果（已知、預期，不是停止點）：第 1 段「評級對照」有 9 個等級（第 1～9 等）門檻和舊版寫死值不同（正式區對照表是 216／210／200／181／171／161／151／141／131）；第 4 段「評級與對照表不一致」有 79 筆（已完成或已結案共 340 筆）。{{29}}補 snapshot 時用的是目前的對照表，已完成單的既有評級不會被改。上線當天數字若和預演差很多（對照表被改過、不一致筆數大增），截圖給 Claude 再決定。',
  8: READONLY_DEFAULT, 9: '15 份依序執行，每份都跑得出結果、沒有紅字即可。有名單的截圖留給 Claude。',
  10: READONLY_DEFAULT, 11: STATUS_JUDGE, 12: STATUS_JUDGE, 13: READONLY_DEFAULT, 14: READONLY_DEFAULT,
  21: '預覽欄位 proposed_stage 就是下一步會填入的值：抽看幾位員工，階段符合你的認知即可；沒有紅字。',
  22: '看過回傳的「更新筆數」合理後，再貼 COMMIT; 單獨執行。做完後回上一步（預覽）重跑，「待回填」應為 0。',
  28: VERIFY_DEFAULT + ' 備份表 m9_improvements_backup 會自動出現。',
  29: VERIFY_DEFAULT + ' 特別看「目前評級對照表」那一項，要和舊版寫死值（220/215/191/181/171/161/151/141/131/121）相同。',
  31: VERIFY_DEFAULT,
  34: '第一部分每一列 ok 都是 true；第二部分逐月檢查，每個月份的「問題筆數」都應為 0（pending_recheck 有數字是正常，不算問題）。從最舊的月份一個月一個月看。做完後回到{{17}}（00d）重跑一次：結果最後的 observations 裡「每月人員狀態中，職位或新人階級與升遷歷史不一致的列數」正式區預演是 55，做完這步應明顯下降（草稿月份被重算）；殘留的筆數若落在「已送審／已確認」月份是預期的（這步不改已送審或已確認月份，也不補升遷異動備註），不是停止點，把剩下的筆數與月份回報給 Claude 即可。',
  46: STATUS_JUDGE, 52: STATUS_JUDGE, 57: STATUS_JUDGE, 62: STATUS_JUDGE + ' 這份第 6、7 區的名單要仔細看，截圖給 Claude。',
  67: STATUS_JUDGE + ' 第 3 區（重複統編）必須是 0 組；第 6、7、8 區的名單要先給 Claude 確認。', 76: STATUS_JUDGE + ' 第 2 區回填筆數與第 9 區權限碼請截圖。',
};
EXPECT[15] = '結果只有一格 JSON（欄位 result）。整段複製貼給 Claude，不用自己判斷。missing 清單裡「督導管理日誌的資料表與函式」和「QR 作廢觸發器」是已知會缺的，分別由{{38}}、{{43}}補；pg_cron 缺是選用，由後面的啟用步驟處理。如果還缺別的東西，不要往下做，等 Claude 回覆。{{38}}、{{43}}、{{44}}（07、08、09）都做完後再跑一次：預期只剩 pg_cron 缺（pg_cron 啟用後就是全齊）。';
EXPECT[16] = '結果只有一格 JSON（欄位 result）。整段複製貼給 Claude，不用自己判斷。missing_by_migration 裡 status = all_missing 代表整支舊版 migration 沒套用，已知的是督導管理日誌（5 支）與 QR 作廢（1 支）；其他有缺的先不要動，等 Claude 回覆。{{38}}、{{43}}、{{44}}都做完後再跑一次：督導日誌（5 支）與 QR 作廢（1 支）的 all_missing 應全部消失。';
EXPECT[17] = '結果只有一格 JSON（欄位 result）。整段複製貼給 Claude，不用自己判斷。missing 清單是「00c 查不出的 32 支舊版 migration」裡不成立的記號：superseded_by 有寫的（督導日誌 3 支由{{38}}補、異動類型約束由{{34}}補、授權類由權限勾選頁決定）缺了無妨；superseded_by 是 null 的才是真的沒套用，請原樣回報給 Claude，不要自己補跑舊版 migration。undeterminable 與 observations 是無法判斷的資料修補（新人升遷時間軸修復），看 observations 的筆數即可，大於 0 也先回報、不要動。庫存與附件 6 支（舊版庫存位置刪除原因、序號授權、函式授權、過帳 ON CONFLICT、附件管理判斷）由{{44}}補。{{38}}、{{43}}、{{44}}（07、08、09）都做完後再跑一次：missing 應從 18 項降到只剩 4 項（維修回報 p1e_ 政策 1 項，正式區是更早的全開政策、不屬漏套用，待老闆決定；總務角色矩陣授權 3 項，由權限勾選頁與授權步驟決定），督導日誌 6 項、庫存 6 項、附件 2 項都消失。觀察值（observations）的 55 列要等{{34}}（異動批次與每月人員名冊）之後才會下降。';
EXPECT[38] = VERIFY_DEFAULT + ' 共 83 列左右，rollback 後才會出現 false；套用後不應該有任何 false。';
EXPECT[43] = VERIFY_DEFAULT + ' 共 11 列；其中最後一列 info 是參考資訊，恆為 true。';
EXPECT[44] = VERIFY_DEFAULT + ' 共 12 列（11 項檢查加 1 列參考資訊 info，恆為 true；info 會列出維修回報現有政策，正式區預期是 maintenance_requests_read、maintenance_requests_write 兩條）。第 10 項剛做完時 md5 應是 41a29efc4e62b01a7ce8f7d0fce9eead，這是總務第 2 批{{48}}的守衛要求的版本。做完後可重跑{{15}}、{{16}}、{{17}}（00b、00c、00d），預期見各步說明。';
const NO_VERIFY_FILE = '畫面下方出現 Success（成功）、沒有紅色錯誤訊息。這份沒有專屬檢查檔：整批做完後，可再跑一次該批的「套用前預覽」，status 應轉為 ALREADY 或 OK。';

// 特定步驟的停止點 / 提醒（where: preview | main | verify）
const STOPS = {
  7: [{ where: 'main', title: '結果和預演差很多就停下（有 true 與 79 筆不一致本身是預期）', body: '正式區預演已知：第 1 段有 9 個等級的門檻和舊版寫死值不同（diff 欄 true）、第 4 段不一致 79 筆，這些是預期現象，不是停止點。上線當天若對照表門檻和預演不同（被改過）、或第 4 段不一致筆數明顯大於 79，先不要做{{29}}，把截圖給 Claude 決定（老闆決定事項 4）。' }],
  29: [{ where: 'main', title: '先確認{{7}}的評級對照是「相同」', body: '如果{{7}}看到評級對照和舊版寫死值不同，請先停下聯絡 Claude；上線後新單的評級會跟著資料庫對照表走。' }],
  31: [{ where: 'preview', title: 'R1 員編規則：預覽有「近期仍在用的不合規員編」就停下', body: '先跑下面的預覽（15 的 .preview.sql）。若列出近期仍在用的不合規員編（舊版近期的入職異動或手動新增用了 FKI、留空、大小寫不一致等），不要貼主檔，停下來聯絡 Claude，不繼續後面的步驟。看不出來是不是「近期仍在用」也停下問。老闆已決定員編規則觸發器要裝，但前提是預覽乾淨。' }],
  66: [{ where: 'main', title: '這步會收緊工單權限：名單沒確認前先不要做', body: '總表標示「驗收並補授權後才執行」。若還沒和 Claude 確認過{{62}}預覽的第 6、7 區名單，這一步先不要貼，直接問 Claude（不要勾完成）。' }],
  70: [{ where: 'main', title: '檔案若列出重複統編並中止，就停下', body: '這份開頭會檢查重複統編；有重複就自己中止並列出名單。看到名單不要硬跑，截圖給 Claude 先整理重複資料。' }],
  75: [{ where: 'main', title: '這步會收緊廠商權限：名單確認前不得做', body: '總表標示「名單確認前不得套用」。{{67}}預覽第 6、7、8 區的名單沒和 Claude 確認過，這一步先不要貼，直接問 Claude（不要勾完成）。' }],
};
const CAUTIONS = {
  2: ['這個檔案有兩段查詢。貼上時只複製「-- ==== 第一段：職位比對 ====」到「-- ==== 第二段：階段比對」那一行之前的內容，不要貼第二段。第二段要用到員工主檔的「階段」欄位（store_employees.newbie_level），要等{{20}}（員工表加「階段」欄位，backfill_employee_stage_A_add_column）做完才能跑；現在整份貼上，第二段會報「欄位不存在」的紅字，而且可能蓋掉第一段的結果。', '第二段（階段比對）等{{22}}（回填員工階段）做完後再補跑一次即可，不跑也不影響上線。'],
  18: ['這份只建立 11 個權限碼，不授權給任何角色（授權由權限勾選頁決定），所以做完之後角色看不到任何變化是正常的。其中督導管理日誌的 7 個碼，舊版是和 supervisor_management_* 資料表一起建的；正式區連那些資料表都沒有（00b 查出），已由{{38}}（督導管理日誌補建）整組補上，所以{{39}}（督導日誌軟刪除）不會再報「Missing prerequisite」。只要{{38}}沒有做完，就不要做{{39}}與{{40}}。'],
  5: ['這一步可以略過（選用）：老闆已決定補授權改由權限勾選頁處理，不再用這份預覽名單。要預覽的話，才需要先改檔內的名單（預設是佔位文字）；不做就保持不勾，不影響後面的步驟。'],
  22: ['這份和{{33}}（調店確認與更正）裡的階段回填內容相同，總表寫「二擇一即可」；照總表仍列在這裡，做完沒問題後{{33}}會再跑一次也無妨。'],
  27: ['前置：{{26}}（任務核心）必須先做完。'],
  33: ['如果{{22}}已經跑過備份，這裡的備份檔會因為「已存在就不覆蓋」而保留{{22}}當時的備份，這是正常的。'],
  41: ['套用前先確認正式區既有的「自費診所截圖」桶是私有的：這份會把同名桶改回私有、上限 10MB。用公開網址讀截圖的地方會失效（新舊版都用簽名網址則不受影響）。'],
  38: ['前置：{{18}}（補建權限碼）要先做完，這份開頭會檢查 7 個督導管理日誌權限碼；也需要舊版 current_user_has_permission(varchar) 與 store_managers 等舊表（{{15}}會列出缺什麼）。', '這份只新增表與函式，不寫任何資料、不授權任何角色；做完之後角色看不到任何變化是正常的。權限語意沿用舊版（放行 admin 與管理員角色碼、檢查 roles.is_active），和正式區 has_permission 不同，這是照舊版逐字帶入，老闆知悉即可。', '還原時若已做過{{40}}（語音與 AI），要先還原{{40}}再還原這份（語音表有外鍵參照 supervisor_management_records）。'],
  44: ['這份補的是 00d 發現正式區沒套用的舊版內容（只改函式與授權，不碰資料表、資料、政策，也不授權任何權限碼）：刪除庫存位置的下層明細原因、庫存過帳函式的 ON CONFLICT 寫法、庫存序號與取號／過帳函式的授權、附件管理判斷函式。', '必須在{{48}}（總務第 2 批：設施上線貼標）之前做：{{48}}開頭有 md5 守衛，要求附件管理判斷函式是這份建立的版本，沒做這步{{48}}會自己中止。', '這份可重複執行；函式已含設施貼標分支（{{48}}之後）會自動略過，不會把後面步驟的內容蓋掉。撤回時若{{48}}之後的步驟已改過附件管理判斷，會中止，要先還原那些步驟。', '刻意不補「維修回報 p1e_ 政策」：正式區維修表是更早的全開政策，改成 p1e_ 會讓沒有總務權限碼的人讀不到維修資料，要和授權一起由老闆決定；因此{{66}}（工單權限收緊）在正式區也不會真的收緊（全開的寫入政策仍在），待老闆決定。'],
  43: ['這份刻意不含舊版的「回填既有資料」兩段 UPDATE：只對之後的新增與更新生效。先看上面的預覽，已報廢、已退役或已刪除但 QR 還沒作廢的筆數若不是 0，把截圖給 Claude，由老闆決定要不要另外回填（回填 SQL 在預覽檔最後，以註解提供）。', '這份開頭會檢查設備與設施兩張表的 status、deleted_at、qr_token_revoked_at 三個欄位；缺任一欄會自己中止並列出缺什麼，看到中止訊息就停下問 Claude。'],
  88: ['這份是選用：要先看過「{{9}}」中的停用活動名單，決定要改回啟用的活動，並把 id 填進檔內暫存表；沒有要改就整步跳過（保持不勾）。'],
};
const PREVIEW_JUDGE = {
  32: '預覽看一下現況；pg_cron 是否已安裝這欄現在可能是 false，這是預期的（排程另外在後面步驟處理）。',
  43: '只有 2 列（設備、設施），看 pending_backfill：不是 0 代表有已報廢／已退役／已刪除但 QR 還沒作廢的資料。套用本步驟不會改它們，請截圖給 Claude 決定要不要另外回填。若報「欄位不存在」，代表前置欄位缺，停下問 Claude。',
  34: '第一部分是套用前現況（唯讀）；第二部分會故意用 RAISE EXCEPTION 還原，看到「錯誤」訊息是預期的、不會寫入。',
};

/* ------------------------------------------------------------------ 上線後（GA）第二份操作頁 */
// 水電話費請款（G46）與採購請款改善第一批（B1）：依老闆 2026-11-25 決定，和這次新版部署一起上正式區（不再等 12/15）。
// 這份是「第二份」操作頁，總表是 ga-post-cutover-runbook.md，不併入 92 步的 m9 總表。
const GA_README = 'ga-post-cutover-runbook.md';
const GA_OPTIONAL = new Set();
const GA_TITLES = {
  1: '水電話費請款（G46）：套用前預覽（唯讀）',
  2: 'G46 第 1 份：請款單來源與水電明細表',
  3: 'G46 第 2 份：帳單端（繳費單位與鎖定）',
  4: 'G46 第 3 份：請款核心（送出前檢查與自動標記）',
  5: 'G46 第 4 份：對 5 支既有請款函式的最小加掛',
  6: '採購請款改善第一批（B1）：套用前預覽（唯讀）',
  7: 'B1 第 1 份：多家買受人公司',
  8: 'B1 第 2 份：含稅單價與調整列',
  9: 'B1 第 3 份：付款方式與同仁代墊',
  10: 'B1 第 4 份：預付款',
  11: 'B1 第 5 份：權限顯示名稱',
};
const GA_EXPECT = {
  1: '輸出一張表。A 區沒有任何 MISSING、D 區沒有任何 SHAPE_MISMATCH 才能繼續。B 區（金額有小數或 0 元的帳單）與 C 區（是否已有公用事業分類）請截圖給 Claude 看；E 區的 9 支函式全文請整份存檔（等同撤回的對照）。',
  2: '每一列 status 都是 pass。',
  3: '每一列 status 都是 pass。',
  4: '每一列 status 都是 pass。',
  5: '每一列 status 都是 pass。做完後回到下面的「黃金快照（G46 做完後）」，三份結果必須和套用前完全相同。',
  6: '輸出第一列的結果必須是 ok；不是 ok 就停下（先決條件不足，多半是 G46 還沒做完）。其餘各列是現況資料量、設定鍵、約束與各函式現行定義的雜湊，請整份存檔，做完後要拿來對照。',
  7: '每一列 status 都是 pass。',
  8: '每一列 status 都是 pass。這份改了金額計算函式本體，做完立刻跑下面的黃金比對，三份結果都要和套用前相同。',
  9: '每一列 status 都是 pass。',
  10: '每一列 status 都是 pass。這份改了累計請款與待請款的計算，做完整批後還要再跑一次黃金比對。',
  11: '每一列 status 都是 pass。這份和 01 至 04 互不相依，只換函式裡的白話訊息。',
};
const GA_STOPS = {
  1: [{ where: 'main', title: 'A 區有 MISSING 或 D 區有 SHAPE_MISMATCH 就停下', body: 'A 區有 MISSING 代表前面的批次還沒套用完（先去補）；D 區有 SHAPE_MISMATCH 代表正式區現行函式和 DEV 實測版本不同，不能硬套。兩者都不要往下做，截圖給 Claude。' }],
  6: [{ where: 'main', title: '第一列不是 ok 就停下', body: '第一列是先決條件檢查。不是 ok 代表 G46 沒做完或第 4.5 批請款單不在，不要套用 B1。' }],
  8: [{ where: 'verify', title: '黃金比對只要有一個數字不同就停下', body: '用「做之前存下的黃金快照」和這次的結果逐列比對：各狀態張數與總額、各採購單累計請款、清單指紋。有任何差異，不要往下做，先問 Claude 要不要撤回 02。' }],
};
const GA_CAUTIONS = {
  1: ['這份只有 SELECT，可以放心跑。輸出整份要存檔（尤其是 E 區的函式全文），等一下備份與撤回都要對照。', '老闆已決定：G46 的選用 05 補填繳費單位不跑（正式區目前廠商是 0 筆，沒有東西可補）；之後用畫面補填。'],
  2: ['套用前先貼本步驟的「備份」區塊：四張表與 9 支函式全文，確認筆數對得上再做主要 SQL。', '做完這份請依序做後面三份，每份都要先看檢查全部 pass 再往下；任何一份出錯，從該份開始往前依序撤回。'],
  5: ['G46 的 4 份做完後，要回「黃金快照（G46 做完後）」比對採購請款完全沒有變化。'],
  7: ['套用前先貼本步驟的備份區塊（含這批會動到的資料表與函式全文），B1 的 README 沒附備份，所以本頁內建。', '若 pay_buyer_title 與 pay_buyer_tax_id 只有其中一個有值、或統編不是 8 碼，不會自動搬成預設公司；做完後請總務到請款設定新增公司並設為預設。'],
  8: ['02 有資料回填與金額計算變更，是 B1 風險最高的一份，做完一定要跑黃金比對。'],
  9: ['這份只把付款方式約束放寬成超集，風險低。'],
  10: ['這份改了累計請款與待請款計算，風險中等。'],
  11: ['05 可以在 B1 的任何時間點做，這裡排在最後。'],
};
const GA_PREVIEW_JUDGE = {};

const BACKUP_GAUP_SQL = `-- G46 套用前備份：四張表整張複製（表已存在就不會覆蓋舊備份）。確認上線穩定後再自行 DROP。
CREATE TABLE IF NOT EXISTS public.zz_bak_gaup_utility_bills AS SELECT * FROM public.ga_utility_bills;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaup_payment_requests AS SELECT * FROM public.ga_payment_requests;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaup_workflow_settings AS SELECT * FROM public.ga_workflow_settings;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaup_service_categories AS SELECT * FROM public.ga_service_categories;
SELECT (SELECT count(*) FROM public.ga_utility_bills) AS utility_bills, (SELECT count(*) FROM public.zz_bak_gaup_utility_bills) AS utility_bills_bak,
       (SELECT count(*) FROM public.ga_payment_requests) AS payment_requests, (SELECT count(*) FROM public.zz_bak_gaup_payment_requests) AS payment_requests_bak,
       (SELECT count(*) FROM public.ga_workflow_settings) AS workflow_settings, (SELECT count(*) FROM public.zz_bak_gaup_workflow_settings) AS workflow_settings_bak,
       (SELECT count(*) FROM public.ga_service_categories) AS service_categories, (SELECT count(*) FROM public.zz_bak_gaup_service_categories) AS service_categories_bak;
`;
const BACKUP_GAIB1_SQL = `-- B1 套用前備份：這批會新增欄位或更新資料的既有表（表已存在就不會覆蓋舊備份）。確認上線穩定後再自行 DROP。
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_payment_requests AS SELECT * FROM public.ga_payment_requests;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_payment_request_lines AS SELECT * FROM public.ga_payment_request_lines;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_payment_request_events AS SELECT * FROM public.ga_payment_request_events;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_purchase_orders AS SELECT * FROM public.ga_purchase_orders;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_purchase_order_items AS SELECT * FROM public.ga_purchase_order_items;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_purchase_receipt_items AS SELECT * FROM public.ga_purchase_receipt_items;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_workflow_settings AS SELECT * FROM public.ga_workflow_settings;
CREATE TABLE IF NOT EXISTS public.zz_bak_gaib1_permissions AS SELECT * FROM public.permissions;
SELECT (SELECT count(*) FROM public.ga_payment_requests) AS payment_requests, (SELECT count(*) FROM public.zz_bak_gaib1_payment_requests) AS payment_requests_bak,
       (SELECT count(*) FROM public.ga_payment_request_lines) AS payment_request_lines, (SELECT count(*) FROM public.zz_bak_gaib1_payment_request_lines) AS payment_request_lines_bak,
       (SELECT count(*) FROM public.ga_purchase_orders) AS purchase_orders, (SELECT count(*) FROM public.zz_bak_gaib1_purchase_orders) AS purchase_orders_bak,
       (SELECT count(*) FROM public.ga_purchase_order_items) AS purchase_order_items, (SELECT count(*) FROM public.zz_bak_gaib1_purchase_order_items) AS purchase_order_items_bak,
       (SELECT count(*) FROM public.ga_purchase_receipt_items) AS purchase_receipt_items, (SELECT count(*) FROM public.zz_bak_gaib1_purchase_receipt_items) AS purchase_receipt_items_bak,
       (SELECT count(*) FROM public.permissions) AS permissions, (SELECT count(*) FROM public.zz_bak_gaib1_permissions) AS permissions_bak;
`;
const GOLDEN_STATUS_SQL = `-- 黃金快照 1／3（唯讀）：請款單各狀態的張數與金額。套用前後各跑一次，結果必須完全相同。
SELECT status, count(*) AS n, COALESCE(sum(amount_untaxed), 0) AS untaxed, COALESCE(sum(tax_amount), 0) AS tax, COALESCE(sum(amount_total), 0) AS total
FROM public.ga_payment_requests
GROUP BY status
ORDER BY status;
`;
const GOLDEN_PO_SQL = `-- 黃金快照 2／3（唯讀）：各採購單累計請款（依請款單狀態分開）。套用前後各跑一次，結果必須完全相同。
SELECT l.po_id, r.status, count(*) AS lines, sum(l.claim_untaxed) AS claim_untaxed, sum(l.claim_tax) AS claim_tax, sum(l.claim_total) AS claim_total
FROM public.ga_payment_request_lines l
JOIN public.ga_payment_requests r ON r.id = l.pr_id
GROUP BY l.po_id, r.status
ORDER BY l.po_id, r.status;
`;
const GOLDEN_LIST_SQL = `-- 黃金快照 3／3（唯讀）：請款單清單的指紋（單號、狀態、金額逐筆串起來取 md5）。套用前後各跑一次，結果必須完全相同。
SELECT count(*) AS n, md5(COALESCE(string_agg(pr_no || '|' || status || '|' || amount_total::text, ',' ORDER BY pr_no), '')) AS list_fingerprint
FROM public.ga_payment_requests;
`;
function goldenBlocks() {
  return [
    { label: '黃金快照 1／3：各狀態張數與金額（唯讀，本產生器內建）', file: '', sql: GOLDEN_STATUS_SQL },
    { label: '黃金快照 2／3：各採購單累計請款（唯讀，本產生器內建）', file: '', sql: GOLDEN_PO_SQL },
    { label: '黃金快照 3／3：請款單清單指紋（唯讀，本產生器內建）', file: '', sql: GOLDEN_LIST_SQL },
  ];
}
// 函式本體備份：從「套用前預覽」檔讀出要備份的函式清單（不手抄），產生唯讀的函式全文查詢。
function gaFuncBackupG46(planDir) {
  const text = readUtf8(must(planDir, 'ga-utility-payment-sql/00-preview-before-apply.sql'));
  const m = text.match(/E 現行定義全文[\s\S]*?p\.proname IN \(([^)]*)\)/);
  if (!m) throw new Error('ga-utility-payment-sql/00-preview-before-apply.sql 找不到 E 區的函式清單');
  return `-- G46 套用前備份：9 支被加掛的函式全文（唯讀）。結果整份複製存檔（這是預覽 E 區同一份名單）。
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN (${m[1].trim()})
 ORDER BY 1;
`;
}
function gaFuncBackupB1(planDir) {
  const text = readUtf8(must(planDir, 'ga-improve-b1-sql/00-preview-before-apply.sql'));
  const m = text.match(/unnest\(ARRAY\[([^\]]*)\]\)/);
  if (!m) throw new Error('ga-improve-b1-sql/00-preview-before-apply.sql 找不到函式簽名清單');
  return `-- B1 套用前備份：會被加掛或改寫的函式全文（唯讀）。結果整份複製存檔；函式不存在的列 definition 會是空的。
SELECT x.sig AS fn, pg_get_functiondef(to_regprocedure(x.sig)) AS definition
  FROM unnest(ARRAY[${m[1].trim()}]) AS x(sig)
 ORDER BY 1;
`;
}
// README 步驟序號 -> 該步要附的備份區塊
function gaBackupBlocks(no, planDir) {
  if (no === 2) return [
    { label: '備份 1／2：四張表（本產生器內建）', file: '', sql: BACKUP_GAUP_SQL },
    { label: '備份 2／2：9 支函式全文（唯讀，名單取自 G46 預覽檔 E 區）', file: 'ga-utility-payment-sql/00-preview-before-apply.sql', sql: gaFuncBackupG46(planDir) },
  ];
  if (no === 7) return [
    { label: '備份 1／2：B1 會動到的表（本產生器內建）', file: '', sql: BACKUP_GAIB1_SQL },
    { label: '備份 2／2：函式全文（唯讀，名單取自 B1 預覽檔）', file: 'ga-improve-b1-sql/00-preview-before-apply.sql', sql: gaFuncBackupB1(planDir) },
  ];
  return [];
}

/** GA 額外步驟（非總表的 SQL 檔步驟）：前置確認、黃金快照、廠商與畫面操作、驗收、授權、收尾。 */
function buildGaExtras(planDir) {
  const empty = () => ({ backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] });
  const base = { readmeNo: null, optional: false, backupText: '', stops: [], cautions: [], rollbackText: '', previewJudge: '', commitText: '' };
  const manual = (o) => Object.assign({}, base, { kind: 'manual', kindLabel: '手動操作', blocks: empty() }, o);
  const golden = (o) => Object.assign({}, base, { kind: 'readonly', kindLabel: '唯讀', blocks: Object.assign(empty(), { main: goldenBlocks() }) }, o);
  const x = {};
  x.gate = manual({
    id: 'x-ga-gate', title: '前置確認：主流程已完成，才做水電與採購請款',
    what: '水電話費請款（G46）與採購請款改善（B1）要在 m9 主流程之後做，且和新版部署一起上線（老闆 2026-11-25 決定，不再等 12/15）。',
    manualText: '1. 確認老闆已同意今天做。\n2. 確認 m9 主流程（92 步總表）中，總務相關的第 44、45、48 步，第 50 至 61 步，第 68 至 75 步都已完成並驗收通過（那一頁的勾選與檢查都是通過）。\n3. 確認正式區 has_permission 的行為和預期一樣（不檢查 roles.is_active、資料庫端不放行 admin）；有疑慮先問 Claude。\n4. 確認開的是「正式區」專案，不是 DEV。\n5. 本頁每一份 SQL 都由人貼到正式區 SQL Editor；任何一步有疑慮就停下問 Claude。',
    stops: [{ where: 'main', title: 'm9 主流程有任何一步沒完成，這一頁整份先不要做', body: '尤其是總務第 4.5 批請款單與第 6 批廠商、水電帳單（第 44、45、48、50 至 61、68 至 75 步）。缺任何一步，G46 預覽的 A 區就會出現 MISSING。' }],
    expect: '以上四點都確認了才開始下一步。', minutes: 5,
  });
  x.goldenBefore = golden({
    id: 'x-ga-golden-before', title: '黃金快照（G46 做之前）：存檔留底',
    what: '在套用任何 SQL 之前，先把採購請款的現況存起來；之後每一個階段做完都拿它來比對，數字必須完全相同。',
    expect: '三段查詢都跑得出結果。每段結果整份複製存到記事本（標明「G46 之前」）。這是之後比對的標準答案。', minutes: 6,
    stops: [{ where: 'main', title: '查詢出現紅色錯誤就停下', body: '這三段只有 SELECT，不該出錯。出錯代表正式區的請款表和預期不同，截圖給 Claude。' }],
  });
  x.goldenAfterG46 = golden({
    id: 'x-ga-golden-g46', title: '黃金快照（G46 做完後）：必須和之前相同',
    what: 'G46 對採購請款只做「來源是水電才分流」的最小加掛，所以採購請款的所有數字應該完全不變。',
    expect: '三段結果和「G46 做之前」逐列比對：各狀態張數與總額、各採購單累計請款、清單指紋，必須完全相同。這份結果也是 B1 的比對起點，請存檔。', minutes: 6,
    stops: [{ where: 'main', title: '任何數字和之前不同就停下', body: '不要做 B1，截圖給 Claude 判斷要不要依相反順序撤回 G46。' }],
  });
  x.vendors = manual({
    id: 'x-ga-vendors', title: '總務建立水電廠商（畫面操作）',
    what: '正式區目前沒有水電廠商。請總務在「廠商資料」新增台電、台水、電信公司等繳費單位，並勾「公用事業」分類（統編必填）。',
    manualText: '1. 請總務登入新版，打開廠商資料。\n2. 依實際繳費對象逐一新增（台電、台水、中華電信等），統編必填，分類勾「公用事業」。\n3. 這一步沒有 SQL 可貼；也不要用 SQL 補。',
    expect: '廠商清單看得到這些廠商，且分類是「公用事業」。', minutes: 15,
  });
  x.payees = manual({
    id: 'x-ga-payees', title: '補填既有帳單的繳費單位（畫面操作，不跑 05）',
    what: '既有水電帳單要補填「繳費單位」之後才能請款。老闆已決定不跑選用的 05 補填腳本，改用畫面逐筆補填。',
    manualText: '1. 請總務在水電帳單畫面使用「補填繳費單位」。\n2. 補填前，帳單不能請款；這是預期行為。\n3. 不要跑 05-backfill-payee 的任何檔案。',
    cautions: ['金額有小數或為 0 元的帳單不能請款，要先到水電帳單修正（預覽的 B 區有清單）。'],
    expect: '要請款的帳單都已填上繳費單位。', minutes: 15,
  });
  x.acceptance = manual({
    id: 'x-ga-acceptance', title: '水電請款驗收：用一張標記清楚的測試帳單走完',
    what: '用一張明確標示為測試的小額帳單，走完整個流程，確認帳單狀態會跟著回復。',
    manualText: '1. 建立一張標記清楚的測試帳單（備註寫「測試，驗收後清除」）與對應的水電請款單。\n2. 缺附件時送出，必須被擋下。\n3. 補附件後送出，帳單應自動標已繳。\n4. 退回：帳單回復待繳。\n5. 再送出、然後作廢：帳單回復待繳。\n6. 清除測試資料（用畫面作廢；不要把測試資料留在正式區）。',
    stops: [{ where: 'main', title: '任何一步和預期不符就停下', body: '例如缺附件沒被擋、退回後帳單沒回復。截圖給 Claude，不要自己補資料。' }],
    expect: '五個動作的結果都和預期相同，測試資料已作廢或清除。', minutes: 25,
  });
  x.grants = manual({
    id: 'x-ga-grants', title: '角色授權：由老闆決定（本頁不貼 SQL）',
    what: 'G46 與 B1 的 SQL 都不新增權限碼、也不授權給任何角色。誰能用由老闆決定，不是本頁的 SQL。',
    manualText: '1. 打開權限勾選頁（或請 Claude 協助），依老闆決定勾選。\n2. 建議對象：總務（水電網費管理、請款管理、廠商檢視）、會計（請款管理、水電帳單檢視、廠商檢視）；店長不給。\n3. 授權完成後，用總務與會計帳號各登入一次確認能看到入口。',
    expect: '被授權的角色能看到入口，沒授權的角色看不到。', minutes: 10,
  });
  x.b1Recheck = Object.assign({}, base, {
    id: 'x-ga-b1-recheck', kind: 'readonly', kindLabel: '唯讀', title: 'B1 套用後：重跑預覽並對照雜湊',
    what: '把 B1 的「套用前預覽」再跑一次，和套用前存下的輸出對照：被加掛的函式雜湊應該改變，has_permission 的雜湊不應該改變。',
    blocks: Object.assign(empty(), { main: [fileBlock(planDir, 'ga-improve-b1-sql/00-preview-before-apply.sql', '重跑：00-preview-before-apply.sql（唯讀）')] }),
    expect: '「函式定義雜湊」中被加掛的函式和套用前不同；「權限語意：has_permission 定義雜湊」和套用前完全相同。',
    stops: [{ where: 'main', title: 'has_permission 雜湊改變就停下', body: 'B1 不該動到 has_permission。雜湊不同代表有別的變更，截圖給 Claude。' }],
    minutes: 6,
  });
  x.b1Golden = golden({
    id: 'x-ga-golden-b1', title: '黃金快照（B1 全部做完後）：零影響檢查',
    what: '用同一批既有採購與請款資料，再跑一次黃金快照，和「G46 做完後」逐列比對，數字必須完全相同。',
    expect: '三段結果和「G46 做完後」完全相同（B1 只多新增欄位與新函式，既有金額不該變）。', minutes: 6,
    stops: [{ where: 'main', title: '任何數字不同就停下', body: '04 改了累計請款與待請款計算；不同代表要依撤回順序（05、04、03、02、01）處理，先問 Claude。' }],
  });
  x.buyer = manual({
    id: 'x-ga-buyer', title: '買受人預設公司確認（畫面操作）',
    what: '如果舊的 pay_buyer_title 與 pay_buyer_tax_id 只有其中一個有值，或統編不是 8 碼，B1 不會自動搬成預設公司。',
    manualText: '1. 打開請款設定的買受人公司清單，看有沒有預設公司。\n2. 沒有的話，請總務手動新增公司（抬頭、8 碼統編）並設為預設。\n3. 不要用 SQL 補。',
    expect: '買受人公司清單有一間預設公司，抬頭與統編正確。', minutes: 8,
  });
  x.closing = manual({
    id: 'x-ga-closing', title: '收尾：回舊版備註與不可送上正式區的清單',
    what: '兩個提醒，讓上線後的備援與日後的操作不出錯。',
    manualText: '1. 這兩批新頁面的「回舊版」單頁備援，需要在 workspace_page_fallbacks 有對應的列；本頁的 SQL 不會建立那些列，由管理員在「頁面回舊版設定」管理頁處理。\n2. 絕對不要送到正式區的東西：DEV 專用的測試資料檔（檔名含 dev_seed）、DEV 專用的測試角色（vue_workspace_gaup_ 開頭）、DEV 專用的清除腳本，以及任何帶 QA-GAUP- 或 QA-GAIB1- 標記的資料。\n3. 備份表（zz_bak_gaup_*、zz_bak_gaib1_*）確認上線穩定後再自行 DROP。',
    expect: '管理員知道回舊版要在管理頁設定；團隊知道哪些東西不能送上正式區。', minutes: 5,
  });
  return x;
}

/* ------------------------------------------------------------------ 組裝 */
function kindOf(nature) {
  if (nature === '唯讀') return { kind: 'readonly', label: '唯讀' };
  if (nature === '新增') return { kind: 'add', label: '新增' };
  if (nature === '新增＋改既有') return { kind: 'addmodify', label: '新增＋會改既有資料' };
  if (nature === '改既有資料') return { kind: 'modify', label: '會改既有資料' };
  throw new Error('未知的「性質」：' + nature);
}
function estimateMinutes(step) {
  if (step.kind === 'manual') return step.minutes || 5;
  const b = step.blocks;
  const nMain = b.main.length;
  if (step.kind === 'readonly') return Math.max(2, Math.round(1 + 1.5 * nMain));
  return Math.round(2 + 2 * nMain + b.backup.length + b.preview.length + (b.verify.length ? 2 : 0) + (b.commit.length ? 2 : 0));
}

function buildModel(opts) {
  opts = opts || {};
  const planDir = opts.planDir || PLAN_DIR;
  const ga = opts.profile === 'ga';
  const readmePath = opts.readmePath || (ga ? path.join(planDir, GA_README) : path.join(planDir, 'm9-sql', 'README.md'));
  const readme = parseReadme(readUtf8(readmePath));
  // 主流程（m9）與上線後（GA）兩份操作頁共用同一套組裝程式，只換下面這幾張對照表
  const P = ga
    ? { excluded: {}, optional: GA_OPTIONAL, titles: GA_TITLES, expect: GA_EXPECT, stops: GA_STOPS, cautions: GA_CAUTIONS, previewJudge: GA_PREVIEW_JUDGE }
    : { excluded: EXCLUDED_README_STEPS, optional: OPTIONAL_README_STEPS, titles: TITLES, expect: EXPECT, stops: STOPS, cautions: CAUTIONS, previewJudge: PREVIEW_JUDGE };
  const readmeStages = readme.stages;

  const readmeSteps = {};
  const warnings = [];
  for (const rs of readme.steps) {
    if (P.excluded[rs.no]) {
      // 被排除的步驟仍要確認總表列的檔案就是我們預期要排除的那一個
      const toks = [...rs.fileCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (!toks.includes(P.excluded[rs.no])) {
        throw new Error('README 第 ' + rs.no + ' 步預期是 ' + P.excluded[rs.no] + '，實際是 ' + toks.join(','));
      }
      continue;
    }
    if (!P.titles[rs.no]) throw new Error('第 ' + rs.no + ' 步沒有白話標題');
    const { kind, label } = kindOf(rs.nature);
    const mainFiles = resolveMainFiles(planDir, rs);
    const blocks = { backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] };

    mainFiles.forEach((f) => {
      blocks.main.push(fileBlock(planDir, f, path.posix.basename(f)));
    });

    const first = mainFiles[0];
    const sib = siblingPaths(first);
    const inM9 = first.startsWith('m9-sql/') || ga; // GA：總表列的每個檔，旁邊有 .verify／.rollback 就一併附上
    // 備份
    if (EXISTS(planDir, sib.backup) && inM9) blocks.backup.push(fileBlock(planDir, sib.backup, '備份：' + path.posix.basename(sib.backup)));
    // 預覽（m9 的 .preview.sql）
    if (EXISTS(planDir, sib.preview) && inM9) blocks.preview.push(fileBlock(planDir, sib.preview, '預覽：' + path.posix.basename(sib.preview)));
    // 驗證
    if (EXISTS(planDir, sib.verify) && inM9) blocks.verify.push(fileBlock(planDir, sib.verify, '檢查：' + path.posix.basename(sib.verify)));
    // 撤回
    let rb = null;
    if (EXISTS(planDir, sib.rollbackA)) rb = sib.rollbackA; else if (EXISTS(planDir, sib.rollbackB)) rb = sib.rollbackB;
    if (!ga && rs.no === 88) rb = 'm5-sql/w19_q2_C_rollback.sql';
    if (rb && (ga || rs.no !== 9)) blocks.rollback.push(fileBlock(planDir, rb, '撤回：' + path.posix.basename(rb)));

    // README 說有哪些檔，就必須找得到
    if (inM9) {
      if (/\.preview\.sql/.test(rs.verify) && !blocks.preview.length) throw new Error('README 第 ' + rs.no + ' 步列有 .preview.sql 但找不到檔案');
      if (/\.verify\.sql/.test(rs.verify) && !blocks.verify.length) throw new Error('README 第 ' + rs.no + ' 步列有 .verify.sql 但找不到檔案');
      if (/\.backup\.sql/.test(rs.backup) && !/65\.backup/.test(rs.backup) && !blocks.backup.length) throw new Error('README 第 ' + rs.no + ' 步列有 .backup.sql 但找不到檔案');
    }
    if (/rollback\.sql/.test(rs.rollback) && !blocks.rollback.length) throw new Error('README 第 ' + rs.no + ' 步列有 rollback 檔但找不到：' + rs.rollback);

    // 特例
    if (ga) blocks.backup.push(...gaBackupBlocks(rs.no, planDir));
    if (!ga && rs.no === 22) blocks.backup.push(fileBlock(planDir, 'm9-sql/65_transfer_confirm_correct_batch.backup.sql', '備份：65_transfer_confirm_correct_batch.backup.sql（與{{33}}共用）'));
    if (!ga && rs.no === 68) blocks.backup.push({ label: '備份：ga_vendors（本產生器內建）', file: '', sql: BACKUP_GA_VENDORS_SQL });
    if (!ga && rs.no === 77) blocks.backup.push({ label: '備份：進貨兩張表（照 m7m8-sql/README.md 第 4.5 批的備份指令）', file: 'm7m8-sql/README.md', sql: extractB45Backup(planDir) });

    if (!ga && rs.no === 41) blocks.backup.push({ label: '備份：先記下既有桶現況（唯讀，複製結果存記事本；沒有列代表桶還不存在）', file: '', sql: BUCKET_STATE_SQL });
    if (!ga && rs.no === 30) {
      const m = blocks.main[0].sql.match(/--\s+(CREATE TABLE IF NOT EXISTS public\.bak_inspection_masters_20261124 AS SELECT \* FROM public\.inspection_masters;)/);
      if (!m) throw new Error('50_inspection_write_core.sql 檔頭找不到選用備份指令');
      blocks.backup.push({ label: '選用備份：inspection_masters（取自檔頭註解）', file: '', sql: m[1] + '\n' });
    }
    // BEGIN 開頭又沒有 COMMIT 的檔，要另外 COMMIT
    const needC = blocks.main.some((b) => needsCommit(b.sql));
    if (needC) { blocks.commit.push({ label: '確認寫入：另外貼這行單獨執行', file: '', sql: COMMIT_SQL }, { label: '放棄不寫入：改貼這行', file: '', sql: ROLLBACK_SQL }); }

    // 備份說明
    let backupText = '';
    if (!/^否/.test(rs.backup)) {
      const auto = blocks.main.some((b) => selfBackup(b.sql));
      backupText = 'README 標示：' + rs.backup + '。' + (blocks.backup.length ? '請先貼下面的備份 SQL，確認筆數對得上，再做主要 SQL。' : (auto ? '這份檔案內容裡有自動備份的語句，執行時會自己先備份；退路另外還有整庫備份。' : '這份沒有獨立的備份檔，檔案裡也沒偵測到自動備份語句。請把上一個「套用前預覽」步驟輸出的現況（函式、政策、筆數）複製存到記事本，並以一開始做的整庫備份當退路；不確定怎麼存，這步先問 Claude 再做。'));
    }

    // GA 第 8 步（B1 02）要在檢查區附上黃金比對
    if (ga && rs.no === 8) blocks.verify.push(...goldenBlocks());
    const stops = (P.stops[rs.no] || []).slice();
    if (blocks.verify.length) stops.push(VERIFY_STOP);
    const cautions = (P.cautions[rs.no] || []).slice();
    if (blocks.main.some((b) => /md5/i.test(b.sql) && /守衛/.test(b.sql))) cautions.push('這份檔頭有 md5 守衛：如果函式內容和預期不符，檔案會自己中止並顯示訊息。看到中止訊息就停下，不要硬跑。');
    if (needC) cautions.push('這份檔案以 BEGIN; 開頭、沒有自己的 COMMIT;：貼上執行並看過回傳的核對結果後，要另外貼 COMMIT;（確認）或 ROLLBACK;（放棄）。若貼 COMMIT; 時出現「沒有進行中的交易」之類訊息，代表資料沒寫入，請停下問 Claude。');

    let expect = P.expect[rs.no];
    if (!expect) {
      if (kind === 'readonly') expect = READONLY_DEFAULT;
      else if (blocks.verify.length) expect = VERIFY_DEFAULT;
      else expect = NO_VERIFY_FILE;
    }

    const step = {
      id: 's' + String(rs.no).padStart(2, '0'),
      readmeNo: rs.no, readmeStage: rs.stageIdx,
      title: P.titles[rs.no], what: rs.what,
      kind, kindLabel: label, optional: P.optional.has(rs.no),
      backupText, readmeBackup: rs.backup, readmeRollback: rs.rollback,
      blocks, stops, cautions, expect, previewJudge: P.previewJudge[rs.no] || '',
      commitText: needC ? '這份檔案不會自己提交。看過上面的核對結果沒問題，就貼 COMMIT; 單獨執行；有疑慮就貼 ROLLBACK;。忘了的話連線結束會自動回滾，等於沒做。' : '',
      rollbackText: (blocks.rollback.length || /無檔|交易內/.test(rs.rollback) ? '總表說明：' + rs.rollback + (blocks.rollback.length ? '' : '（沒有撤回檔）') : '')
        + (blocks.rollback.some((b) => needsCommit(b.sql)) ? '　注意：這份撤回檔也是 BEGIN; 開頭、沒有自己的 COMMIT;，貼上看過結果後要另外貼 COMMIT; 才會真的還原。' : ''),
      natureReadme: rs.nature,
    };
    if (!ga && rs.no === 9) step.cautions.push('一次只貼一份，貼之前先清空編輯器。15 份可以不分先後。');
    step.minutes = !ga && rs.no === 9 ? 20 : estimateMinutes(step);
    readmeSteps[rs.no] = step;
  }

  if (ga) return finishModel(buildGaStages(planDir, readme, readmeSteps), readme, warnings, true);

  /* ---- 額外步驟（非 README 列表） ---- */
  const extra = {};
  extra.r4 = {
    id: 'x-r4', readmeNo: null, title: 'R4 判斷：舊草稿 w17_B／w18_B 跑過沒有', kind: 'readonly', kindLabel: '唯讀', optional: false,
    what: '用唯讀查詢自動判斷正式區有沒有跑過舊草稿 w17_B（改善回補）或 w18_B（評級快照）。m9 的 55、90 已取代它們，兩者擇一。結果決定後面 55、90 能不能照常做。',
    backupText: '', blocks: { backup: [], preview: [], main: [{ label: 'R4 判斷查詢（本產生器內建，唯讀）', file: '', sql: R4_CHECK_SQL }], commit: [], verify: [], rollback: [] },
    stops: [{ where: 'main', title: 'R4：結論欄是 STOP 就停下來聯絡 Claude', body: '結論欄（conclusion）若以 STOP 開頭，代表舊草稿 w17_B 或 w18_B 疑似在正式區跑過，或 55／90 的備份表已存在。不要繼續做 55、90（階段 1 的{{28}}、{{29}}）及後面的步驟，截圖給 Claude。' }],
    cautions: [],
    expect: '結果只有 1 列。結論欄寫「OK：兩份舊草稿都沒跑過，可以繼續」才算通過（欄位 w17_B_looks_applied、w18_B_looks_applied 都是 false）。\n結果 A（OK）：沒跑過，勾「已完成」「檢查通過」，照順序繼續。\n結果 B（STOP）：跑過，停下，截圖給 Claude。原因：55、90 會把「已被舊草稿改過的函式」當成原始版備份，之後撤回只能回到舊草稿版而不是最原始版；Claude 會先判斷 55／90 的備份基準是否需要調整（舊草稿自己的備份表 m4_w17_backup、m4_w18_backup 裡有最原始版本），再告訴你繼續還是調整。',
    minutes: 3, rollbackText: '', previewJudge: '', commitText: '',
  };
  extra.cronEnable = {
    id: 'x-cron-enable', readmeNo: null, title: '啟用 pg_cron 擴充', kind: 'manual', kindLabel: '手動操作（後台）', optional: false,
    what: '在 Supabase 後台啟用 pg_cron，讓「生效日到了的升遷」每天自動生效（老闆決定 R2：要開）。放在{{34}}之後，是為了避免草稿 30 一偵測到 pg_cron 就自己建「每分鐘」排程。',
    backupText: '', blocks: { backup: [], preview: [], main: [], commit: [], verify: [{ label: '檢查：pg_cron 已啟用（唯讀）', file: '', sql: CRON_ENABLE_CHECK_SQL }], rollback: [] },
    stops: [], cautions: [],
    manualText: '1. 打開 Supabase 後台，確認左上角是「正式區」專案。\n2. 左側選 Database，再選 Extensions。\n3. 搜尋 pg_cron，把開關打開（schema 用預設即可）。\n4. 開好後，貼下面的檢查 SQL 執行。',
    expect: '檢查 SQL 回傳 1 列（extname 是 pg_cron）。沒有任何列＝還沒啟用成功，停下來重做第 3 點或問 Claude。',
    minutes: 4, rollbackText: '要停用：到 Database → Extensions 把 pg_cron 關掉（先問 Claude，這會連所有排程一起停）。', previewJudge: '', commitText: '',
  };
  extra.cronSchedule = {
    id: 'x-cron-schedule', readmeNo: null, title: '建立每日升遷生效排程（台北 00:05）', kind: 'add', kindLabel: '新增', optional: false,
    what: '建立排程：每天台北時間 00:05 執行 workspace_apply_due_promotions()。pg_cron 用 UTC，台北 00:05 就是 UTC 16:05（前一天），所以寫成 5 16 * * *。',
    backupText: '', blocks: { backup: [], preview: [], main: [{ label: '建立排程（本產生器內建）', file: '', sql: CRON_SCHEDULE_SQL }], commit: [], verify: [{ label: '檢查：排程是否存在', file: '', sql: CRON_CHECK_SQL }, { label: '隔天早上再看：最近執行結果', file: '', sql: CRON_RUNS_SQL }], rollback: [{ label: '撤回：取消排程', file: '', sql: CRON_UNSCHEDULE_SQL }] },
    stops: [VERIFY_STOP], cautions: ['前置：上一步（pg_cron 已啟用）與{{34}}（異動批次與每月人員名冊，才有最終版的 workspace_apply_due_promotions）都要完成。'],
    expect: '檢查 SQL 剛好 1 列：schedule 是「5 16 * * *」，active 是 true。12/8 早上再跑「最近執行結果」，status 應為 succeeded（00:05 之後才會有紀錄）。',
    minutes: 4, rollbackText: '', previewJudge: '', commitText: '',
  };
  const AUTH_BASE = path.join(PLAN_DIR, 'm9-sql', '95_role_permission_grants');
  extra.auth = {
    id: 'x-auth', readmeNo: null, title: '新權限授權（依權限勾選頁的決定）', kind: 'addmodify', kindLabel: '新增＋會改既有資料', optional: false,
    what: '依老闆在權限勾選頁送出的決定（2026-11-24，另在對話確認：總務服務中心先只給管理員、督導加回「看自己的管理日誌」），一次授權 33 組「角色＋權限」。只開不關：已有的不動，原本被關閉的打開。授權前的狀態記到 m9_role_grant_log，撤回只撤這一步加的。',
    backupText: '', blocks: { backup: [], preview: [],
      main: [{ label: '授權 33 組（可重複執行）', file: 'm9-sql/95_role_permission_grants.sql', sql: readUtf8(AUTH_BASE + '.sql') }],
      commit: [],
      verify: [{ label: '檢查：33 列都要 ok = true', file: 'm9-sql/95_role_permission_grants.verify.sql', sql: readUtf8(AUTH_BASE + '.verify.sql') }],
      rollback: [{ label: '撤回：只撤本步驟新增或打開的授權', file: 'm9-sql/95_role_permission_grants.rollback.sql', sql: readUtf8(AUTH_BASE + '.rollback.sql') }] },
    stops: [VERIFY_STOP],
    cautions: ['前置：補建權限碼那一步（{{18}}）、總務第 4 批與第 4.5 批的權限碼步驟都要先完成，否則有些配對會顯示「找不到」。', '總務服務中心這次刻意只給管理員：總務同仁與店長 12/8 起進不了總務服務中心，之後要開放再另外做一份授權。'],
    expect: '授權 SQL 最後一個查詢逐列列出結果，沒有「找不到」。檢查 SQL 33 列 ok 全部 true。',
    minutes: 10, rollbackText: '', previewJudge: '', commitText: '',
  };
  extra.cutover = {
    id: 'x-cutover', readmeNo: null, title: '切換開新版', kind: 'manual', kindLabel: '手動操作', optional: false,
    what: '資料庫與權限都就緒後，開啟新版：全部門市同一天切換，選單預設開新版，每頁都有「回舊版」連結。',
    backupText: '', blocks: { backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] },
    stops: [{ where: 'main', title: '前面有任何一步沒勾「檢查通過」，或授權步驟還是占位，就先不要切換', body: '先回頭看哪一步沒完成；不確定就問 Claude。切換前先確認：R1 預覽已處理、R4 判斷是 OK、授權步驟已補完並做完。' }],
    cautions: [],
    manualText: '1. 回到上方，確認「必做」的步驟都已勾選完成與檢查通過。\n2. 依 Claude 在上線當天給你的切換指示，開啟新版（不是在 SQL Editor 做的事）。\n3. 用系統管理員帳號登入，點一下選單的任一個新版頁面，能正常打開、資料顯示正常。\n4. 再各用一個店長、督導、總務帳號登入，各點開一頁確認沒有出現「沒有權限」。',
    expect: '各角色帳號都能打開新版頁面，沒有紅色錯誤或空白頁。任何一個角色打不開，立刻回報 Claude，並先用下一步的「回舊版」連結救急。',
    minutes: 15, rollbackText: '', previewJudge: '', commitText: '',
  };
  extra.fallback = {
    id: 'x-fallback', readmeNo: null, title: '回舊版開關確認', kind: 'manual', kindLabel: '手動操作', optional: false,
    what: '確認「回舊版」的備援開關可用：{{19}}建好的兩張表在，系統管理員的「頁面回舊版設定」管理頁打得開。出問題時，管理員能單頁切回舊版，不需要重新部署。',
    backupText: '', blocks: { backup: [], preview: [], main: [], commit: [], verify: [], rollback: [] },
    stops: [], cautions: [],
    manualText: '1. 先貼下面的檢查 SQL（和{{19}}用的是同一份，唯讀），確認備援開關的表與函式都在。\n2. 用系統管理員帳號登入新版，打開「頁面回舊版設定」管理頁。\n3. 管理頁能打開、看得到頁面清單（不用真的切換任何一頁）。若想試一下：切一頁到舊版，確認選單改開舊版，馬上切回新版，並確認稽核紀錄有記到。\n4. 管理頁若出現「儲存失敗（503）」，代表{{19}}的表沒建好，停下問 Claude。',
    expect: '檢查 SQL 每一列 ok 都是 true；管理頁打得開、看得到清單。',
    minutes: 10, rollbackText: '', previewJudge: '', commitText: '',
  };
  // 備援開關的檢查 SQL 直接讀{{19}}用的 verify 檔（逐字）
  extra.fallback.blocks.verify.push(fileBlock(planDir, 'm9-sql/20261123150000_m9_page_fallbacks.verify.sql', '檢查：20261123150000_m9_page_fallbacks.verify.sql'));
  extra.fallback.stops.push(VERIFY_STOP);

  /* ---- 排序與分階段 ---- */
  const stages = [];
  const addStage = (id, title, short, intro, items) => { stages.push({ id, title, short, intro, items }); };
  const rs = (a, b) => { const r = []; for (let i = a; i <= b; i++) if (readmeSteps[i]) r.push(readmeSteps[i]); return r; };
  const stageTitle = (i) => readmeStages[i].title.replace('　', '　');
  addStage('0', stageTitle(0), '0 上線前唯讀檢查', '只有 SELECT，不改任何資料，可全部先跑；最後一步是 R4 判斷。', [...rs(1, 17), extra.r4]);
  addStage('1', stageTitle(1), '1 M9 資料庫草稿', '照序號一步一步做，不能換順序（資料庫相依）。{{34}}之後接著設定每日升遷排程。', [...rs(18, 34), extra.cronEnable, extra.cronSchedule]);
  addStage('2', stageTitle(2), '2 客務、商品、語音、處方箋', '', rs(35, 42));
  addStage('3', stageTitle(3), '3 總務（第 1 到 6 批與第 4.5 批）', '每批先跑預覽再套用；撤回順序相反。', rs(43, 87));
  addStage('4', '階段 4　選用步驟（預設不做）', '4 選用', '原本總表階段 4 的授權類與舊草稿步驟已依老闆決定處理：補授權兩份不執行（改由權限勾選頁）、w17_B／w18_B 不執行（已由 55、90 取代）。只剩一個選用步驟。', rs(88, 88));
  addStage('5', '階段 5　新權限授權', '5 授權', '新版開啟前，依權限勾選頁（2026-11-24 已送出）授權 33 組角色權限。', [extra.auth]);
  addStage('6', '階段 6　切換開新版與回舊版確認', '6 切換開新版', '最後一階段。', [extra.cutover, extra.fallback]);

  return finishModel(stages, readme, warnings, false);
}

const GA_META = {
  title: '水電與採購請款上線操作',
  heading: '水電話費請款與採購請款改善：正式區逐步操作',
  intro: '這是第二份正式區操作頁（不併入 92 步的主流程）。老闆 2026-11-25 決定：水電話費請款（G46）與採購請款改善第一批（B1）和這次新版部署一起上線，不再等 12/15。照著從上做到下，每一步貼上執行、看結果、勾選。進度會自動記住。',
  scheduleLabel: '預定執行', scheduleValue: '與新版部署同一次', scheduleNote: '主流程完成並驗收後再做',
  docKey: 'ga-post-cutover',
  runDate: '', goLiveDate: '',
};

/** GA 分階段：G46 先做完並通過黃金比對，再做 B1。 */
function buildGaStages(planDir, readme, readmeSteps) {
  const x = buildGaExtras(planDir);
  const rs = (a, b) => { const r = []; for (let i = a; i <= b; i++) { if (!readmeSteps[i]) throw new Error('GA 總表缺第 ' + i + ' 步'); r.push(readmeSteps[i]); } return r; };
  const t = (i) => (readme.stages[i] ? readme.stages[i].title : '階段 ' + (i + 1));
  return [
    { id: 'g0', title: '階段 0　前置確認', short: '0 前置確認', intro: '主流程（92 步）完成並驗收，才做這一頁。', items: [x.gate] },
    { id: 'g1', title: t(0), short: '1 水電話費請款（G46）', intro: '先預覽、備份，再依序套用 4 份並各自檢查；做完要通過黃金快照比對。撤回順序：04、03、02、01。', items: [readmeSteps[1], x.goldenBefore, ...rs(2, 5), x.goldenAfterG46, x.vendors, x.payees, x.acceptance, x.grants] },
    { id: 'g2', title: t(1), short: '2 採購請款改善（B1）', intro: '在 G46 穩定之後才做。撤回順序：05、04、03、02、01；撤回前若已有測試資料，撤回會中止。', items: [readmeSteps[6], ...rs(7, 11), x.b1Recheck, x.b1Golden, x.buyer] },
    { id: 'g3', title: '階段 3　收尾', short: '3 收尾', intro: '', items: [x.closing] },
  ];
}

/** 排序、編號、解析文字引用、組出 model（m9 與 GA 共用）。 */
function finishModel(stages, readme, warnings, ga) {
  const order = [];
  let no = 0;
  const outStages = stages.map((st) => {
    const ids = [];
    st.items.forEach((s) => { no += 1; s.no = no; order.push(s); ids.push(s.id); });
    return { id: st.id, title: st.title, short: st.short, intro: st.intro, stepIds: ids };
  });

  // 文字裡的{{N}} 是「總表第 N 步」，換成頁面上實際顯示的序號（階段 0 多了 R4 判斷等，序號會和總表差幾號）
  const noByReadme = {};
  order.forEach((s) => { if (s.readmeNo) noByReadme[s.readmeNo] = s.no; });
  const resolveRefs = (v) => {
    if (typeof v === 'string') {
      return v.replace(/\{\{(\d+)\}\}/g, (all, n) => {
        if (!noByReadme[n]) throw new Error('文字引用了不存在的總表步驟：' + n);
        return '第 ' + noByReadme[n] + ' 步';
      });
    }
    if (Array.isArray(v)) return v.map(resolveRefs);
    if (v && typeof v === 'object') { Object.keys(v).forEach((k) => { if (k !== 'sql') v[k] = resolveRefs(v[k]); }); return v; }
    return v;
  };
  order.forEach((s) => resolveRefs(s));

  const stopList = [];
  order.forEach((s) => (s.stops || []).forEach((x) => {
    if (x === VERIFY_STOP) return; // 通用的「檢查不通過就停下」不逐步列出，頁首另有一句統一說明
    stopList.push({ stepId: s.id, no: s.no, stepTitle: s.title, where: x.where, title: x.title });
  }));
  const totalMin = order.reduce((a, s) => a + (s.optional ? 0 : s.minutes), 0);

  const model = {
    meta: {
      title: '正式區上線操作',
      runDate: '2026-12-07', goLiveDate: '2026-12-08',
      ...(ga ? GA_META : {}),
      readmeStepCount: readme.steps.length,
      excludedReadmeSteps: ga ? [] : Object.keys(EXCLUDED_README_STEPS).map(Number),
      stepCount: order.length, requiredStepCount: order.filter((s) => !s.optional).length,
      readmeStepsIncluded: order.filter((s) => s.readmeNo).length,
      extraStepIds: order.filter((s) => !s.readmeNo).map((s) => s.id),
      estMinutes: totalMin,
    },
    stages: outStages,
    steps: order,
    stopList,
    warnings,
  };
  return model;
}

/* ------------------------------------------------------------------ HTML */
function jsonForHtml(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderHtml(model) {
  const css = readUtf8(path.join(__dirname, 'style.css'));
  const m = model.meta;
  let js = readUtf8(path.join(__dirname, 'client.js'));
  // 第二份操作頁（GA）用自己的進度檔，不能和主流程共用同一個進度
  if (m.docKey) {
    const a = "'runbook/progress-2026-12-07'", b = "'m9-runbook-progress-2026-12-07'";
    if (!js.includes(a) || !js.includes(b)) throw new Error('client.js 找不到進度檔名稱，無法換成 ' + m.docKey);
    js = js.replace(a, () => "'runbook/progress-" + m.docKey + "'").replace(b, () => "'m9-runbook-progress-" + m.docKey + "'");
  }
  const hours = Math.floor(m.estMinutes / 60), mins = m.estMinutes % 60;
  const est = (hours ? hours + ' 小時 ' : '') + mins + ' 分';
  const withBuffer = Math.ceil((m.estMinutes * 1.3) / 30) * 30;
  const bufH = Math.floor(withBuffer / 60), bufM = withBuffer % 60;
  const buf = (bufH ? bufH + ' 小時' : '') + (bufM ? ' ' + bufM + ' 分' : '');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<style>
${css}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="eyebrow">富康菁英業務網　新版上線</div>
  <h1>${esc(m.heading || '正式區資料庫逐步操作')}</h1>
  <p>${esc(m.intro || '老闆在 2026-12-07（日）營業結束後，照著這一頁從上做到下。每一步貼上執行、看結果、勾選。進度會自動記住。')}</p>
  <div class="meta-row">
    <div class="meta"><span class="k">${esc(m.scheduleLabel || '預定執行')}</span><span class="v">${esc(m.scheduleValue || '2026-12-07（日）晚上')}</span><span class="k">${esc(m.scheduleNote || '上線日 2026-12-08（一）')}</span></div>
    <div class="meta"><span class="k">現在時間</span><span class="v" id="clock">--</span></div>
    <div class="meta"><span class="k">總步驟數</span><span class="v">${m.stepCount} 步</span><span class="k">必做 ${m.requiredStepCount} 步，選用 ${m.stepCount - m.requiredStepCount} 步</span></div>
    <div class="meta"><span class="k">預估時間</span><span class="v">約 ${esc(est)}</span><span class="k">連同檢查與意外建議預留 ${esc(buf)}</span></div>
  </div>
  <div class="panels">
    <section class="panel">
      <h3>開始前先做（都做完再開始第 1 步）</h3>
      <ol>
        <li>在 Supabase 後台做「整庫備份」：Database → Backups，確認有可用的 Point-in-Time 還原點，或當日備份可還原；沒有的話，先下載最新的備份檔存到自己的電腦。備份完成時間記在第 1 步的備註欄。</li>
        <li>確認現在開的是「正式區」專案，不是 DEV：看左上角的專案名稱。不確定就先問 Claude，不要貼任何 SQL。</li>
        <li>SQL Editor 每次只貼一份：貼之前先把編輯器清空，按 Run，看完結果再貼下一份。不要把兩份連在一起貼。</li>
        <li>檔案是 BEGIN 開頭的（卡片會標示），不會自己提交：看過回傳的結果沒問題後，要另外貼 COMMIT; 單獨執行；有疑慮就貼 ROLLBACK;。</li>
        <li>照卡片順序做，不要跳步、不要換順序；資料庫之間有相依。</li>
      </ol>
    </section>
    <section class="panel err">
      <h3>出錯怎麼辦</h3>
      <ol>
        <li>立刻停下，不要繼續下一步，也不要重貼一次試試看。</li>
        <li>把畫面截圖（含紅色錯誤訊息和你貼的那一步序號）給 Claude。</li>
        <li>需要撤回時，才展開該步的「撤回」SQL，先問過 Claude 再貼。撤回順序與套用順序相反。</li>
        <li>所有 SQL 都是可重複執行的，但「出錯後自己亂重跑」不在其中，請先問。</li>
      </ol>
    </section>
    <section class="panel stops">
      <h3>停止點（遇到就停下，聯絡 Claude）</h3>
      <ul id="stop-list"></ul>
      <p class="hint">另外：任何一步的「檢查」只要有一列不是 true，也要停下。</p>
    </section>
  </div>
  <p class="sync-detail" id="sync-detail" hidden></p>
</div></header>

<div class="bar" role="region" aria-label="進度">
  <div class="wrap">
    <div class="prog">
      <div class="prog-line" id="prog-text">進度計算中…</div>
      <div class="track" role="progressbar" aria-label="完成進度" aria-valuemin="0" aria-valuenow="0" aria-valuemax="${m.requiredStepCount}"><div class="fill" id="prog-bar"></div></div>
    </div>
    <button type="button" class="btn" id="next-btn">跳到下一個未完成的步驟</button>
    <button type="button" class="btn ghost" id="sync-retry" hidden>重試儲存到雲端</button>
    <p class="sync" id="sync" role="status">正在連線雲端儲存…</p>
  </div>
</div>

<main class="wrap"><div class="layout">
  <aside class="side" aria-label="階段列表">
    <h3>階段</h3>
    <nav id="stage-nav"></nav>
    <button type="button" class="btn ghost" id="expand-first" style="width:100%;margin-top:8px">打開下一步</button>
  </aside>
  <div id="steps"></div>
</div></main>
<div class="wrap"><footer class="end">本頁由 scripts/m9-runbook/build.cjs 讀取 docs/vue-workspace/parity-plan 內的 SQL 草稿產生，SQL 為逐字嵌入。頁面本身不連資料庫，所有 SQL 都由人在正式區 SQL Editor 貼上執行。</footer></div>

<script id="rb-data" type="application/json">${jsonForHtml(model)}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ CLI */
function main() {
  const args = process.argv.slice(2);
  const ga = args.includes('--ga');
  const pos = args.filter((a) => !a.startsWith('--'));
  const out = pos[0] || (ga ? DEFAULT_OUT.replace('m9-runbook.html', 'ga-runbook.html') : DEFAULT_OUT);
  const model = buildModel(ga ? { profile: 'ga' } : undefined);
  const html = renderHtml(model);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  console.log('輸出：' + out);
  console.log('步驟：' + model.meta.stepCount + '（總表 ' + model.meta.readmeStepCount + ' 步中排除 ' + model.meta.excludedReadmeSteps.join('、') + '，納入 ' + model.meta.readmeStepsIncluded + ' 步，另加 ' + model.meta.extraStepIds.length + ' 步）');
  console.log('預估分鐘：' + model.meta.estMinutes);
  console.log('大小：' + Math.round(Buffer.byteLength(html) / 1024) + ' KB');
}

module.exports = { buildModel, renderHtml, parseReadme, needsCommit, EXCLUDED_README_STEPS, PLAN_DIR };
if (require.main === module) {
  try { main(); } catch (e) { console.error('產生失敗：' + e.message); process.exit(1); }
}
