// Only creates namespaced fake data in the allowlisted DEV project.
const fs = require("fs");
const crypto = require("crypto");
require("@next/env").loadEnvConfig(process.cwd(), true);
const { createClient } = require("@supabase/supabase-js");
const e = process.env;
if (
  new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname !==
    "mjpdfpxqttbhzeimmtqr.supabase.co" ||
  e.EXPECTED_SUPABASE_PROJECT_REF !== "mjpdfpxqttbhzeimmtqr" ||
  e.ALLOW_DEV_DATABASE_OPERATIONS !== "true"
)
  throw Error("DEV mismatch");
const db = createClient(
  e.NEXT_PUBLIC_SUPABASE_URL,
  e.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
function ok(r) {
  if (r.error) throw Error("DEV seed operation failed: " + r.error.code);
  return r.data;
}
async function main() {
  const definitions = [
    [
      "editor",
      "工作台測試編輯員",
      [
        "inspection.view_all",
        "inspection.manager_tab",
        "activity.campaign.view_all",
        "activity.campaign.edit",
      ],
    ],
    [
      "viewer",
      "工作台單店檢視員",
      ["inspection.view_store", "activity.campaign.view"],
    ],
    ["denied", "工作台無權限測試員", []],
  ];
  const permRows = ok(
    await db
      .from("permissions")
      .select("id,code")
      .in("code", [...new Set(definitions.flatMap((d) => d[2]))]),
  );
  const wanted = [...new Set(definitions.flatMap((d) => d[2]))];
  if (wanted.some((c) => !permRows.some((p) => p.code === c)))
    throw Error("Missing permission definitions");
  const stores = [];
  for (const [code, name] of [
    ["VW001", "Vue 測試一店"],
    ["VW002", "Vue 測試二店"],
  ]) {
    stores.push(
      ok(
        await db
          .from("stores")
          .upsert(
            { store_code: code, store_name: name, is_active: true },
            { onConflict: "store_code" },
          )
          .select("id,store_code,store_name")
          .single(),
      ),
    );
  }
  fs.mkdirSync(".tmp-check", { recursive: true });
  const file = ".tmp-check/workspace-accounts.json";
  const saved = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { accounts: [] };
  const users = ok(await db.auth.admin.listUsers({ perPage: 1000 })).users;
  const accounts = [];
  for (const [key, name, codes] of definitions) {
    const email = `vue-workspace-${key}@example.test`;
    let account = saved.accounts.find((a) => a.email === email),
      user = users.find((u) => u.email === email);
    if (!user) {
      const password = crypto.randomBytes(24).toString("base64url") + "aA1!";
      user = ok(
        await db.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: name },
        }),
      ).user;
      account = { key, email, password, id: user.id };
      saved.accounts.push(account);
      fs.writeFileSync(file, JSON.stringify(saved, null, 2));
    }
    if (!account)
      throw Error(
        "Existing test user has no locally saved credential; do not reset automatically",
      );
    ok(
      await db
        .from("profiles")
        .upsert({ id: user.id, email, full_name: name, role: "member" }),
    );
    const role = ok(
      await db
        .from("roles")
        .upsert(
          {
            code: `vue_workspace_${key}`,
            name,
            is_active: true,
            is_system: false,
          },
          { onConflict: "code" },
        )
        .select("id")
        .single(),
    );
    if (codes.length)
      ok(
        await db.from("role_permissions").upsert(
          codes.map((code) => ({
            role_id: role.id,
            permission_id: permRows.find((p) => p.code === code).id,
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
    if (key === "viewer") {
      const exists = ok(
        await db
          .from("store_managers")
          .select("id")
          .eq("user_id", user.id)
          .eq("store_id", stores[0].id),
      );
      if (!exists.length)
        ok(
          await db
            .from("store_managers")
            .insert({
              user_id: user.id,
              store_id: stores[0].id,
              role_type: "store_manager",
            }),
        );
    }
    accounts.push(account);
  }
  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  for (let i = 0; i < stores.length; i++) {
    const num = `VW-INS-${i + 1}`;
    const found = ok(
      await db.from("inspection_masters").select("id").eq("inspection_no", num),
    );
    if (!found.length)
      ok(
        await db
          .from("inspection_masters")
          .insert({
            store_id: stores[i].id,
            inspector_id: accounts[0].id,
            created_by: accounts[0].id,
            inspection_date: now + "-15",
            inspection_type: "supervisor",
            inspection_no: num,
            status: i ? "draft" : "completed",
            total_score: i ? 0 : 180,
            max_possible_score: 220,
          }),
      );
  }
  const campaignName = "[Vue 測試] 門市營運活動";
  let campaigns = ok(
    await db.from("campaigns").select("id").eq("name", campaignName),
  );
  if (!campaigns.length)
    campaigns = ok(
      await db
        .from("campaigns")
        .insert({
          name: campaignName,
          start_date: now + "-01",
          end_date: now + "-28",
          campaign_type: "promotion",
          is_active: true,
          created_by: accounts[0].id,
        })
        .select("id"),
    );
  fs.writeFileSync(
    file,
    JSON.stringify(
      { accounts, stores, campaignId: campaigns[0].id, month: now },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    ".tmp-check/測試登入資料.txt",
    accounts
      .map((a) => `${a.key}\n帳號：${a.email}\n密碼：${a.password}\n`)
      .join("\n"),
  );
  console.log(
    "DEV-only sample data ready. Credentials saved locally in .tmp-check; no credentials printed.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
