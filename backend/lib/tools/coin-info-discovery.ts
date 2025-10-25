import { tool } from 'ai';
import { z } from 'zod';
import { registerToolConfig } from '@/lib/ai/tool-metadata';

// Register tool configuration for both aliases
const coinInfoConfig = {
  display: { title: "Coin Info Discovery", icon: "coin" },
  status: {
    running: "Discovering coin info...",
    success: "Coin info discovered",
    error: "Failed to discover coin info"
  }
};

const coinInfoExecutionConfig = {
  requiresAddress: true,

  prepareParams: ({ userAddress, templates, extractedParamsMap, parameterManager }: any) => {
    if (!templates || templates.length === 0) return {};

    const template = templates[0];
    const extractedParams = extractedParamsMap?.get(template);
    const finalParams = parameterManager?.getFinalParameters() || {};
    const toolParams: any = {};

    if (extractedParams?.parameters) {
      toolParams.tokenSymbol = extractedParams.parameters.tokenFrom;
      toolParams.userAddress = userAddress;

      // Check if user already selected variant
      if (finalParams.selectedTokenFromVariant || finalParams.tokenFromAddress) {
        toolParams.selectedVariant =
          finalParams.selectedTokenFromVariant ||
          finalParams.tokenFromAddress;
      }
    }

    return toolParams;
  }
};

registerToolConfig('coin-info-discovery', coinInfoConfig, coinInfoExecutionConfig);
registerToolConfig('coinInfoDiscoveryTool', coinInfoConfig, coinInfoExecutionConfig);

const coinInfoSchema = z.object({
  tokenSymbol: z.string().describe('Token symbol (e.g. SUI, USDC)'),
  userAddress: z.string().describe('User wallet address to check balance'),
  selectedVariant: z
    .string()
    .optional()
    .describe('User-selected token address'),
});

