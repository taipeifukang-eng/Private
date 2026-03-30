'use client';

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface BonusData {
  employee_code: string;
  employee_name: string;
  source_notes: string[];
  single_item_bonus: number;
  meal_allowance_amount: number;
  meal_allowance_details: string[];
  transport_expense: number;
  transport_notes: string[];
  talent_cultivation_bonus: number;
  talent_cultivation_targets: string[];
  spring_festival_bonus: number;
  spring_festival_details: string[];
}

interface VisibleColumns {
  single_item_bonus: boolean;
  meal_allowance: boolean;
  transport_expense: boolean;
  talent_cultivation_bonus: boolean;
  spring_festival_bonus: boolean;
}

export async function generateSingleItemBonusPDF(
  bonusData: BonusData[],
  storeCode: string,
  storeName: string,
  yearMonth: string,
  visibleColumns: VisibleColumns
) {
  // 創建隱藏的容器
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.width = '800px';
  container.style.backgroundColor = 'white';
  container.style.padding = '40px';
  document.body.appendChild(container);

  const yearMonthLabel = `${yearMonth.substring(0, 4)}年${yearMonth.substring(5, 7)}月`;
  const columnCount = 2 + Object.values(visibleColumns).filter(Boolean).length;

  const formatCurrency = (amount: number) => `NT$${amount.toLocaleString()}`;
  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const totals = bonusData.reduce((sum, item) => ({
    singleItem: sum.singleItem + item.single_item_bonus,
    mealAllowance: sum.mealAllowance + item.meal_allowance_amount,
    transport: sum.transport + item.transport_expense,
    talent: sum.talent + item.talent_cultivation_bonus,
    springFestival: sum.springFestival + item.spring_festival_bonus,
  }), {
    singleItem: 0,
    mealAllowance: 0,
    transport: 0,
    talent: 0,
    springFestival: 0,
  });

  const renderMultiline = (lines: string[]) => lines
    .map(line => `<div style="margin-top:2px;font-size:11px;color:#6b7280;">${escapeHtml(line)}</div>`)
    .join('');

  const renderNameCell = (item: BonusData) => {
    const badges = item.source_notes.includes('支援同仁')
      ? `<span style="display:inline-block;margin-left:6px;font-size:10px;color:#7c3aed;background:#ede9fe;border-radius:4px;padding:1px 6px;">支援同仁</span>`
      : '';
    const notes = item.source_notes.filter(note => note !== '支援同仁');

    return `
      ${escapeHtml(item.employee_name)}
      ${badges}
      ${renderMultiline(notes)}
    `;
  };

  const renderCell = (content: string, align: 'left' | 'right' = 'right') => `
    <td style="border: 1px solid #ddd; padding: 10px; text-align: ${align}; vertical-align: top;">
      ${content || '-'}
    </td>
  `;

  // 生成HTML內容
  container.innerHTML = `
    <div style="font-family: 'Microsoft JhengHei', Arial, sans-serif;">
      <h1 style="text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 20px;">
        ${storeCode} ${storeName} ${yearMonthLabel} 獎金／津貼
      </h1>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">員工編號</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">姓名</th>
            ${visibleColumns.single_item_bonus ? '<th style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">單品獎金</th>' : ''}
            ${visibleColumns.meal_allowance ? '<th style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">誤餐費</th>' : ''}
            ${visibleColumns.transport_expense ? '<th style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">交通費用</th>' : ''}
            ${visibleColumns.talent_cultivation_bonus ? '<th style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">育才津貼</th>' : ''}
            ${visibleColumns.spring_festival_bonus ? '<th style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">春節出勤獎金</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${bonusData.map(item => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 10px; vertical-align: top;">${escapeHtml(item.employee_code)}</td>
              <td style="border: 1px solid #ddd; padding: 10px;">
                ${renderNameCell(item)}
              </td>
              ${visibleColumns.single_item_bonus ? renderCell(item.single_item_bonus > 0 ? formatCurrency(item.single_item_bonus) : '') : ''}
              ${visibleColumns.meal_allowance ? renderCell(item.meal_allowance_amount > 0 ? `${formatCurrency(item.meal_allowance_amount)}${renderMultiline(item.meal_allowance_details)}` : '') : ''}
              ${visibleColumns.transport_expense ? renderCell(item.transport_expense > 0 ? `${formatCurrency(item.transport_expense)}${renderMultiline(item.transport_notes)}` : '') : ''}
              ${visibleColumns.talent_cultivation_bonus ? renderCell(item.talent_cultivation_bonus > 0 ? `${formatCurrency(item.talent_cultivation_bonus)}${renderMultiline(item.talent_cultivation_targets)}` : '') : ''}
              ${visibleColumns.spring_festival_bonus ? renderCell(item.spring_festival_bonus > 0 ? `${formatCurrency(item.spring_festival_bonus)}${renderMultiline(item.spring_festival_details)}` : '') : ''}
            </tr>
          `).join('')}
          <tr style="background-color: #f9fafb; font-weight: bold;">
            <td colspan="2" style="border: 1px solid #ddd; padding: 12px; text-align: right;">總計</td>
            ${visibleColumns.single_item_bonus ? `<td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${formatCurrency(totals.singleItem)}</td>` : ''}
            ${visibleColumns.meal_allowance ? `<td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${formatCurrency(totals.mealAllowance)}</td>` : ''}
            ${visibleColumns.transport_expense ? `<td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${formatCurrency(totals.transport)}</td>` : ''}
            ${visibleColumns.talent_cultivation_bonus ? `<td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${formatCurrency(totals.talent)}</td>` : ''}
            ${visibleColumns.spring_festival_bonus ? `<td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${formatCurrency(totals.springFestival)}</td>` : ''}
          </tr>
        </tbody>
      </table>

      <div style="margin-top: 12px; font-size: 12px; color: #6b7280; line-height: 1.6;">
        說明：誤餐費依登記筆數計算，藥師每筆 200 元、非藥師每筆 100 元；未登記的獎金／津貼欄位不顯示。
      </div>
      
      <div style="margin-top: 30px; text-align: right; font-size: 12px; color: #6b7280;">
        列印日期: ${new Date().toLocaleDateString('zh-TW')}
      </div>
    </div>
  `;

  // 等待渲染
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    // 使用 html2canvas 轉換為圖片
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    // 移除容器
    document.body.removeChild(container);

    // 創建 PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = canvas.toDataURL('image/png');
    
    // 計算適合的尺寸
    const pdfWidth = pdf.internal.pageSize.getWidth() - 20;
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    const pageHeight = pdf.internal.pageSize.getHeight();

    let heightLeft = pdfHeight;
    let position = 10;

    // 添加第一頁
    pdf.addImage(imgData, 'PNG', 10, position, pdfWidth, pdfHeight);
    heightLeft -= pageHeight;

    // 如果內容超過一頁，添加新頁
    while (heightLeft > 0) {
      position = heightLeft - pdfHeight + 10;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
    }

    // 下載 PDF
    const fileName = `${storeCode}_${yearMonth}_獎金津貼.pdf`;
    pdf.save(fileName);

  } catch (error) {
    // 確保移除容器
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
    throw error;
  }
}
