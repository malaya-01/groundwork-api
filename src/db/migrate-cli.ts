// npm run migration:run  →  creates the "groundwork" schema if needed and applies pending migrations.
import ds, { migrate } from './data-source';

ds.initialize()
  .then(async () => {
    const applied = await migrate(ds);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database already up to date');
    await ds.destroy();
  })
  .catch((err) => {
    console.error('migration failed:', (err as Error).message ?? err);
    process.exit(1);
  });
