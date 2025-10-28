/**
 * Test Multi-Operation Atomic PTB via LLM API
 */
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('../.env') });

const API_URL = 'http://localhost:3000';
const API_KEY = process.env.BACKEND_API_KEY;

console.log('🧪 Testing Multi-Operation Atomic PTB via LLM\n');

async function testMultiOpAtomic() {
  try {
    console.log('📝 Request: Transfer 0.01 SUI twice + Mint NFT (3 operations)');
    console.log('⏳ Sending request to /api/create-ptb...\n');

    const response = await fetch(`${API_URL}/api/create-ptb`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY!,
      },
      body: JSON.stringify({
        userIntent:
          'transfer 0.01 SUI to 0x78dfbf158b7bc454286017c41ebcf41d324ee4782c56a89fb00e5fb9f296b8ed, then transfer another 0.01 SUI to the same address, and also mint an NFT called MultiOpSuccess with description Testing atomic multi-op PTB and image https://example.com/success.png',
        walletAddress: 'agent1qtes',
      }),
    });

    const data = await response.json();

    if (data.success) {
      console.log('✅ MULTI-OPERATION ATOMIC PTB SUCCESSFUL!\n');
      console.log('📊 Transaction Details:');
      console.log(`   Transaction Hash: ${data.transactionHash}`);
      console.log(`   Template: ${data.templateName}`);

      if (data.mode === 'multi-operation') {
        console.log(`\n   🎯 Mode: ${data.mode}`);
        console.log(`   📋 Operation Count: ${data.operationCount}`);
        console.log(`   🔧 Operations: ${data.operations.join(', ')}`);
        if (data.effects) {
          console.log(`\n   ✨ Effects:`);
          data.effects.forEach((effect: string, index: number) => {
            console.log(`      ${index + 1}. ${effect}`);
          });
        }
      }

      console.log('\n🔗 View on Sui Explorer:');
      console.log(`   https://testnet.suivision.xyz/txblock/${data.transactionHash}`);
      console.log('\n✅ TEST PASSED - Multi-op atomic PTB executed successfully!');
      process.exit(0);
    } else {
      console.error('❌ TEST FAILED');
      console.error('Error:', data.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ TEST FAILED - Request error');
    console.error(error);
    process.exit(1);
  }
}

testMultiOpAtomic();
