import { getSuiDataFetcher } from '@/lib/servers/sui-data';
import { tool } from 'ai';
import { z } from 'zod';
import { registerToolConfig } from '@/lib/ai/tool-metadata';

// Register tool configuration
registerToolConfig('getSuiWalletNfts', {
  display: { title: "Wallet NFTs", icon: "image" },
  status: {
    running: "Fetching your NFTs...",
    success: "NFTs loaded",
    error: "Failed to fetch NFTs"
  }
}, {
  requiresAddress: true,
  defaultParams: () => ({ limit: 20 })
});

export const getSuiWalletNfts = tool({
  description: 'Fetch NFTs owned by the user for selection in PTB transactions',
  inputSchema: z.object({
    userAddress: z.string().describe('User wallet address'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of NFTs to fetch'),
  }),
  execute: async ({ userAddress, limit = 20 }) => {
    try {
      console.log(`🖼️ Fetching NFTs for user: ${userAddress}`);

      const suiDataFetcher = getSuiDataFetcher();
      const nfts = await suiDataFetcher.fetchUserNFTs(userAddress);

      const limitedNfts = nfts.slice(0, limit);

      console.log(`✅ Found ${limitedNfts.length} NFTs (limited to ${limit})`);

      // Process NFTs data
      const processedNfts = limitedNfts.map((nft) => ({
        objectId: nft.id,
        name: nft.name || nft.display?.name || 'Unnamed NFT',
        description: nft.description || nft.display?.description || '',
        imageUrl: nft.image_url || nft.display?.image_url || '',
        type: nft.type,
        creator: nft.display?.creator || 'Unknown Creator',
        displayName: `"${nft.name || nft.display?.name || 'Unnamed NFT'}" (ID: ${nft.id.slice(0, 6)}...${nft.id.slice(-4)})`,
      }));

      // Show NFT selection widget for user to choose from
      console.log(
        `🔔 Found ${processedNfts.length} NFTs - showing selection widget`,
      );

      // Format NFTs for user selection widget
      const nftOptions = processedNfts.map((nft) => ({
        id: nft.objectId,
        name: nft.displayName,
        description: `Creator: ${nft.creator} | Type: ${nft.type}`,
        value: nft.objectId,
        metadata: {
          objectId: nft.objectId,
          name: nft.name,
          creator: nft.creator,
          imageUrl: nft.imageUrl,
          type: nft.type,
        },
      }));

      return {
        success: true,
        requiresUserSelection: true,
        widget: {
          type: 'nft-selector',
          props: {
            title: 'Select NFT to Place in Kiosk',
            description: `Found ${processedNfts.length} available NFTs. Choose which NFT to place in the kiosk.`,
            options: nftOptions,
          },
        },
        availableNfts: processedNfts,
        message: `Selection widgets displayed showing available NFTs. Do not list NFT information or explain - the widget already displays everything needed. Simply wait for user selection.`,
        nfts: processedNfts,
        count: processedNfts.length,
        totalAvailable: nfts.length,
      };
    } catch (error) {
      console.error('❌ Error fetching user NFTs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        nfts: [],
        count: 0,
        message: 'Failed to fetch NFTs from wallet',
      };
    }
  },
});
