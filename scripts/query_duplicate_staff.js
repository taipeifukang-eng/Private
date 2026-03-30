// 查詢 1~2 月重複列到的人員
const { createClient } = require('@supabase/supabase-js');

// 從環境變數讀取 Supabase 連線資訊
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('錯誤：請設定環境變數 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function queryDuplicateStaff() {
  console.log('='.repeat(80));
  console.log('查詢每月人員狀態中重複列到的人員');
  console.log('='.repeat(80));
  console.log();

  // 先查詢資料庫中有哪些月份的資料
  try {
    const { data: allData, error: allError } = await supabase
      .from('monthly_staff_status')
      .select('year_month')
      .order('year_month');

    if (allError) {
      console.error('❌ 查詢失敗:', allError.message);
      return;
    }

    if (!allData || allData.length === 0) {
      console.log('⚠️  資料庫中目前沒有任何 monthly_staff_status 資料');
      console.log('');
      console.log('💡 提示：請先在「每月人員狀態確認」頁面：');
      console.log('   1. 選擇年月（例如：2026年1月）');
      console.log('   2. 點擊「初始化本月資料」按鈕');
      console.log('   3. 重新執行此查詢腳本');
      console.log('='.repeat(80));
      return;
    }

    // 統計月份
    const monthCounts = {};
    allData.forEach(row => {
      const ym = row.year_month;
      monthCounts[ym] = (monthCounts[ym] || 0) + 1;
    });

    console.log('📊 資料庫中現有的月份：\n');
    const months = Object.keys(monthCounts).sort();
    months.forEach(month => {
      console.log(`   ${month}: ${monthCounts[month]} 筆記錄`);
    });
    console.log('\n' + '='.repeat(80));

    // 檢查指定的 1~2 月
    const targetMonths = ['2026-01', '2026-02'];
    const availableTargets = targetMonths.filter(m => monthCounts[m]);

    if (availableTargets.length === 0) {
      console.log('\n⚠️  2026年 1~2月 尚無資料');
      console.log('='.repeat(80));
      return;
    }

    // 針對每個可用的月份查詢重複人員
    for (const targetMonth of availableTargets) {
      await checkDuplicatesForMonth(targetMonth);
    }

  } catch (error) {
    console.error('❌ 發生錯誤:', error.message);
  }
}

async function checkDuplicatesForMonth(targetMonth) {
  console.log(`\n📅 ${targetMonth} 重複人員檢查：`);
  console.log('-'.repeat(80));

  try {
    const { data: monthData, error: monthError } = await supabase
      .from('monthly_staff_status')
      .select(`
        user_id,
        employee_code,
        employee_name,
        monthly_status,
        work_days,
        work_hours,
        position,
        employment_type,
        store_id,
        stores!inner(store_name, store_code)
      `)
      .eq('year_month', targetMonth)
      .order('employee_code')
      .order('stores(store_name)');

    if (monthError) {
      console.error(`❌ ${targetMonth} 查詢錯誤:`, monthError.message);
      return;
    }

    if (!monthData || monthData.length === 0) {
      console.log(`⚠️  ${targetMonth} 沒有任何人員資料`);
      return;
    }

    console.log(`📊 ${targetMonth} 總共有 ${monthData.length} 筆記錄\n`);

    // 按 user_id 分組來找重複
    const userGroups = {};
    monthData.forEach(record => {
      const key = record.user_id;
      if (!userGroups[key]) {
        userGroups[key] = [];
      }
      userGroups[key].push(record);
    });

    let found = false;
    let duplicateCount = 0;

    Object.entries(userGroups).forEach(([userId, records]) => {
      // 檢查是否有不同的 store_id
      const storeIds = [...new Set(records.map(r => r.store_id))];

      if (storeIds.length > 1) {
        found = true;
        duplicateCount++;
        const firstRecord = records[0];
        console.log(`\n🔴 重複人員 #${duplicateCount}:`);
        console.log(`   員編: ${firstRecord.employee_code || 'N/A'}`);
        console.log(`   姓名: ${firstRecord.employee_name}`);
        console.log(`   出現在 ${storeIds.length} 個門市:\n`);

        records.forEach(r => {
          const 天數時數 = r.employment_type === 'full_time'
            ? `${r.work_days || 0}天`
            : `${r.work_hours || 0}時`;
          
          console.log(`      • ${r.stores.store_name} (${r.stores.store_code})`);
          console.log(`        本月狀態: ${r.monthly_status}`);
          console.log(`        ${r.employment_type === 'full_time' ? '工作天數' : '工作時數'}: ${天數時數}`);
          console.log(`        職位: ${r.position || 'N/A'}`);
          console.log('');
        });
      }
    });

    if (!found) {
      console.log(`✅ ${targetMonth} 沒有發現重複人員（每位員工只在一個門市）`);
    } else {
      console.log(`⚠️  ${targetMonth} 發現 ${duplicateCount} 位重複人員`);
    }

    console.log('='.repeat(80));
  } catch (error) {
    console.error(`❌ ${targetMonth} 發生錯誤:`, error.message);
  }
}

queryDuplicateStaff();
