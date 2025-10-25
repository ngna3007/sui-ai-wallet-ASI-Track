/**
 * SuiVisor PTB Backend API
 * Connects to existing database and provides PTB transaction execution for agents
 */

import express from 'express';
import cors from 'cors';
import postgres from 'postgres';
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { config } from 'dotenv';
import { calculateEmbedding, findSimilarPTBs } from './lib/services/embeddings.js';
import {
  signAndExecuteTransaction,
  executeTransactionFromBytes,
  transferSui,
  getAgentWalletInfo,
  getAgentBalance,
} from './lib/services/sui-signer.js';
import { findBestPool, buildSwapTransaction } from './lib/services/cetus-swap.js';
import {
  getOrCreateUser,
  getUserBalances,
  checkAndProcessDeposits,
  sweepUserDeposits,
  processWithdrawal,
  getUserTransactions,
} from './lib/services/user-manager.js';
import { db, schema } from './db/drizzle-client.js';
import { eq, and } from 'drizzle-orm';

// Load environment from parent directory
config({ path: '../.env' });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.BACKEND_PORT || 3000;
const SUI_NETWORK = process.env.SUI_NETWORK || 'testnet';
const DATABASE_URL = process.env.DATABASE_URL;

// Connect to existing PostgreSQL database
const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

console.log('🚀 SuiVisor PTB Backend Starting...');
console.log(`📍 Network: ${SUI_NETWORK}`);
console.log(`🗄️  Database: ${DATABASE_URL ? 'Connected' : 'Not configured'}`);

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SuiVisor PTB Backend',
    network: SUI_NETWORK,
    timestamp: Date.now(),
  });
});

/**
 * POST /api/create-ptb
 *
 * Create and execute PTB transaction based on user intent
 */
