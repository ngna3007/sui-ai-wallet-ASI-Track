/**
 * Add user_nfts table to database
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env file');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function addNftsTable() {
  try {
    console.log('📊 Adding user_nfts table...');

    const sqlScript = readFileSync('/tmp/add_nfts_table.sql', 'utf-8');

    await sql.unsafe(sqlScript);

    console.log('✅ user_nfts table added successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding table:', error);
    process.exit(1);
  }
}

addNftsTable();
