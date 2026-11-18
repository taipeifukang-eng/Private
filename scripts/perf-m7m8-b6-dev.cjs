// M7/M8 第 6 批大量資料速度實測（只連 DEV）。
// 用法：
//   node scripts/perf-m7m8-b6-dev.cjs --all [--label before]     建帳號、灌十萬級假資料、量測、EXPLAIN，最後清除並驗證筆數
//   node scripts/perf-m7m8-b6-dev.cjs --seed                    只建帳號與假資料（之後可重複 --measure）
//   node scripts/perf-m7m8-b6-dev.cjs --measure [--label x] [--explain]   各函式呼叫 5 次取中位數（資料庫內耗時＋經 PostgREST 的往返耗時）
//   node scripts/perf-m7m8-b6-dev.cjs --cleanup-only            只清除（依標記與測試帳號），並驗證筆數回到基準
// 標記：所有資料名稱／編號以 PERF-B6- 開頭，測試帳號 email 以 m7m8-test-perfb6- 開頭，臨時角色代碼 m7m8_test_perfb6_ 開頭。
// 資料落點：只掛 VW／ZT 測試門市；業務月份一律 2038 年。唯一例外：「待我處理」類欄位（帳單到期日、採購預計到貨日、調撥交出日、合約到期日）
//   少數列必須落在「今天以前／30 天內」才會被首頁與徽章計入，這些列用相對今天的日期（仍有 PERF-B6- 標記，清除時一併刪）。
// 環境守衛：只解析 .env.development.local（不讀 .env.local），並確認 supabase CLI 連結的專案是 DEV（ref 以 mjpd 開頭）。
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { assertDevEnvironment, applyDevEnv } = require("../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!ref.startsWith("mjpd")) throw Error("連線目標不是 DEV（ref 不是 mjpd 開頭），停止");
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref) throw Error("supabase CLI 連結的專案不是 DEV，停止");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : d; };
const LABEL = val("--label", "run");
const OUT = val("--out", null);
const SCALE = Number(val("--scale", "1")); // 1 = 十萬級

const EMAIL_PREFIX = "m7m8-test-perfb6-";
const ROLE_PREFIX = "m7m8_test_perfb6_";
const N = {
  vendors: Math.round(20000 * SCALE), wo: Math.round(100000 * SCALE), sr: Math.round(60000 * SCALE), po: Math.round(100000 * SCALE),
  reviews: Math.round(30000 * SCALE), bills: Math.round(100000 * SCALE), parts: Math.round(5000 * SCALE), locs: 20, transfers: Math.round(30000 * SCALE),
  equip: Math.round(20000 * SCALE), fac: Math.round(20000 * SCALE),
};