app.post('/api/create-ptb', async (req, res) => {
  try {
    const { userIntent, walletAddress, templateId } = req.body;

    if (!userIntent && !templateId) {
      return res.status(400).json({
        success: false,
        error: 'Either userIntent or templateId is required',
      });
    }

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'walletAddress is required',
      });
    }

    console.log('🔍 [PTB] Request:', {
      userIntent,
      walletAddress: walletAddress.substring(0, 10) + '...',
      templateId,
    });

    // Search for PTB template in existing database
    let template;

    if (templateId) {
      const result = await sql`
        SELECT * FROM ptb_registry
        WHERE id = ${templateId} AND "isActive" = true
        LIMIT 1
      `;
      template = result[0];
    } else {
      // Semantic search with Voyage AI embeddings
      console.log(`🔍 [PTB] Analyzing intent: "${userIntent}"`);

      // Generate embedding for user intent
      const intentEmbedding = await calculateEmbedding(userIntent);
      console.log(`🧠 [PTB] Generated embedding (${intentEmbedding.length} dimensions)`);

      // Fetch all active templates with embeddings
      const allTemplates = await sql`
        SELECT id, name, description, tags, embedding, "typescriptCode", "inputSchema", "isActive"
        FROM ptb_registry
        WHERE "isActive" = true
        AND embedding IS NOT NULL
      `;

      if (allTemplates.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No PTB templates with embeddings found in database',
        });
      }

      // Parse embeddings (stored as JSONB)
      const templates = allTemplates.map((t: any) => ({
        ...t,
        embedding: Array.isArray(t.embedding) ? t.embedding : JSON.parse(t.embedding),
      }));

      console.log(`🔍 [PTB] Comparing against ${templates.length} templates`);

      // Find most similar templates
      const matches = findSimilarPTBs(intentEmbedding, templates, 0.5, 5);

      if (matches.length === 0) {
        return res.status(404).json({
          success: false,
          error: `No matching PTB template found for: "${userIntent}"`,
          suggestion: 'Try rephrasing your request or be more specific',
        });
      }

      template = matches[0].ptb;
      const similarity = matches[0].similarity;
      console.log(`✅ [PTB] Found: ${template.name} (similarity: ${similarity.toFixed(3)})`);

      // Log top 3 matches for debugging
      if (matches.length > 1) {
        console.log('   Other matches:');
        matches.slice(1, 3).forEach((m: any, i: number) => {
          console.log(`   ${i + 2}. ${m.ptb.name} (${m.similarity.toFixed(3)})`);
        });
      }
    }

    // Extract parameters
    const inputs = extractSimpleParameters(userIntent, template);
    console.log('🔧 [PTB] Inputs:', inputs);

    // Build transaction
    const rpcUrl = SUI_NETWORK === 'mainnet'
      ? 'https://fullnode.mainnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443';

    const client = new SuiClient({ url: rpcUrl });
    const tx = new Transaction();

    if (!template.typescriptCode) {
      return res.status(400).json({
        success: false,
        error: 'Template has no code',
      });
    }

    console.log('⚙️ [PTB] Building transaction...');

    const executeCode = new Function(
      'tx',
      'inputs',
      'userAddress',
      `${template.typescriptCode}\nreturn tx;`
    );

    const builtTx = executeCode(tx, inputs, walletAddress);

    console.log('✅ [PTB] Transaction built');

    // TODO: Sign and execute
    // For now, return mock response
    const mockTxHash = `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

    res.json({
      success: true,
      transactionHash: mockTxHash,
      gasUsed: 0.02,
      templateName: template.name,
      templateId: template.id,
      inputs,
      mode: 'mock',
      message: 'Mock transaction - add signing for production',
    });

  } catch (error) {
    console.error('❌ [PTB] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/templates
 * List available PTB templates
 */
app.get('/api/templates', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    const templates = await sql`
      SELECT id, name, description, tags
      FROM ptb_registry
      WHERE "isActive" = true
      LIMIT ${limit}
    `;

    res.json({
      success: true,
      count: templates.length,
      templates,
    });
  } catch (error) {
    console.error('❌ [Templates] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

function extractSimpleParameters(text: string, template: any): Record<string, any> {
  const inputs: Record<string, any> = {};
  const lower = text.toLowerCase();

  // Amount
  const amountMatch = text.match(/(\d+\.?\d*)/);
  if (amountMatch) {
    inputs.amount = parseFloat(amountMatch[1]);
  }

  // Tokens
  const tokens = ['sui', 'usdc'];
  for (const token of tokens) {
    if (lower.includes(token)) {
      if (!inputs.fromToken) inputs.fromToken = token.toUpperCase();
      else if (!inputs.toToken) inputs.toToken = token.toUpperCase();
    }
  }

  // Address
  const addressMatch = text.match(/0x[a-fA-F0-9]{64}/);
  if (addressMatch) {
    inputs.recipient = addressMatch[0];
  }

  return inputs;
}

/**
 * POST /api/execute-transaction
 * Execute transaction with agent's wallet (Fetch.ai on-chain pattern)
 *
 * Body: {
 *   transactionBytes: string (base64),
 *   mode?: "sign" | "execute" (default: "execute")
 * }
 */
app.post('/api/execute-transaction', async (req, res) => {
  try {
    const { transactionBytes, mode = 'execute' } = req.body;

    if (!transactionBytes) {
      return res.status(400).json({
        success: false,
        error: 'transactionBytes is required',
      });
    }

    console.log('🔐 [Execute] Signing transaction with agent wallet...');

    // Execute transaction on Sui blockchain (Fetch.ai pattern)
    const result = await executeTransactionFromBytes(transactionBytes);

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      digest: result.digest,
      effects: result.effects,
      mode: 'real',
      message: 'Transaction executed on Sui blockchain',
    });
  } catch (error: any) {
    console.error('❌ [Execute] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/transfer
 * Direct SUI transfer (following Fetch.ai transfer_sol pattern)
 *
 * Body: {
 *   recipient: string (Sui address),
 *   amount: number (SUI amount, not MIST)
 * }
 */
app.post('/api/transfer', async (req, res) => {
  try {
    const { recipient, amount } = req.body;

    if (!recipient || !amount) {
      return res.status(400).json({
        success: false,
        error: 'recipient and amount are required',
      });
    }

    console.log(`💸 [Transfer] ${amount} SUI → ${recipient}`);

    // Execute transfer (Fetch.ai pattern)
    const result = await transferSui(recipient, amount);

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      digest: result.digest,
      mode: 'real',
      message: `Transferred ${amount} SUI to ${recipient}`,
    });
  } catch (error: any) {
    console.error('❌ [Transfer] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/agent-wallet
 * Get agent wallet information
 */
app.get('/api/agent-wallet', async (req, res) => {
  try {
    const walletInfo = await getAgentWalletInfo();
    const balance = await getAgentBalance();

    res.json({
      success: true,
      ...walletInfo,
      balanceDetails: balance,
    });
  } catch (error: any) {
    console.error('❌ [Wallet] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Hybrid Fast-Path PTB Endpoints
app.post('/api/swap', async (req, res) => {
  try {
    const { userAddress, fromToken, toToken, amount, poolId } = req.body;
    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields: fromToken, toToken, amount' });
    }

    console.log(`🔄 [Swap] ${amount} ${fromToken} → ${toToken}`);

    // Find best pool if not provided
    let pool;
    if (poolId) {
      console.log(`   Using provided pool: ${poolId}`);
      pool = { poolId, tokenA: '', tokenB: '', fee: 0, liquidity: '0', swapDirection: true, typeArguments: ['', ''] as [string, string] };
    } else {
      pool = await findBestPool(fromToken, toToken);
      if (!pool) {
        return res.status(404).json({
          success: false,
          error: `No pool found for ${fromToken}-${toToken} pair. Pool ID is required.`
        });
      }
      console.log(`   Found pool: ${pool.poolId}`);
    }

    // Get agent wallet info for Sui address
    // Fetch.ai addresses (agent1q...) are not Sui addresses, so we use the agent wallet
    const agentInfo = await getAgentWalletInfo();

    // Build swap transaction using Cetus SDK with agent's Sui address
    const tx = await buildSwapTransaction(pool, amount, agentInfo.address);

    // Execute transaction
    const result = await signAndExecuteTransaction(tx);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      transactionHash: result.digest,
      poolId: pool.poolId,
      fromToken,
      toToken,
      amount,
      executedBy: agentInfo.address, // Agent wallet executes on behalf of Fetch.ai user
      requestedBy: userAddress, // Original Fetch.ai agent address
      mode: 'fast-path-cetus-sdk',
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`
    });
  } catch (error: any) {
    console.error(`❌ [Swap] Error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/stake', async (req, res) => {
  try {
    const { userAddress, amount, validatorAddress } = req.body;
    if (!userAddress || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    console.log(`🔒 [Stake] ${amount} SUI`);

    const template = await sql`
      SELECT * FROM ptb_registry WHERE name = '@sui/stake' AND "isActive" = true LIMIT 1
    `;

    if (template.length === 0) {
      return res.status(404).json({ success: false, error: 'Stake template not found' });
    }

    const tx = new Transaction();
    const executeCode = new Function('tx', 'inputs', 'userAddress', `${template[0].typescriptCode}\nreturn tx;`);
    executeCode(tx, { amount, validatorAddress }, userAddress);

    const result = await signAndExecuteTransaction(tx);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      transactionHash: result.digest,
      templateName: '@sui/stake',
      mode: 'fast-path-real',
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/mint-nft', async (req, res) => {
  try {
    const { userAddress, name, description, imageUrl } = req.body;
    if (!userAddress || !name || !description || !imageUrl) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    console.log(`🎨 [Mint NFT] "${name}" for user: ${userAddress}`);

    // Ensure user exists in the system
    await getOrCreateUser(userAddress);

    const template = await sql`
      SELECT * FROM ptb_registry WHERE name = '@commandoss/mint-nft' AND "isActive" = true LIMIT 1
    `;

    if (template.length === 0) {
      return res.status(404).json({ success: false, error: 'Mint NFT template not found' });
    }

    const tx = new Transaction();
    const executeCode = new Function('tx', 'inputs', 'userAddress', `${template[0].typescriptCode}\nreturn tx;`);
    executeCode(tx, { name, description, imageUrl }, userAddress);

    const result = await signAndExecuteTransaction(tx);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Extract created NFT object ID from objectChanges
    let nftObjectId: string | undefined;
    if (result.objectChanges) {
      const createdObjects = result.objectChanges.filter((change: any) => change.type === 'created');
      if (createdObjects.length > 0) {
        // The first created object is typically the NFT
        nftObjectId = createdObjects[0].objectId;
        console.log(`✅ [Mint NFT] Created NFT: ${nftObjectId}`);
      }
    }

    // Record NFT ownership in database
    if (nftObjectId) {
      try {
        await db.insert(schema.userNfts).values({
          userAddress,
          nftObjectId,
          nftType: '@commandoss/mint-nft',
          name,
          description,
          imageUrl,
          mintTxDigest: result.digest,
          status: 'owned',
        });
        console.log(`💾 [Mint NFT] Recorded ownership for ${userAddress}`);
      } catch (dbError) {
        console.error(`⚠️  [Mint NFT] Failed to record ownership:`, dbError);
        // Don't fail the request if DB recording fails
      }
    }

    res.json({
      success: true,
      transactionHash: result.digest,
      nftObjectId,
      templateName: '@commandoss/mint-nft',
      mode: 'fast-path-real',
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/transfer-nft', async (req, res) => {
  try {
    const { userAddress, nftObjectId, recipientAddress } = req.body;
    if (!userAddress || !nftObjectId || !recipientAddress) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    console.log(`📦 [Transfer NFT] ${nftObjectId} from ${userAddress} → ${recipientAddress}`);

    // Verify user owns the NFT
    const nft = await db.query.userNfts.findFirst({
      where: and(
        eq(schema.userNfts.userAddress, userAddress),
        eq(schema.userNfts.nftObjectId, nftObjectId),
        eq(schema.userNfts.status, 'owned')
      ),
    });

    if (!nft) {
      return res.status(403).json({
        success: false,
        error: `NFT ${nftObjectId} not found or not owned by ${userAddress}`
      });
    }

    // Direct transfer implementation (no template needed)
    const tx = new Transaction();
    tx.transferObjects([tx.object(nftObjectId)], recipientAddress);

    const result = await signAndExecuteTransaction(tx);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Mark NFT as transferred in database
    try {
      await db.update(schema.userNfts)
        .set({
          status: 'transferred',
          transferTxDigest: result.digest,
          recipientAddress,
          transferredAt: new Date(),
        })
        .where(and(
          eq(schema.userNfts.userAddress, userAddress),
          eq(schema.userNfts.nftObjectId, nftObjectId)
        ));
      console.log(`💾 [Transfer NFT] Marked as transferred in database`);
    } catch (dbError) {
      console.error(`⚠️  [Transfer NFT] Failed to update database:`, dbError);
      // Don't fail the request if DB update fails
    }

    res.json({
      success: true,
      transactionHash: result.digest,
      nftObjectId,
      recipientAddress,
      templateName: 'direct-transfer',
      mode: 'fast-path-real',
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Multi-User Wallet Endpoints


/**
 * GET /api/user/info
 * Get or create user account with unique deposit address
 *
 * Query: { userAddress: string (ASI:One sender address) }
 */
app.get('/api/user/info', async (req, res) => {
  try {
    const { userAddress } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'userAddress query parameter is required',
      });
    }

    console.log(`👤 [User] Get or create: ${userAddress}`);

    const user = await getOrCreateUser(userAddress);

    res.json({
      success: true,
      user,
    });
  } catch (error: any) {
    console.error('❌ [User] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/user/balance
 * Get user's virtual balances
 *
 * Query: { userAddress: string }
 */
app.get('/api/user/balance', async (req, res) => {
  try {
    const { userAddress } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'userAddress query parameter is required',
      });
    }

    console.log(`💰 [User] Get balance: ${userAddress}`);

    const balances = await getUserBalances(userAddress);

    res.json({
      success: true,
      userAddress,
      balances,
    });
  } catch (error: any) {
    console.error('❌ [User] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/user/deposit/check
 * Check for new deposits to user's deposit address
 *
 * Body: { userAddress: string }
 */
app.post('/api/user/deposit/check', async (req, res) => {
  try {
    const { userAddress } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'userAddress is required',
      });
    }

    console.log(`🔍 [Deposit] Checking deposits for: ${userAddress}`);

    const result = await checkAndProcessDeposits(userAddress);

    res.json({
      success: true,
      userAddress,
      newDeposits: result.newDeposits,
      totalAmount: result.totalAmount,
    });
  } catch (error: any) {
    console.error('❌ [Deposit] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/user/deposit/sweep
 * Sweep funds from user's deposit address to agent's main wallet
 *
 * Body: { userAddress: string }
 */
app.post('/api/user/deposit/sweep', async (req, res) => {
  try {
    const { userAddress } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'userAddress is required',
      });
    }

    console.log(`🧹 [Sweep] Sweeping deposits for: ${userAddress}`);

    const result = await sweepUserDeposits(userAddress);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      userAddress,
      amount: result.amount,
      digest: result.digest,
      message: `Swept ${result.amount} SUI to main wallet`,
    });
  } catch (error: any) {
    console.error('❌ [Sweep] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/user/withdraw
 * Process withdrawal from user's virtual balance
 *
 * Body: {
 *   userAddress: string,
 *   tokenType: string,
 *   amount: number,
 *   recipientAddress: string
 * }
 */
app.post('/api/user/withdraw', async (req, res) => {
  try {
    const { userAddress, tokenType, amount, recipientAddress } = req.body;

    if (!userAddress || !tokenType || !amount || !recipientAddress) {
      return res.status(400).json({
        success: false,
        error: 'userAddress, tokenType, amount, and recipientAddress are required',
      });
    }

    console.log(`💸 [Withdraw] ${userAddress}: ${amount} ${tokenType} → ${recipientAddress}`);

    const result = await processWithdrawal(userAddress, tokenType, amount, recipientAddress);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      userAddress,
      tokenType,
      amount,
      recipientAddress,
      digest: result.digest,
      message: `Withdrew ${amount} ${tokenType}`,
    });
  } catch (error: any) {
    console.error('❌ [Withdraw] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/user/transactions
 * Get user's transaction history
 *
 * Query: {
 *   userAddress: string,
 *   limit?: number (default: 50)
 * }
 */
app.get('/api/user/transactions', async (req, res) => {
  try {
    const { userAddress, limit } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'userAddress query parameter is required',
      });
    }

    const limitNum = limit ? parseInt(limit as string, 10) : 50;

    console.log(`📜 [Transactions] Get history: ${userAddress} (limit: ${limitNum})`);

    const transactions = await getUserTransactions(userAddress, limitNum);

    res.json({
      success: true,
      userAddress,
      count: transactions.length,
      transactions,
    });
  } catch (error: any) {
    console.error('❌ [Transactions] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/user/nfts
 * Get user's NFTs
 *
 * Query: {
 *   userAddress: string,
 *   status?: 'owned' | 'transferred' | 'burned'
 * }
 */
app.get('/api/user/nfts', async (req, res) => {
  try {
    const { userAddress, status } = req.query;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'userAddress query parameter is required',
      });
    }

    console.log(`🖼️  [NFTs] Get NFTs for: ${userAddress} (status: ${status || 'all'})`);

    const conditions = [eq(schema.userNfts.userAddress, userAddress)];
    if (status) {
      conditions.push(eq(schema.userNfts.status, status as string));
    }

    const nfts = await db.query.userNfts.findMany({
      where: and(...conditions),
      orderBy: (table, { desc }) => [desc(table.mintedAt)],
    });

    res.json({
      success: true,
      userAddress,
      count: nfts.length,
      nfts,
    });
  } catch (error: any) {
    console.error('❌ [NFTs] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('✅ Backend running');
  console.log(`📍 http://localhost:${PORT}`);
  console.log('');
  console.log('🔧 PTB & Execution:');
  console.log(`   POST /api/create-ptb           ← Universal (semantic search)`);
  console.log(`   POST /api/execute-transaction  ← Execute with agent wallet`);
  console.log(`   GET  /api/agent-wallet         ← Agent wallet info`);
  console.log(`   GET  /api/templates            ← List all PTB templates`);
  console.log('');
  console.log('⚡ Fast-Path Operations:');
  console.log(`   POST /api/swap                 ← Token swap (Cetus)`);
  console.log(`   POST /api/stake                ← Stake SUI`);
  console.log(`   POST /api/transfer             ← Transfer SUI`);
  console.log(`   POST /api/mint-nft             ← Mint NFT`);
  console.log(`   POST /api/transfer-nft         ← Transfer NFT`);
  console.log('');
  console.log('👥 Multi-User Wallet:');
  console.log(`   GET  /api/user/info            ← Get/create user + deposit address`);
  console.log(`   GET  /api/user/balance         ← Get user balances`);
  console.log(`   POST /api/user/deposit/check   ← Check for deposits`);
  console.log(`   POST /api/user/deposit/sweep   ← Sweep to main wallet`);
  console.log(`   POST /api/user/withdraw        ← Withdraw from balance`);
  console.log(`   GET  /api/user/transactions    ← Transaction history`);
  console.log('');
  console.log('🏥 System:');
  console.log(`   GET  /health`);
  console.log('');
});

process.on('SIGTERM', async () => {
  await sql.end();
  process.exit(0);
});
