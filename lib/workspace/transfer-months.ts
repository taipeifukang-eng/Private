import {getMovementDateError} from '../employee-movement-date';

export type TransferMonthRow={id:string;store_id:string;year_month:string;status:string;monthly_status:string;work_days:number|null};
export function transferMonthPlan(input:{effectiveDate:string;fromStore:string;toStore:string;fromName:string;toName:string;rows:TransferMonthRow[];destinationDraftMonths:string[]}){
 const error=getMovementDateError(input.effectiveDate);if(error)throw new Error(error);
 if(!input.fromStore||!input.toStore||input.fromStore===input.toStore)throw new Error('調出與調入門市必須不同');
 const month=input.effectiveDate.slice(0,7),day=Number(input.effectiveDate.slice(8)),monthDay=input.effectiveDate.slice(5).replace('-','/');
 const days=(ym:string)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym))throw new Error('月資料月份格式不正確');const [y,m]=ym.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();};
 const relevant=input.rows.filter(r=>(r.store_id===input.fromStore&&r.year_month===month)||(r.store_id===input.toStore&&r.year_month>=month));
 const conflicts:string[]=[],seen=new Set<string>(),lockedMonths:string[]=[];
 for(const r of relevant){days(r.year_month);const key=r.store_id+':'+r.year_month;if(seen.has(key))conflicts.push(`${r.year_month} 同一門市有重複員工月資料`);seen.add(key);if(r.status!=='draft')lockedMonths.push(r.year_month);}
 const targetMonths=Array.from(new Set(input.destinationDraftMonths.filter(m=>m>=month))).sort();targetMonths.forEach(days);
 const changes:Array<{id:string|null;store_id:string;year_month:string;operation:'insert'|'update';monthly_status:string;work_days:number;total_days_in_month:number;partial_month_reason:string|null;partial_month_notes:string|null}>=[];
 const source=input.rows.filter(r=>r.store_id===input.fromStore&&r.year_month===month&&r.status==='draft');
 for(const row of source)changes.push({id:row.id,store_id:input.fromStore,year_month:month,operation:'update',monthly_status:'transferred_out',work_days:day-1,total_days_in_month:days(month),partial_month_reason:'調出店',partial_month_notes:`${monthDay}調出至${input.toName}`});
 for(const ym of targetMonths){
  const matches=input.rows.filter(r=>r.store_id===input.toStore&&r.year_month===ym);if(matches.some(r=>r.status!=='draft'))continue;
  const first=matches[0],effective=ym===month,total=days(ym);
  changes.push({id:first?.id||null,store_id:input.toStore,year_month:ym,operation:first?'update':'insert',monthly_status:effective?'transferred_in':'full_month',work_days:effective?total-day+1:total,total_days_in_month:total,partial_month_reason:effective?'調入店':null,partial_month_notes:effective?`${monthDay}自${input.fromName}調入`:null});
 }
 return {month,changes,conflicts:Array.from(new Set(conflicts)),lockedMonths:Array.from(new Set(lockedMonths)).sort(),sourceMonthInitialized:input.rows.some(r=>r.store_id===input.fromStore&&r.year_month===month),destinationMonthInitialized:targetMonths.includes(month)};
}
