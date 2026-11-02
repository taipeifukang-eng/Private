import {movementPlacementOptions,type PlacementUnit} from './movement-locations';
import type {MovementDraft,MovementIssue} from './movement-fields';
import {getPromotionLevelFromNotes} from '../monthly-staff/promotion-level';
type Store={id:string;store_code:string;store_name:string;is_active:boolean|null};
type Unit=PlacementUnit;
type Employee={employee_code:string;employee_name:string;store_id:string|null};
type History={employee_code:string;movement_date:string;movement_type:string;new_value:string|null;notes:string|null};
export function validateMovementReferences(rows:MovementDraft[],sources:{stores:Store[];units:Unit[];employees:Employee[];history:History[]}){
 const errors:MovementIssue[]=[],stores=new Map(sources.stores.map(s=>[s.id,s])),units=new Map(movementPlacementOptions(sources.units).map(u=>[u.id,u]));
 const employees=new Map<string,Employee[]>(),history=new Map<string,History[]>();
 for(const e of sources.employees){const code=e.employee_code.trim().toUpperCase();employees.set(code,[...(employees.get(code)||[]),e]);}
 for(const h of sources.history){const key=JSON.stringify([h.employee_code.trim().toUpperCase(),h.movement_date]);history.set(key,[...(history.get(key)||[]),h]);}
 const references=rows.map((r,index)=>({r,index})).sort((a,b)=>a.r.effective_date.localeCompare(b.r.effective_date)||a.index-b.index).map(({r,index})=>{
  const add=(field:string,message:string)=>errors.push({row:index+1,field,message});
  const storeFields=r.movement_type==='store_transfer'?['from_store_id','to_store_id'] as const:['store_id'] as const;
  for(const field of storeFields){const id=r[field];if(id.startsWith('org:')){const unit=units.get(id.slice(4));if(!unit||unit.status!=='active')add(field,'請選擇可用的總部最下層組織單位');}else{const store=stores.get(id);if(!store)add(field,'找不到可查看的門市');else if(store.is_active!==true)add(field,'此門市已停用，不能登記新的異動');}}
  const candidates=employees.get(r.employee_code)||[];
  if(r.movement_type!=='onboarding'&&!candidates.length)add('employee_code','找不到可查看的員工主檔，請先核對員編');
  if(candidates.length&&!candidates.some(e=>e.employee_name.trim()===r.employee_name))add('employee_name','姓名與此員編的員工主檔不符');
  const source=r.movement_type==='store_transfer'?r.from_store_id:r.store_id;
  if(r.movement_type!=='onboarding'&&candidates.length&&!candidates.some(e=>e.store_id===source||e.store_id===null))add('store_id','此員工主檔不屬於所選任職門市，請核對異動來源');
  if(r.movement_type!=='onboarding'&&candidates.some(e=>e.store_id===source||e.store_id===null)&&!candidates.some(e=>(e.store_id===source||e.store_id===null)&&e.employee_name.trim()===r.employee_name))add('employee_name','姓名與所選任職門市的主檔不符');
  const existing=history.get(JSON.stringify([r.employee_code,r.effective_date]))||[];
  const duplicate=existing.some(h=>{
   const type=h.movement_type==='promotion'&&h.new_value==='代理店長'?'acting_manager':h.movement_type;
   if(type!==r.movement_type)return false;if(type!=='promotion')return true;
   const position=h.new_value?.startsWith('行政(')?'行政':h.new_value;
   const level=h.new_value==='行政(過階)'?'過階行政':h.new_value==='行政(未過階)'?'未過階行政':getPromotionLevelFromNotes(h.notes)||'';
   return position===r.position&&level===r.newbie_level;
  });
  if(duplicate)add('employee_code','已有相同員工、日期及內容的異動紀錄');
  if(!errors.some(e=>e.row===index+1)&&['onboarding','store_transfer'].includes(r.movement_type)){
   const next={employee_code:r.employee_code,employee_name:r.employee_name,store_id:r.movement_type==='store_transfer'?r.to_store_id:r.store_id};
   employees.set(r.employee_code,[...candidates.filter(e=>e.store_id!==source&&e.store_id!==next.store_id),next]);
  }
  return {row:index+1,store_name:stores.get(r.store_id)?.store_name||units.get(r.store_id.slice(4))?.name||'',from_store_name:stores.get(r.from_store_id)?.store_name||'',to_store_name:stores.get(r.to_store_id)?.store_name||'',existing_employee:candidates.length>0};
 });
 return {references:references.sort((a,b)=>a.row-b.row),errors,valid:errors.length===0};
}