// ---------------------------------------------------------------- SQL 執行（supabase CLI → Management API）
function runSql(sql, { timeoutMs = 600000 } = {}) {
  const f = path.join(os.tmpdir(), `perf-b6-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(f, sql);
  try {
    const r = spawnSync("supabase", ["db", "query", "--linked", "-o", "json", "--file", f], { cwd: root, encoding: "utf8", shell: true, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
    if (r.status) throw new Error(`SQL 失敗：${(r.stderr || r.stdout || "").slice(0, 1500)}`);
    const out = r.stdout || "";
    const i = out.indexOf("{");
    try { return JSON.parse(out.slice(i)).rows || []; } catch { return []; }
  } finally { try { fs.unlinkSync(f); } catch {} }
}
const one = (sql) => runSql(sql)[0] || {};

// ---------------------------------------------------------------- 帳號
const { createClient } = require("@supabase/supabase-js");
const admin = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (res, what) => { if (res.error) throw new Error(`${what} 失敗：${res.error.message}`); return res.data; };
const crypto = require("crypto");

async function listAllUsers(db) {
  const users = [];
  for (let page = 1; page < 1000; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`讀取使用者清單失敗：${error.message}`);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function cleanupUsers() {
  const db = admin();
  const left = [];
  for (const u of (await listAllUsers(db)).filter((x) => (x.email || "").startsWith(EMAIL_PREFIX))) {
    await db.from("store_managers").delete().eq("user_id", u.id);
    await db.from("user_roles").delete().eq("user_id", u.id);
    const r = await db.auth.admin.deleteUser(u.id);
    if (r.error) left.push(`user ${u.email}: ${r.error.message}`);
  }
  const roles = must(await db.from("roles").select("id").like("code", `${ROLE_PREFIX}%`), "讀取臨時角色");
  for (const r of roles) {
    await db.from("user_roles").delete().eq("role_id", r.id);
    await db.from("role_permissions").delete().eq("role_id", r.id);
    const d = await db.from("roles").delete().eq("id", r.id);
    if (d.error) left.push(`role ${r.id}: ${d.error.message}`);
  }
  return left;
}

async function setupUsers() {
  const db = admin();
  const left = await cleanupUsers();
  if (left.length) throw new Error(left.join("; "));
  const stores = must(await db.from("stores").select("id,store_code").in("store_code", ["VW001"]), "門市");
  const vw = stores[0].id;
  const role = async (code) => must(await db.from("roles").select("id").eq("code", code).maybeSingle(), `角色 ${code}`);
  const mk = async (key, roleRows, storeMgr) => {
    const email = `${EMAIL_PREFIX}${key}@example.test`;
    const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
    const c = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `PERF B6 ${key}` } });
    if (c.error) throw new Error(`建立帳號 ${key} 失敗：${c.error.message}`);
    const id = c.data.user.id;
    must(await db.from("profiles").update({ role: "member", job_title: "測試", department: null }).eq("id", id), `profile ${key}`);
    for (const r of roleRows) must(await db.from("user_roles").insert({ user_id: id, role_id: r.id, is_active: true }), `user_roles ${key}`);
    if (storeMgr) must(await db.from("store_managers").insert({ user_id: id, store_id: vw, role_type: "store_manager", is_primary: true }), `store_managers ${key}`);
    const client = anon();
    must(await client.auth.signInWithPassword({ email, password }), `登入 ${key}`);
    return { key, id, client };
  };
  const gaAll = await role("vue_workspace_ga6_ga_all");
  if (!gaAll) throw new Error("DEV 沒有 vue_workspace_ga6_ga_all 角色（先套 20261118130000_m7m8_b6_dev_seed）");
  const storeRole = await role("store_manager");
  // 核准人臨時角色（讓「總務」帳號同時有採購核准，九項計數全開）
  const perm = must(await db.from("permissions").select("id").eq("code", "general_affairs.purchase_order.approve").maybeSingle(), "核准權限碼");
  const ap = must(await db.from("roles").insert({ code: `${ROLE_PREFIX}approver`, name: "PERF B6 臨時核准人", description: "第 6 批速度實測臨時角色", is_active: true, is_system: false }).select("id").single(), "建核准角色");
  must(await db.from("role_permissions").insert({ role_id: ap.id, permission_id: perm.id, is_allowed: true }), "核准角色權限");
  const ga = await mk("ga", [gaAll, ap], false);
  const store = await mk("store", [storeRole], true);
  return { ga, store };
}

// ---------------------------------------------------------------- 假資料
const STORES = "ARRAY(SELECT id FROM public.stores WHERE store_code IN ('VW001','VW002','ZT01','ZT02') ORDER BY store_code)";
const R = (i, salt, n) => `(abs(hashtext((${i})::text || '${salt}'))::bigint % ${n})`;
const TS = (i, salt) => `(timestamptz '2038-01-01 00:00:00+08' + (${R(i, salt + "d", 365)} || ' days')::interval + (${R(i, salt + "s", 86400)} || ' seconds')::interval)`;
const HEAD = "BEGIN;\nSET LOCAL session_replication_role = replica;\nSET LOCAL statement_timeout = 0;\n";

function seedSql(ga) {
  const g = (i) => `gs.i`;
  const steps = [];
  steps.push(["廠商", `${HEAD}
INSERT INTO public.ga_vendors (name, vendor_type, status, contract_required, contract_end_date, created_at, updated_at)
SELECT 'PERF-B6-V-' || lpad(gs.i::text, 6, '0'), 'company',
       CASE WHEN ${R("gs.i", "st", 100)} < 85 THEN 'active' WHEN ${R("gs.i", "st", 100)} < 95 THEN 'paused' ELSE 'inactive' END,
       ${R("gs.i", "cr", 100)} < 40,
       CASE WHEN ${R("gs.i", "ce", 100)} < 6 THEN public.ga_po_today() + (${R("gs.i", "cd", 50)}::int - 15) ELSE date '2038-01-01' + ${R("gs.i", "cx", 365)}::int END,
       ${TS("gs.i", "v")}, ${TS("gs.i", "v")}
  FROM generate_series(1, ${N.vendors}) AS gs(i);
COMMIT;`]);
  const prelude = `${HEAD}
CREATE TEMP TABLE _v ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY name) AS rn FROM public.ga_vendors WHERE name LIKE 'PERF-B6-V-%';
CREATE TEMP TABLE _nv ON COMMIT DROP AS SELECT count(*)::int AS n FROM _v;
`;
  steps.push(["工單", `${prelude}
WITH st AS (SELECT ${STORES} AS a)
INSERT INTO public.maintenance_requests (store_id, title, reported_by, reporter_name, status, priority, reported_at, created_at, updated_at, progress_stage, vendor_id, accepted_at, completed_at, completion_method, resource_type)
SELECT (SELECT a FROM st)[1 + ${R("gs.i", "s", 4)}::int], 'PERF-B6-WO-' || lpad(gs.i::text, 6, '0'), '${ga}'::uuid, 'PERF',
       x.status, 'normal', x.rep, x.rep, x.rep,
       CASE WHEN x.status = 'COMPLETED' THEN NULL
            WHEN ${R("gs.i", "pg", 100)} < 4 THEN 'REOPENED'
            ELSE (ARRAY['INITIAL_REVIEW','WAITING_STORE_INFO','INTERNAL_HANDLING','SEARCHING_VENDOR','WAITING_VENDOR_REPLY','VENDOR_ASSIGNED','VENDOR_WORKING','WAITING_PARTS','WAITING_STORE_CONFIRMATION','OTHER'])[1 + ${R("gs.i", "pgx", 10)}::int] END,
       CASE WHEN ${R("gs.i", "vn", 100)} < 80 THEN (SELECT v.id FROM _v v WHERE v.rn = 1 + ${R("gs.i", "vv", 1000000)}::int % (SELECT n FROM _nv)) END,
       CASE WHEN x.status <> 'UNACCEPTED' THEN x.rep + interval '1 day' END,
       CASE WHEN x.status = 'COMPLETED' THEN x.rep + ((1 + ${R("gs.i", "cd", 10)}) || ' days')::interval END,
       CASE WHEN x.status = 'COMPLETED' THEN CASE WHEN ${R("gs.i", "cm", 100)} < 85 THEN 'STORE_CONFIRMED' WHEN ${R("gs.i", "cm", 100)} < 95 THEN 'ADMIN_FORCE_CLOSED' END END,
       'EQUIPMENT'
  FROM generate_series(1, ${N.wo}) AS gs(i)
  CROSS JOIN LATERAL (SELECT ${TS("gs.i", "w")} AS rep,
         CASE WHEN ${R("gs.i", "ws", 100)} < 50 THEN 'COMPLETED' WHEN ${R("gs.i", "ws", 100)} < 70 THEN 'PROCESSING' WHEN ${R("gs.i", "ws", 100)} < 85 THEN 'ACCEPTED' ELSE 'UNACCEPTED' END AS status) x;
COMMIT;`]);
  steps.push(["需求單", `${HEAD}
WITH st AS (SELECT ${STORES} AS a)
INSERT INTO public.ga_service_requests (request_no, store_id, created_by, created_by_name, request_type, title, description, main_status, public_progress, created_at, updated_at)
SELECT 'PERF-B6-SR-' || lpad(gs.i::text, 6, '0'), (SELECT a FROM st)[1 + ${R("gs.i", "s", 4)}::int], '${ga}'::uuid, 'PERF', 'REPAIR', 'PERF-B6-SR-' || gs.i, 'perf',
       (ARRAY['PENDING_INTAKE','WAITING_STORE_SUPPLEMENT','WAITING_STORE_CONFIRMATION','WAITING_GA_REVIEW','ACCEPTED','IN_PROGRESS','COMPLETED','COMPLETED','REJECTED','CANCELED'])[1 + ${R("gs.i", "ms", 10)}::int],
       '處理中', ${TS("gs.i", "r")}, ${TS("gs.i", "r")}
  FROM generate_series(1, ${N.sr}) AS gs(i);
COMMIT;`]);
  steps.push(["採購評估", `${HEAD}
CREATE TEMP TABLE _sr ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY request_no) AS rn FROM public.ga_service_requests WHERE request_no LIKE 'PERF-B6-SR-%';
INSERT INTO public.ga_purchase_reviews (request_id, decision, created_by, estimated_amount, quoted_amount, created_at, updated_at)
SELECT s.id, 'PURCHASE', '${ga}'::uuid, 1000 + ${R("s.rn", "e", 9000)}, 900 + ${R("s.rn", "q", 9000)}, ${TS("s.rn", "pr")}, ${TS("s.rn", "pr")}
  FROM _sr s WHERE s.rn <= ${N.reviews};
