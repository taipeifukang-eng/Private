const fs = require("fs");
require("@next/env").loadEnvConfig(process.cwd(), true);
const e = process.env;
if (
  new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname !==
    "mjpdfpxqttbhzeimmtqr.supabase.co" ||
  e.ALLOW_DEV_DATABASE_OPERATIONS !== "true"
)
  throw Error("DEV mismatch");
const db = require("@supabase/supabase-js").createClient(
  e.NEXT_PUBLIC_SUPABASE_URL,
  e.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const data = JSON.parse(
  fs.readFileSync(".tmp-check/workspace-accounts.json", "utf8"),
);
(async () => {
  const s = await db
    .from("stores")
    .select("id")
    .eq("store_code", "VW001")
    .single();
  if (s.error) throw s.error;
  const old = await db
    .from("monthly_staff_status")
    .select("id")
    .eq("store_id", s.data.id)
    .eq("year_month", "2026-10")
    .eq("employee_code", "VWTEST01")
    .maybeSingle();
  if (old.error) throw old.error;
  let id = old.data?.id;
  if (!id) {
    const r = await db
      .from("monthly_staff_status")
      .insert({
        store_id: s.data.id,
        year_month: "2026-10",
        employee_code: "VWTEST01",
        employee_name: "Vue 人員測試",
        position: "專員",
        employment_type: "full_time",
        monthly_status: "full_month",
        work_days: 26,
        total_days_in_month: 31,
        status: "draft",
        notes: "Vue 模組測試資料",
      })
      .select("id")
      .single();
    if (r.error) throw r.error;
    id = r.data.id;
  }
  fs.writeFileSync(
    ".tmp-check/five-module-fixtures.json",
    JSON.stringify({ store: s.data.id, staff: id, month: "2026-10" }),
  );
  console.log("DEV namespaced monthly fixture ready");
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
const XLSX = require("xlsx");
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      店號: "VW001",
      店名: "Vue 測試一店",
      盤點單號: "VW-NATIVE-202610",
      "結案?": "否",
      品號: "02000001",
      品名: "Vue 測試品",
      單位: "盒",
      儲位1: "A01",
      儲位2: "",
      盤差量: -1,
      "盤差額(會員)": -100,
      成本: -50,
      單位成本: 50,
      庫存量: 5,
      庫存額: 250,
    },
  ]),
  "盤點",
);
XLSX.writeFile(workbook, ".tmp-check/vue-native-inventory.xlsx");
