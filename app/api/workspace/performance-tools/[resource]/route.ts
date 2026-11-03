import {NextRequest} from 'next/server';
import {context,checked,checkOrigin,failed,respond,WorkspaceError} from '@/lib/workspace/server';
import {moduleContext,requireStore} from '@/lib/workspace/modules';
import {MONTHLY_THRESHOLDS,QUARTERLY_THRESHOLDS} from '@/lib/performance/bonus-calc';
import {POST as saveThresholds} from '@/app/api/performance-thresholds/route';
import {POST as importPerformance} from '@/app/api/performance-data/import/route';
import {GET as readPrescription,POST as savePrescription} from '@/app/api/prescription-monthly/route';
import {GET as prescriptionTemplate} from '@/app/api/prescription-monthly/template/route';
import {POST as importPrescription} from '@/app/api/prescription-monthly/import/route';
import {GET as readBonus} from '@/app/api/performance-bonus/route';
import {GET as bonusAverages} from '@/app/api/performance-bonus/averages/route';
import {POST as importBonus} from '@/app/api/performance-bonus/import/route';
import {GET as bonusStores} from '@/app/api/stores-with-supervisors/route';
export const dynamic='force-dynamic';
type Params={params:{resource:string}};
async function run(request:NextRequest,{params}:Params,write:boolean){
 try {
  if(write)checkOrigin(request);
  const ctx=await context(); // Hard DEV guard applies before any delegated handler.
  const resource=params.resource;
  if(resource.startsWith('bonus')){
   if(!ctx.has(write?'performance.bonus.import':'performance.bonus.view'))throw new WorkspaceError(403,'沒有此獎金操作權限');
  }else{
   await moduleContext('performance');
   if(write&&!ctx.has('performance.edit'))throw new WorkspaceError(403,'沒有編輯業績權限');
  }
  if(resource==='thresholds'){
   const body=write?await request.clone().json():null;
   const store=body?.store_id||request.nextUrl.searchParams.get('store_id');
   await requireStore(ctx,'performance',store);
   if(write){
    for(const period of ['monthly','quarterly'])if(!Array.isArray(body[period])||body[period].length!==5||body[period].some((r:any,i:number)=>r.level!==i+1||!Number.isInteger(r.base_amount)||r.base_amount<0||r.base_amount>2147483647))throw new WorkspaceError(400,'每期需填寫五檻非負整數獎金金額');
    return saveThresholds(request);
   }
   const rows=checked(await ctx.auth.from('store_performance_thresholds').select('period_type,threshold_level,base_amount').eq('store_id',store))||[];
   // 與舊 /api/performance-thresholds GET 同一個形狀（level、multiplier、baseAmount、label、isCustom）。
   const build=(type:string,defaults:typeof MONTHLY_THRESHOLDS)=>defaults.map((d,i)=>{const saved=rows.find(r=>r.period_type===type&&r.threshold_level===i+1);return{level:i+1,multiplier:d.multiplier,baseAmount:saved?Number(saved.base_amount):d.baseAmount,label:d.label,isCustom:!!saved};});
   return respond({monthly:build('monthly',MONTHLY_THRESHOLDS),quarterly:build('quarterly',QUARTERLY_THRESHOLDS)});
  }
  const reads:Record<string,(r:NextRequest)=>Promise<Response|undefined>>={prescription:readPrescription,'prescription-template':prescriptionTemplate,bonus:readBonus,'bonus-averages':bonusAverages,'bonus-stores':bonusStores};
  const writes:Record<string,(r:NextRequest)=>Promise<Response|undefined>>={'performance-import':importPerformance,prescription:savePrescription,'prescription-import':importPrescription,'bonus-import':importBonus};
  const handler=(write?writes:reads)[resource];
  if(!handler)throw new WorkspaceError(404,'找不到此操作');
  const response=await handler(request);
  if(!response)throw new WorkspaceError(503,'服務未傳回結果，請重試');
  return response;
 }catch(e){return failed(e);}
}
export const GET=(r:NextRequest,p:Params)=>run(r,p,false);
export const POST=(r:NextRequest,p:Params)=>run(r,p,true);
