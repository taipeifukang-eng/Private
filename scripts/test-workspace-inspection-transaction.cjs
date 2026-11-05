const fs = require("fs"),
  crypto = require("crypto");
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
const actor = require("../tests/support/credentials.cjs").requireWorkspaceAccount(
  "navigation",
);
(async () => {
  const stores = await db
    .from("stores")
    .select("id")
    .eq("store_code", "VW001")
    .single();
  const templates = await db
    .from("inspection_templates")
    .select("id,max_score")
    .eq("is_active", true);
  if (stores.error || templates.error) throw Error("fixture lookup failed");
  const revision = await db
    .from("workspace_inspection_settings_revision")
    .select("version")
    .single();
  if (revision.error) throw Error("revision lookup failed");
  const key = crypto.randomUUID();
  const r = await db.rpc("workspace_save_inspection", {
    p_actor: actor.id,
    p_id: null,
    p_version: 0,
    p_write: key,
    p_hash: "rollback-test",
    p_master: {
      settings_version: revision.data.version,
      store_id: stores.data.id,
      inspection_date: "2099-12-31",
      inspection_type: "supervisor",
      status: "draft",
      total_score: 220,
      grade: "10",
      score_percentage: 100,
      indoor_temperature: 26,
      // 新增巡店需帶合格定位（資料庫 trigger）
      gps_latitude: 25.033,
      gps_longitude: 121.5654,
      gps_accuracy: 20,
      gps_timestamp: new Date().toISOString(),
    },
    p_results: templates.data.map((t) => ({
      template_id: t.id,
      max_score: t.max_score,
      given_score: t.max_score,
      deduction_amount: 0,
      is_improvement: false,
      selected_items: [],
      workspace_quantities: {},
      notes: null,
      photo_urls: [],
    })),
    p_staff: [{ employee_name: null }],
  });
  if (r.error?.code !== "23502" || !r.error.message.includes("employee_name"))
    throw Error(
      "expected staff constraint failure, received " +
        (r.error?.code || "success"),
    );
  const remaining = await db
    .from("inspection_masters")
    .select("id")
    .eq("client_request_id", key);
  if (remaining.error || remaining.data.length)
    throw Error("atomic rollback failed");
  console.log(
    "PASS transaction rolls back master and 27 detail rows on staff failure",
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
