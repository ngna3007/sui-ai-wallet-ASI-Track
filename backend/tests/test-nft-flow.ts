/**
 * NFT Flow Test
 * Tests the complete NFT lifecycle: Mint → Verify Ownership → Transfer
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_USER = 'agent1qnft_test_user';
const TEST_RECIPIENT = '0x742d35cc6634c0532925a3b844bc9c7eb6fb05f44228e1a3123c835dfa09a470'; // Random Sui address

interface NFT {
  id: number;
  userAddress: string;
  nftObjectId: string;
  name: string;
  description: string;
  imageUrl: string;
  status: string;
  mintTxDigest: string;
  transferTxDigest: string | null;
  recipientAddress: string | null;
  mintedAt: string;
  transferredAt: string | null;
}

console.log('🧪 NFT Flow Test');
console.log(`📍 Testing: ${BACKEND_URL}`);
console.log(`👤 Test User: ${TEST_USER}\n`);

async function testNFTFlow() {
  let nftObjectId: string | undefined;

  try {
    // Step 1: Mint NFT
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 1: Minting NFT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const mintResponse = await fetch(`${BACKEND_URL}/api/mint-nft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: TEST_USER,
        name: 'Test NFT',
        description: 'This is a test NFT for the multi-user wallet system',
        imageUrl: 'https://example.com/test-nft.png',
      }),
    });

    const mintData = await mintResponse.json();

    if (!mintResponse.ok || !mintData.success) {
      console.log(`❌ Mint failed: ${mintData.error || 'Unknown error'}`);
      return false;
    }

    nftObjectId = mintData.nftObjectId;
    console.log(`✅ NFT Minted`);
    console.log(`   Object ID: ${nftObjectId}`);
    console.log(`   TX: ${mintData.transactionHash}`);
    console.log(`   Explorer: ${mintData.explorerUrl}\n`);

    if (!nftObjectId) {
      console.log(`❌ No NFT object ID returned`);
      return false;
    }

    // Step 2: Verify ownership
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 2: Verifying Ownership');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const nftsResponse = await fetch(
      `${BACKEND_URL}/api/user/nfts?userAddress=${TEST_USER}&status=owned`
    );
    const nftsData = await nftsResponse.json();

    if (!nftsResponse.ok || !nftsData.success) {
      console.log(`❌ Failed to fetch NFTs: ${nftsData.error || 'Unknown error'}`);
      return false;
    }

    const ownedNft = nftsData.nfts.find((nft: NFT) => nft.nftObjectId === nftObjectId);

    if (!ownedNft) {
      console.log(`❌ NFT ${nftObjectId} not found in user's owned NFTs`);
      console.log(`   User has ${nftsData.count} NFT(s):`);
      nftsData.nfts.forEach((nft: NFT) => {
        console.log(`   - ${nft.nftObjectId} (${nft.status})`);
      });
      return false;
    }

    console.log(`✅ NFT Ownership Verified`);
    console.log(`   User: ${ownedNft.userAddress}`);
    console.log(`   Name: ${ownedNft.name}`);
    console.log(`   Status: ${ownedNft.status}`);
    console.log(`   Minted: ${new Date(ownedNft.mintedAt).toLocaleString()}\n`);

    // Step 3: Transfer NFT
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 3: Transferring NFT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const transferResponse = await fetch(`${BACKEND_URL}/api/transfer-nft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: TEST_USER,
        nftObjectId,
        recipientAddress: TEST_RECIPIENT,
      }),
    });

    const transferData = await transferResponse.json();

    if (!transferResponse.ok || !transferData.success) {
      console.log(`❌ Transfer failed: ${transferData.error || 'Unknown error'}`);
      return false;
    }

    console.log(`✅ NFT Transferred`);
    console.log(`   From: ${TEST_USER}`);
    console.log(`   To: ${TEST_RECIPIENT}`);
    console.log(`   TX: ${transferData.transactionHash}`);
    console.log(`   Explorer: ${transferData.explorerUrl}\n`);

    // Step 4: Verify NFT is marked as transferred
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 4: Verifying Transfer Status');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const transferredNftsResponse = await fetch(
      `${BACKEND_URL}/api/user/nfts?userAddress=${TEST_USER}&status=transferred`
    );
    const transferredNftsData = await transferredNftsResponse.json();

    if (!transferredNftsResponse.ok || !transferredNftsData.success) {
      console.log(`❌ Failed to fetch transferred NFTs: ${transferredNftsData.error || 'Unknown error'}`);
      return false;
    }

    const transferredNft = transferredNftsData.nfts.find((nft: NFT) => nft.nftObjectId === nftObjectId);

    if (!transferredNft) {
      console.log(`❌ NFT ${nftObjectId} not found in transferred NFTs`);
      return false;
    }

    console.log(`✅ Transfer Status Verified`);
    console.log(`   NFT: ${transferredNft.nftObjectId}`);
    console.log(`   Status: ${transferredNft.status}`);
    console.log(`   Recipient: ${transferredNft.recipientAddress}`);
    console.log(`   Transferred: ${new Date(transferredNft.transferredAt).toLocaleString()}\n`);

    // Step 5: Verify NFT is no longer in owned list
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 5: Verifying NFT Removed from Owned List');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const ownedNftsResponse = await fetch(
      `${BACKEND_URL}/api/user/nfts?userAddress=${TEST_USER}&status=owned`
    );
    const ownedNftsData = await ownedNftsResponse.json();

    const stillOwned = ownedNftsData.nfts.find((nft: NFT) => nft.nftObjectId === nftObjectId);

    if (stillOwned) {
      console.log(`❌ NFT ${nftObjectId} still appears in owned NFTs`);
      return false;
    }

    console.log(`✅ NFT No Longer in Owned List`);
    console.log(`   User now has ${ownedNftsData.count} owned NFT(s)\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ALL TESTS PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('✅ NFT Flow Complete:');
    console.log('   1. ✅ Minted NFT and recorded in database');
    console.log('   2. ✅ Verified ownership in database');
    console.log('   3. ✅ Transferred NFT on-chain');
    console.log('   4. ✅ Marked as transferred in database');
    console.log('   5. ✅ Removed from owned list\n');

    return true;
  } catch (error: any) {
    console.error(`❌ Test failed with error:`, error.message);
    return false;
  }
}

testNFTFlow()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
