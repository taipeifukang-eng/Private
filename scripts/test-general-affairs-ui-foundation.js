const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function matchAll(text, pattern) {
  return Array.from(text.matchAll(pattern));
}

function getNavigationItemBlock(itemId) {
  const pattern = new RegExp(`id:\\s*'${itemId}'[\\s\\S]*?(?=\\n\\s*\\{\\n\\s*id:|\\n\\s*\\],|\\n\\s*\\},\\n\\s*\\{\\n\\s*id:)`);
  return navigation.match(pattern)?.[0] || '';
}

function getNavigationItemHeaderBlock(itemId) {
  const block = getNavigationItemBlock(itemId);
  return block.split('children: [')[0] || block;
}

const navigationPath = 'components/general-affairs/navigation.tsx';
const featuresPath = 'components/general-affairs/features.ts';
const sidebarPath = 'components/general-affairs/GeneralAffairsSidebar.tsx';
const shellPath = 'components/general-affairs/GeneralAffairsShell.tsx';
const headerPath = 'components/general-affairs/GeneralAffairsPageHeader.tsx';
const statePath = 'components/general-affairs/GeneralAffairsPageState.tsx';
const templatesPath = 'components/general-affairs/GeneralAffairsPageTemplates.tsx';
const layoutPath = 'app/general-affairs/layout.tsx';
const navbarPath = 'components/Navbar.tsx';
const vendorRoutePaths = [
  'app/general-affairs/vendors/page.tsx',
  'app/general-affairs/vendors/categories/page.tsx',
  'app/general-affairs/vendors/regions/page.tsx',
  'app/general-affairs/vendors/stats/page.tsx',
];

[
  navigationPath,
  featuresPath,
  sidebarPath,
  shellPath,
  headerPath,
  statePath,
  templatesPath,
  layoutPath,
  navbarPath,
  ...vendorRoutePaths,
].forEach((file) => {
  assert(fs.existsSync(path.join(root, file)), `${file} should exist`);
});

const navigation = read(navigationPath);
const features = read(featuresPath);
const sidebar = read(sidebarPath);
const shell = read(shellPath);
const header = read(headerPath);
const state = read(statePath);
const templates = read(templatesPath);
const layout = read(layoutPath);
const navbar = read(navbarPath);

console.log('RUN navigation definition has unique ids');
const ids = matchAll(navigation, /id:\s*'([^']+)'/g).map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `duplicate navigation ids: ${duplicates.join(', ')}`);
assert(ids.length >= 15, 'navigation should include current and planned General Affairs items');
console.log('PASS navigation definition has unique ids');

console.log('RUN navigation hrefs are scoped to General Affairs');
const hrefs = matchAll(navigation, /href:\s*'([^']+)'/g).map((match) => match[1]);
assert(hrefs.length >= 10, 'navigation should include available General Affairs hrefs');
hrefs.forEach((href) => {
  assert(href.startsWith('/general-affairs'), `navigation href must stay in General Affairs: ${href}`);
});
console.log('PASS navigation hrefs are scoped to General Affairs');

console.log('RUN permission codes are effective-permission style');
const permissionCodes = matchAll(navigation, /'([a-z_]+\.[a-z0-9_.]+)'/g)
  .map((match) => match[1])
  .filter((code) => code.includes('.'));
assert(permissionCodes.length >= 12, 'navigation should define permission code guards');
permissionCodes.forEach((code) => {
  assert(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(code), `invalid permission code format: ${code}`);
});
console.log('PASS permission codes are effective-permission style');

console.log('RUN no account-name or role-name driven navigation');
const forbiddenIdentityPatterns = [
  /@example\.test/i,
  /dev-full-admin/i,
  /dev-ga-/i,
  /profile\.role\s*===/i,
  /role\s*name/i,
  /email\s*===/i,
];
[navigation, sidebar, shell].forEach((text, index) => {
  forbiddenIdentityPatterns.forEach((pattern) => {
    assert(!pattern.test(text), `identity-driven navigation pattern found in file index ${index}: ${pattern}`);
  });
});
console.log('PASS no account-name or role-name driven navigation');

console.log('RUN planned or unavailable features are not clickable');
const plannedFeatureKeys = matchAll(features, /\n\s+\w+:\s*\{[^}]*key:\s*'([^']+)'[^}]*status:\s*'(planned|temporarily_unavailable)'/g)
  .map((match) => match[1]);
