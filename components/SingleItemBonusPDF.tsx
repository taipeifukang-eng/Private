'use client';

import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface BonusData {
  employee_code: string;
  employee_name: string;
  bonus: number;
}

export async function generateSingleItemBonusPDF(
  bonusData: BonusData[],
  storeCode: string,
  storeName: string,
  yearMonth: string
) {
  // 創建隱藏的容器
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.width = '800px';
  container.style.backgroundColor = 'white';
  container.style.padding = '40px';
  document.body.appendChild(container);

  // 計算總計
  const total = bonusData.reduce((sum, item) => sum + item.bonus, 0);

  // 生成HTML內容
  container.innerHTML = `
    <div style="font-family: 'Microsoft JhengHei', Arial, sans-serif;">
      <h1 style="text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 20px;">
        ${storeCode} ${storeName} ${yearMonth.substring(0, 4)}年${yearMonth.substring(4)}月單品獎金
      </h1>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">員工編號</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">姓名</th>
            <th style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">單品獎金</th>
          </tr>
        </thead>
        <tbody>
          ${bonusData.map(item => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 10px;">${item.employee_code}</td>
              <td style="border: 1px solid #ddd; padding: 10px;">${item.employee_name}</td>
              <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">$${item.bonus.toLocaleString()}</td>
            </tr>
          `).join('')}
          <tr style="background-color: #f9fafb; font-weight: bold;">
            <td colspan="2" style="border: 1px solid #ddd; padding: 12px; text-align: right;">總計</td>
            <td style="border: 1px solid #ddd; padding: 12px; text-align: right;">$${total.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      
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
    const fileName = `${storeCode}_${yearMonth}_單品獎金.pdf`;
    pdf.save(fileName);

  } catch (error) {
    // 確保移除容器
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
    throw error;
  }
}
