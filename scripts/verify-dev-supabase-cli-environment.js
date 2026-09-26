#!/usr/bin/env node

/**
 * Local-only Supabase CLI DEV environment guard.
 *
 * This script does not connect to Supabase and must not print secrets.
 * Run it after `supabase link` and before any CLI remote database operation.
 */

const fs = require('fs');
const path = require('path');
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

function readCliProjectRef() {
  const projectRefPath = path.join(process.cwd(), 'supabase', '.temp', 'project-ref');
  if (!fs.existsSync(projectRefPath)) {
    throw new Error('supabase/.temp/project-ref does not exist; run supabase link for the DEV project first');
  }

  const value = fs.readFileSync(projectRefPath, 'utf8').trim();
  if (!value) {
    throw new Error('supabase/.temp/project-ref is empty; run supabase link for the DEV project first');
  }

  if (!/^[a-z0-9]+$/.test(value)) {
    throw new Error('supabase/.temp/project-ref contains an invalid project ref format');
  }

  return value;
}

function fail(message, details = {}) {
  console.error('Supabase CLI environment guard failed');
  console.error(`Reason: ${message}`);
  printSafeDetails(details);
  process.exit(1);
}

function printSafeDetails(details) {
  console.log(`NODE_ENV: ${process.env.NODE_ENV || '<unset>'}`);
  console.log(`URL Project Ref: ${details.maskedUrlProjectRef || '<unavailable>'}`);
  console.log(`Expected Project Ref: ${details.maskedExpectedProjectRef || '<unavailable>'}`);
  console.log(`CLI Project Ref: ${details.maskedCliProjectRef || '<unavailable>'}`);
  console.log(`URL Host: ${details.maskedHost || '<unavailable>'}`);
  console.log(`ALLOW_DEV_DATABASE_OPERATIONS: ${process.env.ALLOW_DEV_DATABASE_OPERATIONS === 'true'}`);
  console.log(`ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS: ${process.env.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS === 'true'}`);
}

function main() {
  loadEnvConfig(process.cwd(), true);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
  const nodeEnv = process.env.NODE_ENV || '';

  let parsed = {};
  if (supabaseUrl) {
    try {
      parsed = parseSupabaseProjectRef(supabaseUrl);
    } catch (error) {
      fail(error.message);
    }
  }

  let cliProjectRef = '';
  try {
    cliProjectRef = readCliProjectRef();
  } catch (error) {
    fail(error.message, {
      maskedUrlProjectRef: parsed.projectRef ? mask(parsed.projectRef) : '<unavailable>',
      maskedExpectedProjectRef: expectedRef ? mask(expectedRef) : '<unavailable>',
      maskedHost: parsed.maskedHost || '<unavailable>',
    });
  }

  const safeDetails = {
    maskedUrlProjectRef: parsed.projectRef ? mask(parsed.projectRef) : '<unavailable>',
    maskedExpectedProjectRef: expectedRef ? mask(expectedRef) : '<unavailable>',
    maskedCliProjectRef: cliProjectRef ? mask(cliProjectRef) : '<unavailable>',
    maskedHost: parsed.maskedHost || '<unavailable>',
  };

  if (!supabaseUrl) {
    fail('NEXT_PUBLIC_SUPABASE_URL is required', safeDetails);
  }

  if (!expectedRef) {
    fail('EXPECTED_SUPABASE_PROJECT_REF is required', safeDetails);
  }

  if (parsed.projectRef !== expectedRef) {
    fail('NEXT_PUBLIC_SUPABASE_URL project ref must equal EXPECTED_SUPABASE_PROJECT_REF', safeDetails);
  }

  if (cliProjectRef !== parsed.projectRef) {
    fail('Supabase CLI project ref must equal NEXT_PUBLIC_SUPABASE_URL project ref', safeDetails);
  }

  if (cliProjectRef !== expectedRef) {
    fail('Supabase CLI project ref must equal EXPECTED_SUPABASE_PROJECT_REF', safeDetails);
  }

  if (PRODUCTION_PROJECT_REF_CANDIDATES.has(parsed.projectRef) || PRODUCTION_PROJECT_REF_CANDIDATES.has(cliProjectRef)) {
    fail('Supabase project ref matches a Production candidate', safeDetails);
  }

  if (process.env.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') {
    fail('ALLOW_DEV_DATABASE_OPERATIONS must strictly equal true', safeDetails);
  }

  if (process.env.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS !== 'true') {
    fail('ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS must strictly equal true', safeDetails);
  }

  if (nodeEnv === 'production') {
    fail('NODE_ENV must not be production', safeDetails);
  }

  console.log('Supabase CLI environment guard passed');
  printSafeDetails(safeDetails);
}

main();
