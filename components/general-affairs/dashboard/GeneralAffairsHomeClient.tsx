'use client';

import { useEffect, useMemo, useState } from 'react';
import GeneralAffairsDashboardClient from '@/components/general-affairs/dashboard/GeneralAffairsDashboardClient';
import {
  GeneralAffairsErrorState,
  GeneralAffairsLoadingState,
  GeneralAffairsPermissionDeniedState,
} from '@/components/general-affairs/GeneralAffairsPageState';
import {
  GA_MAINTENANCE_REQUEST_CREATE,
  GA_MAINTENANCE_REQUEST_UPDATE,
  GA_MAINTENANCE_REQUEST_VIEW_ALL,
} from '@/lib/general-affairs/maintenance-permissions';

type Profile = {
  full_name?: string | null;
  email?: string | null;
};

type HomeState = {
  loading: boolean;
  permissionDenied: boolean;
  profile: Profile | null;
  permissions: string[];
  error: string;
};

const INITIAL_STATE: HomeState = {
  loading: true,
  permissionDenied: false,
  profile: null,
  permissions: [],
  error: '',
};

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(json.error || '載入總務服務中心失敗');
  }
  return json;
}

export default function GeneralAffairsHomeClient() {
  const [state, setState] = useState<HomeState>(INITIAL_STATE);

  useEffect(() => {
    let canceled = false;

    async function loadHomeContext() {
      setState(INITIAL_STATE);

      try {
        const [profileResponse, permissionResponse] = await Promise.all([
          fetch('/api/user/profile', { cache: 'no-store' }),
          fetch('/api/permissions/user', { cache: 'no-store' }),
        ]);

        if (profileResponse.status === 401 || permissionResponse.status === 401) {
          if (!canceled) {
            setState({
              ...INITIAL_STATE,
              loading: false,
              permissionDenied: true,
            });
          }
          return;
        }

        const [profileJson, permissionJson] = await Promise.all([
          parseJsonResponse(profileResponse),
          parseJsonResponse(permissionResponse),
        ]);

        if (!canceled) {
          setState({
            loading: false,
            permissionDenied: false,
            profile: profileJson.profile || null,
            permissions: Array.isArray(permissionJson.permissions) ? permissionJson.permissions : [],
            error: '',
          });
        }
      } catch (error) {
        if (!canceled) {
          setState({
            ...INITIAL_STATE,
            loading: false,
            error: error instanceof Error ? error.message : '載入總務服務中心失敗',
          });
        }
      }
    }

    loadHomeContext();

    return () => {
      canceled = true;
    };
  }, []);

  const permissionSet = useMemo(() => new Set(state.permissions), [state.permissions]);
  const hasAnyPermission = (...codes: string[]) => codes.some((code) => permissionSet.has(code));

  const canAccessInventory = hasAnyPermission(
    'general_affairs.inventory_balance.view',
    'general_affairs.inventory_transaction.view',
    'general_affairs.inventory_transaction.manage'
  );
  const canAccessMaintenanceModule = hasAnyPermission(
    GA_MAINTENANCE_REQUEST_CREATE,
    GA_MAINTENANCE_REQUEST_VIEW_ALL,
    GA_MAINTENANCE_REQUEST_UPDATE,
    'general_affairs.service_center.force_close'
  );
  const canAccessEquipment = hasAnyPermission('general_affairs.equipment.view', 'general_affairs.equipment.manage');
  const canAccessFacilities = hasAnyPermission('general_affairs.facility.view', 'general_affairs.facility.manage');
  const canAccessParts = hasAnyPermission('general_affairs.part.view', 'general_affairs.part.manage');
  const canAccessVendors = hasAnyPermission(
    'general_affairs.vendor.view',
    'general_affairs.vendor.manage',
    'general_affairs.service_category.view',
    'general_affairs.service_category.manage',
    'general_affairs.service_region.view',
    'general_affairs.service_region.manage',
    'general_affairs.cooperation_record.view'
  );

  if (state.loading) {
    return <GeneralAffairsLoadingState title="載入總務服務中心" />;
  }

  if (state.permissionDenied || !permissionSet.has('general_affairs.service_center.access')) {
    return (
      <GeneralAffairsPermissionDeniedState
        title="沒有總務服務中心權限"
        description="請確認是否已設定 general_affairs.service_center.access 權限。"
      />
    );
  }

  if (state.error) {
    return (
      <GeneralAffairsErrorState
        title="載入總務服務中心失敗"
        description={state.error}
      />
    );
  }

  return (
    <GeneralAffairsDashboardClient
      profileName={state.profile?.full_name || state.profile?.email || ''}
      canAccessMaintenanceModule={canAccessMaintenanceModule}
      canAccessInventory={canAccessInventory}
      canAccessInventoryLocations={hasAnyPermission(
        'general_affairs.inventory_location.view',
        'general_affairs.inventory_location.manage'
      )}
      canAccessEquipment={canAccessEquipment}
      canAccessFacilities={canAccessFacilities}
      canAccessParts={canAccessParts}
      canAccessVendors={canAccessVendors}
    />
  );
}
