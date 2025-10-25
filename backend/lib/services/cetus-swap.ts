/**
 * Cetus Swap Service
 * Extracted from main app's cetus-pool-discovery.ts
 */

import { SuiClient } from '@mysten/sui/client';

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const RPC_URL = NETWORK === 'mainnet'
  ? 'https://fullnode.mainnet.sui.io:443'
  : 'https://fullnode.testnet.sui.io:443';

const suiClient = new SuiClient({ url: RPC_URL });

// Well-known token registry (TESTNET)
const WELL_KNOWN_TOKENS = new Map<string, string>([
  ['SUI', '0x2::sui::SUI'],
  ['USDC', '0x0588cff9a50e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC'],
  ['WAL', '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL'],
  ['CETUS', '0xa6f859bee36f3882711be22cf468f0974eb318ec3b8fe9bcc5ed69311360a044::cetus::CETUS'],
  ['USDT', '0x50b3637dde9471e36dcb8b7d147a9e8de50a777181e7f1b11598e28d7bebf8c4::usdt::USDT'],
]);

let poolsCache: any[] = [];
let poolsCacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface PoolInfo {
  poolId: string;
  tokenA: string;
  tokenB: string;
  fee: number;
  liquidity: string;
  swapDirection: boolean;
  typeArguments: [string, string];
}

/**
 * Find best pool for token swap
 */
export async function findBestPool(
  fromToken: string,
  toToken: string
): Promise<PoolInfo | null> {
  try {
    const CetusSDK = await import('@cetusprotocol/cetus-sui-clmm-sdk');
    const sdk = CetusSDK.initCetusSDK({ network: NETWORK });

    // Resolve token symbols to addresses
    const fromAddress = await resolveTokenAddress(fromToken);
    const toAddress = await resolveTokenAddress(toToken);

    if (!fromAddress || !toAddress) {
      console.error(`Cannot resolve addresses: ${fromToken} or ${toToken}`);
      return null;
    }

    console.log(`🔍 Finding pool for ${fromToken}(${fromAddress}) → ${toToken}(${toAddress})`);

    // Get all pools (with caching)
    let allPools: any[];
    const now = Date.now();
    if (poolsCache.length > 0 && (now - poolsCacheTimestamp) < CACHE_TTL) {
      allPools = poolsCache;
      console.log(`✅ Using cached pools (${allPools.length})`);
    } else {
      console.log(`🔍 Fetching pools from Cetus...`);
      allPools = await sdk.Pool.getPoolsWithPage([]);
      poolsCache = allPools;
      poolsCacheTimestamp = now;
      console.log(`💾 Cached ${allPools.length} pools`);
    }

    // Find matching pools
    const matchingPools = allPools.filter((pool: any) => {
      return (
        (pool.coinTypeA === fromAddress && pool.coinTypeB === toAddress) ||
        (pool.coinTypeA === toAddress && pool.coinTypeB === fromAddress)
      );
    });

    if (matchingPools.length === 0) {
      console.error(`No pools found for ${fromToken}-${toToken} pair`);
      return null;
    }

    console.log(`✅ Found ${matchingPools.length} matching pools`);

    // Sort by quality (liquidity / fee)
    const sortedPools = matchingPools
      .map((pool: any) => ({
        ...pool,
        quality: (Number.parseFloat(pool.liquidity || '0')) * (1 / (pool.fee_rate / 10000 + 0.001)),
      }))
      .sort((a: any, b: any) => b.quality - a.quality);

    // Get best pool
    const bestPool = sortedPools[0];
    const isSwapA2B = bestPool.coinTypeA === fromAddress;

    const poolInfo: PoolInfo = {
      poolId: bestPool.poolAddress,
      tokenA: bestPool.coinTypeA,
      tokenB: bestPool.coinTypeB,
      fee: bestPool.fee_rate / 10000,
      liquidity: bestPool.liquidity,
      swapDirection: isSwapA2B,
      typeArguments: [bestPool.coinTypeA, bestPool.coinTypeB],
    };

    console.log(`✅ Best pool: ${bestPool.name} (Fee: ${(poolInfo.fee * 100).toFixed(3)}%)`);

    return poolInfo;
  } catch (error) {
    console.error('Error finding pool:', error);
    return null;
  }
}

