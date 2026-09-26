#!/usr/bin/env node

/**
 * Local-only schema-only parity scanner.
 *
 * This script does not connect to Supabase. It compares a sanitized
 * Production schema-only SQL file with a DEV schema SQL file or directory.
 * It must never be used with data dumps that contain INSERT/COPY rows.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SQL_IDENTIFIER = '(?:(?:"public"|public)\\.)?(?:"[a-zA-Z_][a-zA-Z0-9_]*"|[a-zA-Z_][a-zA-Z0-9_]*)';

const PRODUCTION_ONLY_BLOCK_PATTERNS = [
  { label: 'auth.users data export', regex: /\b(?:insert\s+into|copy)\s+auth\.users\b/i },
  { label: 'storage.objects data export', regex: /\b(?:insert\s+into|copy)\s+storage\.objects\b/i },
];

const ALL_INPUT_BLOCK_PATTERNS = [
  { label: 'JWT/token/key/password wording', regex: /\b(jwt|access_token|refresh_token|anon_key|api[_-]?key|secret|password)\b/i },
  { label: 'Production candidate project ref', regex: /odvksgucvfoaqrumpran/i },
  { label: 'DEV project ref should not be hard-coded', regex: /mjpdfpxqttbhzeimmtqr/i },
  { label: 'Supabase connection string', regex: /postgres(?:ql)?:\/\/|supabase\.co.*(?:password|service_role|apikey)/i },
];

function usage(exitCode = 1) {
  const message = `
Usage:
  node scripts/compare-schema-only-parity.js --production <prod_schema.sql> [--dev <dev_schema.sql|directory>]

Defaults:
  --dev supabase/migrations

Rules:
  - Input files must be schema-only.
  - Do not pass data dumps, Auth user exports, Storage object exports, or files with secrets.
  - This script performs local parsing only and never connects to Supabase.
`;
  console.log(message.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { dev: path.join('supabase', 'migrations') };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    if (arg === '--production') {
      args.production = argv[++i];
      continue;
    }
    if (arg === '--dev') {
      args.dev = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.production) {
    throw new Error('--production is required');
  }
  return args;
}

function walkSqlFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  const out = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const full = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git', '.temp'].includes(entry.name)) {
        out.push(...walkSqlFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      out.push(full);
    }
  }
  return out.sort();
}

function readSqlInput(targetPath) {
  const files = walkSqlFiles(targetPath);
  const parts = files.map((file) => fs.readFileSync(file, 'utf8'));
  return {
    files,
    text: parts.join('\n\n'),
    sha256: crypto.createHash('sha256').update(parts.join('\n\n'), 'utf8').digest('hex').toUpperCase(),
    bytes: Buffer.byteLength(parts.join('\n\n'), 'utf8'),
  };
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function maskFunctionBodies(sql) {
  return sql.replace(/(\bas\s+)(\$[A-Za-z0-9_]*\$)[\s\S]*?\2/gi, '$1$2 /* function body omitted */ $2');
}

function normalizeIdentifier(value) {
  return value
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .trim()
    .toLowerCase();
}

