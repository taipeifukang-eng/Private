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
const actor = JSON.parse(
  fs.readFileSync(".tmp-check/workspace-accounts.json", "utf8"),
).accounts.find((a) => a.key === "navigation");
(async () => {
  const revision = await db
    .from("workspace_inspection_settings_revision")
    .select("version")
    .single();
  const store = await db
    .from("stores")
    .select("id")
    .eq("store_code", "VW001")
    .single();
  const templates = await db
    .from("inspection_templates")
    .select("id,max_score")
    .eq("is_active", true);
  if (revision.error || store.error || templates.error)
    throw Error("fixture lookup failed");
  const changed = await db
    .from("inspection_templates")
    .insert({
      section: "section_1",
      section_name: "Vue 競態測試",
      section_order: 1,
      item_name: "Vue 設定競態測試 " + crypto.randomUUID(),
      item_order: 999,
      max_score: 1,
      scoring_type: "checklist",
      checklist_items: [],
      is_active: false,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (changed.error) throw Error(changed.error.message);
  const current = await db
    .from("workspace_inspection_settings_revision")
    .select("version")
    .single();
  if (current.error || current.data.version <= revision.data.version)
    throw Error("configuration update did not advance version");
  for (const version of [revision.data.version, null]) {
    const key = crypto.randomUUID();
    const r = await db.rpc("workspace_save_inspection", {
      p_actor: actor.id,
      p_id: null,
      p_version: 0,
      p_write: key,
      p_hash: "race-test",
      p_master: {
        settings_version: version,
        store_id: store.data.id,
        inspection_date: "2099-12-30",
        inspection_type: "supervisor",
        status: "draft",
        total_score: 220,
        grade: "10",
        score_percentage: 100,
        indoor_temperature: 26,
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
      p_staff: [],
    });
    if (!r.error?.message.includes("SETTINGS_CONFLICT"))
      throw Error("stale or missing settings version was accepted");
    const remaining = await db
      .from("inspection_masters")
      .select("id")
      .eq("client_request_id", key);
    if (remaining.error || remaining.data.length)
      throw Error("conflict left a partial master");
    console.log(
      "PASS " +
        (version === null ? "missing" : "stale") +
        " settings revision rejected inside transaction without writing",
    );
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
