import type { ReactNode } from 'react';
import { AlertCircle, Ban, Inbox, Loader2, Wrench } from 'lucide-react';

type PageStateTone = 'neutral' | 'warning' | 'danger';

type GeneralAffairsPageStateProps = {
  type: 'loading' | 'empty' | 'error' | 'permission-denied' | 'module-unavailable';
  title?: string;
  description?: string;
  action?: ReactNode;
  requiredPermission?: string;
};

const REDACTED_ERROR_PATTERNS = [
  /schema cache/gi,
  /postgres/gi,
  /public\.[a-z0-9_]+/gi,
  /migration_[a-z0-9_]+\.sql/gi,
  /SQLSTATE\s?[0-9A-Z]+/gi,
  /stack trace/gi,
];

export function sanitizeGeneralAffairsErrorMessage(message: string) {
  return REDACTED_ERROR_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '系統診斷資訊'),
    message,
  );
}

function toneClasses(tone: PageStateTone) {
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-800';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-white text-slate-700';
}

export default function GeneralAffairsPageState({
  type,
  title,
  description,
  action,
  requiredPermission,
}: GeneralAffairsPageStateProps) {
  const meta = {
    loading: {
      icon: Loader2,
      defaultTitle: '載入資料中',
      defaultDescription: '正在取得總務服務中心資料。',
      tone: 'neutral' as PageStateTone,
      spin: true,
    },
    empty: {
      icon: Inbox,
      defaultTitle: '目前沒有資料',
      defaultDescription: '調整篩選條件或新增第一筆資料。',
      tone: 'neutral' as PageStateTone,
      spin: false,
    },
    error: {
      icon: AlertCircle,
      defaultTitle: '載入失敗',
      defaultDescription: '系統暫時無法載入資料，請稍後再試。',
      tone: 'danger' as PageStateTone,
      spin: false,
    },
    'permission-denied': {
      icon: Ban,
      defaultTitle: '目前帳號沒有此功能權限',
      defaultDescription: '請確認角色權限設定，或聯絡系統管理員。',
      tone: 'warning' as PageStateTone,
      spin: false,
    },
    'module-unavailable': {
      icon: Wrench,
      defaultTitle: '此功能尚未在目前測試環境開放',
      defaultDescription: '此入口已受到 availability guard 保護，待模組完成後再開放操作。',
      tone: 'neutral' as PageStateTone,
      spin: false,
    },
  }[type];

  const Icon = meta.icon;
  const safeDescription = description ? sanitizeGeneralAffairsErrorMessage(description) : meta.defaultDescription;

  return (
    <section className={`rounded-lg border p-6 text-center ${toneClasses(meta.tone)}`}>
      <Icon className={`mx-auto h-8 w-8 ${meta.spin ? 'animate-spin text-orange-600' : ''}`} />
      <h2 className="mt-3 text-lg font-semibold">{title || meta.defaultTitle}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 opacity-90">{safeDescription}</p>
      {requiredPermission && (
        <p className="mt-3 text-xs font-semibold">
          缺少權限：<code className="rounded bg-white/70 px-1.5 py-0.5">{requiredPermission}</code>
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </section>
  );
}

export function GeneralAffairsLoadingState(props: Omit<GeneralAffairsPageStateProps, 'type'>) {
  return <GeneralAffairsPageState type="loading" {...props} />;
}

export function GeneralAffairsEmptyState(props: Omit<GeneralAffairsPageStateProps, 'type'>) {
  return <GeneralAffairsPageState type="empty" {...props} />;
}

export function GeneralAffairsErrorState(props: Omit<GeneralAffairsPageStateProps, 'type'>) {
  return <GeneralAffairsPageState type="error" {...props} />;
}

export function GeneralAffairsPermissionDeniedState(props: Omit<GeneralAffairsPageStateProps, 'type'>) {
  return <GeneralAffairsPageState type="permission-denied" {...props} />;
}

export function GeneralAffairsModuleUnavailableState(props: Omit<GeneralAffairsPageStateProps, 'type'>) {
  return <GeneralAffairsPageState type="module-unavailable" {...props} />;
}
