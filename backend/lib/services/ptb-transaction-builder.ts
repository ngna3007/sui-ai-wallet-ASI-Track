/**
 * Real PTB transaction builder that executes actual TypeScript code from templates
 * WITH SECURITY VALIDATION
 */

import { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from '@mysten/sui/client';
import {
  validatePtbTemplate,
  validateTransactionParameters,
} from '@/lib/security/ptb-validator';

export interface TransactionResult {
  transaction: Transaction;
  preview: {
    description: string;
    gasEstimate?: string;
    effects?: string[];
  };
}

/**
 * Build transaction from PTB registry entry using actual TypeScript code execution
 */
export async function buildTransactionFromPTB(
  ptbData: any,
  inputs: Record<string, any>,
  userAddress: string,
  client?: SuiClient,
  supportingData?: Record<string, any>,
): Promise<TransactionResult> {
  const tx = new Transaction();

  try {
    console.log(`🔧 Building PTB transaction: ${ptbData.name}`);
    console.log(`🔧 Inputs:`, inputs);
    console.log(`🔧 PTB TypeScript code:`, ptbData.typescriptCode);

    // SECURITY: Validate PTB template before execution
    const templateValidation = validatePtbTemplate({
      name: ptbData.name,
      typescriptCode: ptbData.typescriptCode,
      inputSchema: ptbData.inputSchema,
    });

    if (!templateValidation.valid) {
      console.error(
        '🚨 PTB template validation failed:',
        templateValidation.errors,
      );
      throw new Error(
        `Security validation failed: ${templateValidation.errors.join(', ')}`,
      );
    }

    if (templateValidation.securityScore < 70) {
      console.warn(
        '⚠️ PTB template has low security score:',
        templateValidation.securityScore,
        'Warnings:',
        templateValidation.warnings,
      );
    }

    // SECURITY: Validate transaction parameters
    const paramsValidation = validateTransactionParameters({
      userAddress,
      inputs,
      templateName: ptbData.name,
    });

    if (!paramsValidation.valid) {
      console.error(
        '🚨 Transaction parameters validation failed:',
        paramsValidation.errors,
      );
      throw new Error(
        `Invalid transaction parameters: ${paramsValidation.errors.join(', ')}`,
      );
    }

    if (paramsValidation.warnings.length > 0) {
      console.warn(
        '⚠️ Transaction parameter warnings:',
        paramsValidation.warnings,
      );
    }

    // Check if we have any inputs - if not, return empty transaction for parameter collection
    const inputKeys = Object.keys(inputs || {});
    if (inputKeys.length === 0) {
      console.log(
        `🔧 No inputs provided - returning empty transaction for parameter collection`,
      );

      const preview = generateTransactionPreview(ptbData, inputs);
      return {
        transaction: tx, // Empty transaction
        preview: {
          ...preview,
          description: `Ready to ${ptbData.name} - please provide parameters`,
          effects: ['Waiting for parameter input'],
        },
      };
    }

    // Execute the PTB's TypeScript code dynamically with supporting data
    const executeCode = new Function(
      'tx',
      'inputs',
      'userAddress',
      'supportingData',
      `
      try {
        // Ensure tx.object method is available (should already be available)
        if (typeof tx.object !== 'function') {
          throw new Error('tx.object method is not available in execution context');
        }

        // Make supportingData available even if not provided
        if (typeof supportingData === 'undefined') {
          supportingData = {};
        }

        ${ptbData.typescriptCode}
        return tx; // Return the modified transaction instance
      } catch (error) {
        console.error('Error in PTB template execution:', error);
        throw error;
      }
    `,
    );

    // Execute the PTB code with the extracted parameters and supporting data
    // tx.object should already be available on the Transaction instance
    const resultTx = executeCode(tx, inputs, userAddress, supportingData || {});

    // Ensure we return the transaction instance, not a serialized version
    const finalTx = resultTx || tx;

    console.log('🔧 Final transaction type:', finalTx.constructor.name);
    console.log('🔧 Has toJSON method:', typeof finalTx.toJSON === 'function');

    // Generate preview based on PTB metadata and inputs
    const preview = generateTransactionPreview(ptbData, inputs);

    return {
      transaction: finalTx, // Return the actual Transaction instance
      preview,
    };
  } catch (error) {
    console.error(
      `❌ Failed to build PTB transaction for ${ptbData.name}:`,
      error,
    );
    throw new Error(
      `Failed to build PTB transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Generate transaction preview based on PTB data and inputs
 */
function generateTransactionPreview(
  ptbData: any,
  inputs: Record<string, any>,
): { description: string; effects: string[] } {
  const { name, description } = ptbData;

  // Generate description based on PTB name and inputs
  let txDescription = description || `Execute ${name}`;

  // Customize description based on common patterns
  if (
    name.includes('Transfer') &&
    name.includes('NFT') &&
    inputs.nftId &&
    inputs.recipientAddress
  ) {
    const recipient = inputs.recipientAddress;
    txDescription = `Transfer NFT to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`;
  } else if (name.includes('Transfer') && inputs.amount && inputs.recipient) {
    const amount = inputs.amount;
    const recipient = inputs.recipient || inputs.to;
    txDescription = `Transfer ${amount} SUI to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`;
  } else if (name.includes('Mint') && inputs.name) {
    txDescription = `Mint NFT "${inputs.name}"`;
  } else if (name.includes('Swap') && inputs.amount) {
    txDescription = `Swap ${inputs.amount} ${inputs.inputCoin || 'tokens'}`;
  } else if (name.includes('Stake') && inputs.amount) {
    txDescription = `Stake ${inputs.amount} SUI`;
  }

  // Generate effects based on inputs and PTB type
  const effects = [
    `Execute ${name}`,
    'Transaction will be processed on Sui blockchain',
    'Gas fees will be deducted from your balance',
  ];

  // Add specific effects based on operation type
  if (inputs.nftId) {
    effects.unshift(
      `NFT ID: ${inputs.nftId.slice(0, 12)}...${inputs.nftId.slice(-8)}`,
    );
  }
  if (inputs.recipientAddress) {
    const recipient = inputs.recipientAddress;
    effects.unshift(
      `Recipient: ${recipient.slice(0, 12)}...${recipient.slice(-8)}`,
    );
  }
  if (inputs.amount) {
    effects.unshift(`Amount: ${inputs.amount} SUI`);
  }
  if (inputs.recipient || inputs.to) {
    const recipient = inputs.recipient || inputs.to;
    effects.unshift(
      `Recipient: ${recipient.slice(0, 12)}...${recipient.slice(-8)}`,
    );
  }
  if (inputs.name) {
    effects.unshift(`NFT Name: ${inputs.name}`);
  }
  if (inputs.description) {
    effects.unshift(`Description: ${inputs.description}`);
  }
  if (inputs.imageUrl) {
    effects.unshift(`Image: ${inputs.imageUrl.slice(0, 30)}...`);
  }

  return {
    description: txDescription,
    effects,
  };
}

/**
 * Estimate gas for transaction
 */
export async function estimateGas(
  client: SuiClient,
  transaction: Transaction,
): Promise<string> {
  try {
    const txBytes = await transaction.build({ client });
    const result = await client.dryRunTransactionBlock({
      transactionBlock: txBytes,
    });

    // Calculate total gas cost
    const gasUsed =
      Number(result.effects.gasUsed.computationCost) +
      Number(result.effects.gasUsed.storageCost) -
      Number(result.effects.gasUsed.storageRebate);

    // Convert to SUI (from MIST)
    return (gasUsed / 1000000000).toFixed(6);
  } catch (error) {
    console.error('Error estimating gas:', error);
    return '0.01'; // Default estimate
  }
}
