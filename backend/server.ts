/**
 * Sui AI Assistant Backend API
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

const PORT = process.env.PORT || process.env.BACKEND_PORT || 3000;
const SUI_NETWORK = process.env.SUI_NETWORK || 'testnet';
const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.API_KEY; // Secure API key for agent authentication

// Global Sui client for blockchain queries (testnet)
const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

// Connect to existing PostgreSQL database
const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

console.log('🚀 Sui AI Assistant Backend Starting...');
console.log(`📍 Network: ${SUI_NETWORK}`);
console.log(`🗄️  Database: ${DATABASE_URL ? 'Connected' : 'Not configured'}`);
console.log(`🔐 API Key: ${API_KEY ? 'Configured' : '⚠️  NOT SET - API is unsecured!'}`);

/**
 * API Key Authentication Middleware
 * Protects all /api/* endpoints
 */
const apiKeyAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Skip auth for health check
  if (req.path === '/health') {
    return next();
  }

  // Skip auth if no API key is configured (development mode)
  if (!API_KEY) {
    console.warn('⚠️  WARNING: No API key configured - allowing unauthenticated access');
    return next();
  }

  // Check for API key in header
  const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: API key required. Provide via X-API-Key or Authorization header.',
    });
  }

  if (providedKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid API key',
    });
  }

  // Valid API key - proceed
  next();
};

// Apply authentication middleware to all routes
app.use(apiKeyAuth);

/**
 * Health check (public endpoint)
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Sui AI Assistant Backend',
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

    // Extract parameters using LLM
    const inputs = await extractParametersWithLLM(userIntent, template);
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

    // Sign and execute transaction with agent wallet
    console.log('🔏 [PTB] Signing and executing...');
    const result = await signAndExecuteTransaction(builtTx);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Transaction execution failed',
      });
    }

    console.log(`✅ [PTB] Transaction executed: ${result.digest}`);

    // Calculate gas used from effects
    const gasUsed = result.effects?.gasUsed
      ? (Number(result.effects.gasUsed.computationCost) +
         Number(result.effects.gasUsed.storageCost) -
         Number(result.effects.gasUsed.storageRebate)) / 1_000_000_000
      : 0;

    res.json({
      success: true,
      transactionHash: result.digest,
      gasUsed,
      templateName: template.name,
      templateId: template.id,
      inputs,
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`,
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

async function extractParametersWithLLM(
  text: string,
  template: any
): Promise<Record<string, any>> {
  // If no input schema, return empty
  if (!template.inputSchema || !template.inputSchema.properties) {
    return {};
  }

  const properties = template.inputSchema.properties;
  const required = template.inputSchema.required || [];

  // Handle templates with no parameters
  if (Object.keys(properties).length === 0) {
    return {};
  }

  // Build system prompt
  const requiredFields = required
    .map((field: string) => {
      const fieldInfo = properties[field];
      return `- ${field} (${fieldInfo.type}): ${fieldInfo.description || 'No description'}`;
    })
    .join('\n');

  const optionalFields = Object.keys(properties)
    .filter((field) => !required.includes(field))
    .map((field) => {
      const fieldInfo = properties[field];
      return `- ${field} (${fieldInfo.type}): ${fieldInfo.description || 'No description'}`;
    })
    .join('\n');

  const systemPrompt = `You are a parameter extraction assistant. Extract structured parameters from user input.

PTB: ${template.name}
Description: ${template.description}

Required Parameters:
${requiredFields || 'None'}

Optional Parameters:
${optionalFields || 'None'}

User Input: "${text}"

CRITICAL RULES:
1. ONLY extract parameters listed in the schema above
2. If a parameter cannot be determined, omit it
3. Return ONLY a JSON object, no other text
4. For addresses, accept any length (40 or 64 characters)
5. For amounts, use the numeric value only

Examples:
- "transfer 0.1 SUI to 0x742d35cc..." → {"amount": "0.1", "recipient": "0x742d35cc..."}
- "mint NFT called Dragon with description 'Fire dragon' and image https://example.com/dragon.png" → {"name": "Dragon", "description": "Fire dragon", "imageUrl": "https://example.com/dragon.png"}
- "swap 0.5 SUI for USDC" → {"amount": "0.5", "fromToken": "SUI", "toToken": "USDC"}
- "stake 1 SUI" → {"amount": "1"}

Return only the JSON object:`;

  try {
    // Use Anthropic API for parameter extraction
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      console.error('LLM parameter extraction failed:', response.statusText);
      return extractSimpleParametersFallback(text);
    }

    const data = (await response.json()) as any;
    const responseText = data.content[0].text;

    console.log('🧠 LLM parameter extraction response:', responseText);

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const params = JSON.parse(jsonMatch[0]);
      console.log('✅ Extracted parameters:', params);
      return params;
    }

    console.warn('No JSON found in LLM response, using fallback');
    return extractSimpleParametersFallback(text);
  } catch (error) {
    console.error('LLM extraction error:', error);
    return extractSimpleParametersFallback(text);
  }
}

function extractSimpleParametersFallback(text: string): Record<string, any> {
  const inputs: Record<string, any> = {};
  const lower = text.toLowerCase();

  // Amount
  const amountMatch = text.match(/(\d+\.?\d*)/);
  if (amountMatch) {
    inputs.amount = amountMatch[1];
  }

  // Tokens
  const tokens = ['sui', 'usdc', 'usdt'];
  for (const token of tokens) {
    if (lower.includes(token)) {
      if (!inputs.fromToken) inputs.fromToken = token.toUpperCase();
      else if (!inputs.toToken) inputs.toToken = token.toUpperCase();
    }
  }

  // Address (accept 40 or 64 character addresses)
  const addressMatch = text.match(/0x[a-fA-F0-9]{40,64}/);
  if (addressMatch) {
    inputs.recipient = addressMatch[0];
  }

  // NFT parameters
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    inputs.imageUrl = urlMatch[0];
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
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`,
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
      amount,
      recipient,
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`,
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
      executedBy: agentInfo.address, // Agent wallet executes on behalf of user
      requestedBy: userAddress, // Original user address
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
      explorerUrl: `https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/balance
 * Get blockchain balance for any address (reads directly from Sui blockchain)
 *
 * Query: { address: string }
 */
