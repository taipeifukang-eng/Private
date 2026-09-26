import Link from 'next/link';
import { Building2, Layers3 } from 'lucide-react';

type Props = {
  assetType: 'equipment' | 'facility';
  current: 'instances' | 'catalog';
};

export default function AssetScopeTabs({ assetType, current }: Props) {
  const isEquipment = assetType === 'equipment';
  const baseHref = isEquipment ? '/general-affairs/equipment' : '/general-affairs/facilities';
  const tabs = [
    {
      id: 'instances' as const,
      label: isEquipment ? '據點設備清冊' : '據點設施清冊',
      href: baseHref,
      icon: Building2,
    },
    {
      id: 'catalog' as const,
      label: isEquipment ? '公司設備型號' : '公司設施架型',
      href: `${baseHref}/templates`,
      icon: Layers3,
    },
  ];

  return (
    <nav className="mb-5 flex w-fit max-w-full overflow-x-auto rounded-md border border-slate-200 bg-white p-1" aria-label="資產資料範圍">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded px-3 text-sm font-semibold ${
              active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
