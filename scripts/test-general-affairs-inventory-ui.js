#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const inventoryPage = read('app/general-affairs/inventory/page.tsx');
const locationsPage = read('app/general-affairs/inventory/locations/page.tsx');
const transactionsClient = read('components/general-affairs/inventory/InventoryTransactionsClient.tsx');
const locationsClient = read('components/general-affairs/inventory/InventoryLocationsClient.tsx');
const navbar = read('components/Navbar.tsx');
const navbarPermissions = read('hooks/useNavbarPermissions.ts');

assert(
  inventoryPage.includes("import InventoryTransactionsClient") &&
    inventoryPage.includes('<InventoryTransactionsClient />'),
  'inventory page must render the transaction and balance client'
);

assert(
  locationsPage.includes("import InventoryLocationsClient") &&
    locationsPage.includes('<InventoryLocationsClient />'),
  'inventory locations page must render the location settings client'
);

for (const [label, source] of [
  ['transactions client', transactionsClient],
  ['locations client', locationsClient],
]) {
  assert(
    source.includes("href=\"/general-affairs/inventory\"") &&
      source.includes("href=\"/general-affairs/inventory/locations\"") &&
      source.includes('庫存交易與餘額') &&
      source.includes('位置與料件設定'),
    `${label} must expose both inventory subpage navigation links`
  );

  assert(
    source.includes('aria-current="page"'),
    `${label} must mark the active inventory subpage`
  );

  assert(
    !source.includes('SUPABASE_SERVICE_ROLE_KEY') &&
      !source.includes('service_role') &&
      !source.includes('supabase db push') &&
      !source.includes('migration repair'),
    `${label} must not include privileged DB or migration operations`
  );
}

assert(
  transactionsClient.includes('庫存餘額') &&
    transactionsClient.includes('新增庫存交易') &&
    transactionsClient.includes('庫存流水') &&
    transactionsClient.includes('負庫存筆數') &&
    transactionsClient.includes('transactionPartFilter'),
  'inventory transaction UI must include balances, posting, history, summary and part filtering'
);

assert(
  transactionsClient.includes('料件持有狀態') &&
    transactionsClient.includes('總持有') &&
    transactionsClient.includes('閒置可調撥') &&
    transactionsClient.includes('使用中') &&
    transactionsClient.includes('待確認') &&
    transactionsClient.includes('holdingSummary') &&
    transactionsClient.includes('holdingFilter') &&
    transactionsClient.includes('visibleBalances') &&
    transactionsClient.includes('清除持有篩選') &&
    transactionsClient.includes('調整狀態') &&
    transactionsClient.includes('/holding'),
  'inventory transaction UI must show filterable part holding status and transferable inventory perspective'
);

assert(
  transactionsClient.includes('缺少 general_affairs.part.view，因此無法建立庫存交易。') &&
    transactionsClient.includes('目前帳號沒有庫存交易管理權限。') &&
    transactionsClient.includes('目前帳號沒有庫存餘額查看權限'),
  'inventory transaction UI must keep explicit permission and part catalog denial messages'
);

assert(
  locationsClient.includes('尚有未儲存變更，確定要離開嗎？') &&
    locationsClient.includes('缺少 general_affairs.part.view，因此無法新增位置料件設定。') &&
    locationsClient.includes('庫存位置與料件設定') &&
    locationsClient.includes('預設位置'),
  'inventory location UI must keep dirty prompt, part.view warning and location policy controls'
);

assert(
  navbar.includes("{ href: '/general-affairs/inventory', label: '庫存管理'") &&
    navbar.includes('show: permissions.canAccessGeneralAffairsInventory'),
  'navbar must expose inventory management through the permission-gated general affairs menu'
);

assert(
  navbarPermissions.includes('canAccessGeneralAffairsInventory') &&
    navbarPermissions.includes("general_affairs.inventory_balance.view") &&
    navbarPermissions.includes("general_affairs.inventory_transaction.view") &&
    navbarPermissions.includes("general_affairs.inventory_transaction.manage"),
  'navbar inventory visibility must be based on inventory effective permissions'
);

console.log('General affairs inventory UI static tests passed');