COMMIT;`]);
  steps.push(["採購單", `${prelude}
CREATE TEMP TABLE _sr ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY request_no) AS rn FROM public.ga_service_requests WHERE request_no LIKE 'PERF-B6-SR-%';
CREATE TEMP TABLE _nsr ON COMMIT DROP AS SELECT count(*)::int AS n FROM _sr;
INSERT INTO public.ga_purchase_orders (po_no, status, vendor_id, vendor_name_snapshot, source_request_id, expected_delivery_date, tax_rate, subtotal, tax_amount, total_amount, approval_required,
                                       submitted_at, ordered_at, created_by, created_at, updated_at)
SELECT 'PERF-B6-PO-' || lpad(gs.i::text, 6, '0'), x.status,
       x.vid, 'PERF-B6-VS-' || ${R("gs.i", "vs", 20000)},
       CASE WHEN ${R("gs.i", "sr", 100)} < 50 THEN (SELECT s.id FROM _sr s WHERE s.rn = 1 + ${R("gs.i", "srr", 1000000)}::int % (SELECT n FROM _nsr)) END,
       CASE WHEN x.status IN ('ORDERED','PARTIALLY_RECEIVED') AND ${R("gs.i", "ov", 100)} < 20 THEN public.ga_po_today() - (1 + ${R("gs.i", "od", 30)}::int)
            WHEN x.status IN ('ORDERED','PARTIALLY_RECEIVED','APPROVED') THEN date '2038-01-01' + ${R("gs.i", "ox", 365)}::int END,
       0.05, x.sub, round(x.sub * 0.05), x.sub + round(x.sub * 0.05), false,
       CASE WHEN x.status <> 'DRAFT' THEN x.cat END,
       CASE WHEN x.status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED') THEN x.cat END,
       '${ga}'::uuid, x.cat, x.cat
  FROM generate_series(1, ${N.po}) AS gs(i)
  CROSS JOIN LATERAL (SELECT ${TS("gs.i", "po")} AS cat, (500 + ${R("gs.i", "am", 20000)})::numeric AS sub,
         (SELECT v.id FROM _v v WHERE v.rn = 1 + ${R("gs.i", "vq", 1000000)}::int % (SELECT n FROM _nv)) AS vid,
         CASE WHEN ${R("gs.i", "ps", 100)} < 5 THEN 'DRAFT' WHEN ${R("gs.i", "ps", 100)} < 8 THEN 'PENDING_APPROVAL' WHEN ${R("gs.i", "ps", 100)} < 11 THEN 'APPROVED'
              WHEN ${R("gs.i", "ps", 100)} < 23 THEN 'ORDERED' WHEN ${R("gs.i", "ps", 100)} < 30 THEN 'PARTIALLY_RECEIVED' WHEN ${R("gs.i", "ps", 100)} < 65 THEN 'RECEIVED'
              WHEN ${R("gs.i", "ps", 100)} < 95 THEN 'CLOSED' ELSE 'CANCELED' END AS status) x;