plannedFeatureKeys.forEach((key) => {
  const itemBlockPattern = new RegExp(`featureKey:\\s*'${key}'[\\s\\S]*?(?=\\n\\s*\\{\\n\\s*id:|\\n\\s*\\],|\\n\\s*\\})`);
  const block = navigation.match(itemBlockPattern)?.[0] || '';
  assert(!/href:\s*'/.test(block), `planned/unavailable feature should not have clickable href: ${key}`);
});
console.log('PASS planned or unavailable features are not clickable');

console.log('RUN groups hide when no visible children');
assert(navigation.includes('.filter((group) => group.items.length > 0)'), 'group filtering should remove empty groups');
assert(navigation.includes('filterNavItem'), 'navigation should filter items before rendering');
console.log('PASS groups hide when no visible children');

console.log('RUN desktop and mobile use the same navigation definition');
assert(sidebar.includes('getVisibleGeneralAffairsNavGroups'), 'sidebar must use shared navigation filtering');
assert(navbar.includes('href="/general-affairs"'), 'top navbar should link directly to General Affairs home');
assert(!navbar.includes('getVisibleGeneralAffairsNavbarItems'), 'top navbar must not render General Affairs feature dropdown items');
assert(shell.includes('<GeneralAffairsSidebar'), 'shell must render GeneralAffairsSidebar for desktop/mobile');
console.log('PASS desktop and mobile use the same navigation definition');

const activeTestItems = [
  { id: 'service-home', href: '/general-affairs', activeMatch: 'exact' },
  { id: 'new-maintenance-report', href: '/general-affairs/reports/new', activeMatch: 'prefix' },
  { id: 'maintenance', href: '/general-affairs/reports/mine', activeMatch: 'prefix' },
  { id: 'parts-list', href: '/general-affairs/parts', activeMatch: 'prefix' },
  { id: 'part-new', href: '/general-affairs/parts/new', activeMatch: 'prefix' },
  { id: 'inventory-overview', href: '/general-affairs/inventory', activeMatch: 'prefix' },
  { id: 'inventory-locations', href: '/general-affairs/inventory/locations', activeMatch: 'prefix' },
  { id: 'equipment-list', href: '/general-affairs/equipment', activeMatch: 'exact' },
  { id: 'equipment-templates', href: '/general-affairs/equipment/templates', activeMatch: 'prefix' },
  { id: 'equipment-categories', href: '/general-affairs/equipment/categories', activeMatch: 'prefix' },
  { id: 'equipment-new', href: '/general-affairs/equipment/new', activeMatch: 'prefix' },
  { id: 'facility-list', href: '/general-affairs/facilities', activeMatch: 'exact' },
  { id: 'facility-templates', href: '/general-affairs/facilities/templates', activeMatch: 'prefix' },
  { id: 'facility-categories', href: '/general-affairs/facilities/categories', activeMatch: 'prefix' },
  { id: 'facility-new', href: '/general-affairs/facilities/new', activeMatch: 'prefix' },
  { id: 'vendors-list', href: '/general-affairs/vendors', activeMatch: 'prefix' },
  { id: 'vendor-categories', href: '/general-affairs/vendors/categories', activeMatch: 'prefix' },
  { id: 'vendor-regions', href: '/general-affairs/vendors/regions', activeMatch: 'prefix' },
  { id: 'vendor-stats', href: '/general-affairs/vendors/stats', activeMatch: 'prefix' },
];

function getActiveItemIdForTest(pathname, currentPath, items) {
  const exactMatch = items
    .filter((item) => {
      if (item.activePaths?.some((activePath) => pathname === activePath)) return true;
      if (item.href.includes('?')) return currentPath === item.href;
      return pathname === item.href;
    })
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (exactMatch) return exactMatch.id;

  const prefixMatch = items
    .filter((item) => {
      if (item.activeMatch !== 'prefix') return false;
      const activePaths = [
        ...(!item.href.includes('?') ? [item.href] : []),
        ...(item.activePaths || []),
      ];
      return activePaths.some((activePath) => pathname.startsWith(`${activePath}/`));
    })
    .sort((a, b) => b.href.length - a.href.length)[0];

  return prefixMatch?.id || null;
}

function assertActive(pathname, expectedId, currentPath = pathname) {
  const activeId = getActiveItemIdForTest(pathname, currentPath, activeTestItems);
  assert(activeId === expectedId, `${pathname} expected active ${expectedId}, got ${activeId}`);
  const activeCount = activeTestItems.filter((item) => item.id === activeId).length;
  assert(activeCount <= 1, `${pathname} should have at most one active item`);
}

console.log('RUN inventory exact active');
assertActive('/general-affairs/inventory', 'inventory-overview');
assert(navigation.includes("id: 'parts'"), 'parts management parent should exist');
assert(navigation.includes("id: 'parts-list'"), 'parts parent should contain parts list child');
assert(navigation.includes("label: '料件列表'"), 'parts parent should contain parts list label');
assert(navigation.includes("id: 'inventory-management'"), 'inventory management parent should exist');
assert(navigation.includes("id: 'inventory-overview'"), 'inventory management parent should contain overview child');
assert(navigation.includes("id: 'inventory-locations'"), 'parts parent should contain inventory locations child');
console.log('PASS inventory exact active');

console.log('RUN inventory location longest match');
assertActive('/general-affairs/inventory/locations', 'inventory-locations');
assert(getActiveItemIdForTest('/general-affairs/inventory/locations', '/general-affairs/inventory/locations', activeTestItems) !== 'inventory-overview', 'inventory overview should not stay active for inventory locations');
console.log('PASS inventory location longest match');

console.log('RUN single active item');
assert(navigation.includes('getActiveGeneralAffairsNavItemId'), 'navigation should expose a single active item helper');
assert(sidebar.includes('activeItemId'), 'sidebar should render from one active item id');
assert(!sidebar.includes('hasActiveChild'), 'sidebar should not mark parent items active through active children');
console.log('PASS single active item');

console.log('RUN request routes active');
assertActive('/general-affairs/reports/new', 'new-maintenance-report');
assertActive('/general-affairs/reports/mine', 'maintenance');
assert(!navigation.includes("id: 'new-part-request'"), 'legacy new part request nav item should not remain');
assert(!navigation.includes("id: 'my-part-requests'"), 'legacy my part requests nav item should not remain');
console.log('PASS request routes active');

console.log('RUN equipment active');
assertActive('/general-affairs/equipment', 'equipment-list');
assertActive('/general-affairs/equipment/templates', 'equipment-templates');
assertActive('/general-affairs/equipment/categories', 'equipment-categories');
assertActive('/general-affairs/equipment/new', 'equipment-new');
assert(getActiveItemIdForTest('/general-affairs/equipment/templates', '/general-affairs/equipment/templates', activeTestItems) !== 'equipment-list', 'equipment list must not stay active on company equipment catalog');
assertActive('/general-affairs/equipment/templates', 'equipment-templates');
assert(getNavigationItemBlock('equipment').includes("children: ["), 'equipment management should expand children instead of navigating');
assert(!getNavigationItemHeaderBlock('equipment').includes("href: '/general-affairs/equipment'"), 'equipment parent should not navigate to a standalone page');
assert(navigation.includes("id: 'equipment-templates'"), 'equipment model should be visible beside store equipment');
assert(navigation.includes("id: 'equipment-new'"), 'new equipment should be a visible sidebar item in the latest IA');
console.log('PASS equipment active');

console.log('RUN facility active');
assertActive('/general-affairs/facilities', 'facility-list');
assertActive('/general-affairs/facilities/templates', 'facility-templates');
assertActive('/general-affairs/facilities/categories', 'facility-categories');
assertActive('/general-affairs/facilities/new', 'facility-new');
assert(getActiveItemIdForTest('/general-affairs/facilities/templates', '/general-affairs/facilities/templates', activeTestItems) !== 'facility-list', 'facility list must not stay active on company facility catalog');
assert(getNavigationItemBlock('facilities').includes("children: ["), 'facility management should expand children instead of navigating');
assert(!getNavigationItemHeaderBlock('facilities').includes("href: '/general-affairs/facilities'"), 'facility parent should not navigate to a standalone page');
assert(navigation.includes("id: 'facility-new'"), 'new facility should be a visible sidebar item in the latest IA');
console.log('PASS facility active');

console.log('RUN expandable parent visual alignment');
assert(sidebar.includes("hasChildren ? '' : 'flex-1'"), 'expandable parent labels should not stretch the chevron to the far edge');
assert(!sidebar.includes('className={`w-full ${classes}`}'), 'expandable parent button should align like ordinary nav items, not a full-width block button');
assert(sidebar.includes('aria-expanded={expanded}'), 'expandable parent items should keep accessible expanded state');
console.log('PASS expandable parent visual alignment');

console.log('RUN sidebar collapses all groups on navigation');
assert(sidebar.includes('function handleNavigate'), 'sidebar should centralize navigation click handling');
assert(sidebar.includes('setExpandedGroups(new Set())'), 'sidebar should collapse every expanded group after clicking any nav link');
assert(sidebar.includes('onNavigate={handleNavigate}'), 'nav links should trigger the shared collapse handler');
assert(!sidebar.includes('getParentItemId'), 'sidebar should not keep the clicked child parent group expanded after navigation');
console.log('PASS sidebar collapses all groups on navigation');

console.log('RUN nested fallback active');
assertActive('/general-affairs/inventory/unknown-child', 'inventory-overview');
assertActive('/general-affairs/parts', 'parts-list');
assertActive('/general-affairs/parts/new', 'part-new');
assertActive('/general-affairs/parts/unknown-child', 'parts-list');
assertActive('/general-affairs/vendors', 'vendors-list');
assertActive('/general-affairs/vendors/new', 'vendors-list');
assertActive('/general-affairs/vendors/categories', 'vendor-categories');
assertActive('/general-affairs/vendors/regions', 'vendor-regions');
assertActive('/general-affairs/vendors/stats', 'vendor-stats');
assertActive('/general-affairs', 'service-home');
console.log('PASS nested fallback active');

console.log('RUN vendor direct routes target service center vendor tabs');
vendorRoutePaths.forEach((file) => {
  const text = read(file);
  assert(text.includes("section: 'vendors'"), `${file} should open the vendor section`);
});
assert(read('app/general-affairs/vendors/page.tsx').includes("vendorView: 'list'"), 'vendor list route should select list tab');
assert(read('app/general-affairs/vendors/categories/page.tsx').includes("vendorView: 'categories'"), 'vendor categories route should select categories tab');
assert(read('app/general-affairs/vendors/regions/page.tsx').includes("vendorView: 'regions'"), 'vendor regions route should select regions tab');
assert(read('app/general-affairs/vendors/stats/page.tsx').includes("vendorView: 'stats'"), 'vendor stats route should select stats tab');
console.log('PASS vendor direct routes target service center vendor tabs');

console.log('RUN page header and templates exist');
assert(header.includes('primaryAction'), 'page header should support primaryAction');
assert(header.includes('secondaryActions'), 'page header should support secondaryActions');
assert(templates.includes('GeneralAffairsListPage'), 'list page template missing');
assert(templates.includes('GeneralAffairsFormPage'), 'form page template missing');
assert(templates.includes('GeneralAffairsDashboardPage'), 'dashboard page template missing');
console.log('PASS page header and templates exist');

console.log('RUN page states sanitize unsafe raw diagnostics');
assert(state.includes('sanitizeGeneralAffairsErrorMessage'), 'state component should sanitize error messages');
assert(!state.includes('Could not find the table'), 'state component must not display schema cache raw table errors');
assert(!state.includes('migration_general_affairs'), 'state component must not display migration filenames');
console.log('PASS page states sanitize unsafe raw diagnostics');

console.log('RUN layout is migration-free and API-contract-free');
const changedUiFiles = [navigation, features, sidebar, shell, header, state, templates, layout, navbar];
changedUiFiles.forEach((text, index) => {
  assert(!/supabase\s+db\s+push/i.test(text), `db push text should not appear in UI file index ${index}`);
  assert(!/create table|alter table|drop table|create policy|alter policy/i.test(text), `DB DDL should not appear in UI file index ${index}`);
  assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(text), `service role should not appear in UI file index ${index}`);
});
console.log('PASS layout is migration-free and API-contract-free');

console.log('RUN ModuleUnavailablePage remains available');
assert(fs.existsSync(path.join(root, 'components/general-affairs/ModuleUnavailablePage.tsx')), 'ModuleUnavailablePage should remain');
console.log('PASS ModuleUnavailablePage remains available');

console.log('General Affairs UI foundation static tests passed');
