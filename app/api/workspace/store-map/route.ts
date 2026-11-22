import {checked,context,failed,requireCapability,respond} from '@/lib/workspace/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const ctx=await context();requireCapability(ctx,['store.store.view','store.store.view_inactive','store.manage']);
 const canInactive=ctx.has('store.store.view_inactive','store.manage');
 const inactive=canInactive&&new URL(request.url).searchParams.get('inactive')==='true';
 const stores:any[]=[];
 for(let from=0;;from+=500){
  let query=ctx.auth.from('stores').select('id,store_code,store_name,short_name,address,phone,is_active,gps_latitude,gps_longitude').order('store_code').order('id').range(from,from+499);
  if(!inactive)query=query.eq('is_active',true);
  const rows=checked(await query)||[];stores.push(...rows);if(rows.length<500)break;
 }
 return respond({stores,canInactive,apiKey:process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY||process.env.VITE_GOOGLE_MAPS_API_KEY||'',mapId:process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID'});
}catch(error){return failed(error);}}
