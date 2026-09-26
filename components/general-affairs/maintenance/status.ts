import {
  MAINTENANCE_STATUS_LABELS,
  type MaintenanceTicketAction,
  type MaintenanceTicketStatus,
} from '@/lib/maintenance/status';

export type MaintenanceStatusTone = {
  badge: string;
  dot: string;
  iconKey: 'clock' | 'check' | 'settings';
};

export type MaintenanceStatusDefinition = {
  code: MaintenanceTicketStatus;
  label: string;
  tone: MaintenanceStatusTone;
  isTerminal: boolean;
  supportedManageActions: MaintenanceTicketAction[];
};

export const MAINTENANCE_STATUS_DEFINITIONS: MaintenanceStatusDefinition[] = [
  {
    code: 'UNACCEPTED',
    label: MAINTENANCE_STATUS_LABELS.UNACCEPTED,
    tone: {
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      dot: 'bg-amber-400',
      iconKey: 'clock',
    },
    isTerminal: false,
    supportedManageActions: ['ACCEPT'],
  },
  {
    code: 'ACCEPTED',
    label: MAINTENANCE_STATUS_LABELS.ACCEPTED,
    tone: {
      badge: 'bg-sky-50 text-sky-700 border-sky-200',
      dot: 'bg-sky-500',
      iconKey: 'check',
    },
    isTerminal: false,
    supportedManageActions: ['SAVE_PROGRESS', 'REQUEST_COMPLETION', 'FORCE_CLOSE'],
  },
  {
    code: 'PROCESSING',
    label: MAINTENANCE_STATUS_LABELS.PROCESSING,
    tone: {
      badge: 'bg-blue-50 text-blue-700 border-blue-200',
      dot: 'bg-blue-500',
      iconKey: 'settings',
    },
    isTerminal: false,
    supportedManageActions: ['SAVE_PROGRESS', 'REQUEST_COMPLETION', 'FORCE_CLOSE'],
  },
  {
    code: 'COMPLETED',
    label: MAINTENANCE_STATUS_LABELS.COMPLETED,
    tone: {
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dot: 'bg-emerald-500',
      iconKey: 'check',
    },
    isTerminal: true,
    supportedManageActions: [],
  },
];

export const MAINTENANCE_STATUS_DEFINITION_BY_CODE = Object.fromEntries(
  MAINTENANCE_STATUS_DEFINITIONS.map((definition) => [definition.code, definition]),
) as Record<MaintenanceTicketStatus, MaintenanceStatusDefinition>;

export const MAINTENANCE_STATUS_STEPS = MAINTENANCE_STATUS_DEFINITIONS.map((definition) => ({
  status: definition.code,
  label: definition.label,
}));

export const PLANNED_MAINTENANCE_ACTIONS = [
  'vendor_dispatch',
  'vendor_quote',
  'cost_claim',
  'formal_attachment',
  'work_order_part_issue',
  'sla_auto_overdue',
] as const;
