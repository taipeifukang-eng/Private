// 檢查資料庫中有哪些月份的資料
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('錯誤：請設定環境變數');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  console.log('='.repeat(80));
  console.log('檢查 monthly_staff_status 表中的資料');
  console.log('='.repeat(80));
  console.log();

  try {
    // 查詢所有不同的年月
    const { data: months, error: monthError } = await supabase
      .from('monthly_staff_status')
      .select('year_month')
      .order('year_month');

    if (monthError) {
      console.error('❌ 查詢錯誤:', monthError.message);
      return;
    }

    if (!months || months.length === 0) {
      console.log('⚠️  資料庫中沒有任何 monthly_staff_status 資料');
      return;
    }

    // 統計每個月份
    const monthCounts = {};
    months.forEach(m => {
      const ym = m.year_month;
      monthCounts[ym] = (monthCounts[ym] || 0) + 1;
    });

    console.log('📊 資料庫中現有的月份資料：\n');
    Object.entries(monthCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([month, count]) => {
        console.log(`   ${month}: ${count} 筆記錄`);
      });

    console.log();
    console.log('='.repeat(80));

    // 如果有資料，顯示一些範例
    const firstMonth = Object.keys(monthCounts).sort()[0];
    if (firstMonth) {
      console.log(`\n📋 ${firstMonth} 的前 5 筆資料範例：\n`);
      
      const { data: samples, error: sampleError } = await supabase
        .from('monthly_staff_status')
        .select(`
          employee_code,
          employee_name,
          monthly_status,
          work_days,
          work_hours,
          stores!inner(store_name, store_code)
        `)
        .eq('year_month', firstMonth)
        .limit(5);

      if (!sampleError && samples) {
        samples.forEach((s, i) => {
          console.log(`${i + 1}. ${s.employee_name} (${s.employee_code || 'N/A'}) - ${s.stores.store_name}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ 發生錯誤:', error.message);
  }
}

checkData();
