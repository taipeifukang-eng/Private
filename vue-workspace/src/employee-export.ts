import * as XLSX from 'xlsx';

// Export the complete filtered snapshot, including rows outside the visible page.
export function employeeWorkbook(rows: Array<{
  employee_code: string; employee_name: string; current_position?: string | null;
  status_label: string; start_date?: string | null; birthday?: string | null;
}>) {
  return textWorkbook([
    ['員編','姓名','當前職位','狀態','到職日','生日'],
    ...rows.map(e=>[e.employee_code,e.employee_name,e.current_position||'',e.status_label,e.start_date||'',e.birthday||''].map(String)),
  ],'員工篩選結果',[14,20,20,16,16,16]);
}

export function movementWorkbook(rows:Array<{
  employee_code:string;employee_name:string;store?:{store_name?:string}|null;
  type_label:string;movement_type:string;onboarding_is_pharmacist?:boolean|null;
  old_value?:string|null;new_label?:string|null;movement_date:string;display_notes?:string|null;
}>) {
 return textWorkbook([
  ['員編','姓名','任職門市','異動類型','是否藥師(入職)','舊值','新值','生效日期','備註'],
  ...rows.map(r=>[r.employee_code,r.employee_name,r.store?.store_name||'未指定門市',r.type_label,
   r.movement_type==='onboarding'?(r.onboarding_is_pharmacist==null?'未記錄':r.onboarding_is_pharmacist?'是':'否'):'—',
   r.old_value||'—',r.new_label||'—',r.movement_date,r.display_notes||'—']),
 ],'異動記錄',[16,20,24,20,20,20,24,16,60]);
}

function textWorkbook(rows:string[][],name:string,widths:number[]) {
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  // Explicit text cells preserve leading zeroes and literal formula-like names.
  for (const address of Object.keys(sheet)) if (!address.startsWith('!')) {
    sheet[address].t='s';sheet[address].z='@';delete sheet[address].f;
  }
  sheet['!cols']=widths.map(wch=>({wch}));
  sheet['!autofilter']={ref:sheet['!ref']!};
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,name);
  return XLSX.write(book,{type:'array',bookType:'xlsx'});
}