export const coinInfoDiscoveryTool = tool({
  description:
    'Find token variants in user wallet with balances. When multiple variants found, display the full "message" field to user showing addresses.',
  inputSchema: coinInfoSchema,
  execute: async ({ tokenSymbol, userAddress, selectedVariant }) => {
    try {
      console.log(`🪙 Discovering info for token: ${tokenSymbol}`);

      // PHASE 2: User already selected variant - fetch coins for that variant
      if (selectedVariant) {
        console.log(`✅ User selected variant: ${selectedVariant}`);

        // Fetch coin objects for the selected variant
        const quicknodeUrl = process.env.QUICKNODE_URL;
        if (!quicknodeUrl) {
          return {
            success: false,
            error: 'QUICKNODE_URL not configured',
          };
        }

        const response = await fetch(quicknodeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'suix_getCoins',
            params: [userAddress, selectedVariant, null, 50],
          }),
        });

        const data = await response.json();
        const coins = data.result?.data || [];

        // Get decimals for the selected variant
        const decimals = await getCoinDecimals(selectedVariant);

        return {
          success: true,
          selectedToken: {
            symbol: tokenSymbol.toUpperCase(),
            address: selectedVariant,
          },
          ptbIntegration: {
            tokenFromAddress: selectedVariant,
            [`${tokenSymbol.toUpperCase()}Address`]: selectedVariant,
            tokenFromDecimals: decimals,
          },
          userCoins: {
            coins: coins.map((c: any) => ({
              coinObjectId: c.coinObjectId,
              version: c.version,
              digest: c.digest,
              balance: c.balance,
            })),
            totalCoinObjects: coins.length,
          },
          userSelectionComplete: true,
          message: `Selected ${tokenSymbol} variant: ${selectedVariant}`,
        };
      }

      // PHASE 1: Find all variants in user's wallet
      console.log(`🔍 Searching wallet for ${tokenSymbol} variants...`);
      const variants = await findUserTokenVariants(tokenSymbol, userAddress);

      // Error: No tokens in wallet
      if (variants.length === 0) {
        console.log(`❌ No ${tokenSymbol} found in wallet`);
        return {
          success: false,
          error: `You don't have any ${tokenSymbol} in your wallet`,
          suggestion:
            'You need to acquire some tokens first or try a different token',
          needsUserAction: 'acquire-tokens',
        };
      }

      // Auto-select: Single variant
      if (variants.length === 1) {
        console.log(
          `✅ Auto-selected single ${tokenSymbol} variant: ${variants[0].address}`,
        );
        return {
          success: true,
          selectedToken: {
            symbol: tokenSymbol.toUpperCase(),
            address: variants[0].address,
            balance: variants[0].balance,
          },
          ptbIntegration: {
            tokenFromAddress: variants[0].address,
            [`${tokenSymbol.toUpperCase()}Address`]: variants[0].address,
            tokenFromDecimals: variants[0].decimals,
          },
          userCoins: {
            coins: variants[0].coins,
            totalCoinObjects: variants[0].coinCount,
          },
          autoSelected: true,
          message: `Auto-selected ${tokenSymbol} (Balance: ${formatBalance(variants[0].balance, variants[0].decimals)})`,
        };
      }

      // Multiple variants - show selection widget
      console.log(
        `🔔 Found ${variants.length} ${tokenSymbol} variants - requiring user selection`,
      );
      return {
        success: true,
        requiresUserSelection: true,
        selectionWidget: {
          type: 'token-variant-selector',
          title: `Select ${tokenSymbol} Variant`,
          description: `You have ${variants.length} different ${tokenSymbol} variants in your wallet. Select one to continue.`,
          options: variants.map((v, idx) => ({
            id: v.address,
            name: `${tokenSymbol} Variant ${idx + 1}`,
            description: `Balance: ${formatBalance(v.balance, v.decimals)} ${tokenSymbol} (${v.coinCount} coin${v.coinCount > 1 ? 's' : ''}) | ${v.address.slice(0, 20)}...`,
            value: v.address,
            metadata: {
              balance: v.balance,
              balanceFormatted: formatBalance(v.balance, v.decimals),
              coinCount: v.coinCount,
              address: v.address,
              decimals: v.decimals,
            },
          })),
          onSelectAction: {
            toolName: 'coin-info-discovery',
            parameters: {
              tokenSymbol: tokenSymbol,
              userAddress: userAddress,
              selectedVariant: '{{selectedValue}}',
            },
          },
        },
        availableVariants: variants,
        variantSummary: variants.map((v, idx) => ({
          variant: idx + 1,
          address: v.address,
          balance: formatBalance(v.balance, v.decimals),
          symbol: tokenSymbol,
          coinCount: v.coinCount,
        })),
        displayMessage: variants
          .map(
            (v, idx) =>
              `**Variant ${idx + 1}**: ${formatBalance(v.balance, v.decimals)} ${tokenSymbol} (${v.coinCount} coins)\n` +
              `Address: \`${v.address}\``,
          )
          .join('\n\n'),
        message: `DISPLAY TO USER: Found ${variants.length} ${tokenSymbol} variants. Show each variant's balance AND full address:\n\n${variants
          .map(
            (v, idx) =>
              `Variant ${idx + 1}:\n` +
              `• Balance: ${formatBalance(v.balance, v.decimals)} ${tokenSymbol}\n` +
              `• Coins: ${v.coinCount}\n` +
              `• Address: ${v.address}\n`,
          )
          .join('\n')}\n\nAsk user to select a variant.`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(
        `❌ Coin discovery failed for ${tokenSymbol}: ${errorMessage}`,
      );

      return {
        success: false,
        error: `Coin discovery failed: ${errorMessage}`,
        suggestion:
          'Try with different token symbol or check your wallet connection',
      };
    }
  },
});

// Helper functions for wallet-first variant discovery

interface TokenVariant {
  address: string;
  balance: string;
  coinCount: number;
  decimals: number;
  coins: Array<{
    coinObjectId: string;
    version: string;
    digest: string;
    balance: string;
  }>;
}

