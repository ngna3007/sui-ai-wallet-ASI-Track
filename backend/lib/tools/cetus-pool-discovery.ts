import { tool } from 'ai';
import { z } from 'zod';
import { cache, CacheKeys } from '@/lib/cache/redis-cache';
import { registerToolConfig } from '@/lib/ai/tool-metadata';

// Register tool configuration for both aliases
const cetusPoolConfig = {
  display: { title: "Cetus Pool Discovery", icon: "search" },
  status: {
    running: "Discovering Cetus pools...",
    success: "Pools discovered",
    error: "Failed to discover pools"
  }
};

const cetusPoolExecutionConfig = {
  requiresAddress: false,

  canSkip: ({ toolResults, parameterManager, toolName }: any) => {
    // Skip if user selection already complete
    if (toolResults[toolName]?.userSelectionComplete) {
      return true;
    }

    // Skip if pool already selected
    const finalParams = parameterManager?.getFinalParameters() || {};
    if (finalParams.poolId && finalParams.userSelectionComplete) {
      return true;
    }

    return false;
  },

  prepareParams: ({ parameterManager }: any) => {
    if (!parameterManager) return {};

    const finalParams = parameterManager.getFinalParameters();
    const toolParams: any = {};

    // Smart mode: use tokenFromAddress + tokenToSymbol
    if (finalParams.tokenFromAddress) {
      toolParams.tokenFromAddress = finalParams.tokenFromAddress;
      toolParams.tokenToSymbol = finalParams.tokenTo || finalParams.tokenToSymbol;
      if (finalParams.selectedPoolId || finalParams.poolId) {
        toolParams.selectedPoolId = finalParams.selectedPoolId || finalParams.poolId;
      }
    }
    // Legacy mode fallback
    else {
      toolParams.tokenA = finalParams.tokenA || finalParams.tokenFrom;
      toolParams.tokenB = finalParams.tokenB || finalParams.tokenTo;
      if (finalParams.selectedPoolId || finalParams.poolId) {
        toolParams.selectedPoolId = finalParams.selectedPoolId || finalParams.poolId;
      }
    }

    return toolParams;
  }
};

registerToolConfig('cetus-pool-discovery', cetusPoolConfig, cetusPoolExecutionConfig);
registerToolConfig('cetusPoolDiscoveryTool', cetusPoolConfig, cetusPoolExecutionConfig);

// Well-known token registry to reduce API calls (TESTNET ADDRESSES)
const WELL_KNOWN_TOKENS = new Map<string, string>([
  ['SUI', '0x2::sui::SUI'],
  [
    'USDC',
    '0x0588cff9a50e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC',
  ],
  [
    'WAL',
    '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL',
  ],
  [
    'CETUS',
    '0xa6f859bee36f3882711be22cf468f0974eb318ec3b8fe9bcc5ed69311360a044::cetus::CETUS',
  ],
  [
    'USDT',
    '0x50b3637dde9471e36dcb8b7d147a9e8de50a777181e7f1b11598e28d7bebf8c4::usdt::USDT',
  ],
]);

// Removed complex retry and circuit breaker logic - using direct queries only

const poolDiscoverySchema = z.object({
  tokenFromAddress: z
    .string()
    .optional()
    .describe('Selected tokenFrom address (from wallet)'),
  tokenToSymbol: z
    .string()
    .optional()
    .describe('Target tokenTo symbol (e.g. SUI)'),
  selectedPoolId: z.string().optional().describe('User-selected pool ID'),
  // Legacy parameters for backward compatibility
  tokenA: z
    .string()
    .optional()
    .describe('Legacy: First token symbol or address'),
  tokenB: z
    .string()
    .optional()
    .describe('Legacy: Second token symbol or address'),
});

