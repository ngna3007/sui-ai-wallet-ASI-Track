import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const AGENT_PRIVATE_KEY = 'suiprivkey1qr4e7wz84w8eef707mpyaah3s9d2p3p6wp4h47ytqwsr0m805uxtkqjcttv';
const RECIPIENT = '0x78dfbf158b7bc454286017c41ebcf41d324ee4782c56a89fb00e5fb9f296b8ed';
const NFT_PACKAGE = '0xc82610b387bf80580070abebd7add5d82930f2bfa67d3eb534e2d999e797472d';

async function atomicPTB() {
  // Setup
  const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
  const keypair = Ed25519Keypair.fromSecretKey(AGENT_PRIVATE_KEY);

  console.log('🔧 Building atomic PTB...');
  console.log('   1. Transfer 0.01 SUI to recipient');
  console.log('   2. Transfer another 0.01 SUI to recipient');
  console.log('   3. Mint NFT "AtomicTest" for sender');
  console.log('');

  const tx = new Transaction();

  // Operation 1: Transfer 0.01 SUI
  const [coin1] = tx.splitCoins(tx.gas, [10000000]); // 0.01 SUI = 10_000_000 MIST
  tx.transferObjects([coin1], RECIPIENT);
  console.log('✅ Added: Transfer 0.01 SUI to recipient');

  // Operation 2: Transfer another 0.01 SUI
  const [coin2] = tx.splitCoins(tx.gas, [10000000]); // 0.01 SUI = 10_000_000 MIST
  tx.transferObjects([coin2], RECIPIENT);
  console.log('✅ Added: Transfer another 0.01 SUI to recipient');

  // Operation 3: Mint NFT (transfers to sender automatically)
  const nftName = 'AtomicTest';
  const nftDescription = 'Testing atomic PTB execution - 2x Transfer + Mint';
  const nftImageUrl = 'https://example.com/atomic.png';

  tx.moveCall({
    target: `${NFT_PACKAGE}::nft::mint_to_sender`,
    arguments: [
      tx.pure.string(nftName),
      tx.pure.string(nftDescription),
      tx.pure.string(nftImageUrl),
    ],
  });
  console.log('✅ Added: Mint NFT "AtomicTest" to sender');

  console.log('');
  console.log('🔏 Signing and executing atomic transaction...');

  // Execute
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: {
      showEffects: true,
      showObjectChanges: true,
    },
  });

  console.log('');
  console.log('🎉 ATOMIC TRANSACTION EXECUTED!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Transaction Digest:', result.digest);
  console.log('Explorer:', `https://suiscan.xyz/testnet/tx/${result.digest}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Effects Summary:');
  console.log('   Status:', result.effects?.status?.status);
  console.log('   Gas Used:',
    result.effects?.gasUsed
      ? (Number(result.effects.gasUsed.computationCost) +
         Number(result.effects.gasUsed.storageCost) -
         Number(result.effects.gasUsed.storageRebate)) / 1_000_000_000 + ' SUI'
      : 'N/A'
  );

  if (result.objectChanges) {
    console.log('');
    console.log('📦 Object Changes:');
    result.objectChanges.forEach((change: any, i: number) => {
      console.log(`   ${i + 1}. ${change.type}: ${change.objectType || 'N/A'}`);
      if (change.objectId) {
        console.log(`      Object ID: ${change.objectId}`);
      }
    });
  }

  console.log('');
  console.log('✅ All 3 operations (2x SUI transfer + NFT mint) executed atomically!');

  return result.digest;
}

atomicPTB().catch(console.error);
