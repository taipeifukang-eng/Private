/** Short login name is supported only in the isolated DEV project. */
export function resolveLoginEmail(account: string): string {
  const value = account.trim();
  let isDev = false;
  try {
    isDev = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname === 'mjpdfpxqttbhzeimmtqr.supabase.co';
  } catch { /* Invalid configuration must not enable the DEV alias. */ }
  return isDev && value.toLowerCase() === 'administrator'
    ? 'administrator@example.test'
    : value;
}
