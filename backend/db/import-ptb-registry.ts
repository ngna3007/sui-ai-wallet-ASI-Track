/**
 * Import PTB Registry from CSV to new database
 */
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = postgres(DATABASE_URL);

async function importPTBRegistry() {
  try {
    console.log('📝 Reading PTB registry CSV...');
    const csvPath = join(__dirname, '../../ptb_registry.csv');
    const csvContent = readFileSync(csvPath, 'utf-8');

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Found ${records.length} PTB templates to import`);

    // Create ptb_registry table if not exists
    console.log('🗄️  Creating ptb_registry table...');
    await sql`
      CREATE TABLE IF NOT EXISTS ptb_registry (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT[],
        "typescriptCode" TEXT NOT NULL,
        "inputSchema" JSONB,
        "isActive" BOOLEAN DEFAULT true,
        embedding JSONB,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    console.log('📥 Importing PTB templates...');
    let imported = 0;
    let skipped = 0;

    for (const record of records) {
      try {
        // Check if already exists
        const existing = await sql`
          SELECT id FROM ptb_registry WHERE name = ${record.name}
        `;

        if (existing.length > 0) {
          console.log(`   ⏭️  Skipping ${record.name} (already exists)`);
          skipped++;
          continue;
        }

        // Parse tags
        const tags = record.tags ? record.tags.split(',').map((t: string) => t.trim()) : [];

        // Parse inputSchema
        let inputSchema = null;
        if (record.inputSchema) {
          try {
            inputSchema = JSON.parse(record.inputSchema);
          } catch (e) {
            console.warn(`   ⚠️  Invalid JSON for ${record.name} inputSchema`);
          }
        }

        // Parse embedding
        let embedding = null;
        if (record.embedding) {
          try {
            embedding = JSON.parse(record.embedding);
          } catch (e) {
            console.warn(`   ⚠️  Invalid JSON for ${record.name} embedding`);
          }
        }

        // Insert
        await sql`
          INSERT INTO ptb_registry (
            name, description, tags, "typescriptCode", "inputSchema", "isActive", embedding
          ) VALUES (
            ${record.name},
            ${record.description},
            ${tags},
            ${record.typescriptCode},
            ${inputSchema},
            ${record.isActive === 'true'},
            ${embedding}
          )
        `;

        console.log(`   ✅ Imported: ${record.name}`);
        imported++;
      } catch (error) {
        console.error(`   ❌ Failed to import ${record.name}:`, error);
      }
    }

    console.log('');
    console.log('✅ Import complete!');
    console.log(`   Imported: ${imported}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total in database: ${imported + skipped}`);

    await sql.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Import failed:', error);
    await sql.end();
    process.exit(1);
  }
}

importPTBRegistry();
