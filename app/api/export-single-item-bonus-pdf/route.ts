import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * 匯出門市單品獎金 PDF（包含一般員工和支援人員）
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

    // 1. 查詢該門市該月份有單品獎金的一般員工
    const { data: staffData } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, last_month_single_item_bonus')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('last_month_single_item_bonus', 'is', null)
      .gt('last_month_single_item_bonus', 0)
      .order('employee_code');

    // 2. 查詢支援人員單品獎金
    const { data: supportData } = await supabase
      .from('support_staff_bonus')
      .select('employee_code, employee_name, bonus_amount')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .gt('bonus_amount', 0)
      .order('employee_code');

    // 合併數據
    const allStaff = [
      ...(staffData || []).map(s => ({
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        bonus: s.last_month_single_item_bonus
      })),
      ...(supportData || []).map(s => ({
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        bonus: s.bonus_amount
      }))
    ];

    // 按員工編號排序
    allStaff.sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));

    // 創建 PDF
    const doc = new jsPDF() as any;
    
    // 標題
    doc.setFontSize(16);
    doc.text('單品獎金清單', 105, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.text(`門市：${store.store_code} - ${store.store_name}`, 105, 23, { align: 'center' });
    doc.text(`月份：${year_month}`, 105, 30, { align: 'center' });

    // 準備表格數據
    const tableData = allStaff.map((staff: any) => [
      staff.employee_code || '-',
      staff.employee_name || '-',
      `$${(staff.bonus || 0).toLocaleString()}`
    ]);

    // 計算總計
    const totalBonus = allStaff.reduce((sum, staff) => sum + (staff.bonus || 0), 0);

    // 使用 autoTable 繪製表格（支援中文）
    autoTable(doc, {
      startY: 35,
      head: [['員工編號', '姓名', '單品獎金']],
      body: tableData,
      foot: [['總計', '', `$${totalBonus.toLocaleString()}`]],
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 10,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [66, 139, 202],
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center'
      },
      footStyles: {
        fillColor: [240, 240, 240],
        textColor: 0,
        fontStyle: 'bold',
        halign: 'left'
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 50 },
        1: { halign: 'left', cellWidth: 80 },
        2: { halign: 'right', cellWidth: 'auto' }
      },
      didParseCell: function(data: any) {
        // 確保中文正確顯示
        if (data.cell.text && Array.isArray(data.cell.text)) {
          data.cell.text = data.cell.text.map((text: string) => {
            // 使用 escape 方法確保中文字符正確編碼
            return text;
          });
        }
      }
    });

    // 生成 PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // 設定檔名
    const filename = `${store.store_code}_${year_month}_單品獎金.pdf`;
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