export const cetusPoolDiscoveryTool = tool({
  description:
    'Smart discovery: finds tokenTo variants AND best pools in one step',
  inputSchema: poolDiscoverySchema,
  execute: async ({
    tokenFromAddress,
    tokenToSymbol,
    selectedPoolId,
    tokenA,
    tokenB,
  }) => {
    try {
      // Smart mode: tokenFromAddress + tokenToSymbol
      if (tokenFromAddress && tokenToSymbol) {
        console.log(`🔍 Smart mode: ${tokenFromAddress} → ${tokenToSymbol}`);
        return await smartDiscovery(
          tokenFromAddress,
          tokenToSymbol,
          selectedPoolId,
        );
      }

      // Legacy mode
      if (!tokenA || !tokenB) {
        return { success: false, error: 'Missing required parameters' };
      }

      console.log(`🔍 Legacy mode: ${tokenA}-${tokenB} pools on Cetus...`);
      console.log(`🔧 Pool discovery called with:`, {
        tokenA,
        tokenB,
        selectedPoolId,
      });

      // Import the existing pool discovery functionality
      const { initCetusSDK } = require('@cetusprotocol/cetus-sui-clmm-sdk');
      const sdk = initCetusSDK({ network: 'testnet' });

      // Step 1: Resolve token symbols to addresses
      const tokenAAddress = await resolveTokenAddress(tokenA);
      const tokenBAddress = await resolveTokenAddress(tokenB);

      if (!tokenAAddress || !tokenBAddress) {
        return {
          success: false,
          error: `Cannot resolve token addresses for ${tokenA} or ${tokenB}`,
          suggestions: ['Check token symbols', 'Try full contract addresses'],
        };
      }

      console.log(`Resolved addresses:`);
      console.log(`  ${tokenA}: ${tokenAAddress}`);
      console.log(`  ${tokenB}: ${tokenBAddress}`);

      // Step 2: Check cache for all pools
      const cacheKey = CacheKeys.cetusAllPools();
      let allPools: any[] = (await cache.get<any[]>(cacheKey)) || [];

      if (allPools.length === 0) {
        console.log(`🔍 Fetching all pools from Cetus (cache miss)...`);
        allPools = await sdk.Pool.getPoolsWithPage([]);
        // Cache for 10 minutes
        await cache.set(cacheKey, allPools, 600);
        console.log(`💾 Cached ${allPools.length} pools`);
      } else {
        console.log(`✅ Using cached pools (${allPools.length} pools)`);
      }

      // Step 3: Direct pool discovery using manual filtering
      console.log(`🔍 Searching for ${tokenA}-${tokenB} pools...`);

      // For USDC, find all pools with any USDC variant paired with SUI
      let foundPools: any[];
      if (tokenA.toUpperCase() === 'USDC' || tokenB.toUpperCase() === 'USDC') {
        const suiAddress = '0x2::sui::SUI';
        foundPools = allPools.filter((pool: any) => {
          const hasUsdc =
            pool.coinTypeA.includes('usdc::USDC') ||
            pool.coinTypeB.includes('usdc::USDC');
          const hasSui =
            pool.coinTypeA === suiAddress || pool.coinTypeB === suiAddress;
          return hasUsdc && hasSui;
        });
        console.log(
          `🔍 Found ${foundPools.length} SUI-USDC pools (all USDC variants)`,
        );
      } else {
        // Standard exact match filtering for other tokens
        foundPools = allPools.filter((pool: any) => {
          return (
            (pool.coinTypeA === tokenAAddress &&
              pool.coinTypeB === tokenBAddress) ||
            (pool.coinTypeA === tokenBAddress &&
              pool.coinTypeB === tokenAAddress)
          );
        });
      }

      console.log(`✅ Found ${foundPools.length} pools`);

      if (foundPools.length === 0) {
        return {
          success: false,
          error: `No pools found for ${tokenA}-${tokenB} pair`,
          suggestion:
            'Try different token symbols or check if pools exist on Cetus DEX',
        };
      }

      // Process found pools
      const processedPools = foundPools.map((pool: any) => {
        const isTokenAFirst = pool.coinTypeA === tokenAAddress;

        return {
          poolId: pool.poolAddress,
          poolType: 'v2', // Cetus v2
          tokenA: {
            address: pool.coinTypeA,
            symbol: extractTokenSymbol(pool.coinTypeA),
            isInput: isTokenAFirst,
          },
          tokenB: {
            address: pool.coinTypeB,
            symbol: extractTokenSymbol(pool.coinTypeB),
            isInput: !isTokenAFirst,
          },
          swapDirection: isTokenAFirst, // true = A→B, false = B→A
          fee: pool.fee_rate / 10000, // Convert to decimal (e.g. 30 → 0.003)
          liquidity: pool.liquidity,
          name: pool.name,
          // Generate PTB-ready configuration
          ptbConfig: {
            poolId: pool.poolAddress,
            typeArguments: [pool.coinTypeA, pool.coinTypeB],
            direction: isTokenAFirst,
            globalConfig:
              '0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e',
          },
        };
      });

      // PHASE 2: User Selection Logic (Option A - State-Based)
      // If selectedPoolId is provided, user has made selection - complete the tool
      if (selectedPoolId) {
        console.log(`✅ User selected pool: ${selectedPoolId}`);

        const selectedPool = processedPools.find(
          (pool: any) => pool.poolId === selectedPoolId,
        );
        if (!selectedPool) {
          return {
            success: false,
            error: `Selected pool ${selectedPoolId} not found in available pools`,
            suggestion: 'Please select from the available pool options',
          };
        }

        // Tool is now COMPLETE - return final PTB parameters
        return {
          success: true,
          query: { tokenA, tokenB },
          resolved: {
            tokenA: { symbol: tokenA, address: tokenAAddress },
            tokenB: { symbol: tokenB, address: tokenBAddress },
          },
          selectedPool: selectedPool,

          // Ready for PTB execution - user selection complete
          ptbIntegration: {
            poolId: selectedPool.poolId,
            poolTypeArgs: selectedPool.ptbConfig.typeArguments,
            tokenFromAddress: tokenAAddress,
            tokenToAddress: tokenBAddress,
            direction: selectedPool.ptbConfig.direction,
            typeArguments: selectedPool.ptbConfig.typeArguments,
            inputToken: tokenAAddress,
            outputToken: tokenBAddress,
          },
          userSelectionComplete: true,
          requiresUserSelection: false, // Clear the selection requirement flag
          message: `Pool selected: ${selectedPool.name} (Fee: ${(selectedPool.fee * 100).toFixed(3)}%)`,
        };
      }

      // Filter and sort pools to top k best options (by liquidity and fee quality)
      const sortedPools = processedPools
        .map((pool: any) => ({
          ...pool,
          liquidityNum: Number.parseFloat(pool.liquidity) || 0,
          // Quality score: higher liquidity + lower fees = better
          qualityScore:
            (Number.parseFloat(pool.liquidity) || 0) * (1 / (pool.fee + 0.001)), // Avoid division by zero
        }))
        .sort((a, b) => b.qualityScore - a.qualityScore) // Sort by quality score descending
        .slice(0, 5); // Take top 5 pools only

      console.log(
        `🔔 Filtered to top ${sortedPools.length} best pools from ${processedPools.length} total`,
      );

      // PHASE 1: Multiple pools found, show top filtered options
      if (sortedPools.length > 1) {
        console.log(
          `🔔 Showing top ${sortedPools.length} pools for user selection`,
        );

        // Format pools for user selection widget
        const poolOptions = sortedPools.map((pool: any) => {
          const liquidityNum = Number.parseFloat(pool.liquidity) || 0;
          const liquidityFormatted =
            liquidityNum > 0 ? `${(liquidityNum / 1000000).toFixed(2)}M` : '0';

          // The fee is already a decimal (e.g., 0.001 = 0.1%), so multiply by 100 for percentage
          const feePercent = (pool.fee * 100).toFixed(3);

          return {
            id: pool.poolId,
            name: `${pool.name} (Fee: ${feePercent}%)`,
            description: `Liquidity: ${liquidityFormatted} | Full Pool ID: ${pool.poolId}`,
            value: pool.poolId,
            metadata: {
              fee: pool.fee,
              liquidity: liquidityFormatted,
              name: pool.name,
              poolId: pool.poolId,
              fullPoolId: pool.poolId,
            },
          };
        });

        // Tool is SUCCESSFUL - found pools and awaiting user selection
        return {
          success: true, // Tool successfully found pools
          requiresUserSelection: true,
          selectionWidget: {
            type: 'pool-selector',
            title: `Select Pool for ${tokenA} → ${tokenB} Swap`,
            description: `Top ${sortedPools.length} pools selected by liquidity and fee optimization. Choose the best option.`,
            options: poolOptions,
            instruction: 'Select a pool to continue with the swap transaction.',

            // Instructions for completing the tool
            onSelectAction: {
              toolName: 'cetus-pool-discovery',
              parameters: {
                tokenA: tokenA,
                tokenB: tokenB,
                selectedPoolId: '{{selectedValue}}', // Will be replaced with user choice
              },
            },
          },
          // Provide filtered pool data
          availablePools: sortedPools, // Top k filtered pools
          recommendedPool: sortedPools[0], // First pool is best by quality score
          message: `Found top ${sortedPools.length} best pools optimized by liquidity and fees. DISPLAY THESE POOLS to the user and ask them to select one by providing the pool ID.`,
          instruction:
            'DISPLAY THE FILTERED POOL options to the user in a clear list format. Ask the user to reply with their chosen pool ID to continue with the swap.',
          nextStep: 'user-pool-selection',
        };
      }

      // SINGLE POOL: Auto-select best filtered pool and proceed
      const selectedPool = sortedPools[0];
      const result = {
        success: true,
        query: { tokenA, tokenB },
        resolved: {
          tokenA: { symbol: tokenA, address: tokenAAddress },
          tokenB: { symbol: tokenB, address: tokenBAddress },
        },
        pools: sortedPools, // Use filtered pools
        totalFound: processedPools.length, // But show original total found
        selectedPool: selectedPool,

        // Auto-selected single pool - ready for PTB
        ptbIntegration: {
          poolId: selectedPool.poolId,
          poolTypeArgs: selectedPool.ptbConfig.typeArguments,
          tokenFromAddress: tokenAAddress,
          tokenToAddress: tokenBAddress,
          direction: selectedPool.ptbConfig.direction,
          typeArguments: selectedPool.ptbConfig.typeArguments,
          inputToken: tokenAAddress,
          outputToken: tokenBAddress,
        },

        searchStrategy: 'direct-query',
        message: `Auto-selected pool: ${selectedPool.name} (Fee: ${(selectedPool.fee * 100).toFixed(3)}%)`,
      };

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Pool discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestion:
          'Try with different token symbols or check network connection',
      };
    }
  },
});