async function findUserTokenVariants(
  symbol: string,
  userAddress: string,
): Promise<TokenVariant[]> {
  try {
    const quicknodeUrl = process.env.QUICKNODE_URL;

    if (!quicknodeUrl) {
      console.warn('[findUserTokenVariants] QUICKNODE_URL not configured');
      return [];
    }

    // Query ALL user's coins
    const response = await fetch(quicknodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_getAllCoins',
        params: [userAddress, null, 100], // Get up to 100 coins
      }),
    });

    if (!response.ok) {
      console.error(`[findUserTokenVariants] RPC error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    if (data.error) {
      console.error('[findUserTokenVariants] RPC returned error:', data.error);
      return [];
    }

    const allCoins = data.result?.data || [];

    // Group by coinType
    const variantMap = new Map<
      string,
      {
        address: string;
        balance: bigint;
        coinCount: number;
        coins: Array<{
          coinObjectId: string;
          version: string;
          digest: string;
          balance: string;
        }>;
      }
    >();

    for (const coin of allCoins) {
      const coinType = coin.coinType;
      const extractedSymbol = extractSymbolFromAddress(coinType);

      if (extractedSymbol === symbol.toUpperCase()) {
        const existing = variantMap.get(coinType);
        if (existing) {
          existing.balance += BigInt(coin.balance);
          existing.coinCount += 1;
          existing.coins.push({
            coinObjectId: coin.coinObjectId,
            version: coin.version,
            digest: coin.digest,
            balance: coin.balance,
          });
        } else {
          variantMap.set(coinType, {
            address: coinType,
            balance: BigInt(coin.balance),
            coinCount: 1,
            coins: [
              {
                coinObjectId: coin.coinObjectId,
                version: coin.version,
                digest: coin.digest,
                balance: coin.balance,
              },
            ],
          });
        }
      }
    }

    // Return variants with balance > 0, sorted by balance descending
    const variantsWithoutDecimals = Array.from(variantMap.values())
      .filter((v) => v.balance > 0n)
      .sort((a, b) => Number(b.balance - a.balance))
      .map((v) => ({
        address: v.address,
        balance: v.balance.toString(),
        coinCount: v.coinCount,
        coins: v.coins,
      }));

    // Fetch decimals for each variant
    const variants = await Promise.all(
      variantsWithoutDecimals.map(async (v) => ({
        ...v,
        decimals: await getCoinDecimals(v.address),
      })),
    );

    console.log(
      `[findUserTokenVariants] Found ${variants.length} ${symbol} variants in wallet`,
    );
    return variants;
  } catch (error) {
    console.error('[findUserTokenVariants] Error:', error);
    return [];
  }
}

async function getCoinDecimals(tokenAddress: string): Promise<number> {
  try {
    const quicknodeUrl = process.env.QUICKNODE_URL;
    if (!quicknodeUrl) return 9; // Default fallback

    // Try to get metadata from chain
    const response = await fetch(quicknodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_getCoinMetadata',
        params: [tokenAddress],
      }),
    });

    const data = await response.json();
    if (data.result && typeof data.result.decimals === 'number') {
      return data.result.decimals;
    }

    // Fallback: heuristic based on token type
    const addressLower = tokenAddress.toLowerCase();
    if (addressLower.includes('usdc') || addressLower.includes('usdt')) {
      return 6; // Stablecoins typically use 6
    }

    return 9; // Default Sui standard
  } catch (error) {
    console.warn('[getCoinDecimals] Error:', error);
    return 9; // Default fallback
  }
}

function formatBalance(balance: string, decimals = 9): string {
  try {
    const balanceNum = BigInt(balance);
    const divisor = BigInt(10 ** decimals);
    const whole = balanceNum / divisor;
    const fraction = balanceNum % divisor;

    if (fraction === 0n) {
      return whole.toString();
    }

    const fractionStr = fraction.toString().padStart(decimals, '0');
    const trimmed = fractionStr.replace(/0+$/, '').slice(0, 2); // Show max 2 decimals

    if (trimmed === '') {
      return whole.toString();
    }

    return `${whole}.${trimmed}`;
  } catch (error) {
    return balance;
  }
}

// Utility functions

function extractSymbolFromAddress(address: string): string {
  const parts = address.split('::');
  if (parts.length >= 3) {
    return parts[2].toUpperCase();
  }
  return 'UNKNOWN';
}
