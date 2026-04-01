import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const DEFAULT_DB_SCHEMA = 'agrifas';

function ensureDatabaseSchemaInUrl(
  rawUrl: string | undefined,
  schema = DEFAULT_DB_SCHEMA,
) {
  if (!rawUrl) return rawUrl;

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

function extractSchemaFromUrl(rawUrl: string | undefined) {
  if (!rawUrl) return null;

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

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseUrlWithSchema: string | undefined;

  constructor() {
    const normalizedUrl = ensureDatabaseSchemaInUrl(process.env.DATABASE_URL);

    super({
      ...(normalizedUrl
        ? {
            datasources: {
              db: {
                url: normalizedUrl,
              },
            },
          }
        : {}),
    });

    this.databaseUrlWithSchema = normalizedUrl;
  }

  async onModuleInit() {
    await this.$connect();

    const schema = extractSchemaFromUrl(this.databaseUrlWithSchema);
    if (schema) {
      this.logger.log(`Prisma conectado ao schema "${schema}".`);
    } else {
      this.logger.warn(
        'Prisma conectado sem schema explicito na DATABASE_URL.',
      );
    }
  }
}
