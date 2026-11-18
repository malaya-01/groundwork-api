// Single source of truth for the TypeORM connection.
// Used by the Nest app (db.module.ts) AND by the TypeORM CLI (migration:generate / run / revert).
import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { SnakeNamingStrategy } from './naming';

config();

/** Tables live in their own schema so Supabase's auto-generated REST API does not expose them. */
export const SCHEMA = 'groundwork';

export function dataSourceOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  if (url.includes('YOUR-DATABASE-PASSWORD')) throw new Error('DATABASE_URL still has the placeholder password. Edit .env.');
  return {
    type: 'postgres',
    url,
    schema: SCHEMA,
    ssl: (process.env.DB_SSL ?? 'true') !== 'false' ? { rejectUnauthorized: false } : false,
    entities: ENTITIES,
    migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
    namingStrategy: new SnakeNamingStrategy(),
    uuidExtension: 'pgcrypto',
    synchronize: false, // schema changes only ever happen through generated migrations
    logging: ['error', 'warn', 'migration'],
    extra: { max: Number(process.env.DB_POOL_MAX ?? 5), connectionTimeoutMillis: 15_000 },
  };
}

/** Creates the schema if needed and applies pending migrations. */
export async function migrate(ds: DataSource): Promise<string[]> {
  await ds.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  const applied = await ds.runMigrations({ transaction: 'each' });
  return applied.map((m) => m.name);
}

// Default export for the TypeORM CLI (-d src/db/data-source.ts)
export default new DataSource(dataSourceOptions());
