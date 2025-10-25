import { getSuiDataFetcher } from '@/lib/servers/sui-data';
import { tool } from 'ai';
import { z } from 'zod';
import { registerToolConfig } from '@/lib/ai/tool-metadata';

// Register tool configuration
registerToolConfig('getSuiWalletKiosks', {
  display: { title: "Wallet Kiosks", icon: "store" },
  status: {
    running: "Fetching your kiosks...",
    success: "Kiosks loaded",
    error: "Failed to fetch kiosks"
  }
}, {
  requiresAddress: true,
  defaultParams: () => ({ limit: 10 })
});

export const getSuiWalletKiosks = tool({
  description:
    'Fetch kiosks and owner caps owned by the user for selection in PTB transactions',
  inputSchema: z.object({
    userAddress: z.string().describe('User wallet address'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of kiosks to fetch'),
  }),
  execute: async ({ userAddress, limit = 10 }) => {
    try {
      console.log(`🏪 Fetching kiosks for user: ${userAddress}`);

      const suiDataFetcher = getSuiDataFetcher();
      const kiosks = await suiDataFetcher.fetchUserKiosks(userAddress);

      const limitedKiosks = kiosks.slice(0, limit);

      console.log(
        `✅ Found ${limitedKiosks.length} kiosks (limited to ${limit})`,
      );

      // Process kiosks data
      const processedKiosks = limitedKiosks.map((kiosk) => ({
        objectId: kiosk.id,
        ownerCapId: kiosk.ownerCapId,
        itemCount: kiosk.itemCount || 0,
        profits: '0', // KioskObject doesn't have profits property
        type: kiosk.type,
        name: kiosk.name,
        displayName: `Kiosk (${kiosk.id.slice(-6)}) - ${kiosk.itemCount || 0} items`,
      }));

      // Show kiosk selection widget for user to choose from
      console.log(
        `🔔 Found ${processedKiosks.length} kiosks - showing selection widget`,
      );

      // Format kiosks for user selection widget
      const kioskOptions = processedKiosks.map((kiosk) => ({
        id: kiosk.objectId,
        name: kiosk.displayName,
        description: `ID: ${kiosk.objectId} | Owner Cap: ${kiosk.ownerCapId}`,
        value: kiosk.objectId,
        metadata: {
          objectId: kiosk.objectId,
          ownerCapId: kiosk.ownerCapId,
          itemCount: kiosk.itemCount,
          name: kiosk.name,
        },
      }));

      return {
        success: true,
        requiresUserSelection: true,
        widget: {
          type: 'kiosk-selector',
          props: {
            title: 'Select Kiosk for NFT Placement',
            description: `Found ${processedKiosks.length} available kiosks. Choose which kiosk to use.`,
            options: kioskOptions,
          },
        },
        availableKiosks: processedKiosks,
        message: `Selection widgets displayed showing available kiosks. Do not list kiosk information or explain - the widget already displays everything needed. Simply wait for user selection.`,
        kiosks: processedKiosks,
        count: processedKiosks.length,
        totalAvailable: kiosks.length,
      };
    } catch (error) {
      console.error('❌ Error fetching user kiosks:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        kiosks: [],
        count: 0,
        message: 'Failed to fetch kiosks from wallet',
      };
    }
  },
});
