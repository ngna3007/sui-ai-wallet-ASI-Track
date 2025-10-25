/**
 * Apply database schema for multi-user wallet architecture
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load environment from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function applySchema() {
  try {
    console.log('📝 Reading schema.sql...');
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    console.log('🗄️  Applying database schema...');

    // Execute schema (postgres library handles multi-statement execution)
    await sql.unsafe(schema);

    console.log('✅ Schema applied successfully!');
    console.log('');
    console.log('📋 Created tables:');
    console.log('   - user_accounts');
    console.log('   - user_balances');
    console.log('   - deposit_transactions');
    console.log('   - user_transactions');
    console.log('   - sweep_operations');
    console.log('   - withdrawal_requests');
    console.log('   - audit_log');
    console.log('');

    await sql.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to apply schema:', error);
    await sql.end();
    process.exit(1);
  }
}

applySchema();
