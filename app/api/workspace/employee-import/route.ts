import {context,checkOrigin,requireCapability,checked,respond,failed,WorkspaceError,uuid} from '@/lib/workspace/server';
import {parseEmployeeImport,MAX_IMPORT_BYTES,MAX_IMPORT_ROWS} from '@/lib/workspace/employee-import';
export const dynamic='force-dynamic';
export const maxDuration=120;
async function access(){const ctx=await context();requireCapability(ctx,['employee.import']);return ctx;}
async function stores(ctx:Awaited<ReturnType<typeof access>>){return checked(await ctx.auth.from('stores').select('id,store_code,store_name').eq('is_active',true).order('store_code'))||[];}
export async function GET(){try{const ctx=await access();return respond({stores:await stores(ctx)});}catch(e){return failed(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const ctx=await access();const form=await request.formData(),file=form.get('file');
 if(!(file instanceof File)||!/^.*\.xlsx?$/i.test(file.name)||!file.size||file.size>MAX_IMPORT_BYTES)throw new WorkspaceError(400,'請選擇 5 MB 以內的 Excel（.xlsx／.xls）檔案');
 const allowed=await stores(ctx);let parsed;
 try{parsed=parseEmployeeImport(Buffer.from(await file.arrayBuffer()),allowed);}catch(e){throw new WorkspaceError(400,(e as Error).message||'無法解析 Excel');}
 if(!parsed.rows.length)throw new WorkspaceError(400,'檔案中沒有員工資料');
 const result=checked(await ctx.admin.rpc('workspace_employee_import_check',{p_rows:parsed.rows,p_visible:allowed.map(s=>s.id)}));
 const errors=[...parsed.errors,...result.errors].filter((r,i,a)=>a.findIndex(x=>String(x.row)===String(r.row)&&x.message===r.message)===i);
 // D.1：完全重複且已存在的列自動略過並列在結果；其他錯誤整批不存。
 const duplicates=(result.duplicates||[]).filter((d:any)=>!errors.some((e:any)=>String(e.row)===String(d.row)));
 return respond({...parsed,errors,duplicates,valid:errors.length===0});
}catch(e){return failed(e);}}
export async function PUT(request:Request){try{
 checkOrigin(request);const ctx=await access();const b=await request.json();
 if(!uuid(b.requestId)||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>MAX_IMPORT_ROWS)throw new WorkspaceError(400,'請先上傳並預覽員工資料');
 const rows=b.rows.map((r:any)=>{if(!r||!uuid(r.store_id)||!Number.isInteger(r.row)||r.row<2||r.row>MAX_IMPORT_ROWS+1||['employee_code','employee_name','position','start_date'].some(k=>typeof r[k]!=='string'||r[k].length>200))throw new WorkspaceError(400,'員工欄位不正確，請重新預覽');return {row:r.row,store_id:r.store_id,employee_code:r.employee_code,employee_name:r.employee_name,position:r.position,start_date:r.start_date};});
 const allowed=await stores(ctx);const result=await ctx.admin.rpc('workspace_employee_import_save',{p_actor:ctx.user.id,p_request:b.requestId,p_rows:rows,p_visible:allowed.map(s=>s.id)});
 if(result.error){if(/IMPORT_(CONFLICT|REQUEST_REUSED)/.test(result.error.message))throw new WorkspaceError(409,'員編、門市或本次匯入內容已變動，請重新預覽後再確認');throw new WorkspaceError(503,'尚未取得匯入成功結果，請保留目前內容並重試；相同批次不會重複新增');}
 return respond(result.data);
}catch(e){return failed(e);}}
