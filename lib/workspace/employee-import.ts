import * as XLSX from 'xlsx';
import {POSITION_OPTIONS} from '../../types/workflow';
import {checkEmployeeId,completeExcelEmployeeId} from './employee-id-rule';
export const HEADERS=['門市代號','員編','姓名','職位','到職日期'];
export const MAX_IMPORT_ROWS=10000,MAX_IMPORT_BYTES=5*1024*1024;
export function importDate(value:unknown,date1904=false){
 let text=String(value??'').trim();
 if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value,{date1904});if(!d)return '';text=`${d.y}-${d.m}-${d.d}`;}
 const m=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);if(!m)return '';
 const y=+m[1],mo=+m[2],day=+m[3],d=new Date(Date.UTC(y,mo-1,day));
 return y>=1900&&y<=2099&&d.getUTCFullYear()===y&&d.getUTCMonth()===mo-1&&d.getUTCDate()===day?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';
}
export function parseEmployeeImport(buffer:Buffer,stores:any[]){
 const book=XLSX.read(buffer,{type:'buffer',cellDates:false,sheetRows:MAX_IMPORT_ROWS+2});const sheet=book.Sheets[book.SheetNames[0]];if(!sheet)throw Error('檔案中沒有工作表');
 const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');if(range.s.r!==0)throw Error('請將欄位標題放在第一列');if(range.e.r>MAX_IMPORT_ROWS)throw Error('最多可匯入 10,000 列');
 const matrix=XLSX.utils.sheet_to_json<any[]>(sheet,{header:1,defval:'',blankrows:true,raw:true});
 const headers=(matrix[0]||[]).map(v=>String(v).trim()),indices=HEADERS.map(h=>headers.indexOf(h));
 if(indices.some(i=>i<0)||HEADERS.some(h=>headers.filter(v=>v===h).length!==1))throw Error('第一列須包含且不可重複：'+HEADERS.join('、'));
 const rows:any[]=[],errors:{row:number;message:string}[]=[];let skipped=0;
 for(let i=1;i<matrix.length;i++){
  const values=indices.map(c=>matrix[i]?.[c]??'');if(values.every(v=>!String(v).trim())){skipped++;continue;}
  const texts=values.map(v=>String(v).trim()),[storeCode,rawCode,name,position]=texts;
  const code=completeExcelEmployeeId(rawCode),date=importDate(values[4],!!book.Workbook?.WBProps?.date1904);
  const matches=stores.filter(s=>s.store_code===storeCode||(/^\d+$/.test(storeCode)&&/^\d+$/.test(s.store_code)&&Number(s.store_code)===Number(storeCode)));
  const r={row:i+1,store_id:matches.length===1?matches[0].id:null,store_code:matches.length===1?matches[0].store_code:storeCode,store_name:matches.length===1?matches[0].store_name:'',employee_code:code,employee_name:name,position,start_date:date};rows.push(r);
  const messages=[];for(let j=0;j<HEADERS.length;j++)if(!texts[j])messages.push('缺少'+HEADERS[j]);
  if(storeCode&&matches.length!==1)messages.push('門市代號不存在、不在可匯入範圍或對應不唯一');
  if(rawCode){const id=checkEmployeeId(code);if(!id.ok)messages.push(id.message);}
  if(name.length>200)messages.push('姓名過長');
  // F.1：職位必須在公司職位清單內。
  if(position&&!POSITION_OPTIONS.includes(position))messages.push('職位不在公司職位清單內');
  if(texts[4]&&!date)messages.push('到職日期無效，請用 YYYY-MM-DD 或 Excel 日期');
  for(const message of messages)errors.push({row:i+1,message});
 }
 const seen=new Map<string,number>();for(const r of rows){if(!r.employee_code)continue;if(seen.has(r.employee_code))errors.push({row:r.row,message:`員編與第 ${seen.get(r.employee_code)} 列重複`});else seen.set(r.employee_code,r.row);}
 return {rows,errors,skipped,valid:rows.length>0&&!errors.length};
}
