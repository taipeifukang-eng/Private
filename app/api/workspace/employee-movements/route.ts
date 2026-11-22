import {context,failed,respond,WorkspaceError} from '@/lib/workspace/server';
import {canDeleteMovement,canEditMovement,canReadMovementHistory,movementTypes} from '@/lib/workspace/employee-movements';
import {formatPromotionPosition,getMovementNotesForDisplay} from '@/lib/monthly-staff/promotion-level';
import {POSITION_OPTIONS,NEWBIE_LEVEL_OPTIONS,ADMIN_LEVEL_OPTIONS} from '@/types/workflow';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const ctx=await context();if(!await canReadMovementHistory(ctx))throw new WorkspaceError(403,'沒有異動歷史的查看權限');
 const q=new URL(request.url).searchParams,month=q.get('month')||'',type=q.get('type')||'all',rawPage=q.get('page')||'1',rawSize=q.get('size')||'100';
 if(month&&!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new WorkspaceError(400,'月份格式不正確');
 if(type!=='all'&&!movementTypes.some(t=>t.value===type))throw new WorkspaceError(400,'異動類型不正確');
 if(!/^[1-9]\d{0,5}$/.test(rawPage)||!['50','100'].includes(rawSize))throw new WorkspaceError(400,'頁數或每頁筆數不正確');
 const page=Number(rawPage),size=Number(rawSize);
 let query=ctx.auth.from('employee_movement_history').select('id,employee_code,employee_name,store_id,movement_type,onboarding_is_pharmacist,movement_date,old_value,new_value,notes,store:stores(store_code,store_name)',{count:'exact'}).order('movement_date',{ascending:true}).order('created_at',{ascending:true}).order('id');
 if(month){const [y,m]=month.split('-').map(Number);const next=m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,'0')}-01`;query=query.gte('movement_date',month+'-01').lt('movement_date',next);}
 if(type!=='all')query=query.eq('movement_type',type);
 const result=await query.range((page-1)*size,page*size-1);if(result.error)throw new WorkspaceError(503,'異動紀錄讀取失敗，請重試');
 const rows=result.data||[],codes=Array.from(new Set(rows.map(r=>r.employee_code)));
 // C.1：每位員工只有時間軸最後一筆可刪（movement_date、created_at、id 排序）；用管理端讀取，避免 RLS 隱藏較新的異動而誤判。
 const latest=new Map<string,string>();
 for(let i=0;i<codes.length;i+=25){
  const all=await ctx.admin.from('employee_movement_history').select('id,employee_code,movement_date,created_at').in('employee_code',codes.slice(i,i+25)).order('movement_date',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(5000);
  if(all.error)throw new WorkspaceError(503,'異動紀錄讀取失敗，請重試');
  for(const h of all.data||[])if(!latest.has(h.employee_code))latest.set(h.employee_code,h.id);
 }
 return respond({canEdit:canEditMovement(ctx),canDelete:canDeleteMovement(ctx),positions:POSITION_OPTIONS,newbieLevels:NEWBIE_LEVEL_OPTIONS,adminLevels:ADMIN_LEVEL_OPTIONS,rows:rows.map(r=>({...r,is_latest:latest.get(r.employee_code)===r.id,type_label:r.movement_type==='promotion'&&r.new_value==='代理店長'?'代理（舊紀錄）':movementTypes.find(t=>t.value===r.movement_type)?.label||r.movement_type,new_label:r.movement_type==='promotion'?formatPromotionPosition(r.new_value,r.notes):r.new_value,display_notes:getMovementNotesForDisplay(r.notes)})),total:result.count||0,page,size,month,type,types:movementTypes});
}catch(e){return failed(e);}}
