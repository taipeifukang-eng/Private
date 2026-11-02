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
  const accounts = require("../tests/support/credentials.cjs").readWorkspaceAccounts().accounts;
  const users = ok(await db.auth.admin.listUsers({ perPage: 1000 })).users;
  const actor = users.find(
    (u) => u.email === accounts.find((a) => a.key === "navigation").email,
  ).id;
  const other = users.find(
    (u) => u.email === accounts.find((a) => a.key === "viewer").email,
  ).id;
  const templateId = crypto.randomUUID(),
    id = crypto.randomUUID(),
    foreign = crypto.randomUUID();
  const steps = [
    {
      id: "a",
      label: "Vue 主項測試",
      required: true,
      planned_start_date: "2026-10-01",
      planned_end_date: "2026-10-07",
      subSteps: [
        { id: "a1", label: "Vue 子項一" },
        { id: "a2", label: "Vue 子項二" },
      ],
    },
    { id: "b", label: "Vue 單項測試" },
  ];
  ok(
    await db.from("templates").insert({
      id: templateId,
      title: "Vue 任務驗證 " + id.slice(0, 8),
      description: "專用測試資料",
      created_by: actor,
      steps_schema: steps,
      sections: [
        {
          id: "mine",
          department: "Vue 測試部門",
          steps,
          assigned_users: [actor],
        },
        {
          id: "other",
          department: "Vue 另一部門",
          steps: [{ id: "secret", label: "另一區段項目" }],
          assigned_users: [other],
        },
      ],
    }),
  );
  ok(
    await db.from("assignments").insert([
      {
        id,
        template_id: templateId,
        assigned_to: actor,
        created_by: actor,
        status: "pending",
        department: "Vue 測試部門",
        archived: false,
      },
      {
        id: foreign,
        template_id: templateId,
        assigned_to: other,
        created_by: actor,
        status: "pending",
        department: "Vue 非本人部門",
        archived: false,
      },
    ]),
  );
  ok(
    await db.from("assignment_collaborators").insert([
      { assignment_id: id, user_id: actor, section_id: "mine" },
      { assignment_id: id, user_id: other, section_id: "other" },
      { assignment_id: foreign, user_id: other, section_id: "other" },
    ]),
  );
  fs.writeFileSync(
    ".tmp-check/task-fixture.json",
    JSON.stringify({
      id,
      foreign,
      templateId,
      actor,
      title: "Vue 任務驗證 " + id.slice(0, 8),
    }),
  );
  console.log("Created namespaced task fixtures");
})();
