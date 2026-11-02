const fs = require("fs"),
  crypto = require("crypto"),
  assert = require("assert/strict");
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
const ok = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
(async () => {
  const f = JSON.parse(fs.readFileSync(".tmp-check/task-fixture.json", "utf8"));
  const template = ok(
    await db.from("templates").select("*").eq("id", f.templateId).single(),
  );
  assert.equal(template.description, "專用測試資料");
  const before = ok(
    await db.from("assignments").select("*").eq("id", f.id).single(),
  );
  const logs = ok(await db.from("logs").select("id").eq("assignment_id", f.id));
  const args = {
    p_id: f.id,
    p_actor: f.actor,
    p_version: before.workspace_version,
    p_write: crypto.randomUUID(),
    p_hash: "rollback",
    p_status: "in_progress",
    p_actions: [
      { step_id: "b", action: "complete", note: "rollback" },
      { step_id: "b", action: "invalid" },
    ],
  };
  assert((await db.rpc("workspace_save_task", args)).error);
  assert.deepEqual(
    ok(await db.from("logs").select("id").eq("assignment_id", f.id)),
    logs,
  );
  assert.equal(
    ok(
      await db
        .from("assignments")
        .select("workspace_version")
        .eq("id", f.id)
        .single(),
    ).workspace_version,
    before.workspace_version,
  );
  console.log("PASS failed batch rolls back logs, status, and version");
  ok(
    await db
      .from("logs")
      .insert({
        assignment_id: f.id,
        user_id: f.actor,
        step_id: "b",
        action: "complete",
        note: "legacy test",
      }),
  );
  args.p_actions = [{ step_id: "b", action: "complete" }];
  assert.match(
    (await db.rpc("workspace_save_task", args)).error.message,
    /CONFLICT/,
  );
  console.log("PASS legacy log write invalidates Vue snapshot");
  const version = ok(
    await db
      .from("assignments")
      .select("workspace_version")
      .eq("id", f.id)
      .single(),
  ).workspace_version;
  ok(
    await db
      .from("templates")
      .update({ description: "專用測試資料" })
      .eq("id", f.templateId),
  );
  assert(
    ok(
      await db
        .from("assignments")
        .select("workspace_version")
        .eq("id", f.id)
        .single(),
    ).workspace_version > version,
  );
  console.log("PASS template changes invalidate task snapshot");
  const current = ok(
    await db
      .from("assignments")
      .select("workspace_version")
      .eq("id", f.id)
      .single(),
  ).workspace_version;
  const base = {
    ...args,
    p_version: current,
    p_actions: [{ step_id: "b", action: "complete" }],
  };
  const results = await Promise.all([
    db.rpc("workspace_save_task", {
      ...base,
      p_write: crypto.randomUUID(),
      p_hash: "race1",
    }),
    db.rpc("workspace_save_task", {
      ...base,
      p_write: crypto.randomUUID(),
      p_hash: "race2",
    }),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(
    results.filter((r) => /CONFLICT/.test(r.error?.message || "")).length,
    1,
  );
  console.log("PASS concurrent writes accept exactly one revision");
})();
