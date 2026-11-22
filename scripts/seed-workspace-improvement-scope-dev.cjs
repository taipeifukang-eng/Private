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
const ok = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
(async () => {
  if (process.argv[2] === "overdue") {
    const id = process.argv[3];
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("invalid fixture id");
    const row = ok(
      await db
        .from("inspection_improvements")
        .select("inspection_id")
        .eq("id", id)
        .single(),
    );
    const master = ok(
      await db
        .from("inspection_masters")
        .select("supervisor_notes")
        .eq("id", row.inspection_id)
        .single(),
    );
    if (master.supervisor_notes !== "Vue 改善範圍與並行測試")
      throw Error("not owned fixture");
    ok(
      await db
        .from("inspection_improvements")
        .update({ status: "overdue" })
        .eq("id", id)
        .eq("status", "pending"),
    );
    console.log("Prepared overdue test fixture");
    return;
  }
  // D04：憑證只存在 .tmp-check/test-credentials.json（key: improvement_manager）。
  const creds = require("../tests/support/credentials.cjs"),
    email = "vue-workspace-improvement-manager@example.test",
    saved = creds.loadCredentials().accounts.improvement_manager;
  let account = saved && saved.password ? { id: saved.userId, email } : null;
  const users = ok(await db.auth.admin.listUsers({ perPage: 1000 })).users;
  let user = users.find((u) => u.email === email);
  if (!user) {
    const password = crypto.randomBytes(24).toString("base64url") + "aA1!";
    user = ok(
      await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Vue 改善範圍測試主管" },
      }),
    ).user;
    account = { id: user.id, email };
    creds.registerAccount("improvement_manager", { email, password, userId: user.id });
  }
  if (!account || account.id !== user.id)
    throw Error("existing account credentials unavailable; not resetting");
  ok(
    await db
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: "Vue 改善範圍測試主管",
        role: "manager",
      }),
  );
  const store = ok(
    await db.from("stores").select("id").eq("store_code", "VW001").single(),
  );
  const assigned = ok(
    await db
      .from("store_managers")
      .select("id")
      .eq("user_id", user.id)
      .eq("store_id", store.id),
  );
  if (!assigned.length)
    ok(
      await db
        .from("store_managers")
        .insert({
          user_id: user.id,
          store_id: store.id,
          role_type: "store_manager",
        }),
    );
  console.log("Prepared dedicated VW001 manager test account");
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
