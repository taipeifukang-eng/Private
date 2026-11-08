export function campaignDates(start:string,end:string){const result:string[]=[];for(let d=new Date(start+'T00:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){result.push(d.toISOString().slice(0,10));if(result.length>3660)break;}return result;}
export function availableCampaignDates(dates:string[],events:any[]){return dates.filter(date=>[3,6,7].includes(new Date(date+'T00:00:00Z').getUTCDay()||7)&&!events.some(e=>e.event_date.slice(0,10)===date&&e.is_blocked));}
// 舊版：活動期間內沒有可用日期時直接提示、不排程（週三、週六、週日且未被阻擋）。
export const NO_AVAILABLE_DATES_MESSAGE='活動期間內沒有可用的排程日期（週三、週六、週日且未被阻擋）';
export function runAutoSchedule(stores:any[],dates:string[],settings:any[],events:any[]):{noDates:true;message:string}|{noDates:false;schedules:{store_id:string;activity_date:string}[];failed:any[]}{
 if(!availableCampaignDates(dates,events).length)return {noDates:true,message:NO_AVAILABLE_DATES_MESSAGE};
 return {noDates:false,...autoCampaignSchedule(stores,dates,settings,events)};
}
export function autoCampaignSchedule(stores:any[],dates:string[],settings:any[],events:any[]){
 const available=availableCampaignDates(dates,events);
 const schedules:{store_id:string;activity_date:string}[]=[],groups=new Map<string,Set<string>>();let failed:any[]=[];
 const assign=(store:any,strict:boolean)=>{const group=store.supervisor_id||'unassigned',rule=settings.find(s=>s.store_id===store.id);for(const date of available){const day=new Date(date+'T00:00:00Z').getUTCDay()||7;
  if(rule?.forbidden_days?.includes(day)||rule?.allowed_days?.length&&!rule.allowed_days.includes(day)||groups.get(date)?.has(group))continue;
  if(strict&&[-1,1].some(offset=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return groups.get(d.toISOString().slice(0,10))?.has(group);}))continue;
  schedules.push({store_id:store.id,activity_date:date});if(!groups.has(date))groups.set(date,new Set());groups.get(date)!.add(group);return true;
 }return false;};
 for(const store of stores)if(!assign(store,true))failed.push(store);failed=failed.filter(s=>!assign(s,false));return {schedules,failed};
}
