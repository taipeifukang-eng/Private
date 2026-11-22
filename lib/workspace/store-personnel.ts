import { checked, type Context } from './server';

// Match the legacy store personnel page, in addition to workspace store access.
export async function canReadStorePersonnel(ctx: Context) {
  const profile = checked(await ctx.auth.from('profiles').select('role,department,job_title').eq('id', ctx.user.id).maybeSingle());
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const assignedPosition = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
  return !assignedPosition && !!profile.department?.startsWith('營業') && ['member', 'manager'].includes(profile.role);
}
