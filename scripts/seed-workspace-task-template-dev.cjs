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
const ok = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
(async () => {
  const accounts = JSON.parse(
    fs.readFileSync(".tmp-check/workspace-accounts.json", "utf8"),
  ).accounts;
  const users = ok(await db.auth.admin.listUsers({ perPage: 1000 })).users;
  const people = {};
  for (const key of ["navigation", "editor", "viewer"]) {
    const a = accounts.find((a) => a.key === key),
      u = users.find((u) => u.email === a.email);
    if (!u || !u.email.endsWith("@example.test"))
      throw Error("not fixture account");
    ok(
      await db
        .from("profiles")
        .update({ department: "Vue 範本測試" })
        .eq("id", u.id),
    );
    people[key] = u.id;
  }
  fs.writeFileSync(
    ".tmp-check/task-template-people.json",
    JSON.stringify(people),
  );
  console.log("Prepared namespaced template user departments");
})();
