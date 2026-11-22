import {NextRequest} from 'next/server';
import {context,checkOrigin,failed,WorkspaceError} from '@/lib/workspace/server';
import {moduleContext} from '@/lib/workspace/modules';
import {PATCH as updateAlias,DELETE as deleteAlias} from '@/app/api/prescription-monthly/aliases/[id]/route';
export const dynamic='force-dynamic';
type Params={params:{id:string}};
// 門市簡稱對照表的修改與刪除：與 performance-tools/[resource] 同樣的 DEV 守衛、Origin 檢查、業績模組與 performance.edit 權限，再交給舊版同一個處理函式。
async function run(request:NextRequest,params:Params,handler:(r:NextRequest,p:Params)=>Promise<Response|undefined>){
 try{
  checkOrigin(request);
  const ctx=await context();
  await moduleContext('performance');
  if(!ctx.has('performance.edit'))throw new WorkspaceError(403,'沒有編輯業績權限');
  const response=await handler(request,params);
  if(!response)throw new WorkspaceError(503,'服務未傳回結果，請重試');
  return response;
 }catch(e){return failed(e);}
}
export const PATCH=(r:NextRequest,p:Params)=>run(r,p,updateAlias);
export const DELETE=(r:NextRequest,p:Params)=>run(r,p,deleteAlias);
