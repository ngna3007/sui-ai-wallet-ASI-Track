/**
 * Test Database Connection
 * Validates PostgreSQL connection and ptb_registry table access
 */

import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '../.env' });

const DATABASE_URL = process.env.DATABASE_URL;

async function testDatabaseConnection() {
  console.log('🧪 Testing Database Connection...\n');

  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in .env');
    process.exit(1);
  }

  console.log('📍 Database URL:', DATABASE_URL.split('@')[1]?.split('/')[0] || 'hidden');

  const sql = postgres(DATABASE_URL, {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
  });

  try {
    // Test 1: Basic connection
    console.log('Test 1: Basic connection...');
    const result = await sql`SELECT NOW() as current_time`;
    console.log('✅ Connected! Server time:', result[0].current_time);

    // Test 2: Check if ptb_registry table exists
    console.log('\nTest 2: Checking ptb_registry table...');
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'ptb_registry'
      );
    `;

    if (tableCheck[0].exists) {
      console.log('✅ ptb_registry table exists');
    } else {
      console.log('❌ ptb_registry table NOT found');
      process.exit(1);
    }

    // Test 3: Count PTB templates
    console.log('\nTest 3: Counting PTB templates...');
    const countResult = await sql`
      SELECT COUNT(*) as total FROM ptb_registry WHERE "isActive" = true
    `;
    const total = countResult[0].total;
    console.log(`✅ Found ${total} active PTB templates`);

    if (total === 0) {
      console.log('⚠️  Warning: No templates found. Database may be empty.');
    }

    // Test 4: Sample templates
    if (total > 0) {
      console.log('\nTest 4: Fetching sample templates...');
      const samples = await sql`
        SELECT id, name, description, tags
        FROM ptb_registry
        WHERE "isActive" = true
        LIMIT 5
      `;

      console.log('✅ Sample templates:');
      samples.forEach((t: any, i: number) => {
        console.log(`   ${i + 1}. ${t.name}`);
        if (t.description) console.log(`      ${t.description.substring(0, 60)}...`);
        if (t.tags) console.log(`      Tags: ${Array.isArray(t.tags) ? t.tags.join(', ') : t.tags}`);
      });
    }

    // Test 5: Check for embeddings
    console.log('\nTest 5: Checking for embeddings...');
    const embeddingCheck = await sql`
      SELECT COUNT(*) as with_embeddings
      FROM ptb_registry
      WHERE embedding IS NOT NULL AND "isActive" = true
    `;
    const withEmbeddings = embeddingCheck[0].with_embeddings;
    console.log(`✅ ${withEmbeddings}/${total} templates have embeddings`);

    if (withEmbeddings === 0 && total > 0) {
      console.log('⚠️  Warning: No embeddings found. Semantic search will not work.');
    }

    console.log('\n✅ All database tests passed!');

  } catch (error: any) {
    console.error('\n❌ Database test failed:', error.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

testDatabaseConnection();
