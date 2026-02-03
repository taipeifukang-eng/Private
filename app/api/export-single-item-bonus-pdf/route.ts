import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsPDF } from 'jspdf';

/**
 * 匯出門市單品獎金 PDF
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查權限（店長以上）
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, job_title')
      .eq('id', user.id)
      .single();

    const isStoreManager = ['店長', '代理店長', '督導', '督導(代理店長)'].includes(profile?.job_title || '');
    const hasPermission = ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '') || isStoreManager;

    if (!hasPermission) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { year_month, store_id } = body;

    if (!year_month || !store_id) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 查詢門市資訊
    const { data: store } = await supabase
      .from('stores')
      .select('store_code, store_name')
      .eq('id', store_id)
      .single();

    if (!store) {
      return NextResponse.json({ error: '找不到門市' }, { status: 404 });
    }

    // 查詢該門市該月份有單品獎金的員工
    const { data: staffData, error } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, last_month_single_item_bonus')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('last_month_single_item_bonus', 'is', null)
      .order('employee_code');

    if (error) {
      console.error('Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 創建 PDF
    const doc = new jsPDF();
    
    // 標題
    doc.setFontSize(18);
    doc.text('Single Item Bonus List', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Store: ${store.store_code} ${store.store_name}`, 105, 30, { align: 'center' });
    doc.text(`Month: ${year_month}`, 105, 37, { align: 'center' });

    // 表格標題
    const startY = 50;
    const lineHeight = 10;
    let currentY = startY;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Employee Code', 20, currentY);
    doc.text('Name', 70, currentY);
    doc.text('Bonus', 140, currentY, { align: 'right' });
    
    // 表頭線
    currentY += 2;
    doc.line(20, currentY, 190, currentY);
    currentY += 8;

    // 數據行
    doc.setFont('helvetica', 'normal');
    let totalBonus = 0;

    staffData.forEach((staff: any) => {
      const bonus = staff.last_month_single_item_bonus || 0;
      totalBonus += bonus;

      // 檢查是否需要換頁
      if (currentY > 270) {
        doc.addPage();
        currentY = 20;
      }

      doc.text(staff.employee_code || '-', 20, currentY);
      doc.text(staff.employee_name || '-', 70, currentY);
      doc.text(`$${bonus.toLocaleString()}`, 140, currentY, { align: 'right' });

      currentY += lineHeight;
    });

    // 總計
    currentY += 5;
    doc.line(20, currentY, 190, currentY);
    currentY += 8;
    
    doc.setFont('helvetica', 'bold');
    doc.text('Total', 20, currentY);
    doc.text(`$${totalBonus.toLocaleString()}`, 140, currentY, { align: 'right' });

    // 生成 PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // 設定檔名
    const filename = `${store.store_code}_${year_month}_single_item_bonus.pdf`;

    // 回傳 PDF
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });

  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json({ 
      error: error.message || '匯出失敗' 
    }, { status: 500 });
  }
}