// Smart Discovery: Find tokenTo variants + best pools in one query
async function smartDiscovery(
  tokenFromAddress: string,
  tokenToSymbol: string,
  selectedPoolId?: string,
): Promise<any> {
  const { initCetusSDK } = require('@cetusprotocol/cetus-sui-clmm-sdk');
  const sdk = initCetusSDK({ network: 'testnet' });

  // Get all pools (cached)
  const cacheKey = CacheKeys.cetusAllPools();
  let allPools: any[] = (await cache.get<any[]>(cacheKey)) || [];

  if (allPools.length === 0) {
    console.log(`🔍 Fetching pools...`);
    allPools = await sdk.Pool.getPoolsWithPage([]);
    await cache.set(cacheKey, allPools, 600);
    console.log(`💾 Cached ${allPools.length} pools`);
  }

  // Filter pools with tokenFrom
  const relevantPools = allPools.filter(
    (pool: any) =>
      pool.coinTypeA === tokenFromAddress ||
      pool.coinTypeB === tokenFromAddress,
  );

  if (relevantPools.length === 0) {
    return { success: false, error: `No pools found for your token` };
  }

  // Extract tokenTo variants by symbol
  const variantMap = new Map<string, { address: string; pools: any[] }>();

  for (const pool of relevantPools) {
    const pairedToken =
      pool.coinTypeA === tokenFromAddress ? pool.coinTypeB : pool.coinTypeA;
    const symbol = extractTokenSymbol(pairedToken);

    if (symbol === tokenToSymbol.toUpperCase()) {
      if (!variantMap.has(pairedToken)) {
        variantMap.set(pairedToken, { address: pairedToken, pools: [] });
      }
      variantMap.get(pairedToken)?.pools.push(pool);
    }
  }

  const variants = Array.from(variantMap.values());

  if (variants.length === 0) {
    return {
      success: false,
      error: `No ${tokenToSymbol} found that pairs with your token`,
    };
  }

  // Sort pools by quality within each variant
  for (const v of variants) {
    v.pools = v.pools
      .map((p: any) => ({
        ...p,
        quality:
          Number.parseFloat(p.liquidity || '0') *
          (1 / (p.fee_rate / 10000 + 0.001)),
      }))
      .sort((a: any, b: any) => b.quality - a.quality);
  }

  variants.sort((a, b) => b.pools[0].quality - a.pools[0].quality);

  // User selected pool
  if (selectedPoolId) {
    for (const v of variants) {
      const pool = v.pools.find((p: any) => p.poolAddress === selectedPoolId);
      if (pool) {
        return {
          success: true,
          ptbIntegration: {
            poolId: pool.poolAddress,
            tokenFromAddress,
            tokenToAddress: v.address,
            poolTypeArgs: [pool.coinTypeA, pool.coinTypeB],
          },
          userSelectionComplete: true,
        };
      }
    }
    return { success: false, error: 'Pool not found' };
  }

  // Auto-select: 1 variant + 1 pool
  if (variants.length === 1 && variants[0].pools.length === 1) {
    const v = variants[0];
    const p = v.pools[0];
    return {
      success: true,
      ptbIntegration: {
        poolId: p.poolAddress,
        tokenFromAddress,
        tokenToAddress: v.address,
        poolTypeArgs: [p.coinTypeA, p.coinTypeB],
      },
      autoSelected: true,
    };
  }

  // Auto-select: 1 variant + many pools → pick best
  if (variants.length === 1) {
    const v = variants[0];
    const p = v.pools[0];
    return {
      success: true,
      ptbIntegration: {
        poolId: p.poolAddress,
        tokenFromAddress,
        tokenToAddress: v.address,
        poolTypeArgs: [p.coinTypeA, p.coinTypeB],
      },
      autoSelected: true,
    };
  }

  // Multiple variants → show widget
  const formatLiq = (l: string) => {
    const n = Number.parseFloat(l || '0');
    return n > 0 ? `${(n / 1000000).toFixed(2)}M` : '0';
  };

  return {
    success: true,
    requiresUserSelection: true,
    selectionWidget: {
      type: 'token-pool-selector',
      title: `Select ${tokenToSymbol} Variant`,
      description: `Found ${variants.length} variants. Each shows best pool.`,
      options: variants.map((v: any, i: number) => {
        const p = v.pools[0];
        return {
          id: p.poolAddress,
          name: `${tokenToSymbol} ${i + 1}`,
          description: `${v.address.slice(0, 20)}... | Fee: ${(p.fee_rate / 10000).toFixed(3)}% | Liq: ${formatLiq(p.liquidity)} | ${v.pools.length} pool(s)`,
          value: p.poolAddress,
        };
      }),
      onSelectAction: {
        toolName: 'cetus-pool-discovery',
        parameters: {
          tokenFromAddress,
          tokenToSymbol,
          selectedPoolId: '{{selectedValue}}',
        },
      },
    },
  };
}

