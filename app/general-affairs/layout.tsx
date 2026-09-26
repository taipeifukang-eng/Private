import { getCurrentUser } from '@/app/auth/actions';
import GeneralAffairsShell from '@/components/general-affairs/GeneralAffairsShell';

export default async function GeneralAffairsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getCurrentUser();

  return (
    <GeneralAffairsShell userId={user?.id || null}>
      {children}
    </GeneralAffairsShell>
  );
}
