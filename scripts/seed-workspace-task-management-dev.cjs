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
  const manager = require("../tests/support/credentials.cjs").requireWorkspaceAccount("archive_manager");
  const user = ok(await db.auth.admin.getUserById(manager.id)).user;
  if (user.email !== "vue-workspace-archive-manager@example.test")
    throw Error("not fixture account");
  const role = ok(
    await db
      .from("roles")
      .select("id")
      .eq("code", "vue_workspace_archive_manager")
      .single(),
  );
  const perms = ok(
    await db
      .from("permissions")
      .select("id,code")
      .in("code", ["task.manage", "task.template.delete"]),
  );
  if (perms.length !== 2) throw Error("missing permission definitions");
  ok(
    await db.from("role_permissions").upsert(
      perms.map((p) => ({
        role_id: role.id,
        permission_id: p.id,
        is_allowed: true,
      })),
      { onConflict: "role_id,permission_id" },
    ),
  );
  const nav = require("../tests/support/credentials.cjs").requireWorkspaceAccount("navigation");
  const users = ok(await db.auth.admin.listUsers({ perPage: 1000 })).users;
  const admin = users.find((u) => u.email === nav.email).id;
  const template = crypto.randomUUID(),
    foreign = crypto.randomUUID(),
    ids = [crypto.randomUUID(), crypto.randomUUID()].sort(),
    title = "Vue 整批封存 " + template.slice(0, 8);
  const steps = [
    { id: "p", label: "主項", subSteps: [{ id: "s", label: "子項" }] },
    { id: "x", label: "跨部門確認" },
  ];
  ok(
    await db.from("templates").insert(
      [
        { id: template, title, created_by: manager.id },
        { id: foreign, title: "Vue 其他主管範本", created_by: admin },
      ].map((t) => ({
        ...t,
        description: "Vue 管理封存測試專用",
        steps_schema: steps,
        sections: [
          {
            id: "one",
            department: "Vue 測試部門",
            assigned_users: [manager.id],
            steps: [steps[0]],
          },
          {
            id: "two",
            department: "Vue 另一部門",
            assigned_users: [],
            steps: [steps[1]],
          },
        ],
      })),
    ),
  );
  ok(
    await db
      .from("assignments")
      .insert(
        ids.map((id) => ({
          id,
          template_id: template,
          assigned_to: manager.id,
          created_by: manager.id,
          status: "completed",
          archived: false,
          department: "Vue 測試部門",
        })),
      ),
  );
  ok(
    await db
      .from("assignment_collaborators")
      .insert(
        ids.map((id) => ({
          assignment_id: id,
          user_id: manager.id,
          section_id: null,
        })),
      ),
  );
  ok(
    await db
      .from("logs")
      .insert(
        ids.flatMap((id, i) =>
          (i === 0 ? ["p", "s", "x"] : ["p", "s"]).map((step_id) => ({
            assignment_id: id,
            user_id: manager.id,
            step_id,
            action: "complete",
            note: "測試已完成項目",
          })),
        ),
      ),
  );
  fs.writeFileSync(
    ".tmp-check/task-management-fixture.json",
    JSON.stringify({ template, foreign, ids, title }),
  );
  console.log(
    "Created two-assignment archive fixture with one missing cross-section step",
  );
})();
