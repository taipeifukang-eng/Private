import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export type AuthorizedStore = {
  id: string;
  store_code: string;
  store_name: string;
};

function isStoreScopedJobTitle(jobTitle: string | null | undefined) {
  const title = String(jobTitle || '').trim();
  return ['店長', '代理店長', '督導', '督導(代理店長)'].includes(title);
}

function isManagerJobTitle(jobTitle: string | null | undefined) {
  const title = String(jobTitle || '').trim();
  return ['經理', '副理', '區經理', '營業經理', '區域經理', '門市經理'].some((k) => title.includes(k));
}

export type ClinicSelfpayAccess = {
  canUseCalculator: boolean;
  canManageMapping: boolean;
  canDeleteBatch: boolean;
};

export async function getCurrentUserId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

export async function getClinicSelfpayAccess(userId: string): Promise<ClinicSelfpayAccess> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('role, job_title')
    .eq('id', userId)
    .maybeSingle();

  const title = String(profile?.job_title || '').trim();
  const isStoreTitle = isStoreScopedJobTitle(title);
  const isManagerTitle = isManagerJobTitle(title);

  const legacyOrCalcAllowed = await hasAnyPermission(userId, [
    'store.clinic_selfpay.margin',
    'store.clinic_selfpay.calculator.use',
  ]);

  const mappingAllowed = await hasAnyPermission(userId, [
    'store.clinic_selfpay.margin',
    'store.clinic_selfpay.mapping.manage',
  ]);

  const deleteAllowed = await hasAnyPermission(userId, [
    'store.clinic_selfpay.batch.delete',
  ]);

  return {
    canUseCalculator: legacyOrCalcAllowed || isStoreTitle || isManagerTitle,
    canManageMapping: mappingAllowed || isManagerTitle,
    canDeleteBatch: deleteAllowed || isManagerTitle,
  };
}

export async function getAuthorizedStores(userId: string): Promise<AuthorizedStore[]> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, job_title')
    .eq('id', userId)
    .maybeSingle();

  const storeScopedByTitle = isStoreScopedJobTitle(profile?.job_title);

  if (profile?.role === 'admin' && !storeScopedByTitle) {
    const { data } = await admin
      .from('stores')
      .select('id, store_code, store_name')
      .eq('is_active', true)
      .order('store_code', { ascending: true });
    return (data || []) as AuthorizedStore[];
  }

  const { data: managed } = await admin
    .from('store_managers')
    .select('store_id, stores!inner(id, store_code, store_name)')
    .eq('user_id', userId)
    .eq('stores.is_active', true);

  const mapped = (managed || [])
    .map((row: any) => row.stores)
    .filter(Boolean) as AuthorizedStore[];

  const deduped = new Map<string, AuthorizedStore>();
  mapped.forEach((s) => {
    if (!deduped.has(s.id)) deduped.set(s.id, s);
  });

  return Array.from(deduped.values()).sort((a, b) => a.store_code.localeCompare(b.store_code));
}

export function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

export function parseRocDateToIso(raw: string): string | null {
  const s = raw.replace(/\s/g, '');
  const m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toYearMonth(isoDate: string | null): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  return isoDate.slice(0, 7);
}
