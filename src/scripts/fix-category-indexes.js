const mongoose = require('mongoose');

const DATABASES = [
  {
    name: 'Production / Main DB (dbmasheco)',
    uri: 'mongodb+srv://sabbirdev001_db_user:z7ftsb5wrQCj7nlj@cluster0.hrtdswj.mongodb.net/dbmasheco'
  },
  {
    name: 'Active / Scaleup DB (tenet)',
    uri: 'mongodb+srv://mohsinahmed22022_db_user:mohammad.Mohsin2005@scaleup.kblzvbw.mongodb.net/tenet'
  }
];

async function checkAndFixDatabase(dbConfig) {
  console.log(`\n========================================`);
  console.log(`Connecting to: ${dbConfig.name}`);
  console.log(`========================================`);
  let conn;
  try {
    conn = await mongoose.createConnection(dbConfig.uri).asPromise();
    console.log(`Connected successfully!`);

    const collectionsToCheck = ['categories', 'products'];

    for (const colName of collectionsToCheck) {
      console.log(`\n--- Checking Collection: ${colName} ---`);
      const col = conn.collection(colName);
      const indexes = await col.indexes();
      console.log('Current Indexes:');
      indexes.forEach(idx => {
        console.log(` - Name: "${idx.name}", Key: ${JSON.stringify(idx.key)}, Unique: ${!!idx.unique}`);
      });

      // Target legacy global indexes that break multi-tenancy:
      // In a multi-tenant app, slug or name cannot be globally unique; they must be scoped to { tenantId: 1, slug: 1 }
      for (const idx of indexes) {
        // Look for global slug index
        const isGlobalSlug = idx.key && idx.key.slug === 1 && !idx.key.tenantId && idx.name !== '_id_';
        // Look for global name index
        const isGlobalName = idx.key && idx.key.name === 1 && !idx.key.tenantId && idx.name !== '_id_';

        if (isGlobalSlug || isGlobalName) {
          console.log(`>>> Found legacy global index to drop: "${idx.name}"`);
          try {
            await col.dropIndex(idx.name);
            console.log(`>>> Successfully dropped index "${idx.name}" from ${colName}!`);
          } catch (dropErr) {
            console.error(`Failed to drop index "${idx.name}":`, dropErr.message);
          }
        }
      }

      // Check if tenant-scoped compound indexes exist, if not, create them
      if (colName === 'categories') {
        const afterIndexes = await col.indexes();
        const hasTenantSlug = afterIndexes.some(idx => idx.key && idx.key.tenantId && idx.key.slug);
        const hasTenantName = afterIndexes.some(idx => idx.key && idx.key.tenantId && idx.key.name);

        if (!hasTenantSlug) {
          console.log('Creating compound index: { tenantId: 1, slug: 1 } (unique)');
          await col.createIndex({ tenantId: 1, slug: 1 }, { unique: true });
        }
        if (!hasTenantName) {
          console.log('Creating compound index: { tenantId: 1, name: 1 } (unique, case-insensitive)');
          await col.createIndex({ tenantId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
        }
      }

      if (colName === 'products') {
        const afterIndexes = await col.indexes();
        const hasTenantSlug = afterIndexes.some(idx => idx.key && idx.key.tenantId && idx.key.slug);
        if (!hasTenantSlug) {
          console.log('Creating compound index: { tenantId: 1, slug: 1 } (unique)');
          await col.createIndex({ tenantId: 1, slug: 1 }, { unique: true });
        }
      }

      // Final index list
      const finalIndexes = await col.indexes();
      console.log(`\nFinal Indexes for ${colName}:`);
      finalIndexes.forEach(idx => {
        console.log(` - Name: "${idx.name}", Key: ${JSON.stringify(idx.key)}, Unique: ${!!idx.unique}`);
      });
    }

    await conn.close();
  } catch (err) {
    console.error(`Error in ${dbConfig.name}:`, err.message);
    if (conn) await conn.close();
  }
}

async function main() {
  for (const db of DATABASES) {
    await checkAndFixDatabase(db);
  }
  console.log('\nAll database index migrations finished!');
  process.exit(0);
}

main();