function splitTopLevelComma(block) {
  const items = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (quote === '\'' && block[i + 1] === '\'') {
          current += block[i + 1];
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function extractCreateTableBlocks(sql) {
  const cleaned = stripComments(sql);
  const blocks = [];
  const regex = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${SQL_IDENTIFIER})\\s*\\(`, 'gi');
  let match;
  while ((match = regex.exec(cleaned))) {
    const bodyStart = regex.lastIndex;
    let i = bodyStart;
    let inString = false;
    for (; i < cleaned.length - 1; i += 1) {
      const ch = cleaned[i];
      if (inString) {
        if (ch === '\'' && cleaned[i + 1] === '\'') {
          i += 1;
          continue;
        }
        if (ch === '\'') inString = false;
        continue;
      }
      if (ch === '\'') {
        inString = true;
        continue;
      }
      if (ch === ')' && cleaned[i + 1] === ';') break;
    }
    blocks.push({
      table: normalizeIdentifier(match[1]),
      body: cleaned.slice(bodyStart, i),
    });
    regex.lastIndex = i + 2;
  }
  return blocks;
}

function parseColumns(sql) {
  const tables = new Map();
  for (const block of extractCreateTableBlocks(sql)) {
    const columns = {};
    for (const item of splitTopLevelComma(block.body)) {
      if (/^(constraint|primary|foreign|unique|check|exclude)\b/i.test(item)) continue;
      const match = item.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+(.+)$/s);
      if (!match) continue;
      columns[normalizeIdentifier(match[1])] = match[2].replace(/\s+/g, ' ').trim();
    }
    tables.set(block.table, columns);
  }
  return tables;
}

function collect(regex, sql, formatter = (m) => normalizeIdentifier(m[1])) {
  const set = new Set();
  for (const match of stripComments(sql).matchAll(regex)) {
    set.add(formatter(match));
  }
  return set;
}

function parseSchema(sql) {
  const tables = parseColumns(sql);
  return {
    tables,
    tableNames: new Set(tables.keys()),
    sequences: collect(new RegExp(`create\\s+sequence\\s+(?:if\\s+not\\s+exists\\s+)?(${SQL_IDENTIFIER})`, 'gi'), sql),
    functions: collect(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(${SQL_IDENTIFIER})`, 'gi'), sql),
    policies: collect(new RegExp(`create\\s+policy\\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\\s+on\\s+(${SQL_IDENTIFIER})`, 'gi'), sql, (m) => `${normalizeIdentifier(m[3])}.${String(m[1] || m[2]).trim().toLowerCase()}`),
    triggers: collect(/create\s+(?:or\s+replace\s+)?trigger\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s+/gi, sql, (m) => String(m[1] || m[2]).trim().toLowerCase()),
    indexes: collect(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi, sql),
    constraints: collect(/constraint\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+(?:primary|foreign|unique|check|exclude)/gi, sql),
    grants: collect(/\bgrant\s+(.+?)\s+on\s+(.+?)\s+to\s+(.+?);/gis, sql, (m) => `${m[1].replace(/\s+/g, ' ').trim().toLowerCase()} on ${m[2].replace(/\s+/g, ' ').trim().toLowerCase()} to ${m[3].replace(/\s+/g, ' ').trim().toLowerCase()}`),
  };
}

function diffSets(prod, dev) {
  return {
    missingInDev: [...prod].filter((x) => !dev.has(x)).sort(),
    extraInDev: [...dev].filter((x) => !prod.has(x)).sort(),
  };
}

function diffColumns(prodTables, devTables) {
  const out = [];
  for (const [table, prodColumns] of prodTables) {
    const devColumns = devTables.get(table);
    if (!devColumns) continue;
    const prodSet = new Set(Object.keys(prodColumns));
    const devSet = new Set(Object.keys(devColumns));
    const missingColumns = [...prodSet].filter((x) => !devSet.has(x)).sort();
    const extraColumns = [...devSet].filter((x) => !prodSet.has(x)).sort();
    const typeMismatches = [];
    for (const col of prodSet) {
      if (devSet.has(col) && prodColumns[col] !== devColumns[col]) {
        typeMismatches.push({
          column: col,
          production: prodColumns[col],
          dev: devColumns[col],
        });
      }
    }
    if (missingColumns.length || extraColumns.length || typeMismatches.length) {
      out.push({ table, missingColumns, extraColumns, typeMismatches });
    }
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

function scanSensitive(inputName, text, { production = false } = {}) {
  const findings = [];
  const topLevelSql = maskFunctionBodies(text);
  const patterns = production
    ? [...PRODUCTION_ONLY_BLOCK_PATTERNS, ...ALL_INPUT_BLOCK_PATTERNS]
    : ALL_INPUT_BLOCK_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.regex.test(topLevelSql)) findings.push(pattern.label);
  }
  if (production && /\binsert\s+into\b/i.test(topLevelSql)) findings.push('top-level INSERT statement');
  if (production && /^\s*copy\s+/im.test(topLevelSql)) findings.push('top-level COPY statement');
  return { inputName, findings };
}

