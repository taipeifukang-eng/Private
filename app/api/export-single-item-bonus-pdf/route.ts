import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

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
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // 收集 PDF 數據
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    // 標題
    doc.fontSize(18).font('Helvetica-Bold').text('單品獎金清單', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text(`門市：${store.store_code} ${store.store_name}`, { align: 'center' });
    doc.text(`月份：${year_month}`, { align: 'center' });
    doc.moveDown(1);

    // 表格標題
    const tableTop = doc.y;
    const colWidths = { code: 100, name: 100, bonus: 150 };
    const startX = 50;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('員編', startX, tableTop, { width: colWidths.code, align: 'left' });
    doc.text('姓名', startX + colWidths.code, tableTop, { width: colWidths.name, align: 'left' });
    doc.text('單品獎金', startX + colWidths.code + colWidths.name, tableTop, { width: colWidths.bonus, align: 'right' });

    // 繪製表頭下方線
    doc.moveTo(startX, tableTop + 15)
       .lineTo(startX + colWidths.code + colWidths.name + colWidths.bonus, tableTop + 15)
       .stroke();

    // 數據行
    let yPosition = tableTop + 25;
    let totalBonus = 0;

    doc.font('Helvetica');
    staffData.forEach((staff: any) => {
      const bonus = staff.last_month_single_item_bonus || 0;
      totalBonus += bonus;

      // 檢查是否需要換頁
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }

      doc.text(staff.employee_code || '-', startX, yPosition, { width: colWidths.code, align: 'left' });
      doc.text(staff.employee_name || '-', startX + colWidths.code, yPosition, { width: colWidths.name, align: 'left' });
      doc.text(`$${bonus.toLocaleString()}`, startX + colWidths.code + colWidths.name, yPosition, { width: colWidths.bonus, align: 'right' });

      yPosition += 20;
    });

    // 總計
    yPosition += 10;
    doc.moveTo(startX, yPosition)
       .lineTo(startX + colWidths.code + colWidths.name + colWidths.bonus, yPosition)
       .stroke();
    
    yPosition += 15;
    doc.font('Helvetica-Bold');
    doc.text('總計', startX, yPosition, { width: colWidths.code + colWidths.name, align: 'left' });
    doc.text(`$${totalBonus.toLocaleString()}`, startX + colWidths.code + colWidths.name, yPosition, { width: colWidths.bonus, align: 'right' });

    // 結束文檔
    doc.end();

    // 等待 PDF 完成
    await new Promise((resolve) => {
      doc.on('end', resolve);
    });

    // 合併所有 chunks
    const pdfBuffer = Buffer.concat(chunks);

    // 設定檔名
    const filename = `單品獎金_${store.store_code}_${year_month}.pdf`;
    const encodedFilename = encodeURIComponent(filename);

    // 回傳 PDF
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`
      }
    });

  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json({ 
      error: error.message || '匯出失敗' 
    }, { status: 500 });
  }
}
