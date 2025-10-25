import { tool } from 'ai';
import { z } from 'zod';
import { registerToolConfig } from '@/lib/ai/tool-metadata';

// Register tool configuration
registerToolConfig('getSuiWalletCoins', {
  display: { title: "Wallet Coins", icon: "coins" },
  status: {
    running: "Fetching your coins...",
    success: "Coins loaded",
    error: "Failed to fetch coins"
  }
}, {
  requiresAddress: true,
  defaultParams: () => ({ limit: 20 })
});

export const getSuiWalletCoins = tool({
  description:
    'Get all coin objects for a SUI wallet address with detailed information',
  inputSchema: z.object({
    address: z
      .string()
      .describe('The SUI wallet address to get coins for (0x...)'),
    coinType: z
      .string()
      .optional()
      .describe('Optional specific coin type to filter (e.g., 0x2::sui::SUI)'),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe('Number of coin objects to fetch (1-100, default: 50)'),
  }),
  execute: async ({ address, coinType, limit = 50 }) => {
    const quicknodeUrl = process.env.QUICKNODE_URL;

    if (!quicknodeUrl) {
      throw new Error('QUICKNODE_URL is not configured');
    }

    try {
      // Choose the correct RPC method based on whether coinType is provided
      const method = coinType ? 'suix_getCoins' : 'suix_getAllCoins';
      const params: any[] = coinType
        ? [address, coinType, null, limit] // suix_getCoins: [owner, coinType, cursor, limit]
        : [address, null, limit]; // suix_getAllCoins: [owner, cursor, limit]

      // Get coins for the address
      const response = await fetch(quicknodeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: method,
          params: params,
        }),
      });

      if (!response.ok) {
        throw new Error(`QuickNode API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`SUI RPC error: ${data.error.message}`);
      }

      const result = data.result || {};
      const coins = result.data || [];

      // Process and format the coins
      const processedCoins = coins.map((coin: any) => {
        const coinTypeStr = coin.coinType;
        const balance = coin.balance;
        const coinObjectId = coin.coinObjectId;
        const version = coin.version;
        const digest = coin.digest;

        // Format the balance based on coin type
        let formattedBalance: string;
        let symbol = 'Unknown';
        let decimals = 9;

        if (coinTypeStr === '0x2::sui::SUI') {
          symbol = 'SUI';
          decimals = 9;
          const suiAmount = Number.parseInt(balance) / Math.pow(10, decimals);
          formattedBalance = `${suiAmount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })} SUI`;
        } else {
          // Extract token name from coin type
          const parts = coinTypeStr.split('::');
          symbol = parts[parts.length - 1] || 'Unknown';

          // For unknown tokens, show raw amount with reasonable formatting
          const amount = Number.parseInt(balance);
          if (amount > 1000000000) {
            // Assume 9 decimals for large numbers
            formattedBalance = `${(amount / 1000000000).toLocaleString(
              'en-US',
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6,
              },
            )} ${symbol}`;
          } else {
            formattedBalance = `${amount.toLocaleString()} ${symbol}`;
          }
        }

        return {
          coinObjectId,
          version,
          digest,
          coinType: coinTypeStr,
          symbol,
          balance,
          formattedBalance,
          rawAmount: Number.parseInt(balance),
          decimals,
          isSui: coinTypeStr === '0x2::sui::SUI',
          // Additional metadata
          shortObjectId:
            coinObjectId.length > 10
              ? `${coinObjectId.slice(0, 6)}...${coinObjectId.slice(-4)}`
              : coinObjectId,
          shortDigest:
            digest.length > 10
              ? `${digest.slice(0, 6)}...${digest.slice(-4)}`
              : digest,
        };
      });

      // Sort coins: SUI first, then by balance descending
      processedCoins.sort((a: any, b: any) => {
        if (a.isSui && !b.isSui) return -1;
        if (!a.isSui && b.isSui) return 1;
        return b.rawAmount - a.rawAmount;
      });

      // Group by coin type and calculate totals
      const coinTypeSummary = processedCoins.reduce((acc: any, coin: any) => {
        const type = coin.coinType;
        if (!acc[type]) {
          acc[type] = {
            coinType: type,
            symbol: coin.symbol,
            count: 0,
            totalBalance: 0,
            formattedTotal: '',
            isSui: coin.isSui,
          };
        }
        acc[type].count++;
        acc[type].totalBalance += coin.rawAmount;

        // Format total balance
        if (coin.isSui) {
          const suiAmount = acc[type].totalBalance / Math.pow(10, 9);
          acc[type].formattedTotal = `${suiAmount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })} SUI`;
        } else {
          const amount = acc[type].totalBalance;
          if (amount > 1000000000) {
            acc[type].formattedTotal = `${(amount / 1000000000).toLocaleString(
              'en-US',
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6,
              },
            )} ${coin.symbol}`;
          } else {
            acc[type].formattedTotal =
              `${amount.toLocaleString()} ${coin.symbol}`;
          }
        }

        return acc;
      }, {});

      const summary = Object.values(coinTypeSummary);

      return {
        success: true,
        address,
        coins: processedCoins,
        coinTypeSummary: summary,
        totalCoinObjects: processedCoins.length,
        uniqueCoinTypes: Object.keys(coinTypeSummary).length,
        hasMore: result.hasNextPage || false,
        nextCursor: result.nextCursor,
        metadata: {
          queryTime: new Date().toISOString(),
          limit,
          coinTypeFilter: coinType || null,
          totalValueInSui:
            coinTypeSummary['0x2::sui::SUI']?.totalBalance / Math.pow(10, 9) ||
            0,
        },
      };
    } catch (error) {
      console.error('Error fetching SUI coins:', error);
      return {
        success: false,
        error: `Failed to fetch SUI coins: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
