import { NextRequest } from 'next/server';
import * as listing from '@/app/api/employee-purchases/route';
import * as details from '@/app/api/employee-purchases/employee-details/route';
import * as importing from '@/app/api/employee-purchases/import/route';
import { context,checkOrigin,requireCapability,failed,WorkspaceError } from '@/lib/workspace/server';
export const dynamic='force-dynamic';
type C={params:{path?:string[]}};
export async function GET(r:NextRequest,c:C){try{
 const ctx=await context();requireCapability(ctx,['employee_purchase.view','employee_purchase.import']);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.nextUrl.searchParams.get('year_month')||''))throw new WorkspaceError(400,'月份格式錯誤');
 const path=(c.params.path||[]).join('/');
 if(path==='employee-details')return details.GET(r);
 if(path)throw new WorkspaceError(404,'找不到此操作');
 const response=await listing.GET(r);if(!response.ok)return response;
 return Response.json({...await response.json(),capabilities:{import:ctx.has('employee_purchase.import')}});
}catch(e){return failed(e)}}
export async function POST(r:NextRequest,c:C){try{
 const ctx=await context();checkOrigin(r);requireCapability(ctx,['employee_purchase.import']);
 if((c.params.path||[]).join('/')!=='import')throw new WorkspaceError(404,'找不到此操作');
 return importing.POST(r);
}catch(e){return failed(e)}}