COMMIT;`]);
  steps.push(["採購單明細", `${HEAD}
CREATE TEMP TABLE _po ON COMMIT DROP AS SELECT id, status, row_number() OVER (ORDER BY po_no) AS rn FROM public.ga_purchase_orders WHERE po_no LIKE 'PERF-B6-PO-%';
INSERT INTO public.ga_purchase_order_items (po_id, line_no, item_name, unit, quantity, quantity_base, unit_price, line_amount, fulfil_mode, target_store_id, received_qty)
SELECT p.id, l.n, 'PERF-B6-ITEM-' || p.rn || '-' || l.n, 'pc', 2, 2, 100 + ${R("p.rn", "up", 500)}, 2 * (100 + ${R("p.rn", "up", 500)}), 'NO_STOCK',
       (${STORES})[1 + ${R("p.rn", "ts", 4)}::int], CASE WHEN p.status IN ('RECEIVED','CLOSED') THEN 2 ELSE 0 END
  FROM _po p CROSS JOIN LATERAL generate_series(1, CASE WHEN ${R("p.rn", "ln", 100)} < 50 THEN 2 ELSE 1 END) AS l(n);
COMMIT;`]);
  steps.push(["水電帳單", `${HEAD}
INSERT INTO public.ga_utility_bills (store_id, location_name, expense_type, billing_month, provider_name, amount, due_date, paid_at, created_by, created_at, updated_at, deleted_at, deletion_reason)
SELECT (${STORES})[1 + ${R("gs.i", "s", 4)}::int], 'PERF-B6-L-' || lpad(gs.i::text, 6, '0'),
       (ARRAY['WATER','ELECTRICITY','PHONE','INTERNET'])[1 + ${R("gs.i", "t", 4)}::int], x.bm, 'PERF-B6-P', 300 + ${R("gs.i", "a", 30000)},
       CASE WHEN ${R("gs.i", "dn", 100)} < 5 THEN NULL WHEN ${R("gs.i", "dp", 100)} < 4 THEN public.ga_po_today() - (1 + ${R("gs.i", "dd", 40)}::int) ELSE x.bm + 25 END,
       CASE WHEN ${R("gs.i", "pd", 100)} < 60 THEN x.bm + 20 END,
       '${ga}'::uuid, x.bm::timestamptz, x.bm::timestamptz,
       CASE WHEN ${R("gs.i", "dl", 100)} < 2 THEN x.bm::timestamptz + interval '40 days' END,
       CASE WHEN ${R("gs.i", "dl", 100)} < 2 THEN 'perf' END
  FROM generate_series(1, ${N.bills}) AS gs(i)
  CROSS JOIN LATERAL (SELECT make_date(2038, 1 + ${R("gs.i", "m", 12)}::int, 1) AS bm) x;
COMMIT;`]);
  steps.push(["庫存據點與料件", `${HEAD}
INSERT INTO public.ga_inventory_locations (name, location_type, is_active, allow_negative_stock, is_default)
SELECT 'PERF-B6-LOC-' || lpad(gs.i::text, 3, '0'), 'OTHER', true, gs.i = 1, false FROM generate_series(1, ${N.locs}) AS gs(i);
INSERT INTO public.ga_parts (category_id, name, base_unit, minimum_issue_qty, is_active)
SELECT (SELECT id FROM public.ga_part_categories ORDER BY id LIMIT 1), 'PERF-B6-PART-' || lpad(gs.i::text, 6, '0'), 'pc', 1, true FROM generate_series(1, ${N.parts}) AS gs(i);
COMMIT;`]);
  steps.push(["庫存餘額與安全量", `${HEAD}
