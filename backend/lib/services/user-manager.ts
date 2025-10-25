/**
 * User Management Service
 * Handles multi-user wallet architecture
 *
 * Architecture:
 * - Each user gets unique deposit address (derived deterministically)
 * - Agent main wallet holds all funds (efficient operations)
 * - Database tracks individual user balances
 * - Automatic sweeping from deposit addresses to main wallet
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { fromHex, toHex } from '@mysten/sui/utils';
import crypto from 'crypto';
import { db, schema } from '../../db/drizzle-client.js';
import { eq, and } from 'drizzle-orm';

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
 */
export async function getOrCreateUser(userAddress: string): Promise<{
  userAddress: string;
  depositAddress: string;
  balances: Record<string, number>;
}> {
  console.log(`📝 [UserManager] Get or create user: ${userAddress}`);

  // Check if user exists
  const existing = await db.query.userAccounts.findFirst({
    where: eq(schema.userAccounts.userAddress, userAddress),
  });

  if (existing) {
    // User exists, get balances
    const balances = await getUserBalances(userAddress);

    return {
      userAddress: existing.userAddress,
      depositAddress: existing.depositAddress,
      balances,
    };
  }

  // Create new user
  const depositInfo = deriveDepositAddress(userAddress);

  await db.insert(schema.userAccounts).values({
    userAddress,
    depositAddress: depositInfo.address,
    depositKeypairSeed: depositInfo.seed,
  });

  // Initialize balances for common tokens
  const tokens = ['SUI', 'USDC'];
  for (const token of tokens) {
    await db.insert(schema.userBalances).values({
      userAddress,
      tokenType: token,
      balance: '0',
    });
  }

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
    balances: { SUI: 0, USDC: 0 },
  };
}

/**
 * Get user balances
 */
export async function getUserBalances(userAddress: string): Promise<Record<string, number>> {
  const balances = await db.query.userBalances.findMany({
    where: eq(schema.userBalances.userAddress, userAddress),
  });

  const result: Record<string, number> = {};
  for (const row of balances) {
    result[row.tokenType] = parseFloat(row.balance);
  }

  return result;
}

/**
 * Update user balance (after deposit or transaction)
 */
export async function updateUserBalance(
  userAddress: string,
  tokenType: string,
  delta: number,
  operation: 'deposit' | 'withdraw' | 'transfer' | 'sweep'
): Promise<void> {
  console.log(`💰 [UserManager] Update balance: ${userAddress} ${operation} ${delta} ${tokenType}`);

  // Get current balance
  const current = await db.query.userBalances.findFirst({
    where: and(
      eq(schema.userBalances.userAddress, userAddress),
      eq(schema.userBalances.tokenType, tokenType)
    ),
  });

  if (!current) {
    // Initialize if not exists
    await db.insert(schema.userBalances).values({
      userAddress,
      tokenType,
      balance: String(Math.max(0, delta)),
    });
  } else {
    const newBalance = Math.max(0, parseFloat(current.balance) + delta);

    await db.update(schema.userBalances)
      .set({ balance: String(newBalance) })
      .where(and(
        eq(schema.userBalances.userAddress, userAddress),
        eq(schema.userBalances.tokenType, tokenType)
      ));
  }

  // Audit log
  await db.insert(schema.auditLog).values({
    userAddress,
    action: 'balance_updated',
    details: { tokenType, delta, operation },
  });
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

    // Record deposit (will be swept later)
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
 * Sweep funds from user's deposit address to main wallet
 */
export async function sweepUserDeposits(userAddress: string): Promise<{
  success: boolean;
  amount: number;
  digest?: string;
  error?: string;
}> {
  try {
    const user = await db.query.userAccounts.findFirst({
      where: eq(schema.userAccounts.userAddress, userAddress),
    });

    if (!user) {
      throw new Error('User not found');
    }

    const depositAddress = user.depositAddress;
    const seed = user.depositKeypairSeed;

    // Reconstruct keypair from stored seed
    const seedBytes = fromHex(seed);
    const keypair = Ed25519Keypair.fromSecretKey(seedBytes);

    // Check balance
    const balance = await suiClient.getBalance({ owner: depositAddress });
    const amountMist = parseInt(balance.totalBalance);
    const amountSui = amountMist / 1_000_000_000;

    if (amountSui < 0.01) {
      // Not enough to sweep (need gas)
      return {
        success: false,
        amount: amountSui,
        error: 'Insufficient balance to sweep (need gas)',
      };
    }

    console.log(`🧹 [UserManager] Sweeping ${amountSui} SUI from ${depositAddress}`);

    // Import the main wallet function
    const { getAgentAddress } = await import('./sui-signer.js');
    const mainWallet = getAgentAddress();

    // Create sweep transaction
    const { Transaction } = await import('@mysten/sui/transactions');
    const tx = new Transaction();

    // Transfer all coins (minus gas) to main wallet
    const [coin] = tx.splitCoins(tx.gas, [amountMist - 10_000_000]); // Keep 0.01 SUI for gas
    tx.transferObjects([coin], mainWallet);

    // Sign with deposit address keypair
    tx.setSender(depositAddress);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: {
        showEffects: true,
      },
    });

    console.log(`✅ [UserManager] Swept ${amountSui} SUI: ${result.digest}`);

    // Record sweep
    await db.insert(schema.sweepOperations).values({
      userAddress,
      fromAddress: depositAddress,
      toAddress: mainWallet,
      tokenType: 'SUI',
      amount: String(amountSui),
      suiDigest: result.digest,
      status: 'confirmed',
    });

    // Update user balance
    await updateUserBalance(userAddress, 'SUI', amountSui, 'sweep');

    return {
      success: true,
      amount: amountSui,
      digest: result.digest,
    };
  } catch (error) {
    console.error(`❌ [UserManager] Sweep failed:`, error);
    return {
      success: false,
      amount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Process withdrawal request
 */
export async function processWithdrawal(
  userAddress: string,
  tokenType: string,
  amount: number,
  recipientAddress: string
): Promise<{
  success: boolean;
  digest?: string;
  error?: string;
}> {
  try {
    console.log(`💸 [UserManager] Withdrawal: ${amount} ${tokenType} to ${recipientAddress}`);

    // Check user balance
    const balances = await getUserBalances(userAddress);

    if (!balances[tokenType] || balances[tokenType] < amount) {
      return {
        success: false,
        error: `Insufficient balance. You have ${balances[tokenType] || 0} ${tokenType}`,
      };
    }

    // Create withdrawal request
    const [withdrawalRequest] = await db.insert(schema.withdrawalRequests).values({
      userAddress,
      tokenType,
      amount: String(amount),
      recipientAddress,
      status: 'processing',
    }).returning();

    // Execute transfer from main wallet
    const { transferSui } = await import('./sui-signer.js');
    const result = await transferSui(recipientAddress, amount);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    // Update withdrawal request
    await db.update(schema.withdrawalRequests)
      .set({
        status: 'completed',
        suiDigest: result.digest,
        completedAt: new Date(),
      })
      .where(eq(schema.withdrawalRequests.id, withdrawalRequest.id));

    // Deduct from user balance
    await updateUserBalance(userAddress, tokenType, -amount, 'withdraw');

    console.log(`✅ [UserManager] Withdrawal complete: ${result.digest}`);

    return {
      success: true,
      digest: result.digest,
    };
  } catch (error) {
    console.error(`❌ [UserManager] Withdrawal failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
