import { checked, checkOrigin, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { canReadStorePersonnel } from '@/lib/workspace/store-personnel';
import { MAX_PROMOTION_FILE_BYTES, parsePromotionWorkbook, promotionTemplate, validatePromotionRows } from '@/lib/workspace/promotion-import';
import { POSITION_OPTIONS, NEWBIE_LEVEL_OPTIONS, ADMIN_LEVEL_OPTIONS } from '@/types/workflow';
export const dynamic = 'force-dynamic';
async function scope(id: unknown) {
  const ctx = await context();
  requireCapability(ctx,['employee.promotion.batch']);
  if (!await canReadStorePersonnel(ctx)) throw new WorkspaceError(403,'沒有門市升遷管理的操作權限');
  if (!uuid(id)) throw new WorkspaceError(400,'門市 ID 不正確');
  const store = checked(await ctx.auth.from('stores').select('id,store_code,store_name,is_active').eq('id',id).maybeSingle());
  if (!store) throw new WorkspaceError(404,'找不到可查看的門市');
  if (!store.is_active) throw new WorkspaceError(400,'已停止門市不可新增升遷紀錄');
  return {ctx,store};
}
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const {store} = await scope(q.get('store'));
    if (q.get('template') === 'true') return new Response(new Uint8Array(promotionTemplate()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename=promotion-template.xlsx; filename*=UTF-8''%E5%8D%87%E9%81%B7%E5%8C%AF%E5%85%A5%E7%AF%84%E6%9C%AC.xlsx",'Cache-Control':'no-store'}});
    return respond({store,positions:[...POSITION_OPTIONS,'代理店長'],newbieLevels:NEWBIE_LEVEL_OPTIONS,adminLevels:ADMIN_LEVEL_OPTIONS});
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const {ctx,store} = await scope(new URL(request.url).searchParams.get('store'));
    let result: ReturnType<typeof validatePromotionRows> & {sourceRows?:number[]};
    let saveBody: any = null;
    try {
      if (request.headers.get('content-type')?.includes('multipart/form-data')) {
        const body = await request.formData(), file = body.get('file');
        if (!(file instanceof File) || !/\.(xlsx|xls)$/i.test(file.name) || file.size > MAX_PROMOTION_FILE_BYTES) throw new Error('請選擇 5 MB 以下的 .xlsx 或 .xls 檔案');
        result = parsePromotionWorkbook(Buffer.from(await file.arrayBuffer()));
      } else {
        const body = await request.json();
        if (!['validate','save'].includes(body.operation)) throw new Error('操作不正確');
        if (body.operation === 'save') {
          if (!uuid(body.requestId) || typeof body.expected !== 'string' || !/^[a-f0-9]{32}$/.test(body.expected)) throw new Error('請先驗證資料再儲存');
          saveBody = body;
        }
        result = validatePromotionRows(body.rows);
      }
    } catch (error) { throw new WorkspaceError(400,error instanceof Error ? error.message : '匯入格式不正確'); }
    // Validate against the authenticated view of this store; never trust imported names or cross-store codes.
    const employees: any[] = [];
    for (let from=0;;from+=500) {
      const rows = checked(await ctx.auth.from('store_employees').select('id,employee_code,employee_name,is_active').eq('store_id',store.id).order('id').range(from,from+499)) || [];
      employees.push(...rows); if(rows.length<500) break;
    }
    result.rows.forEach((row,index) => {
      const rowNumber = result.sourceRows?.[index] ?? index+1;
      const matches = employees.filter(employee => employee.employee_code === row.employee_code);
      if (matches.length !== 1) result.errors.push({row:rowNumber,field:'employee_code',message:matches.length?'此門市同員編有多筆主檔，請先核對':'找不到此門市可查看的員工'});
      else if (matches[0].employee_name !== row.employee_name) result.errors.push({row:rowNumber,field:'employee_name',message:'姓名與門市員工主檔不符，請核對'});
    });
    if (saveBody) {
      if (result.errors.length) return respond({error:'請修正升遷資料',errors:result.errors.map(e=>`第 ${e.row} 列：${e.message}`)},400);
      const saved = await ctx.admin.rpc('workspace_promotion_save',{p_actor:ctx.user.id,p_request:saveBody.requestId,p_store:store.id,p_rows:result.rows,p_expected:saveBody.expected});
      if (saved.error) {
        const message = saved.error.message;
        if (message.includes('WORKSPACE_CONFLICT')) throw new WorkspaceError(409,'員工或月份資料已被其他人修改，請重新驗證後核對');
        if (message.includes('WORKSPACE_REQUEST_REUSED')) throw new WorkspaceError(409,'請求識別已用於其他內容，請重新驗證');
        if (message.includes('WORKSPACE_DUPLICATE')) throw new WorkspaceError(409,'已有相同員工、日期及職位的升遷紀錄，請核對歷程');
        if (message.includes('WORKSPACE_EMPLOYEE')) throw new WorkspaceError(409,'員工主檔已變更，請重新驗證');
        if (message.includes('WORKSPACE_INACTIVE')) throw new WorkspaceError(400,'門市已停止營運');
        throw new WorkspaceError(503,'儲存未完成，升遷與月份資料未變更，請稍後重試');
      }
      return respond(saved.data);
    }
    const expected = result.errors.length ? null : checked(await ctx.admin.rpc('workspace_promotion_snapshot',{p_store:store.id,p_rows:result.rows}));
    return respond({...result,valid:result.errors.length===0,store,expected});
  } catch (error) { return failed(error); }
}
