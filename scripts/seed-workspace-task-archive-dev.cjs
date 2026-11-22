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
  // D04：憑證只存在 .tmp-check/test-credentials.json（key: archive_manager）。
  const creds = require("../tests/support/credentials.cjs"),
    email = "vue-workspace-archive-manager@example.test",
    saved = creds.loadCredentials().accounts.archive_manager;
  let account = saved && saved.password ? { id: saved.userId, email } : null;
  const users = ok(await db.auth.admin.listUsers({ perPage: 1000 })).users;
  let user = users.find((u) => u.email === email);
  if (!user) {
    const password = crypto.randomBytes(24).toString("base64url") + "aA1!";
    user = ok(
      await db.auth.admin.createUser({ email, password, email_confirm: true }),
    ).user;
    account = { id: user.id, email };
    creds.registerAccount("archive_manager", { email, password, userId: user.id });
  }
  if (!account || account.id !== user.id)
    throw Error("existing credentials missing; not resetting");
  ok(
    await db
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: "Vue 封存範圍測試主管",
        role: "manager",
        department: "Vue 測試部門",
      }),
  );
  const role = ok(
    await db
      .from("roles")
      .upsert(
        {
          code: "vue_workspace_archive_manager",
          name: "Vue 封存範圍測試",
          is_active: true,
          is_system: false,
        },
        { onConflict: "code" },
      )
      .select("id")
      .single(),
  );
  const perms = ok(
    await db
      .from("permissions")
      .select("id,code")
      .in("code", ["task.view_archived", "task.view_own"]),
  );
  if (perms.length !== 2) throw Error("missing permissions");
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
  ok(
    await db
      .from("user_roles")
      .upsert(
        { user_id: user.id, role_id: role.id, is_active: true },
        { onConflict: "user_id,role_id" },
      ),
  );
  const nav = creds.requireWorkspaceAccount("navigation");
  const actor = users.find((u) => u.email === nav.email).id;
  const templateId = crypto.randomUUID(),
    own = crypto.randomUUID(),
    foreign = crypto.randomUUID(),
    archivedBy = crypto.randomUUID();
  const title = "Vue 封存測試 " + own.slice(0, 8);
  const steps = [
    {
      id: "p",
      label: "Vue 封存主項",
      subSteps: [{ id: "s", label: "Vue 封存子項" }],
    },
  ];
  ok(
    await db
      .from("templates")
      .insert({
        id: templateId,
        title,
        description: "Vue 封存交易專用測試",
        created_by: actor,
        steps_schema: steps,
        sections: [
          {
            id: "one",
            department: "Vue 測試部門",
            assigned_users: [user.id],
            steps,
          },
        ],
      }),
  );
  const now = new Date().toISOString();
  ok(
    await db.from("assignments").insert(
      [
        { id: own, created_by: user.id, archived_by: actor },
        { id: foreign, created_by: actor, archived_by: actor },
        { id: archivedBy, created_by: actor, archived_by: user.id },
      ].map((r) => ({
        ...r,
        template_id: templateId,
        assigned_to: user.id,
        archived: true,
        archived_at: now,
        completed_at: now,
        status: "completed",
        department: "Vue 測試部門",
      })),
    ),
  );
  ok(
    await db
      .from("assignment_collaborators")
      .insert(
        [own, foreign, archivedBy].map((id) => ({
          assignment_id: id,
          user_id: user.id,
          section_id: "one",
        })),
      ),
  );
  ok(
    await db.from("logs").insert(
      [
        { step_id: "p", action: "complete", note: "完成主項" },
        { step_id: "s", action: "complete", note: "初次完成" },
        { step_id: "s", action: "uncomplete", note: null },
        { step_id: "s", action: "complete", note: "重新確認完成" },
      ].map((r, i) => ({
        ...r,
        assignment_id: own,
        user_id: user.id,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      })),
    ),
  );
  fs.writeFileSync(
    ".tmp-check/task-archive-fixture.json",
    JSON.stringify({
      own,
      foreign,
      archivedBy,
      templateId,
      title,
      manager: user.id,
    }),
  );
  console.log("Created scoped archive fixtures");
})();
