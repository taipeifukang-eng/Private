const fs = require('fs');
require('@next/env').loadEnvConfig(process.cwd(), true);
const { createClient } = require('@supabase/supabase-js');
const e = process.env;
if (new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'mjpdfpxqttbhzeimmtqr.supabase.co' || e.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') throw Error('DEV guard');
const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const check = r => { if (r.error) throw r.error; return r.data; };
(async () => {
  const f = JSON.parse(fs.readFileSync('.tmp-check/store-employees-fixture.json', 'utf8'));
  const s = check(await db.from('stores').select('id,store_code,store_name').eq('id', f.id).single());
  if (s.store_code !== f.store_code || !/^VWEMP\d+$/.test(s.store_code) || s.store_name !== 'Vue 門市員工分頁驗證') throw Error('Fixture identity mismatch');
  check(await db.from('stores').delete().eq('id', s.id));
  const remaining = await db.from('monthly_staff_status').select('id', { count: 'exact', head: true }).eq('store_id', s.id);
  check(remaining);
  if (remaining.count !== 0) throw Error('Fixture rows remain');
  console.log('Isolated DEV store and employee fixture removed; zero monthly rows remain');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
