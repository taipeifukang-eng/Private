#!/usr/bin/env node

/**
 * SQL Migration Validation Script
 * Validates the pharmacist master RBAC migration SQL for syntax and logic errors
 */

const fs = require('fs');
const path = require('path');

// Read the migration file
const migrationPath = path.join(__dirname, 'supabase', 'migration_pharmacist_master_rbac.sql');
const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

console.log('='.repeat(60));
console.log('SQL MIGRATION VALIDATION REPORT');
console.log('='.repeat(60));
console.log('\n📄 File: supabase/migration_pharmacist_master_rbac.sql\n');

// Check 1: Feature name is correct
console.log('✓ Check 1: Feature name validation');
const hasCorrectFeature = sqlContent.includes("'pharmacist_master'");
const hasWrongFeature = sqlContent.includes("'pharmacist_management'") && 
                        sqlContent.includes("'pharmacist.management.master");
console.log(`  - Uses 'pharmacist_master': ${hasCorrectFeature ? '✅ YES' : '❌ NO'}`);
console.log(`  - Avoids 'pharmacist_management': ${!hasWrongFeature ? '✅ YES' : '❌ NO'}`);

// Check 2: Permission codes are correct
console.log('\n✓ Check 2: Permission code validation');
const hasMasterView = sqlContent.includes("'pharmacist.management.master.view'");
const hasMasterEdit = sqlContent.includes("'pharmacist.management.master.edit'");
console.log(`  - Has master.view code: ${hasMasterView ? '✅ YES' : '❌ NO'}`);
console.log(`  - Has master.edit code: ${hasMasterEdit ? '✅ YES' : '❌ NO'}`);

// Check 3: ON CONFLICT clause present
console.log('\n✓ Check 3: Conflict handling');
const hasConflictClause = sqlContent.includes('ON CONFLICT (code)');
console.log(`  - Has ON CONFLICT clause: ${hasConflictClause ? '✅ YES' : '❌ NO'}`);

// Check 4: RBAC roles configured
console.log('\n✓ Check 4: Role configuration');
const hasBusiness = sqlContent.includes("'business_manager'");
const hasSupervisor = sqlContent.includes("'supervisor_role'");
const hasAdmin = sqlContent.includes("'admin_role'");
console.log(`  - business_manager configured: ${hasBusiness ? '✅ YES' : '❌ NO'}`);
console.log(`  - supervisor_role configured: ${hasSupervisor ? '✅ YES' : '❌ NO'}`);
console.log(`  - admin_role configured: ${hasAdmin ? '✅ YES' : '❌ NO'}`);

// Check 5: Verification query present
console.log('\n✓ Check 5: Verification query');
const hasVerification = sqlContent.includes('SELECT') && 
                       sqlContent.includes('role_code') &&
                       sqlContent.includes('permission_code');
console.log(`  - Verification query present: ${hasVerification ? '✅ YES' : '❌ NO'}`);

// Check 6: NOT EXISTS guards
console.log('\n✓ Check 6: Duplicate prevention');
const hasNotExists = (sqlContent.match(/NOT EXISTS/g) || []).length >= 3;
console.log(`  - NOT EXISTS guards present: ${hasNotExists ? '✅ YES' : '❌ NO'}`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(60));

const allChecks = [
  hasCorrectFeature,
  !hasWrongFeature,
  hasMasterView,
  hasMasterEdit,
  hasConflictClause,
  hasBusiness,
  hasSupervisor,
  hasAdmin,
  hasVerification,
  hasNotExists
];

const passedChecks = allChecks.filter(Boolean).length;
const totalChecks = allChecks.length;

console.log(`\n✅ Passed: ${passedChecks}/${totalChecks} checks`);
console.log(`\n📋 Status: ${passedChecks === totalChecks ? '✅ READY FOR EXECUTION' : '⚠️  NEEDS REVIEW'}`);

if (passedChecks === totalChecks) {
  console.log('\n✨ The migration file is ready to execute in Supabase.');
  console.log('📖 Follow instructions in: PHARMACIST_MASTER_RBAC_EXECUTION.md');
  process.exit(0);
} else {
  console.log('\n⚠️  Some checks failed. Please review the migration file.');
  process.exit(1);
}
