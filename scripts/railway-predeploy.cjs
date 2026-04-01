const { spawnSync } = require('node:child_process');

const TARGET_SCHEMA = 'agrifas';

function ensureSchemaInDatabaseUrl(rawUrl, schema = TARGET_SCHEMA) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.get('schema')) {
      parsed.searchParams.set('schema', schema);
    }
    return parsed.toString();
  } catch {
    if (/[?&]schema=/i.test(rawUrl)) {
      return rawUrl;
    }

    const separator = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${separator}schema=${encodeURIComponent(schema)}`;
  }
}

function readSchemaFromDatabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  try {
    return new URL(rawUrl).searchParams.get('schema') || null;
  } catch {
    const match = rawUrl.match(/[?&]schema=([^&]+)/i);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

const normalizedDatabaseUrl = ensureSchemaInDatabaseUrl(process.env.DATABASE_URL);

if (!normalizedDatabaseUrl) {
  console.error('[railway:predeploy] DATABASE_URL nao encontrado.');
  process.exit(1);
}

process.env.DATABASE_URL = normalizedDatabaseUrl;

const schema = readSchemaFromDatabaseUrl(normalizedDatabaseUrl) || TARGET_SCHEMA;
console.log(`[railway:predeploy] Executando prisma db push no schema "${schema}".`);

const result = spawnSync(
  'npx',
  ['prisma', 'db', 'push', '--skip-generate'],
  {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  },
);

if (result.error) {
  console.error('[railway:predeploy] Falha ao executar prisma db push:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
