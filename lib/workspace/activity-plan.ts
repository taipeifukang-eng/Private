import { NextRequest } from 'next/server';
import { GET as details } from '@/app/api/campaign-store-details/route';
import { GET as ownStaff } from '@/app/api/campaign-store-own-staff/route';
import { GET as requests } from '@/app/api/campaign-support-requests/route';
import { GET as supportStaff } from '@/app/api/campaign-support-staff/route';
import { GET as headcount } from '@/app/api/campaign-store-headcount/route';
import { GET as checklist } from '@/app/api/campaign-checklist-items/route';
import { GET as completions } from '@/app/api/campaign-checklist-completions/route';
import { GET as trips } from '@/app/api/campaign-equipment-trips/route';
import { GET as departments } from '@/app/api/campaign-department-publish/route';

// Call only after campaignView has authorized the published audience. Preserve
// each legacy reader's additional access checks and restrict store rows again.
export async function activityPlan(url: URL, campaignId: string, storeIds: string[]): Promise<Record<string, any> & {errors:Record<string,string>}> {
  const target = new URL(url.origin + '/api/workspace/monthly/tools');
  target.searchParams.set('campaign_id', campaignId);
  const readers = { details, ownStaff, requests, supportStaff, headcount, checklist, completions, trips, departments };
  const result: Record<string, any> = {}, errors: Record<string, string> = {};
  const entries = Object.entries(readers);
  const responses = await Promise.allSettled(entries.map(async ([, read]) => {
    const response = await read(new NextRequest(target));
    const body = await response.json();
    if (!response.ok || body.success === false) throw new Error(response.status === 403 ? '無查看權限' : '讀取失敗，請重試');
    return body.data;
  }));
  responses.forEach((r, i) => {
    const key = entries[i][0];
    if (r.status === 'fulfilled') result[key] = r.value;
    else { result[key] = key === 'departments' ? null : []; errors[key] = r.reason?.message || '讀取失敗，請重試'; }
  });
  const allowed = new Set(storeIds);
  for (const key of ['details', 'ownStaff', 'headcount', 'completions']) result[key] = (result[key] || []).filter((r: any) => allowed.has(r.store_id));
  result.requests = (result.requests || []).filter((r: any) => allowed.has(r.requesting_store_id));
  const requestIds = new Set(result.requests.map((r: any) => r.id));
  result.supportStaff = (result.supportStaff || []).filter((r: any) => allowed.has(r.requesting_store_id) && requestIds.has(r.support_request_id));
  return { ...result, errors };
}
