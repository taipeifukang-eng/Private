'use client';

// ============================================
// 權限檢查 React Hooks
// ============================================

import { useEffect, useState } from 'react';

/**
 * 檢查單一權限
 */
export function usePermission(permissionCode: string) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    async function checkPermission() {
      try {
        const response = await fetch('/api/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode })
        });

        const data = await response.json();
        setAllowed(data.allowed === true);
      } catch (error) {
        console.error('權限檢查失敗:', error);
        setAllowed(false);
      } finally {
        setLoading(false);
      }
    }

    checkPermission();
  }, [permissionCode]);

  return { allowed, loading };
}

/**
 * 檢查多個權限 (任一)
 */
export function useAnyPermission(permissionCodes: string[]) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    async function checkPermissions() {
      try {
        const response = await fetch('/api/permissions/check-multiple', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            permissionCodes,
            mode: 'any'
          })
        });

        const data = await response.json();
        setAllowed(data.allowed === true);
      } catch (error) {
        console.error('權限檢查失敗:', error);
        setAllowed(false);
      } finally {
        setLoading(false);
      }
    }

    checkPermissions();
  }, [permissionCodes]);

  return { allowed, loading };
}

/**
 * 檢查多個權限 (全部)
 */
export function useAllPermissions(permissionCodes: string[]) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    async function checkPermissions() {
      try {
        const response = await fetch('/api/permissions/check-multiple', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            permissionCodes,
            mode: 'all'
          })
        });

        const data = await response.json();
        setAllowed(data.allowed === true);
      } catch (error) {
        console.error('權限檢查失敗:', error);
        setAllowed(false);
      } finally {
        setLoading(false);
      }
    }

    checkPermissions();
  }, [permissionCodes]);

  return { allowed, loading };
}

/**
 * 取得使用者所有權限
 */
export function useUserPermissions() {
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    async function fetchPermissions() {
      try {
        const response = await fetch('/api/permissions/user');
        const data = await response.json();
        setPermissions(data.permissions || []);
      } catch (error) {
        console.error('取得權限列表失敗:', error);
        setPermissions([]);
      } finally {
        setLoading(false);
      }
    }

    fetchPermissions();
  }, []);

  return { permissions, loading };
}