/**
 * Resolve token symbol to address
 */
async function resolveTokenAddress(token: string): Promise<string | null> {
  // Already an address
  if (token.includes('::')) {
    return token.match(/^0x[a-f0-9]+::[a-zA-Z_][a-zA-Z0-9_]*::[A-Z_]+$/) ? token : null;
  }

  // Check well-known tokens
  const wellKnown = WELL_KNOWN_TOKENS.get(token.toUpperCase());
  if (wellKnown) {
    return wellKnown;
  }

  console.warn(`Unknown token: ${token}`);
  return null;
}

/**
 * Get user's coins for a specific token type
 */
export async function getUserCoins(
  userAddress: string,
  tokenAddress: string
): Promise<Array<{ coinObjectId: string; balance: string }>> {
  try {
    const response = await suiClient.getCoins({
      owner: userAddress,
      coinType: tokenAddress,
    });

    return response.data.map(coin => ({
      coinObjectId: coin.coinObjectId,
      balance: coin.balance,
    }));
  } catch (error) {
    console.error('Error getting user coins:', error);
    return [];
  }
}

/**
 * Get coin metadata (decimals)
 */
export async function getCoinDecimals(tokenAddress: string): Promise<number> {
  try {
    const metadata = await suiClient.getCoinMetadata({ coinType: tokenAddress });
    return metadata?.decimals ?? 9;
  } catch (error) {
    console.warn('Error getting decimals, using default:', error);
    return 9;
  }
}

/**
 * Extract token symbol from address
 */
export function extractTokenSymbol(address: string): string {
  const parts = address.split('::');
  if (parts.length >= 3) {
    return parts[2].toUpperCase();
  }
  return `${address.slice(0, 8)}...`;
}

/**
 * Build a swap transaction manually using Cetus flash swap (same approach as PTB template)
 */
