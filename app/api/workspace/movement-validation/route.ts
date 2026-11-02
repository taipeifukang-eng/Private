import {movementErrors} from '@/lib/workspace/movement-errors';
import {parseMovementWorkbook,MAX_MOVEMENT_FILE_BYTES} from '@/lib/workspace/movement-import';
import {movementPlacementOptions} from '@/lib/workspace/movement-locations';
import {movementTypes} from '@/lib/workspace/movement-fields';
import {POSITION_OPTIONS,NEWBIE_LEVEL_OPTIONS,ADMIN_LEVEL_OPTIONS} from '@/types/workflow';
import {checked,checkOrigin,context,failed,requireCapability,respond,WorkspaceError} from '@/lib/workspace/server';
import {validateMovementFields} from '@/lib/workspace/movement-fields';
import {validateMovementReferences} from '@/lib/workspace/movement-references';
export const dynamic='force-dynamic';
async function readAll(query:()=>any){const rows:any[]=[];for(let from=0;;from+=500){const page=checked(await query().range(from,from+499)) as any[];rows.push(...page);if(page.length<500)return rows;}}
export async function POST(request:Request){try{
 checkOrigin(request);const ctx=await context();requireCapability(ctx,['employee.promotion.batch']);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let fields:ReturnType<typeof validateMovementFields>&{sourceRows?:number[]};
 try{
  if(request.headers.get('content-type')?.includes('multipart/form-data')){
   const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||!/\.(xlsx|xls)$/i.test(file.name)||file.size>MAX_MOVEMENT_FILE_BYTES)throw Error('請選擇 5 MB 以下的 .xlsx 或 .xls 檔案');
   const [storeList,unitList]=await Promise.all([
    readAll(()=>ctx.auth.from('stores').select('id,store_code,store_name').eq('is_active',true).order('id')),
    readAll(()=>ctx.admin.from('organization_units').select('id,code,name,type,status,parent_id,sort_order').order('id')),
   ]);
   fields=parseMovementWorkbook(Buffer.from(await file.arrayBuffer()),today,storeList.map(s=>({id:s.id,code:s.store_code,name:s.store_name})),movementPlacementOptions(unitList));
  }else{const body=await request.json();fields=validateMovementFields(body?.rows,today);}
 }catch(e){throw new WorkspaceError(400,(e as Error).message);}
 if(!fields.valid)return respond({...fields,references:[],validationOnly:true,canSubmit:false});
 const version=checked(await ctx.admin.rpc('workspace_movement_snapshot',{p_rows:fields.rows}));
 const codes=Array.from(new Set(fields.rows.map(r=>r.employee_code))),ids=Array.from(new Set(fields.rows.flatMap(r=>[r.store_id,r.from_store_id,r.to_store_id]).filter(Boolean)));
 const storeIds=ids.filter(id=>!id.startsWith('org:')),unitIds=ids.filter(id=>id.startsWith('org:')).map(id=>id.slice(4));
 const stores:any[]=[],units:any[]=[],employees:any[]=[],history:any[]=[];
 // Chunk IN lists to keep request URLs bounded; each chunk is fully paged.
 for(let i=0;i<storeIds.length;i+=100)stores.push(...await readAll(()=>ctx.auth.from('stores').select('id,store_code,store_name,is_active').in('id',storeIds.slice(i,i+100)).order('id')));
 // Organization catalog is service-only, as in the existing authorized batch API.
 if(unitIds.length)units.push(...await readAll(()=>ctx.admin.from('organization_units').select('id,code,name,type,status,parent_id,sort_order').order('id')));
 const dates=fields.rows.map(r=>r.effective_date).sort();
 for(let i=0;i<codes.length;i+=100){const chunk=codes.slice(i,i+100);const [e,h]=await Promise.all([
  readAll(()=>ctx.auth.from('store_employees').select('employee_code,employee_name,store_id').in('employee_code',chunk).order('id')),
  readAll(()=>ctx.auth.from('employee_movement_history').select('employee_code,movement_date,movement_type,new_value,notes').in('employee_code',chunk).gte('movement_date',dates[0]).lte('movement_date',dates[dates.length-1]).order('id')),
 ]);employees.push(...e);history.push(...h);}
 const result=validateMovementReferences(fields.rows,{stores,units,employees,history});
 if(result.valid){
  const preview=checked(await ctx.admin.rpc('workspace_movement_preview',{p_actor:ctx.user.id,p_rows:fields.rows,p_expected:version}));
  if(!preview.valid){result.valid=false;result.errors.push({row:preview.row||1,field:'employee_code',message:movementErrors[preview.problem]||'資料無法完成整批寫入，請核對主檔與異動內容後重試。'});}
 }

 return respond({rows:fields.rows,...result,sourceRows:fields.sourceRows,errors:result.errors.map(e=>({...e,row:fields.sourceRows?.[e.row-1]??e.row})),references:result.references.map(r=>({...r,row:fields.sourceRows?.[r.row-1]??r.row})),version:result.valid?version:null,validationOnly:false,canSubmit:result.valid});
}catch(e){return failed(e);}}

export async function GET(){try{
 const ctx=await context();requireCapability(ctx,['employee.promotion.batch']);
 const [stores,employees,units]=await Promise.all([
  readAll(()=>ctx.auth.from('stores').select('id,store_code,store_name,is_active').eq('is_active',true).order('store_code').order('id')),
  readAll(()=>ctx.auth.from('store_employees').select('id,employee_code,employee_name,store_id,position,current_position,is_pharmacist,birthday,is_active').order('employee_code').order('id')),
  readAll(()=>ctx.admin.from('organization_units').select('id,code,name,type,status,parent_id,sort_order').order('id')),
 ]);
 return respond({stores,employees,organizationOptions:movementPlacementOptions(units),types:movementTypes,positions:POSITION_OPTIONS,newbieLevels:NEWBIE_LEVEL_OPTIONS,adminLevels:ADMIN_LEVEL_OPTIONS,validationOnly:false,canSubmit:true});
}catch(e){return failed(e);}}
