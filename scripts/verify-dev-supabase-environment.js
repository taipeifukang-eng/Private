#!/usr/bin/env node

/**
 * Local-only DEV Supabase environment guard.
 *
 * This script does not connect to Supabase and must not print secrets.
 * Run it before any DEV bootstrap, seed, migration, or RLS test script.
 */

const { loadEnvConfig } = require('@next/env');

const PRODUCTION_PROJECT_REF_CANDIDATES = new Set([
  'odvksgucvfoaqrumpran',
]);

function mask(value) {
  if (!value) return '<missing>';
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseSupabaseProjectRef(urlValue) {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }

  const host = parsed.hostname.toLowerCase();
  const match = host.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (!match) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL host is not a Supabase project host');
  }

  return {
    projectRef: match[1],
    maskedHost: `${mask(match[1])}.supabase.co`,
  };
}

function decodeJwtPayload(token, label) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) {
    throw new Error(`${label} is not a valid JWT`);
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    throw new Error(`${label} payload cannot be decoded`);
  }
}

function assertJwtRole(token, expectedRole, label, safeDetails) {
  let payload;
  try {
    payload = decodeJwtPayload(token, label);
  } catch (error) {
    fail(error.message, safeDetails);
  }

  if (payload.role !== expectedRole) {
    fail(`${label} must have JWT role "${expectedRole}"`, safeDetails);
  }
}

function fail(message, details = {}) {
  console.error('Environment guard failed');
  console.error(`Reason: ${message}`);
  printSafeDetails(details);
  process.exit(1);
}

function printSafeDetails(details) {
  const nodeEnv = process.env.NODE_ENV || '<unset>';
  console.log(`NODE_ENV: ${nodeEnv}`);
  console.log(`Project Ref: ${details.maskedProjectRef || '<unavailable>'}`);
  console.log(`URL Host: ${details.maskedHost || '<unavailable>'}`);
  console.log(`ALLOW_DEV_DATABASE_OPERATIONS: ${process.env.ALLOW_DEV_DATABASE_OPERATIONS === 'true'}`);
}

function main() {
  loadEnvConfig(process.cwd(), true);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
  const nodeEnv = process.env.NODE_ENV || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let parsed = {};
  if (supabaseUrl) {
    try {
      parsed = parseSupabaseProjectRef(supabaseUrl);
    } catch (error) {
      fail(error.message);
    }
  }

  const safeDetails = {
    maskedProjectRef: parsed.projectRef ? mask(parsed.projectRef) : '<unavailable>',
    maskedHost: parsed.maskedHost || '<unavailable>',
  };

  if (!supabaseUrl) {
    fail('NEXT_PUBLIC_SUPABASE_URL is required', safeDetails);
  }

  if (!expectedRef) {
    fail('EXPECTED_SUPABASE_PROJECT_REF is required', safeDetails);
  }

  if (parsed.projectRef !== expectedRef) {
    fail('Supabase project ref does not match EXPECTED_SUPABASE_PROJECT_REF', safeDetails);
  }

  if (PRODUCTION_PROJECT_REF_CANDIDATES.has(parsed.projectRef)) {
    fail('Supabase project ref matches a Production candidate', safeDetails);
  }

  if (process.env.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') {
    fail('ALLOW_DEV_DATABASE_OPERATIONS must strictly equal true', safeDetails);
  }

  if (nodeEnv === 'production') {
    fail('NODE_ENV must not be production', safeDetails);
  }

  if (!serviceRoleKey) {
    fail('SUPABASE_SERVICE_ROLE_KEY is required', safeDetails);
  }

  if (!anonKey) {
    fail('NEXT_PUBLIC_SUPABASE_ANON_KEY is required', safeDetails);
  }

  assertJwtRole(anonKey, 'anon', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', safeDetails);
  assertJwtRole(serviceRoleKey, 'service_role', 'SUPABASE_SERVICE_ROLE_KEY', safeDetails);

  console.log('Environment guard passed');
  printSafeDetails(safeDetails);
}

main();
