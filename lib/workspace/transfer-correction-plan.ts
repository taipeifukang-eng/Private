import {getMovementDateError} from '../employee-movement-date';

export type CorrectionMonth={id:string;store_id:string;year_month:string;status:string|null;monthly_status:string;work_days:number|null;[key:string]:unknown};
const manualFields=['work_hours','notes','extra_tasks','monthly_transport_expense','transport_expense_notes','support_to_other_stores_hours','support_from_other_stores_hours','supervisor_shift_hours','transaction_count','sales_amount','gross_profit','gross_profit_rate','extra_task_planned_hours','extra_task_external_hours','last_month_single_item_bonus','talent_cultivation_bonus','talent_cultivation_target','is_dual_position','has_manager_bonus','is_supervisor_rotation','is_acting_manager','newbie_level','special_role'] as const;
const meaningful=(value:unknown)=>value!==null&&value!==undefined&&value!==''&&value!==false&&value!==0&&(!Array.isArray(value)||value.length>0);

/** Review proposals only: no row is deleted, and manual fields are never part of a patch. */
export function transferCorrectionPlan(input:{oldDate:string;newDate:string;fromStore:string;toStore:string;fromName:string;toName:string;rows:CorrectionMonth[];initialized:Array<{store_id:string;year_month:string}>}){
 for(const date of [input.oldDate,input.newDate]){const error=getMovementDateError(date);if(error)throw new Error(error);if(date<'2000-01-01'||date>'2100-12-31')throw new Error('更正日期年份須為2000至2100');}
 if(input.oldDate===input.newDate)throw new Error('新舊日期相同');
 if(!input.fromStore||!input.toStore||input.fromStore===input.toStore)throw new Error('調出與調入門市必須不同');
 const oldMonth=input.oldDate.slice(0,7),newMonth=input.newDate.slice(0,7),first=oldMonth<newMonth?oldMonth:newMonth,last=oldMonth>newMonth?oldMonth:newMonth,day=Number(input.newDate.slice(8)),monthDay=input.newDate.slice(5).replace('-','/');
 const inScope=(r:{store_id:string;year_month:string})=>[input.fromStore,input.toStore].includes(r.store_id)&&r.year_month>=first&&r.year_month<=last;
 const days=(ym:string)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym))throw new Error('月份格式不正確');const [y,m]=ym.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();};
 const groups=new Map<string,{store_id:string;year_month:string;rows:CorrectionMonth[]}>();
 for(const r of [...input.rows.filter(inScope),...input.initialized.filter(inScope)]){days(r.year_month);const key=r.store_id+':'+r.year_month;if(!groups.has(key))groups.set(key,{store_id:r.store_id,year_month:r.year_month,rows:[]});}
 for(const r of input.rows.filter(inScope))groups.get(r.store_id+':'+r.year_month)!.rows.push(r);
 const conflicts:string[]=[],changes=[];
 for(const group of Array.from(groups.values()).sort((a,b)=>a.year_month.localeCompare(b.year_month)||a.store_id.localeCompare(b.store_id))){
  const source=group.store_id===input.fromStore,ym=group.year_month,total=days(ym),label=source?input.fromName:input.toName;
  if(group.rows.length>1){conflicts.push(`${ym} ${label} 有重複員工月資料`);continue;}
  const before=group.rows[0]||null;
  if(before&&before.status!=='draft')conflicts.push(`${ym} ${label} 不是草稿，須先處理該月份狀態`);
  const workDays=source?(ym<newMonth?total:ym===newMonth?day-1:0):(ym<newMonth?0:ym===newMonth?total-day+1:total);
  // Preserve existing zero-day rows with their manual values, but never create empty rows outside employment.
  if(!before&&workDays===0)continue;
  const partial=ym===newMonth,retainedOnly=workDays===0;
  const state=source?(ym<newMonth?'full_month':'transferred_out'):(ym>newMonth?'full_month':'transferred_in');
  const notes=retainedOnly?`跨月更正：${input.newDate}${source?'調出':'調入'}；本月不在此店任職，保留原列與手填資料`:partial?`${monthDay}${source?'調出至'+input.toName:'自'+input.fromName+'調入'}`:null;
  const preserved=before?Object.fromEntries(manualFields.filter(k=>meaningful(before[k])).map(k=>[k,before[k]])):{};
  changes.push({id:before?.id||null,store_id:group.store_id,store_name:label,year_month:ym,operation:before?'update':'insert',before:before?{monthly_status:before.monthly_status,work_days:before.work_days}:null,patch:{monthly_status:state,work_days:workDays,total_days_in_month:total,partial_month_reason:retainedOnly?'跨月更正保留':partial?(source?'調出店':'調入店'):null,partial_month_notes:notes},preservedManualValues:preserved,retainedOnly,reviewRequired:true});
 }
 return {oldDate:input.oldDate,newDate:input.newDate,crossMonth:oldMonth!==newMonth,firstMonth:first,lastMonth:last,changes,conflicts,requiresHumanReview:true};
}