function firstItems(items, max = 30) {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `... ${items.length - max} more`];
}

function countDiff(diff) {
  return {
    missingInDev: diff.missingInDev.length,
    extraInDev: diff.extraInDev.length,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    usage(1);
  }

  const production = readSqlInput(args.production);
  const dev = readSqlInput(args.dev);
  const sensitive = [
    scanSensitive('production', production.text, { production: true }),
    scanSensitive('dev', dev.text),
  ];

  const blockingSensitive = sensitive
    .filter((entry) => entry.findings.length > 0)
    .map((entry) => ({ input: entry.inputName, findings: entry.findings }));

  if (blockingSensitive.length) {
    console.error('Schema-only parity scan failed: input appears to contain data rows or sensitive markers.');
    console.error(JSON.stringify(blockingSensitive, null, 2));
    process.exit(1);
  }

  const prodSchema = parseSchema(production.text);
  const devSchema = parseSchema(dev.text);
  const result = {
    productionInput: {
      files: production.files.map((file) => path.relative(process.cwd(), file)),
      bytes: production.bytes,
      sha256: production.sha256,
    },
    devInput: {
      files: dev.files.map((file) => path.relative(process.cwd(), file)),
      bytes: dev.bytes,
      sha256: dev.sha256,
    },
    counts: {
      production: {
        tables: prodSchema.tableNames.size,
        sequences: prodSchema.sequences.size,
        functions: prodSchema.functions.size,
        policies: prodSchema.policies.size,
        triggers: prodSchema.triggers.size,
        indexes: prodSchema.indexes.size,
        constraints: prodSchema.constraints.size,
        grants: prodSchema.grants.size,
      },
      dev: {
        tables: devSchema.tableNames.size,
        sequences: devSchema.sequences.size,
        functions: devSchema.functions.size,
        policies: devSchema.policies.size,
        triggers: devSchema.triggers.size,
        indexes: devSchema.indexes.size,
        constraints: devSchema.constraints.size,
        grants: devSchema.grants.size,
      },
    },
    diff: {
      tables: diffSets(prodSchema.tableNames, devSchema.tableNames),
      sequences: diffSets(prodSchema.sequences, devSchema.sequences),
      functions: diffSets(prodSchema.functions, devSchema.functions),
      policies: diffSets(prodSchema.policies, devSchema.policies),
      triggers: diffSets(prodSchema.triggers, devSchema.triggers),
      indexes: diffSets(prodSchema.indexes, devSchema.indexes),
      constraints: diffSets(prodSchema.constraints, devSchema.constraints),
      grants: diffSets(prodSchema.grants, devSchema.grants),
      columns: diffColumns(prodSchema.tables, devSchema.tables),
    },
  };

  const summary = {
    productionInput: result.productionInput,
    devInput: result.devInput,
    counts: result.counts,
    diffCounts: {
      tables: countDiff(result.diff.tables),
      sequences: countDiff(result.diff.sequences),
      functions: countDiff(result.diff.functions),
      policies: countDiff(result.diff.policies),
      triggers: countDiff(result.diff.triggers),
      indexes: countDiff(result.diff.indexes),
      constraints: countDiff(result.diff.constraints),
      grants: countDiff(result.diff.grants),
      columnDiffTables: result.diff.columns.length,
    },
    missingInDev: {
      tables: firstItems(result.diff.tables.missingInDev),
      sequences: firstItems(result.diff.sequences.missingInDev),
      functions: firstItems(result.diff.functions.missingInDev),
      policies: firstItems(result.diff.policies.missingInDev),
      triggers: firstItems(result.diff.triggers.missingInDev),
      indexes: firstItems(result.diff.indexes.missingInDev),
      constraints: firstItems(result.diff.constraints.missingInDev),
      grants: firstItems(result.diff.grants.missingInDev),
      columnDiffTables: firstItems(result.diff.columns.map((entry) => entry.table)),
    },
    extraInDev: {
      tables: firstItems(result.diff.tables.extraInDev),
      functions: firstItems(result.diff.functions.extraInDev),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