CREATE TEMP TABLE _l ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY name) AS rn FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-LOC-%';
CREATE TEMP TABLE _p ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY name) AS rn FROM public.ga_parts WHERE name LIKE 'PERF-B6-PART-%';
INSERT INTO public.ga_inventory_balances (location_id, part_id, quantity_base)
SELECT l.id, p.id, CASE WHEN ${R("l.rn * 100000 + p.rn", "q", 100)} < 2 THEN -1 * (1 + ${R("p.rn", "n", 10)}) ELSE ${R("l.rn * 100000 + p.rn", "qq", 100)} END
  FROM _l l CROSS JOIN _p p;
INSERT INTO public.ga_inventory_location_parts (location_id, part_id, is_active, safety_stock_qty, reorder_point_qty)
SELECT l.id, p.id, true, 20, 40 FROM _l l CROSS JOIN _p p WHERE l.rn <= ${Math.floor(N.locs / 2)};
COMMIT;`]);
  steps.push(["調撥單", `${HEAD}
CREATE TEMP TABLE _l ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY name) AS rn FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-LOC-%';
INSERT INTO public.ga_inventory_transfers (transfer_no, source_location_id, destination_location_id, status, reason, source_confirmed_at, received_at, canceled_at, cancel_reason, created_by, created_at, updated_at)
SELECT 'PERF-B6-TR-' || lpad(gs.i::text, 6, '0'), s.id, d.id, x.status, 'perf',
       CASE WHEN x.status IN ('SOURCE_CONFIRMED','IN_TRANSIT','RECEIVED') THEN CASE WHEN x.status <> 'RECEIVED' AND ${R("gs.i", "ov", 100)} < 30 THEN now() - ((5 + ${R("gs.i", "od", 60)}) || ' days')::interval ELSE x.cat + interval '1 day' END END,
       CASE WHEN x.status = 'RECEIVED' THEN x.cat + interval '3 days' END,
       CASE WHEN x.status = 'CANCELED' THEN x.cat + interval '1 day' END, CASE WHEN x.status = 'CANCELED' THEN 'perf' END,
       '${ga}'::uuid, x.cat, x.cat
  FROM generate_series(1, ${N.transfers}) AS gs(i)
  CROSS JOIN LATERAL (SELECT ${TS("gs.i", "t")} AS cat, 1 + ${R("gs.i", "si", N.locs)}::int AS si, 1 + (${R("gs.i", "si", N.locs)}::int + 1 + ${R("gs.i", "di", N.locs - 1)}::int) % ${N.locs} AS di,
         CASE WHEN ${R("gs.i", "ts", 100)} < 10 THEN 'REQUESTED' WHEN ${R("gs.i", "ts", 100)} < 20 THEN 'SOURCE_CONFIRMED' WHEN ${R("gs.i", "ts", 100)} < 30 THEN 'IN_TRANSIT'
              WHEN ${R("gs.i", "ts", 100)} < 90 THEN 'RECEIVED' ELSE 'CANCELED' END AS status) x
  JOIN _l s ON s.rn = x.si JOIN _l d ON d.rn = x.di;
COMMIT;`]);
  steps.push(["設備與設施", `${HEAD}
WITH st AS (SELECT ${STORES} AS a)
INSERT INTO public.ga_equipment (store_id, category_id, name, status, criticality, specs, has_warranty, onboarding_status, created_at, updated_at)
SELECT (SELECT a FROM st)[1 + ${R("gs.i", "s", 4)}::int], (SELECT id FROM public.ga_equipment_categories ORDER BY id LIMIT 1), 'PERF-B6-EQ-' || lpad(gs.i::text, 6, '0'), 'ACTIVE', 'NORMAL', '{}'::jsonb, false,
       CASE WHEN ${R("gs.i", "o", 100)} < 10 THEN 'PENDING_GA_REVIEW' WHEN ${R("gs.i", "o", 100)} < 15 THEN 'NEEDS_EQUIPMENT_PHOTO' WHEN ${R("gs.i", "o", 100)} < 20 THEN 'NEEDS_LABEL_PHOTO' ELSE 'COMPLETED' END,
       ${TS("gs.i", "e")}, ${TS("gs.i", "e")}
  FROM generate_series(1, ${N.equip}) AS gs(i);
