import {api} from './api';
export async function campaignApi(resource:string,query:Record<string,string>={},method='GET',body?:any){
 const result=await api('campaign-tools?'+new URLSearchParams({resource,...query}),{method,...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 if(result.success===false)throw Error(result.error||'操作失敗，請重試');return result;
}
