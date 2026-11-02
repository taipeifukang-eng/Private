const fs=require('fs');require('@next/env').loadEnvConfig(process.cwd(),true);const {createClient}=require('@supabase/supabase-js');
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='mjpdfpxqttbhzeimmtqr.supabase.co'||process.env.ALLOW_DEV_DATABASE_OPERATIONS!=='true')throw Error('DEV guard');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const tables=['monthly_store_summary','monthly_staff_status','support_staff_bonus','talent_cultivation_bonus','spring_festival_bonus','meal_allowance_records'];
(async()=>{if(process.argv[2]==='check'){for(const table of tables){const r=await db.from(table).select('id').eq('year_month','2099-11');if(r.error||r.data.length)throw Error('Fixture month is not empty: '+table);}console.log('Reserved test month is empty');}
else if(process.argv[2]==='clean'){const stores=await db.from('stores').select('id').eq('store_code','0002');if(stores.error||stores.data.length!==1)throw Error('store');const store=stores.data[0].id;
for(const table of [...tables].reverse()){const r=await db.from(table).delete().eq('year_month','2099-11').eq('store_id',store);if(r.error)throw Error(r.error.message);}console.log('Temporary monthly fixtures removed');}
})();