export async function buildSwapTransaction(
  pool: PoolInfo,
  amount: number,
  senderAddress: string,
  slippage: number = 0.05 // 5% default slippage
): Promise<any> {
  try {
    const { Transaction } = await import('@mysten/sui/transactions');
    const tx = new Transaction();

    // Cetus protocol addresses (testnet)
    const CETUS_GLOBAL_CONFIG = '0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e';
    const POOL_MODULE = '0xb2a1d27337788bda89d350703b8326952413bd94b35b9b573ac8401b9803d018::pool';
    const CLOCK_ID = '0x6';

    // Get decimals for proper amount conversion
    const fromTokenAddress = pool.swapDirection ? pool.tokenA : pool.tokenB;
    const fromDecimals = await getCoinDecimals(fromTokenAddress);
    const amountInSmallestUnit = Math.max(Math.floor(amount * Math.pow(10, fromDecimals)), 1);

    console.log(`🔧 Building swap transaction (manual flash swap):`);
    console.log(`   Pool: ${pool.poolId}`);
    console.log(`   Amount: ${amount} (${amountInSmallestUnit} base units, ${fromDecimals} decimals)`);
    console.log(`   Direction: ${pool.swapDirection ? 'A→B' : 'B→A'}`);
    console.log(`   Type Args: [${pool.typeArguments.join(', ')}]`);

    // Fetch user's coins for the from token
    const userCoins = await getUserCoins(senderAddress, fromTokenAddress);

    if (userCoins.length === 0) {
      throw new Error(`No ${fromTokenAddress} coins found in wallet`);
    }

    console.log(`   Found ${userCoins.length} coin(s) for ${fromTokenAddress}`);
    console.log(`   Total available: ${userCoins.reduce((sum, c) => sum + BigInt(c.balance), 0n)} base units`);

    // Step 1: Execute flash swap
    const flashSwapResult = tx.moveCall({
      target: `${POOL_MODULE}::flash_swap`,
      typeArguments: pool.typeArguments,
      arguments: [
        tx.object(CETUS_GLOBAL_CONFIG),
        tx.object(pool.poolId),
        tx.pure.bool(pool.swapDirection), // a2b
        tx.pure.bool(true), // by_amount_in
        tx.pure.u64(amountInSmallestUnit),
        tx.pure.u128(pool.swapDirection ? '4295048016' : '79226673515401279992447579055'), // sqrt_price_limit
        tx.object(CLOCK_ID)
      ],
    });

    const receiveA = flashSwapResult[0];
    const receiveB = flashSwapResult[1];
    const flashReceipt = flashSwapResult[2];

    // Step 2: Get required payment amount
    const payAmount = tx.moveCall({
      target: `${POOL_MODULE}::swap_pay_amount`,
      typeArguments: pool.typeArguments,
      arguments: [flashReceipt],
    });

    // Step 3: Prepare input coin for payment
    let inputCoin;
    const isSUISwap = fromTokenAddress === '0x2::sui::SUI';

    if (isSUISwap) {
      // For SUI, use gas coin
      console.log(`   Using gas coin for SUI swap`);
      inputCoin = tx.splitCoins(tx.gas, [payAmount]);
    } else {
      // For other tokens, merge and split from user coins
      console.log(`   Using token coins for swap`);

      if (userCoins.length === 1) {
        inputCoin = tx.object(userCoins[0].coinObjectId);
      } else {
        const firstCoin = tx.object(userCoins[0].coinObjectId);
        const otherCoins = userCoins.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(firstCoin, otherCoins);
        inputCoin = firstCoin;
      }

      inputCoin = tx.splitCoins(inputCoin, [payAmount]);
    }

    // Step 4: Convert coin to balance
    const isTokenAFirst = pool.swapDirection;
    const poolTokenA = pool.typeArguments[0];
    const poolTokenB = pool.typeArguments[1];

    let paymentBalance, zeroBalance;

    if (isTokenAFirst) {
      paymentBalance = tx.moveCall({
        target: '0x2::coin::into_balance',
        typeArguments: [poolTokenA],
        arguments: [inputCoin[0]]
      });

      zeroBalance = tx.moveCall({
        target: '0x2::balance::zero',
        typeArguments: [poolTokenB],
        arguments: []
      });
    } else {
      paymentBalance = tx.moveCall({
        target: '0x2::coin::into_balance',
        typeArguments: [poolTokenB],
        arguments: [inputCoin[0]]
      });

      zeroBalance = tx.moveCall({
        target: '0x2::balance::zero',
        typeArguments: [poolTokenA],
        arguments: []
      });
    }

    // Step 5: Repay flash swap
    tx.moveCall({
      target: `${POOL_MODULE}::repay_flash_swap`,
      typeArguments: pool.typeArguments,
      arguments: [
        tx.object(CETUS_GLOBAL_CONFIG),
        tx.object(pool.poolId),
        isTokenAFirst ? paymentBalance : zeroBalance,
        isTokenAFirst ? zeroBalance : paymentBalance,
        flashReceipt,
      ],
    });

    // Step 6: Convert output balances to coins and transfer
    const outputA = tx.moveCall({
      target: '0x2::coin::from_balance',
      typeArguments: [poolTokenA],
      arguments: [receiveA]
    });

    const outputB = tx.moveCall({
      target: '0x2::coin::from_balance',
      typeArguments: [poolTokenB],
      arguments: [receiveB]
    });

    tx.transferObjects([outputA, outputB], tx.pure.address(senderAddress));

    console.log(`✅ Swap transaction built successfully`);

    return tx;
  } catch (error) {
    console.error('Error building swap transaction:', error);
    throw error;
  }
}