WITH st AS (SELECT ${STORES} AS a)
INSERT INTO public.ga_facilities (store_id, category_id, name, status, criticality, specs, onboarding_status, created_at, updated_at)
SELECT (SELECT a FROM st)[1 + ${R("gs.i", "s", 4)}::int], (SELECT id FROM public.ga_facility_categories ORDER BY id LIMIT 1), 'PERF-B6-FC-' || lpad(gs.i::text, 6, '0'), 'ACTIVE', 'NORMAL', '{}'::jsonb,
       CASE WHEN ${R("gs.i", "o", 100)} < 10 THEN 'PENDING_GA_REVIEW' WHEN ${R("gs.i", "o", 100)} < 15 THEN 'NEEDS_EQUIPMENT_PHOTO' WHEN ${R("gs.i", "o", 100)} < 20 THEN 'NEEDS_LABEL_PHOTO' ELSE 'COMPLETED' END,
       ${TS("gs.i", "f")}, ${TS("gs.i", "f")}
  FROM generate_series(1, ${N.fac}) AS gs(i);
COMMIT;`]);
  return steps;
}

// ---------------------------------------------------------------- 計數（基準與清除驗證）
const TABLES = [
  ["ga_vendors", "name LIKE 'PERF-B6-%'"], ["maintenance_requests", "title LIKE 'PERF-B6-%'"], ["ga_service_requests", "request_no LIKE 'PERF-B6-%'"],
  ["ga_purchase_orders", "po_no LIKE 'PERF-B6-%'"], ["ga_purchase_order_items", "item_name LIKE 'PERF-B6-%'"], ["ga_purchase_reviews", "request_id IN (SELECT id FROM public.ga_service_requests WHERE request_no LIKE 'PERF-B6-%')"],
  ["ga_utility_bills", "location_name LIKE 'PERF-B6-%'"], ["ga_inventory_locations", "name LIKE 'PERF-B6-%'"], ["ga_parts", "name LIKE 'PERF-B6-%'"],
  ["ga_inventory_balances", "location_id IN (SELECT id FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-%')"],
  ["ga_inventory_location_parts", "location_id IN (SELECT id FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-%')"],
  ["ga_inventory_transfers", "transfer_no LIKE 'PERF-B6-%'"], ["ga_equipment", "name LIKE 'PERF-B6-%'"], ["ga_facilities", "name LIKE 'PERF-B6-%'"],
];
function counts() {
  const parts = TABLES.map(([t, w]) => `SELECT '${t}' AS t, (SELECT count(*) FROM public.${t}) AS total, (SELECT count(*) FROM public.${t} WHERE ${w}) AS marked`);
  parts.push(`SELECT 'profiles' AS t, (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.profiles WHERE email LIKE '${EMAIL_PREFIX}%')`);
  parts.push(`SELECT 'roles' AS t, (SELECT count(*) FROM public.roles), (SELECT count(*) FROM public.roles WHERE code LIKE '${ROLE_PREFIX}%')`);
  const rows = runSql(parts.join("\nUNION ALL\n") + ";");
  return Object.fromEntries(rows.map((r) => [r.t, { total: Number(r.total), marked: Number(r.marked) }]));
}

function cleanupSql() {
  return `${HEAD}