// Helper functions
async function resolveTokenAddress(
  tokenIdentifier: string,
): Promise<string | null> {
  // If already an address, validate and return
  if (tokenIdentifier.includes('::')) {
    return tokenIdentifier.match(
      /^0x[a-f0-9]+::[a-zA-Z_][a-zA-Z0-9_]*::[A-Z_]+$/,
    )
      ? tokenIdentifier
      : null;
  }

  // Check well-known tokens first (no API call needed)
  const wellKnownAddress = WELL_KNOWN_TOKENS.get(tokenIdentifier.toUpperCase());
  if (wellKnownAddress) {
    console.log(
      `📚 Found ${tokenIdentifier} in well-known tokens: ${wellKnownAddress}`,
    );
    return wellKnownAddress;
  }

  // Dynamic token resolution - scan all pools to find tokens by symbol
  try {
    const { initCetusSDK } = require('@cetusprotocol/cetus-sui-clmm-sdk');
    const sdk = initCetusSDK({ network: 'testnet' });

    console.log(`🔍 Fetching pools for ${tokenIdentifier} token resolution...`);
    const allPools = (await sdk.Pool.getPoolsWithPage([])) as any[];

    // Extract all unique token addresses from pools
    const allTokenAddresses = new Set<string>();
    allPools.forEach((pool: any) => {
      allTokenAddresses.add(pool.coinTypeA);
      allTokenAddresses.add(pool.coinTypeB);
    });

    // Find tokens that match the symbol
    const symbol = tokenIdentifier.toUpperCase();
    const matchingTokens = Array.from(allTokenAddresses).filter((address) => {
      const extractedSymbol = extractTokenSymbol(address);
      return extractedSymbol === symbol;
    });

    if (matchingTokens.length === 1) {
      return matchingTokens[0];
    } else if (matchingTokens.length > 1) {
      console.log(`Multiple tokens found for ${symbol}:`, matchingTokens);
      return matchingTokens[0]; // Return first match
    }

    console.log(`No token found for symbol: ${tokenIdentifier}`);
    return null;
  } catch (error) {
    console.log(
      `Error resolving token ${tokenIdentifier}:`,
      error instanceof Error ? error.message : 'Unknown error',
    );
    return null;
  }
}

function extractTokenSymbol(address: string): string {
  const parts = address.split('::');
  if (parts.length >= 3) {
    const tokenName = parts[2];

    // Dynamic symbol extraction without hardcoded mappings
    const symbol = tokenName
      .replace(/_TOKEN$/, '') // Remove _TOKEN suffix
      .replace(/^[a-z]/g, (c) => c.toUpperCase()) // Capitalize first letter
      .toUpperCase(); // Make everything uppercase

    return symbol;
  }
  return `${address.slice(0, 8)}...`;
}
