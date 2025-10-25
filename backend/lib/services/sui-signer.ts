/**
 * Sui Transaction Signing Service
 * Implements Fetch.ai on-chain agent pattern for Sui blockchain
 *
 * Following the pattern from Fetch.ai examples:
 * - Load agent keypair from environment variable
 * - Sign transactions with agent's private key
 * - Execute transactions on Sui network
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { fromHex } from '@mysten/sui/utils';

// Initialize Sui client
const NETWORK = process.env.SUI_NETWORK || 'testnet';
const RPC_URL =
  NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';

const suiClient = new SuiClient({ url: RPC_URL });

/**
 * Load agent's Sui keypair from environment variable
 *
 * Similar to Fetch.ai Solana pattern:
 * ```python
 * secret_key_str = os.getenv('AGENT_SECRET_LIST')
 * secret_key_bytes = bytes(secret_key_list)
 * agent_keypair = Keypair.from_bytes(secret_key_bytes)
 * ```
 */
export function loadAgentKeypair(): Ed25519Keypair {
  const privateKey = process.env.AGENT_SUI_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      'AGENT_SUI_PRIVATE_KEY not set in environment.\n' +
      'Generate one with: sui client new-address ed25519\n' +
      'Then export the private key and set in .env'
    );
  }

  try {
    // Support both formats:
    // 1. Raw hex: "0xabc123..."
    // 2. Sui private key string: "suiprivkey1q..."

    if (privateKey.startsWith('suiprivkey')) {
      // Import from Bech32 encoded key
      return Ed25519Keypair.fromSecretKey(privateKey);
    } else {
      // Import from hex string
      const hexKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
      const secretKey = fromHex(hexKey);
      return Ed25519Keypair.fromSecretKey(secretKey);
    }
  } catch (error) {
    throw new Error(
      `Failed to load agent keypair: ${error instanceof Error ? error.message : error}\n` +
      'Check AGENT_SUI_PRIVATE_KEY format in .env'
    );
  }
}

/**
 * Get agent's Sui address
 */
export function getAgentAddress(): string {
  const keypair = loadAgentKeypair();
  return keypair.toSuiAddress();
}

/**
 * Get agent's wallet balance
 */
export async function getAgentBalance(): Promise<{
  totalBalance: string;
  coins: Array<{ coinType: string; balance: string }>;
}> {
  const address = getAgentAddress();

  const balance = await suiClient.getBalance({
    owner: address,
  });

  const allBalances = await suiClient.getAllBalances({
    owner: address,
  });

  return {
    totalBalance: balance.totalBalance,
    coins: allBalances,
  };
}

/**
 * Sign and execute a transaction on Sui blockchain
 *
 * Follows Fetch.ai pattern:
 * ```python
 * transaction = Transaction.new_signed_with_payer(
 *     [transfer_instruction],
 *     from_keypair.pubkey(),
 *     [from_keypair],  # Agent signs
 *     recent_blockhash
 * )
 * result = client.send_raw_transaction(bytes(transaction))
 * ```
 */
export async function signAndExecuteTransaction(
  transaction: Transaction,
): Promise<{
  success: boolean;
  digest: string;
  effects?: any;
  objectChanges?: any;
  error?: string;
}> {
  try {
    const keypair = loadAgentKeypair();
    const address = keypair.toSuiAddress();

    console.log(`🔐 [Signer] Signing transaction with agent address: ${address}`);

    // Set sender (agent's address)
    transaction.setSender(address);

    // Sign and execute transaction
    const result = await suiClient.signAndExecuteTransaction({
      transaction,
      signer: keypair,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });

    console.log(`✅ [Signer] Transaction executed: ${result.digest}`);

    return {
      success: true,
      digest: result.digest,
      effects: result.effects,
      objectChanges: result.objectChanges,
    };
  } catch (error) {
    console.error(`❌ [Signer] Transaction failed:`, error);
    return {
      success: false,
      digest: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a PTB (Programmable Transaction Block) from serialized bytes
 *
 * @param transactionBytes - Base64 encoded transaction bytes
 */
export async function executeTransactionFromBytes(
  transactionBytes: string,
): Promise<{
  success: boolean;
  digest: string;
  effects?: any;
  error?: string;
}> {
  try {
    const keypair = loadAgentKeypair();
    const address = keypair.toSuiAddress();

    console.log(`🔐 [Signer] Signing transaction bytes with agent: ${address}`);

    // Deserialize transaction
    const tx = Transaction.from(transactionBytes);
    tx.setSender(address);

    return await signAndExecuteTransaction(tx);
  } catch (error) {
    console.error(`❌ [Signer] Failed to execute transaction:`, error);
    return {
      success: false,
      digest: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Transfer SUI tokens (following Fetch.ai transfer pattern)
 *
 * @param recipientAddress - Recipient's Sui address
 * @param amountSui - Amount in SUI (will be converted to MIST)
 */
export async function transferSui(
  recipientAddress: string,
  amountSui: number,
): Promise<{
  success: boolean;
  digest: string;
  error?: string;
}> {
  try {
    const keypair = loadAgentKeypair();
    const senderAddress = keypair.toSuiAddress();

    // Convert SUI to MIST (1 SUI = 1,000,000,000 MIST)
    const amountMist = Math.floor(amountSui * 1_000_000_000);

    console.log(`💸 [Transfer] ${amountSui} SUI (${amountMist} MIST)`);
    console.log(`   From: ${senderAddress}`);
    console.log(`   To: ${recipientAddress}`);

    // Create transaction
    const tx = new Transaction();

    // Split coin for exact amount
    const [coin] = tx.splitCoins(tx.gas, [amountMist]);

    // Transfer to recipient
    tx.transferObjects([coin], recipientAddress);

    // Sign and execute
    const result = await signAndExecuteTransaction(tx);

    if (result.success) {
      console.log(`✅ [Transfer] Complete: ${result.digest}`);
    }

    return result;
  } catch (error) {
    console.error(`❌ [Transfer] Failed:`, error);
    return {
      success: false,
      digest: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get agent wallet info for display
 */
export async function getAgentWalletInfo(): Promise<{
  address: string;
  balance: string;
  network: string;
}> {
  const address = getAgentAddress();
  const balanceData = await getAgentBalance();

  return {
    address,
    balance: `${(parseInt(balanceData.totalBalance) / 1_000_000_000).toFixed(4)} SUI`,
    network: NETWORK,
  };
}
