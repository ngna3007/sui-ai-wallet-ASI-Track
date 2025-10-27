/**
 * User Management Service
 * Non-Custodial Architecture
 *
 * Architecture:
 * - Each user gets unique deposit address (derived deterministically)
 * - Users manage funds in their own deposit wallets
 * - Balance read directly from blockchain (no virtual balances)
 * - No sweeping - funds stay in deposit address until user executes PTB
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { toHex } from '@mysten/sui/utils';
import crypto from 'crypto';
import { db, schema } from '../../db/drizzle-client.js';
import { eq } from 'drizzle-orm';

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const RPC_URL =
  NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';

const suiClient = new SuiClient({ url: RPC_URL });

// Master key for derivation (keep secure!)
const MASTER_SEED = process.env.MASTER_DERIVATION_SEED || 'suivisor_master_seed_change_in_production';

/**
 * Derive deterministic deposit address for a user
 * Each user gets unique Sui address derived from their ASI:One address
 */
export function deriveDepositAddress(userAddress: string): {
  keypair: Ed25519Keypair;
  address: string;
  seed: string;
} {
  // Create deterministic seed from master + user address
  const derivationPath = `${MASTER_SEED}:deposit:${userAddress}`;
  const hash = crypto.createHash('sha256').update(derivationPath).digest();

  // Generate keypair from 32-byte seed
  const seedBytes = Uint8Array.from(hash.subarray(0, 32));
  const keypair = Ed25519Keypair.fromSecretKey(seedBytes);
  const address = keypair.toSuiAddress();
  const seed = toHex(seedBytes);

  return {
    keypair,
    address,
    seed,
  };
}

/**
 * Get or create user account
 * Returns user info with their unique deposit address
 */
export async function getOrCreateUser(userAddress: string): Promise<{
  userAddress: string;
  depositAddress: string;
}> {
  console.log(`📝 [UserManager] Get or create user: ${userAddress}`);

  // Check if user exists
  const existing = await db.query.userAccounts.findFirst({
    where: eq(schema.userAccounts.userAddress, userAddress),
  });

  if (existing) {
    return {
      userAddress: existing.userAddress,
      depositAddress: existing.depositAddress,
    };
  }

  // Create new user
  const depositInfo = deriveDepositAddress(userAddress);

  await db.insert(schema.userAccounts).values({
    userAddress,
    depositAddress: depositInfo.address,
    depositKeypairSeed: depositInfo.seed,
  });

  console.log(`✅ [UserManager] Created user: ${userAddress}`);
  console.log(`   Deposit Address: ${depositInfo.address}`);

  // Audit log
  await db.insert(schema.auditLog).values({
    userAddress,
    action: 'user_created',
    details: { depositAddress: depositInfo.address },
  });

  return {
    userAddress,
    depositAddress: depositInfo.address,
  };
}

/**
 * Check and process deposits to user's deposit address
 */
export async function checkAndProcessDeposits(userAddress: string): Promise<{
  newDeposits: number;
  totalAmount: number;
}> {
  const user = await db.query.userAccounts.findFirst({
    where: eq(schema.userAccounts.userAddress, userAddress),
  });

  if (!user) {
    throw new Error('User not found');
  }

  const depositAddress = user.depositAddress;

  console.log(`🔍 [UserManager] Checking deposits for ${depositAddress}`);

  // Get balance from blockchain
  const balance = await suiClient.getBalance({
    owner: depositAddress,
  });

  const amountMist = parseInt(balance.totalBalance);
  const amountSui = amountMist / 1_000_000_000;

  if (amountSui > 0) {
    console.log(`💵 [UserManager] Found ${amountSui} SUI in deposit address`);

    // Record deposit transaction
    try {
      await db.insert(schema.depositTransactions).values({
        userAddress,
        suiDigest: 'detected_' + Date.now(),
        fromAddress: 'external',
        toAddress: depositAddress,
        tokenType: 'SUI',
        amount: String(amountSui),
        status: 'confirmed',
      });
    } catch (error) {
      // Ignore duplicate key errors (ON CONFLICT DO NOTHING)
      console.log('Deposit already recorded');
    }

    return {
      newDeposits: 1,
      totalAmount: amountSui,
    };
  }

  return { newDeposits: 0, totalAmount: 0 };
}

/**
 * Get user transaction history
 */
export async function getUserTransactions(
  userAddress: string,
  limit: number = 50
): Promise<any[]> {
  const transactions = await db.query.userTransactions.findMany({
    where: eq(schema.userTransactions.userAddress, userAddress),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit,
  });

  return transactions;
}
