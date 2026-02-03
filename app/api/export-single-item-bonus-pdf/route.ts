import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

// 動態導入 pdfmake
const PdfPrinter = require('pdfmake');

// 定義字體（使用內建字體）
const fonts: TFontDictionary = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

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

    // 計算總計
    const totalBonus = allStaff.reduce((sum, staff) => sum + (staff.bonus || 0), 0);

    // 準備表格數據
    const tableBody = allStaff.map((staff: any) => [
      staff.employee_code || '-',
      staff.employee_name || '-',
      `$${(staff.bonus || 0).toLocaleString()}`
    ]);

    // 添加總計行
    tableBody.push([
      { text: '總計', bold: true },
      '',
      { text: `$${totalBonus.toLocaleString()}`, bold: true }
    ]);

    // 定義 PDF 文檔結構
    const docDefinition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      content: [
        {
          text: '單品獎金清單',
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 10]
        },
        {
          text: `門市：${store.store_code} - ${store.store_name}`,
          style: 'subheader',
          alignment: 'center',
          margin: [0, 0, 0, 5]
        },
        {
          text: `月份：${year_month}`,
          style: 'subheader',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          table: {
            headerRows: 1,
            widths: [100, '*', 100],
            body: [
              [
                { text: '員工編號', style: 'tableHeader' },
                { text: '姓名', style: 'tableHeader' },
                { text: '單品獎金', style: 'tableHeader', alignment: 'right' }
              ],
              ...tableBody.map(row => {
                if (typeof row[0] === 'object' && 'bold' in row[0]) {
                  // 總計行
                  return [
                    { text: row[0].text, bold: true },
                    row[1],
                    { text: row[2].text, bold: true, alignment: 'right' }
                  ];
                }
                // 一般數據行
                return [
                  row[0],
                  row[1],
                  { text: row[2], alignment: 'right' }
                ];
              })
            ]
          },
          layout: {
            fillColor: (rowIndex: number) => {
              if (rowIndex === 0) return '#428bca';
              if (rowIndex === tableBody.length) return '#f0f0f0';
              return null;
            },
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#cccccc',
            vLineColor: () => '#cccccc'
          }
        }
      ],
      styles: {
        header: {
          fontSize: 18,
          bold: true
        },
        subheader: {
          fontSize: 12
        },
        tableHeader: {
          bold: true,
          fontSize: 11,
          color: 'white',
          alignment: 'center'
        }
      },
      defaultStyle: {
        fontSize: 10
      }
    };

    // 創建 PDF
    const printer = new PdfPrinter(fonts);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);

    // 收集 PDF 數據
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => {});
    pdfDoc.end();

    // 等待 PDF 完成
    await new Promise((resolve) => {
      pdfDoc.on('end', resolve);
    });

    // 合併所有 chunks
    const pdfBuffer = Buffer.concat(chunks);

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