app.get('/api/balance', async (req, res) => {
  try {
    const { address } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'address query parameter is required',
      });
    }

    console.log(`💰 [Balance] Reading from blockchain: ${address}`);

    // Get ALL coins owned by this address
    const allCoins = await suiClient.getAllCoins({ owner: address });

    const balances: Record<string, number> = {};
    const coinDetails: Record<string, any> = {};

    // Common token name mappings
    const tokenNameMap: Record<string, string> = {
      '0x2::sui::SUI': 'SUI',
      '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': 'USDC',
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': 'USDT',
      // Add more token mappings as needed
    };

    // Common token decimals
    const tokenDecimalsMap: Record<string, number> = {
      'SUI': 9,
      'USDC': 6,
      'USDT': 6,
    };

    // Group coins by type and sum balances
    const coinsByType: Record<string, bigint> = {};

    for (const coin of allCoins.data) {
      const coinType = coin.coinType;
      const balance = BigInt(coin.balance);

      if (coinsByType[coinType]) {
        coinsByType[coinType] += balance;
      } else {
        coinsByType[coinType] = balance;
      }
    }

    // Convert to readable format
    for (const [coinType, totalBalance] of Object.entries(coinsByType)) {
      // Get token name (use mapping or extract from coin type)
      let tokenName = tokenNameMap[coinType];

      if (!tokenName) {
        // Extract token name from coin type (e.g., "0x...::token::TOKEN" -> "TOKEN")
        const parts = coinType.split('::');
        tokenName = parts[parts.length - 1] || coinType.substring(0, 8);
      }

      // Get decimals (default to 9 if unknown)
      const decimals = tokenDecimalsMap[tokenName] || 9;
      const divisor = Math.pow(10, decimals);

      balances[tokenName] = Number(totalBalance) / divisor;

      coinDetails[tokenName] = {
        coinType,
        balance: Number(totalBalance),
        decimals,
        readableBalance: balances[tokenName],
      };
    }

    console.log(`✅ [Balance] Found ${Object.keys(balances).length} token types:`, balances);

    res.json({
      success: true,
      address,
      balances,
      coinDetails,
      totalTokenTypes: Object.keys(balances).length,
    });
  } catch (error: any) {
    console.error('❌ [Balance] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('✅ Backend running');
  console.log(`📍 http://0.0.0.0:${PORT}`);
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
