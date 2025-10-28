/**
 * Database Connection Diagnostic Test
 */
import postgres from 'postgres';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment from parent directory
dotenv.config({ path: resolve('../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

console.log('🔍 Testing database connection...');
console.log(`📍 Database: ${DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ':***@') : 'NOT SET'}`);

async function testConnection() {
  try {
    console.log('\n⏳ Attempting to connect (30 second timeout)...');

    const sql = postgres(DATABASE_URL!, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 30, // Increased timeout for diagnosis
    });

    console.log('✅ Connection object created');

    // Try a simple query
    console.log('⏳ Executing test query...');
    const result = await sql`SELECT NOW() as current_time, version() as postgres_version`;

    console.log('\n✅ DATABASE CONNECTION SUCCESSFUL!');
    console.log('📊 Database Info:');
    console.log(`   Time: ${result[0].current_time}`);
    console.log(`   Version: ${result[0].postgres_version}`);

    // Test PTB registry table
    console.log('\n⏳ Checking ptb_registry table...');
    const templates = await sql`SELECT COUNT(*) as count FROM ptb_registry WHERE embedding IS NOT NULL`;
    console.log(`✅ Found ${templates[0].count} PTB templates with embeddings`);

    await sql.end();
    console.log('\n✅ All tests passed! Database is working correctly.');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ DATABASE CONNECTION FAILED!');
    console.error('Error details:', error);

    if (error instanceof Error) {
      if (error.message.includes('CONNECT_TIMEOUT')) {
        console.error('\n💡 Diagnosis: Connection timeout');
        console.error('   Possible causes:');
        console.error('   - Neon database is paused (scale to zero)');
        console.error('   - Network connectivity issues');
        console.error('   - Firewall blocking connection');
        console.error('\n   Solution: Check Neon dashboard and wake up database');
      } else if (error.message.includes('authentication')) {
        console.error('\n💡 Diagnosis: Authentication failed');
        console.error('   - Check DATABASE_URL credentials');
      }
    }

    process.exit(1);
  }
}

testConnection();
