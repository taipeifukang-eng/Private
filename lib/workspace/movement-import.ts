import * as XLSX from 'xlsx';
import {normalizePromotionDate} from './promotion-import';
import {movementTypes,validateMovementFields,MAX_MOVEMENT_ROWS,type MovementIssue} from './movement-fields';
export const MAX_MOVEMENT_FILE_BYTES=5*1024*1024;
type Location={id:string;code:string;name:string};
const headers:Record<string,string>={完整員編:'employee_code',員編:'employee_code',姓名:'employee_name',異動類型:'movement_type',任職門市ID:'store_id',任職門市:'store_id',是否為藥師:'onboarding_is_pharmacist',生日:'birthday',升任後職位:'position',職位:'position','升任後新人/行政等級':'newbie_level','新人/行政等級':'newbie_level',新人等級:'newbie_level',原任職門市ID:'from_store_id',原任職門市:'from_store_id',新任職門市ID:'to_store_id',新任職門市:'to_store_id',生效日期:'effective_date',備註:'notes'};
for(const key of Object.values(headers))headers[key]=key;
function date(value:unknown,date1904:boolean){const text=String(value??'').trim(),match=text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);return match?`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:normalizePromotionDate(value,date1904);}
function storeMatches(value:string,stores:Location[]){
 const exact=stores.filter(s=>value===s.id||value===s.name||value===s.code||(s.code&&value.startsWith(s.code+' ')));if(exact.length)return exact;
 const normalize=(v:string)=>v.trim().toUpperCase().replace(/^(.*\d)[A-Z]+$/,'$1');
 const code=normalize(value.split(/\s+/,1)[0]);const matches=stores.filter(s=>{const target=normalize(s.code);return code===target||(/^\d+$/.test(code)&&/^\d+$/.test(target)&&Number(code)===Number(target));});if(matches.length)return matches;
 const hr=value.match(/^(\d{3,4})(.+)$/);if(!hr)return [];
 const name=(v:string)=>v.trim().toLowerCase().replace(/(門市|分店|店)$/,'').replace(/\s+/g,'');const hint=name(hr[2]);
 return stores.filter(s=>hint&&normalize(s.code)===hr[1].padStart(4,'0')&&name(s.name)&&(name(s.name).includes(hint)||hint.includes(name(s.name))));
}
export function parseMovementWorkbook(buffer:Buffer,today:string,stores:Location[],units:Location[]){
 if(!buffer.length||buffer.length>MAX_MOVEMENT_FILE_BYTES)throw Error('請選擇 5 MB 以下的非空 Excel 檔案');
 const book=XLSX.read(buffer,{type:'buffer',cellDates:false,cellFormula:true,sheetRows:MAX_MOVEMENT_ROWS+2});const sheet=book.Sheets[book.SheetNames[0]];
 if(!sheet?.['!ref'])throw Error('第一個工作表沒有資料');const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
 if(range.e.r-range.s.r>MAX_MOVEMENT_ROWS)throw Error(`Excel 最多 ${MAX_MOVEMENT_ROWS} 筆資料`);if(range.e.c-range.s.c>30)throw Error('Excel 欄位過多，請使用異動匯入範本');
 const columns=new Map<number,string>(),found=new Set<string>();let fullCodes=false;for(let c=range.s.c;c<=range.e.c;c++){const key=headers[String(sheet[XLSX.utils.encode_cell({r:range.s.r,c})]?.v||'').trim()];if(String(sheet[XLSX.utils.encode_cell({r:range.s.r,c})]?.v||'').trim()==='完整員編')fullCodes=true;if(!key)continue;if(found.has(key))throw Error('Excel 有重複欄位：'+key);found.add(key);columns.set(c,key);}
 if(['employee_code','employee_name','movement_type','effective_date'].some(k=>!found.has(k)))throw Error('缺少員編、姓名、異動類型或生效日期欄位');
 const input:any[]=[],sourceRows:number[]=[],errors:MovementIssue[]=[];
 for(let r=range.s.r+1;r<=range.e.r;r++){
  const row:any={};let nonempty=false;
  for(const [c,key] of Array.from(columns)){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(!cell)continue;if(cell.f||cell.t==='e')errors.push({row:r+1,field:key,message:'請移除公式或 Excel 錯誤，貼上實際值'});if(cell.f||String(cell.v??'').trim())nonempty=true;row[key]=['birthday','effective_date'].includes(key)?date(cell.v,!!book.Workbook?.WBProps?.date1904):String(XLSX.utils.format_cell(cell)||'').trim();}
  if(!nonempty)continue;
  const code=String(row.employee_code||'').toUpperCase();row.employee_code=fullCodes?code:/^\d{4}$/.test(code)?'FK'+code:/^\d{5}$/.test(code)?'FKF'+code:code;
  row.movement_type=movementTypes.find(t=>t.label===row.movement_type)?.value||row.movement_type;
  if(row.movement_type==='onboarding'){const flag=String(row.onboarding_is_pharmacist??'').toLowerCase();row.onboarding_is_pharmacist=['是','true','1'].includes(flag)?true:['否','false','0'].includes(flag)?false:undefined;}
  for(const field of ['store_id','from_store_id','to_store_id']){
   const value=String(row[field]||'').trim();if(!value)continue;const matches=storeMatches(value,stores);
   const org=field==='store_id'&&row.movement_type==='onboarding'?units.filter(u=>value==='org:'+u.id||value===u.id||value===u.name||value===u.code||(u.code&&value.startsWith(u.code+' '))):[];
   if(matches.length>1||(!matches.length&&org.length>1)){errors.push({row:r+1,field,message:'名稱或代碼符合多個單位，請填完整代碼或 ID'});row[field]='';}
   else row[field]=matches[0]?.id||(org[0]?'org:'+org[0].id:value);
  }
  sourceRows.push(r+1);input.push(row);
 }
 const result=validateMovementFields(input,today);errors.push(...result.errors.map(e=>({...e,row:sourceRows[e.row-1]})));
 return {rows:result.rows,sourceRows,errors,valid:errors.length===0};
}