DELETE FROM public.ga_purchase_order_items WHERE item_name LIKE 'PERF-B6-%';
DELETE FROM public.ga_purchase_orders WHERE po_no LIKE 'PERF-B6-%';
DELETE FROM public.ga_purchase_reviews WHERE request_id IN (SELECT id FROM public.ga_service_requests WHERE request_no LIKE 'PERF-B6-%');
DELETE FROM public.ga_inventory_transfers WHERE transfer_no LIKE 'PERF-B6-%';
DELETE FROM public.ga_inventory_balances WHERE location_id IN (SELECT id FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-%');
DELETE FROM public.ga_inventory_location_parts WHERE location_id IN (SELECT id FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-%');
DELETE FROM public.ga_inventory_locations WHERE name LIKE 'PERF-B6-%';
DELETE FROM public.ga_parts WHERE name LIKE 'PERF-B6-%';
DELETE FROM public.maintenance_requests WHERE title LIKE 'PERF-B6-%';
DELETE FROM public.ga_service_requests WHERE request_no LIKE 'PERF-B6-%';
DELETE FROM public.ga_utility_bills WHERE location_name LIKE 'PERF-B6-%';
DELETE FROM public.ga_equipment WHERE name LIKE 'PERF-B6-%';
DELETE FROM public.ga_facilities WHERE name LIKE 'PERF-B6-%';
DELETE FROM public.ga_vendors WHERE name LIKE 'PERF-B6-%';
COMMIT;`;
}

// ---------------------------------------------------------------- 量測
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// [函式, 參數 SQL, rpc 參數物件, 誰呼叫, 目標毫秒]
const CASES = [
  ["ga_ws_home_summary", "", {}, ["ga", "store"], 1500],
  ["ga_ws_home_badges", "", {}, ["ga", "store"], 1000],
  ["ga_ws_vendor_perf", "p_from => '2038-01', p_to => '2038-12'", { p_from: "2038-01", p_to: "2038-12" }, ["ga"], 1000],
  ["ga_ws_purchase_analysis", "p_year_month => '2038-06'", { p_year_month: "2038-06" }, ["ga"], 1000],
  ["ga_ws_ub_list", "p_filters => '{\"month\":\"2038-06\"}'::jsonb", { p_filters: { month: "2038-06" } }, ["ga"], 1000],
  ["ga_ws_ub_list#全部", "p_filters => '{}'::jsonb", { p_filters: {} }, ["ga"], 1000],
  ["ga_ws_ub_list#逾期", "p_filters => '{\"overdue\":true}'::jsonb", { p_filters: { overdue: true } }, ["ga"], 1000],
  ["ga_ws_vendor_list", "", {}, ["ga"], 1000],
  ["ga_ws_vendor_list#搜尋", "p_filters => '{\"search\":\"V-0123\"}'::jsonb", { p_filters: { search: "V-0123" } }, ["ga"], 1000],
  ["ga_ws_po_list#待我處理", "p_filters => '{\"attention\":true}'::jsonb", { p_filters: { attention: true } }, ["ga"], 1000],
  ["ga_hm_counts", "", null, ["ga", "store"], 1000], // 只做資料庫內耗時（不開放給登入者）
];

function measureDbSql(uid, who) {
  const blocks = CASES.filter((c) => c[3].includes(who)).map(([name, sqlArgs]) => {
    const fn = name.split("#")[0];
    return `  FOR i IN 1..5 LOOP
    t0 := clock_timestamp();
    r := public.${fn}(${sqlArgs})::jsonb;
    INSERT INTO _perf VALUES ('${name}', '${who}', i, extract(epoch FROM clock_timestamp() - t0) * 1000, length(r::text), COALESCE(r ->> 'ok', 'counts'));
  END LOOP;`;
  }).join("\n");
  return `CREATE TEMP TABLE _perf (fn text, who text, i int, ms numeric, bytes int, ok text) ON COMMIT DROP;
DO $perf$
DECLARE i int; t0 timestamptz; r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${uid}', true);
${blocks}
END
$perf$;
SELECT fn, who, i, round(ms, 1) AS ms, bytes, ok FROM _perf ORDER BY fn, i;`;
}

async function measure(users) {
  const results = {};
  for (const who of ["ga", "store"]) {
    const rows = runSql(measureDbSql(users[who].id, who));
    for (const r of rows) {
      const k = `${r.fn}|${who}`;
      (results[k] ||= { fn: r.fn, who, db: [], e2e: [], bytes: Number(r.bytes), ok: r.ok });
      results[k].db.push(Number(r.ms));
      if (r.ok !== "true" && r.ok !== "counts") results[k].ok = r.ok;
    }
  }
  for (const [name, , rpcArgs, whos] of CASES) {
    if (rpcArgs === null) continue;
    for (const who of whos) {
      const k = `${name}|${who}`;
      const fn = name.split("#")[0];
      for (let i = 0; i < 5; i += 1) {
        const t = process.hrtime.bigint();
        const res = await users[who].client.rpc(fn, rpcArgs);
        const ms = Number(process.hrtime.bigint() - t) / 1e6;
        if (res.error) { results[k].e2eError = res.error.message; }
        results[k].e2e.push(ms);
      }
    }
  }
  const out = Object.values(results).map((r) => {
    const target = CASES.find((c) => c[0] === r.fn)[4];
    return { fn: r.fn, who: r.who, ok: r.ok, bytes: r.bytes, dbMedian: Math.round(median(r.db) * 10) / 10, dbAll: r.db, e2eMedian: r.e2e.length ? Math.round(median(r.e2e)) : null, e2eAll: r.e2e.map((x) => Math.round(x)), e2eError: r.e2eError, target };
  });
  return out;
}

function printTable(out) {
  console.log(`\n== 量測結果（label=${LABEL}）；dbMedian＝資料庫內耗時中位數 ms，e2eMedian＝經 PostgREST 往返中位數 ms ==`);
  for (const r of out) {
    const slow = r.dbMedian > r.target ? "  <-- 超標" : "";
    console.log(`${r.fn.padEnd(30)} ${r.who.padEnd(6)} ok=${String(r.ok).padEnd(6)} db=${String(r.dbMedian).padStart(8)}  e2e=${String(r.e2eMedian ?? "-").padStart(6)}  target<${r.target}  bytes=${r.bytes}${slow}${r.e2eError ? "  e2eError=" + r.e2eError : ""}`);
  }
}

// ---------------------------------------------------------------- EXPLAIN（最重的幾段內層查詢）
const EXPLAINS = require("./perf-m7m8-b6-explains.cjs");
function explain(users) {
  const uid = users.ga.id;
  const res = {};
  for (const [name, sql] of Object.entries(EXPLAINS)) {
    const rows = runSql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', '${uid}', true);\nEXPLAIN (ANALYZE, BUFFERS) ${sql};`);
    res[name] = rows.map((r) => r["QUERY PLAN"]).filter(Boolean);
    const lines = res[name];
    const exec = lines.find((l) => /Execution Time/.test(l));
    console.log(`\n--- EXPLAIN ${name}：${exec || ""}`);
    for (const l of lines.slice(0, 40)) console.log("  " + l);
  }
  return res;
}

