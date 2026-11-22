import { checked, context, failed, requireCapability, respond } from '@/lib/workspace/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { try {
  const ctx = await context(); requireCapability(ctx, ['organization.member.manage', 'organization.manager.manage']);
  const search = (new URL(request.url).searchParams.get('q') || '').trim().toLocaleLowerCase();
  const people: any[] = [];
  for (let start = 0; ; start += 500) {
    const rows = checked(await ctx.admin.from('profiles').select('id,full_name,email,employee_code,job_title,department').order('id').range(start, start + 499)) || [];
    people.push(...rows.filter(row => !search || [row.full_name, row.email, row.employee_code, row.job_title, row.department].some(value => String(value || '').toLocaleLowerCase().includes(search))));
    if (rows.length < 500) break;
  }
  people.sort((a, b) => String(a.employee_code || '').localeCompare(String(b.employee_code || '')) || a.id.localeCompare(b.id));
  return respond({ people });
} catch (e) { return failed(e); } }
