import {getMovementDateError} from '../employee-movement-date';
import {POSITION_OPTIONS,NEWBIE_LEVEL_OPTIONS,ADMIN_LEVEL_OPTIONS} from '../../types/workflow';
import {normalizeBirthday} from './employee-birthdays';
export const movementTypes=[
 {value:'onboarding',label:'入職'},{value:'promotion',label:'升職'},
 {value:'acting_manager',label:'代理'},{value:'leave_without_pay',label:'留職停薪'},
 {value:'return_to_work',label:'復職'},{value:'pass_probation',label:'過試用期'},
 {value:'resignation',label:'離職'},{value:'store_transfer',label:'調店'},
] as const;
export const MAX_MOVEMENT_ROWS=500;
const fields=['employee_code','employee_name','store_id','movement_type','birthday','position','newbie_level','effective_date','notes','from_store_id','to_store_id'] as const;
export type MovementDraft=Record<typeof fields[number],string>&{onboarding_is_pharmacist:boolean};
export type MovementIssue={row:number;field:string;message:string};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Field validation only. Database authorization, source existence, conflicts and preview remain separate gates.
export function validateMovementFields(input:unknown,today:string){
 if(!Array.isArray(input)||!input.length||input.length>MAX_MOVEMENT_ROWS)throw Error(`請提供 1 至 ${MAX_MOVEMENT_ROWS} 筆異動資料`);
 const errors:MovementIssue[]=[],seen=new Set<string>();
 const rows=input.map((source,index)=>{
  const raw=source&&typeof source==='object'&&!Array.isArray(source)?source:{};
  const strings=Object.fromEntries(fields.map(f=>[f,typeof raw[f]==='string'?raw[f].trim():''])) as Record<typeof fields[number],string>;
  const r:MovementDraft={...strings,onboarding_is_pharmacist:raw.onboarding_is_pharmacist===true};
  const add=(field:string,message:string)=>errors.push({row:index+1,field,message});
  for(const field of fields)if(raw[field]!=null&&typeof raw[field]!=='string')add(field,'欄位格式須為文字');
  for(const field of ['store_id','from_store_id','to_store_id'] as const)r[field]=r[field].toLowerCase();
  r.employee_code=r.employee_code.toUpperCase();r.onboarding_is_pharmacist=raw.onboarding_is_pharmacist===true;
  if(!/^[A-Z0-9_-]{1,20}$/.test(r.employee_code))add('employee_code','員編必填，限 20 字內的英數字、底線或連字號');
  if(r.employee_code.startsWith('EXAMPLE-'))add('employee_code','請將範例員編 EXAMPLE-xx 替換為實際員編');
  if(!r.employee_name||r.employee_name.length>100)add('employee_name','姓名必填且不得超過 100 字');
  if(!movementTypes.some(t=>t.value===r.movement_type))add('movement_type','請選擇有效異動類型');
  const dateError=getMovementDateError(r.effective_date);if(dateError)add('effective_date',dateError);
  if(r.notes.length>5000)add('notes','備註不得超過 5000 字');
  // Older imports represent acting manager as a promotion; normalize before deduplication.
  if(r.movement_type==='promotion'&&r.position==='代理店長')r.movement_type='acting_manager';
  if(r.movement_type==='store_transfer'){
   if(!uuid(r.from_store_id))add('from_store_id','請選擇原任職門市');
   if(!uuid(r.to_store_id))add('to_store_id','請選擇新任職門市');
   if(r.from_store_id&&r.from_store_id===r.to_store_id)add('to_store_id','原任職與新任職門市不可相同');
   r.store_id=r.to_store_id;
  }else{
   const org=r.store_id.startsWith('org:');
   if(org?(r.movement_type!=='onboarding'||!uuid(r.store_id.slice(4))):!uuid(r.store_id))add('store_id','請選擇任職門市；總部組織僅供入職使用');
   r.from_store_id='';r.to_store_id='';
  }
  if(r.movement_type==='promotion'){
   const alias=r.position==='行政(過階)'?'過階行政':r.position==='行政(未過階)'?'未過階行政':'';
   if(alias){if(r.newbie_level&&r.newbie_level!==alias)add('newbie_level','行政職位與階級不一致');r.position='行政';r.newbie_level=alias;}
   if(!(POSITION_OPTIONS as readonly string[]).includes(r.position))add('position','請選擇有效升職職位');
   const levels=r.position==='新人'?NEWBIE_LEVEL_OPTIONS:r.position==='行政'?ADMIN_LEVEL_OPTIONS:[];
   if(levels.length&&!levels.some(l=>l.value===r.newbie_level))add('newbie_level','請選擇有效的新人階段或行政階級');
   if(!levels.length)r.newbie_level='';
   if(/(新人等級|行政階級)[:：]/.test(r.notes))add('notes','階段／階級請填專用欄位，避免與備註衝突');
  }else{
   if(r.movement_type==='acting_manager'&&r.position!=='代理店長')add('position','代理異動職位必須為代理店長');
   if(r.movement_type!=='acting_manager')r.position='';
   r.newbie_level='';
  }
  if(r.movement_type==='onboarding'){
   const birthday=normalizeBirthday(r.birthday,today);
   if(!birthday)add('birthday','入職須填寫有效生日，且不可晚於今天');
   else{r.birthday=birthday;if(!dateError&&birthday>r.effective_date)add('birthday','生日不可晚於入職生效日');}
   if(typeof raw.onboarding_is_pharmacist!=='boolean')add('onboarding_is_pharmacist','請確認入職是否為藥師');
  }else{r.birthday='';r.onboarding_is_pharmacist=false;}
  const key=JSON.stringify([r.employee_code,r.effective_date,r.movement_type,...(r.movement_type==='promotion'?[r.position,r.newbie_level]:[])]);
  if(seen.has(key))add('employee_code','本批次有相同員工、日期及異動內容，請移除重複列');seen.add(key);
  return r;
 });
 return {rows,errors,valid:errors.length===0};
}
