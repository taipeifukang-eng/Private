#!/usr/bin/env node

/**
 * Local-only API/schema parity audit.
 *
 * Scans app/components/lib code for Supabase table/RPC references and compares
 * them with local migrations and optional Production schema-only evidence.
 * This script never connects to Supabase and must not receive data dumps.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SCAN_DIRS = ['app', 'components', 'lib'];
const DEFAULT_MIGRATIONS_DIR = path.join('supabase', 'migrations');
const DEFAULT_PRODUCTION_SCHEMA = path.join('schema-intake', 'production-public.schema-only.sql');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const SOURCE_BLOCK_PATTERNS = [
  { label: 'Production candidate project ref', regex: /odvksgucvfoaqrumpran/i },
  { label: 'DEV project ref should not be hard-coded', regex: /mjpdfpxqttbhzeimmtqr/i },
  { label: 'auth users data dump', regex: /\b(insert\s+into|copy)\s+auth\.users\b/i },
];

const SQL_BLOCK_PATTERNS = [
  ...SOURCE_BLOCK_PATTERNS,
  { label: 'secret wording', regex: /\b(access_token|refresh_token|anon_key|service[_ -]?role[_ -]?key|jwt|password|connection\s+string)\b/i },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git', '.temp'].includes(entry.name)) {
        out.push(...walk(full));
      }
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function readFiles(files) {
  return files.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
}

function readSqlDirectory(dir) {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n\n');
}

function normalizeIdentifier(value) {
  return value.replace(/"/g, '').replace(/^public\./i, '').trim().toLowerCase();
}

function scanSensitive(label, text, patterns = SQL_BLOCK_PATTERNS) {
  const findings = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) findings.push(pattern.label);
  }
  if (findings.length) {
    throw new Error(`${label} contains blocked sensitive markers: ${findings.join(', ')}`);
  }
}

function collectSqlObjects(sql) {
  const tables = new Set();
  const functions = new Set();

  const schemaPrefix = /(?:(?:"?(?:public|auth|storage)"?)\.)?/;
  const identifier = /"?([a-zA-Z_][a-zA-Z0-9_]*)"?/;
  const tableRegex = new RegExp(
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${schemaPrefix.source}${identifier.source}\s*\(`,
    'gi',
  );
  const functionRegex = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+${schemaPrefix.source}${identifier.source}\s*\(`,
    'gi',
  );

  for (const match of sql.matchAll(tableRegex)) {
    tables.add(normalizeIdentifier(match[1]));
  }
  for (const match of sql.matchAll(functionRegex)) {
    functions.add(normalizeIdentifier(match[1]));
  }

  return { tables, functions };
}

function collectCodeReferences(sourceFiles) {
  const tables = new Map();
  const rpcs = new Map();

  function add(map, name, file, line) {
    const normalized = normalizeIdentifier(name);
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push({ file: path.relative(process.cwd(), file), line });
  }

  for (const { file, text } of sourceFiles) {
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const line = index + 1;
      for (const match of lineText.matchAll(/(?:\.from|from)\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g)) {
        add(tables, match[1], file, line);
      }
      for (const match of lineText.matchAll(/(?:\.rpc|rpc)\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g)) {
        add(rpcs, match[1], file, line);
      }
    });
  }

  return { tables, rpcs };
}

function summarizeReferences(map) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, refs]) => ({
      name,
      referenceCount: refs.length,
      firstRefs: refs.slice(0, 5),
    }));
}

function missingReferences(refMap, availableSet) {
  return summarizeReferences(refMap)
    .filter((entry) => !availableSet.has(entry.name));
}

function main() {
  const scanFiles = DEFAULT_SCAN_DIRS.flatMap(walk).sort();
  const source = readFiles(scanFiles);
  const sourceText = source.map((entry) => entry.text).join('\n');
  scanSensitive('source code', sourceText, SOURCE_BLOCK_PATTERNS);

  const migrationsSql = readSqlDirectory(DEFAULT_MIGRATIONS_DIR);
  scanSensitive('local migrations', migrationsSql);
  const dev = collectSqlObjects(migrationsSql);

  let production = null;
  if (fs.existsSync(DEFAULT_PRODUCTION_SCHEMA)) {
    const productionSql = fs.readFileSync(DEFAULT_PRODUCTION_SCHEMA, 'utf8');
    scanSensitive('production schema-only', productionSql);
    production = collectSqlObjects(productionSql);
  }

  const refs = collectCodeReferences(source);
  const codeTables = summarizeReferences(refs.tables);
  const codeRpcs = summarizeReferences(refs.rpcs);
  const missingInDevTables = missingReferences(refs.tables, dev.tables);
  const missingInDevRpcs = missingReferences(refs.rpcs, dev.functions);

  const result = {
    scanned: {
      files: scanFiles.length,
      directories: DEFAULT_SCAN_DIRS,
    },
    counts: {
      codeTables: codeTables.length,
      codeRpcs: codeRpcs.length,
      devTables: dev.tables.size,
      devFunctions: dev.functions.size,
      productionTables: production?.tables.size ?? null,
      productionFunctions: production?.functions.size ?? null,
    },
    missingInDev: {
      tables: missingInDevTables,
      rpcs: missingInDevRpcs,
    },
    codeReferences: {
      tables: codeTables,
      rpcs: codeRpcs,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
