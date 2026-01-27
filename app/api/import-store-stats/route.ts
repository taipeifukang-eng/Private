import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

// 配置 API Route
export const runtime = 'nodejs'; // 使用 Node.js runtime
export const maxDuration = 60; // 最大執行時間 60 秒

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查用戶權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('取得用戶資料失敗:', profileError);
      return NextResponse.json({ 
        error: '無法取得用戶資料',
        details: profileError?.message 
      }, { status: 403 });
    }

    // 權限檢查：admin, supervisor, area_manager 或營業部人員（member 或 manager 角色）
    const isAuthorized = 
      ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '') ||
      (profile?.department?.startsWith('營業') && (profile?.role === 'member' || profile?.role === 'manager'));

    if (!isAuthorized) {
      console.log('權限不足:', { role: profile.role, department: profile.department, job_title: profile.job_title });
      return NextResponse.json({ 
        error: '權限不足',
        details: '只有督導以上或營業部人員可以匯入統計資料',
        userInfo: {
          role: profile.role,
          department: profile.department,
          job_title: profile.job_title
        }
      }, { status: 403 });
    }

    // 解析表單數據
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const yearMonth = formData.get('yearMonth') as string;

    if (!file || !yearMonth) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 讀取 Excel 檔案
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet) as any[];

    console.log('📊 匯入門市統計資料:', {
      yearMonth,
      totalRows: data.length,
      sampleRow: data[0]
    });

    // 處理每一列數據
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const row of data) {
      try {
        const storeCode = row['門市代號']?.toString().trim();
        
        if (!storeCode) {
          results.errors.push(`跳過空門市代號的列`);
          results.failed++;
          continue;
        }

        // 查詢門市 ID - 先精確匹配，若找不到則模糊匹配（如 0023 → 0023B）
        let { data: store } = await supabase
          .from('stores')
          .select('id, store_code')
          .eq('store_code', storeCode)
          .single();

        // 如果精確匹配找不到，嘗試模糊匹配（store_code LIKE '0023%'）
        if (!store) {
          const { data: stores } = await supabase
            .from('stores')
            .select('id, store_code')
            .ilike('store_code', `${storeCode}%`)
            .limit(1);
          
          if (stores && stores.length > 0) {
            store = stores[0];
            console.log(`✓ 門市代號映射: ${storeCode} → ${store.store_code}`);
          }
        }

        if (!store) {
          results.errors.push(`找不到門市: ${storeCode}`);
          results.failed++;
          continue;
        }

        // 先獲取門市的完整信息
        const { data: storeInfo } = await supabase
          .from('stores')
          .select('*')
          .eq('id', store.id)
          .single();

        // 準備更新數據（只更新統計欄位，不影響其他欄位）
        const statsData = {
          store_name: storeInfo?.store_name || store.store_code,
          store_code: store.store_code,
          total_staff_count: parseInt(row['門市人數']) || 0,
          admin_staff_count: parseInt(row['行政人數']) || 0,
          newbie_count: parseInt(row['新人人數']) || 0,
          business_days: parseInt(row['營業天數']) || 0,
          total_gross_profit: parseFloat(row['毛利']) || 0,
          total_customer_count: parseInt(row['總來客數']) || 0,
          prescription_addon_only_count: parseInt(row['單純處方加購來客數']) || 0,
          regular_prescription_count: parseInt(row['一般箋張數']) || 0,
          chronic_prescription_count: parseInt(row['慢箋張數']) || 0
        };

        // 檢查是否已存在記錄
        const { data: existing, error: existingError } = await supabase
          .from('monthly_store_summary')
          .select('id')
          .eq('year_month', yearMonth)
          .eq('store_id', store.id)
          .maybeSingle();

        if (existingError) {
          console.error('查詢記錄錯誤:', existingError);
          results.errors.push(`查詢失敗 ${store.store_code}: ${existingError.message}`);
          results.failed++;
          continue;
        }

        if (existing) {
          // 更新現有記錄
          const { error: updateError } = await supabase
            .from('monthly_store_summary')
            .update(statsData)
            .eq('id', existing.id);

          if (updateError) {
            console.error('更新錯誤:', updateError);
            // 特別檢查欄位不存在的錯誤
            if (updateError.message.includes('column') && updateError.message.includes('does not exist')) {
              results.errors.push(`資料庫欄位不存在，請先執行 migration_add_store_monthly_stats.sql`);
            } else {
              results.errors.push(`更新失敗 ${store.store_code}: ${updateError.message}`);
            }
            results.failed++;
          } else {
            console.log(`✓ 更新成功: ${store.store_code}`);
            results.success++;
          }
        } else {
          // 創建新記錄（獲取該門市該月的員工數）
          const { count: staffCount } = await supabase
            .from('monthly_staff_status')
            .select('id', { count: 'exact', head: true })
            .eq('year_month', yearMonth)
            .eq('store_id', store.id);

          const { error: insertError } = await supabase
            .from('monthly_store_summary')
            .insert({
              year_month: yearMonth,
              store_id: store.id,
              total_employees: staffCount || 0,
              confirmed_count: 0,
              store_status: 'pending',
              ...statsData
            });

          if (insertError) {
            console.error('新增錯誤:', insertError);
            // 特別檢查欄位不存在的錯誤
            if (insertError.message.includes('column') && insertError.message.includes('does not exist')) {
              results.errors.push(`資料庫欄位不存在，請先執行 migration_add_store_monthly_stats.sql`);
            } else {
              results.errors.push(`新增失敗 ${store.store_code}: ${insertError.message}`);
            }
            results.failed++;
          } else {
            console.log(`✓ 新增成功: ${store.store_code}`);
            results.success++;
          }
        }
      } catch (error: any) {
        console.error('處理列錯誤:', error);
        results.errors.push(`處理失敗: ${error.message}`);
        results.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功匯入 ${results.success} 筆，失敗 ${results.failed} 筆`,
      details: results
    });

  } catch (error: any) {
    console.error('匯入門市統計資料錯誤:', error);
    return NextResponse.json(
      { error: error.message || '匯入失敗' },
      { status: 500 }
    );
  }
}