async function findExistingUsers() {
  // 取得已存在的測試帳號（--measure 單獨執行時用）；密碼是隨機的，所以改用重新建立帳號的方式不可行：這裡以 service role 重設密碼。
  const db = admin();
  const allUsers = await listAllUsers(db);
  const out = {};
  for (const key of ["ga", "store"]) {
    const u = allUsers.find((x) => x.email === `${EMAIL_PREFIX}${key}@example.test`);
    if (!u) throw new Error(`找不到測試帳號 ${key}，先執行 --seed`);
    const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
    must(await db.auth.admin.updateUserById(u.id, { password }), `重設密碼 ${key}`);
    const client = anon();
    must(await client.auth.signInWithPassword({ email: u.email, password }), `登入 ${key}`);
    out[key] = { key, id: u.id, client };
  }
  return out;
}

async function cleanupAll() {
  console.log("清除資料...");
  runSql(cleanupSql());
  const left = await cleanupUsers();
  if (left.length) console.log("帳號清除殘留：" + left.join("; "));
  return left;
}

(async () => {
  const state = path.join(os.tmpdir(), "perf-b6-baseline.json");
  if (has("--cleanup-only")) {
    await cleanupAll();
    const c = counts();
    const base = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : null;
    console.log("清除後標記筆數：" + JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.marked]))));
    const bad = Object.entries(c).filter(([, v]) => v.marked !== 0).map(([k]) => k);
    if (base) {
      const diff = Object.entries(c).filter(([k, v]) => v.total !== base[k]?.total).map(([k, v]) => `${k}: ${base[k]?.total} -> ${v.total}`);
      console.log(diff.length ? "與基準筆數不同：" + diff.join("; ") : "與基準筆數完全相同（" + Object.keys(base).length + " 張表）");
      if (diff.length) process.exitCode = 1;
    } else console.log("沒有基準檔（" + state + "），只驗證標記筆數為 0");
    if (bad.length) { console.log("仍有殘留：" + bad.join(",")); process.exitCode = 1; }
    return;
  }
  let users;
  const all = has("--all");
  if (all || has("--seed")) {
    // 基準：先清上次殘留，再記錄各表筆數。
    await cleanupAll();
    const base = counts();
    fs.writeFileSync(state, JSON.stringify(base));
    console.log("基準筆數：" + JSON.stringify(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.total]))));
    try {
      users = await setupUsers();
      for (const [name, sql] of seedSql(users.ga.id)) {
        const t = Date.now();
        runSql(sql.replace(/\$\{ga\}/g, users.ga.id));
        console.log(`建立 ${name}：${((Date.now() - t) / 1000).toFixed(1)} 秒`);
      }
      runSql("ANALYZE public.ga_vendors; ANALYZE public.maintenance_requests; ANALYZE public.ga_service_requests; ANALYZE public.ga_purchase_orders; ANALYZE public.ga_purchase_order_items; ANALYZE public.ga_purchase_reviews; ANALYZE public.ga_utility_bills; ANALYZE public.ga_inventory_balances; ANALYZE public.ga_inventory_location_parts; ANALYZE public.ga_inventory_transfers; ANALYZE public.ga_inventory_locations; ANALYZE public.ga_parts; ANALYZE public.ga_equipment; ANALYZE public.ga_facilities;");
      const c = counts();
      console.log("灌入後標記筆數：" + JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.marked]))));
    } catch (e) {
      console.error("灌資料中途失敗：" + (e.message || e));
      if (all) { try { await cleanupAll(); } catch (e2) { console.error("自動清除也失敗，請執行 --cleanup-only：" + (e2.message || e2)); } }
      else console.error("已建立的部分資料仍在，請執行 node scripts/perf-m7m8-b6-dev.cjs --cleanup-only");
      process.exit(1);
    }
  }
  try {
    if (all || has("--measure")) {
      if (!users) users = await findExistingUsers();
      const out = await measure(users);
      printTable(out);
      let ex = null;
      if (has("--explain") || all) ex = explain(users);
      if (OUT) fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, counts: N, results: out, explain: ex }, null, 1));
    }
  } finally {
    if (all) {
      await cleanupAll();
      const c = counts();
      const base = JSON.parse(fs.readFileSync(state, "utf8"));
      const diff = Object.entries(c).filter(([k, v]) => v.total !== base[k]?.total || v.marked !== 0).map(([k, v]) => `${k}: 基準 ${base[k]?.total} -> ${v.total}（標記 ${v.marked}）`);
      console.log(diff.length ? "清除驗證失敗：" + diff.join("; ") : "清除驗證通過：所有表筆數回到基準、標記筆數為 0");
      if (diff.length) process.exitCode = 1;
    }
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
