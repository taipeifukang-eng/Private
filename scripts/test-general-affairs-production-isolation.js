#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const api = read('app/api/maintenance-requests/route.ts');
const summaryApi = read('app/api/maintenance-requests/summary/route.ts');
const generalAffairsConsumers = [
  'components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx',
  'components/general-affairs/equipment/EquipmentManagementClient.tsx',
  'components/general-affairs/facilities/FacilitiesClient.tsx',
  'components/general-affairs/assets/AssetMaintenanceHistoryClient.tsx',
];

assert(
  api.includes("source === 'general_affairs'") && api.includes("not('ga_service_request_id', 'is', null)"),
  'Maintenance request API must isolate new General Affairs work orders.',
);
assert(
  summaryApi.includes("source === 'general_affairs'") && summaryApi.includes("not('ga_service_request_id', 'is', null)"),
  'Maintenance summary API must isolate new General Affairs work orders.',
);

for (const relativePath of generalAffairsConsumers) {
  const source = read(relativePath);
  assert(
    source.includes('source=general_affairs') || source.includes("params.set('source', 'general_affairs')"),
    `${relativePath} must request the isolated General Affairs work-order scope.`,
  );
}

const migrationFiles = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => /general_affairs|inventory_location|inventory_transaction|resource_attachment/.test(name))
  .filter((name) => name.endsWith('.sql'));

const forbiddenDataCopy = /insert\s+into\s+(?:public\.)?(?:ga_service_requests|maintenance_requests)\b[\s\S]{0,500}\bselect\b/gi;
for (const fileName of migrationFiles) {
  const sql = read(path.join('supabase', 'migrations', fileName));
  assert(
    !forbiddenDataCopy.test(sql),
    `${fileName} appears to copy operational request data; production rollout must be schema-only.`,
  );
  forbiddenDataCopy.lastIndex = 0;
}

console.log('General Affairs production isolation checks passed.');
console.log(`Checked ${generalAffairsConsumers.length} UI consumers and ${migrationFiles.length} migrations.`);
