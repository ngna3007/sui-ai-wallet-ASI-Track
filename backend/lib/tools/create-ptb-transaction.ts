import { Transaction } from '@mysten/sui/transactions';
import { tool } from 'ai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ptbService } from '../../services/ptb-service';
import { buildTransactionFromPTB } from '../../services/ptb-transaction-builder';
import { extractParametersWithLLM } from '../parameter-parser';
import { getSuiWalletNfts } from './get-sui-wallet-nfts';
import { getSuiWalletKiosks } from './get-sui-wallet-kiosks';
import { getSuiWalletCoins } from './get-sui-wallet-coins';
import { tradeportGetTradingCollections } from './tradeport-get-trading-collections';
import { cetusPoolDiscoveryTool } from './cetus-pool-discovery';
import { coinInfoDiscoveryTool } from './coin-info-discovery';
import { type ToolMetadata, getToolExecutionConfig, registerToolConfig } from '@/lib/ai/tool-metadata';

// Debouncing map to prevent duplicate calls
const pendingCalls = new Map<string, Promise<any>>();

interface CreatePtbTransactionProps {
  dataStream: any;
  selectedChatModel: string;
}

// Available supporting tools mapping
const SUPPORTING_TOOLS: Record<string, any> = {
  getSuiWalletNfts: getSuiWalletNfts,
  getSuiWalletKiosks: getSuiWalletKiosks,
  getSuiWalletCoins: getSuiWalletCoins,
  tradeportGetTradingCollections: tradeportGetTradingCollections,
  cetusPoolDiscoveryTool: cetusPoolDiscoveryTool,
  coinInfoDiscoveryTool: coinInfoDiscoveryTool,
};

export const createPtbTransactionMetadata: ToolMetadata = {
  display: {
    title: 'PTB Transaction Builder',
    icon: 'settings',
    prefersBorder: true,
  },
  status: {
    running: 'Building PTB transaction...',
    success: 'Transaction ready for signing',
    error: 'Failed to build transaction',
  },
  output: {
    templateType: 'transaction',
    widgetComponent: 'PtbTransactionWidget',
  },
  security: {
    requiresSignature: true,
    requiresWalletConnection: true,
    riskLevel: 'medium',
  },
};

registerToolConfig('createPtbTransaction', {
  display: { title: "PTB Transaction Builder", icon: "settings" },
  status: {
    running: "Building PTB transaction...",
    success: "Transaction ready for signing",
    error: "Failed to build transaction"
  }
});

interface DetectedOperation {
  template: any;
  extractedParams: Record<string, any>;
  relevanceScore: number;
}

export const createPtbTransaction = ({
  dataStream,
  selectedChatModel,
}: CreatePtbTransactionProps) => {
  return tool({
    description:
      'Builds PTB transactions from user input. Searches templates from database, extracts parameters using LLM, fetches wallet data via supporting tools, and constructs executable transactions. Handles both single and multi-operation transactions.',
    inputSchema: z.object({
      userInput: z
        .string()
        .optional()
        .describe(
          'User request for PTB operations (e.g., "mint NFT called kostas" or "mint NFT and transfer 1 SUI"). Required unless templateId is provided.',
        ),
      templateId: z
        .string()
        .optional()
        .describe(
          'Optional specific PTB template UUID if known. If not provided, will auto-detect from userInput.',
        ),
      userAddress: z
        .string()
        .describe(
          'User wallet address for supportingTools and context (required for PTB execution)',
        ),
      prefilledParams: z
        .union([
          z.record(z.any()),
          z.string().transform((str) => {
            try {
              return JSON.parse(str);
            } catch {
              return {};
            }
          }),
        ])
        .optional()
        .describe(
          'Optional pre-filled parameter values as object or JSON string',
        ),
      maxOperations: z
        .number()
        .optional()
        .describe(
          'Optional limit on number of operations to combine for multi-operation scenarios (default: no limit)',
        ),
    }),
    execute: async ({
      userInput,
      templateId,
      userAddress,
      prefilledParams,
      maxOperations,
    }: {
      userInput?: string;
      templateId?: string;
      userAddress?: string;
      prefilledParams?: any;
      maxOperations?: number;
    }) => {
      try {
        dataStream.write({
          type: 'data-tool-status',
          data: {
            toolName: 'createPtbTransaction',
            status: 'running',
            message: createPtbTransactionMetadata.status.running
          }
        });

        // Validation: ensure we have either userInput or templateId
        if (!userInput && !templateId) {
          throw new Error('Either userInput or templateId must be provided');
        }

        // Debounce duplicate calls
        const callKey = `${userInput || ''}-${templateId || ''}-${userAddress || ''}`;
        if (pendingCalls.has(callKey)) {
          console.log('[createPtbTransaction] Debouncing duplicate call');
          return await pendingCalls.get(callKey);
        }

        // Create promise for this call
        const callPromise = (async () => {
          const detectedOperations: DetectedOperation[] = [];

          // Parameter management system
          const { PTBParameterManager } = await import(
            '@/lib/ptb/parameter-manager'
          );
          let parameterManager: any = null;

          // 1. userProvidedParams - User provided parameters
          const userProvidedParams = prefilledParams || {};

          // 2. toolResults - Supporting tool execution results
          const toolResults: Record<string, any> = {};

          // 3. finalParameters - Managed by parameterManager

          // Step 1: Template Resolution - Single or Multi-operation
          let templates: any[] = [];

          if (templateId) {
            dataStream.write({
              type: 'data-tool-status',
              data: {
                toolName: 'createPtbTransaction',
                status: 'running',
                message: 'Searching for matching templates...'
              }
            });

            // Single template mode - handle both UUID and name formats
            const uuidRegex =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            if (uuidRegex.test(templateId)) {
              // Valid UUID format - use directly
              const template = await ptbService.getPTBTemplate(templateId);
              if (!template) {
                throw new Error(
                  `PTB template not found with ID: ${templateId}`,
                );
              }
              templates = [template];
            } else if (templateId.startsWith('@')) {
              // Template name format (e.g., @commandoss/mint-nft) - search by name
              const searchResults = await ptbService.searchPTBsKeyword(
                templateId.replace('@', ''),
              );
              if (searchResults.length === 0) {
                throw new Error(
                  `PTB template not found with name: "${templateId}"`,
                );
              }
              templates = [searchResults[0]]; // Take the first match
            } else {
              throw new Error(
                `Invalid template ID. Must be a valid UUID or @name format.`,
              );
            }
          } else {
            // Multi-operation mode - use LLM to detect operations
            if (!userInput) {
              throw new Error(
                'userInput is required when templateId is not provided',
              );
            }
            const searchQueries = await extractOperationIntents(
              userInput,
              selectedChatModel,
            );

            // Template selection: semantic search, then parameter extraction for top matches
            console.log(
              '[createPtbTransaction] Template selection',
              `Processing ${searchQueries.length} operations`,
            );

            // Cache to avoid duplicate searches
            const searchCache = new Map<string, any[]>();

            // Process all operations in parallel
            const templateSelectionPromises = searchQueries.map(
              async (searchQuery, index) => {
                console.log(
                  '[createPtbTransaction] Searching templates',
                  `"${searchQuery}" (${index + 1}/${searchQueries.length})`,
                );

                try {
                  // 1. Check cache first to avoid redundant searches
                  let foundTemplates = searchCache.get(searchQuery);
                  if (!foundTemplates) {
                    foundTemplates = await ptbService.searchPTBTemplates(
                      searchQuery,
                      5,
                    ); // Reduced from 10 to 5
                    searchCache.set(searchQuery, foundTemplates);
                    console.log(
                      'Template search cached',
                      `${searchQuery} → ${foundTemplates.length} results`,
                    );
                  } else {
                    console.log(
                      'Using cached results',
                      `${searchQuery} → ${foundTemplates.length} results`,
                    );
                  }

                  if (foundTemplates.length === 0) {
                    console.warn(
                      'No templates found',
                      `for query: ${searchQuery}`,
                    );
                    return null;
                  }

                  // 2. Select top template with confidence threshold
                  const topTemplate = foundTemplates[0]; // Highest similarity score
                  const similarity = topTemplate.similarityScore || 0;

                  // Apply confidence threshold - reject low-confidence matches
                  if (similarity < 0.6) {
                    console.warn(
                      'Low confidence template',
                      `${topTemplate.name} (similarity: ${similarity.toFixed(3)}) below threshold 0.6`,
                    );
                    return null;
                  }

                  console.log(
                    'Top template selected',
                    `${topTemplate.name} (similarity: ${similarity.toFixed(3)})`,
                  );

                  // 3. Extract parameters ONLY for the winner (single LLM call per operation)
                  const paramResult = await extractParametersWithLLM(
                    userInput || '', // Use fallback empty string instead of non-null assertion
                    topTemplate,
                    '',
                    selectedChatModel,
                  );

                  if (!paramResult.success) {
                    console.warn(
                      'Parameter extraction failed',
                      `${topTemplate.name} - Unknown error`,
                    );
                    return null;
                  }

                  // 4. Create operation result
                  const relevanceScore = topTemplate.similarityScore || 0.5;
                  return {
                    template: topTemplate,
                    extractedParams: paramResult.parameters,
                    relevanceScore,
                    operation: searchQuery,
                  };
                } catch (error) {
                  console.error(
                    'Template selection failed',
                    `${searchQuery}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  );
                  return null;
                }
              },
            );

            // Wait for all operations to complete in parallel
            const templateSelectionResults = await Promise.all(
              templateSelectionPromises,
            );

            // Filter successful results and sort by relevance
            const validCandidates = templateSelectionResults
              .filter(
                (result): result is NonNullable<typeof result> =>
                  result !== null,
              )
              .sort((a, b) => b.relevanceScore - a.relevanceScore);

            console.log(
              'Template selection complete',
              `Selected ${validCandidates.length}/${searchQueries.length} operations`,
            );

            // Apply operation limits
            for (const candidate of validCandidates) {
              // Check operation limit
              if (maxOperations && detectedOperations.length >= maxOperations) {
                console.warn(
                  'Operation limit reached',
                  `Maximum ${maxOperations} operations allowed`,
                );
                break;
              }

              // Add operation to final selection
              detectedOperations.push(candidate);
              templates.push(candidate.template);

              console.log(
                'Operation selected',
                `${candidate.template.name} (${candidate.operation})`,
              );
            }

            console.log(
              'Multi-operation detection',
              `Found ${detectedOperations.length} operations`,
            );
          }

          if (templates.length === 0) {
            throw new Error('No supported operations detected from user input');
          }

          // Log final template selection for diagnostics
          console.log(
            '[createPtbTransaction] Final template selection',
            `${templates.length} templates: [${templates.map((template) => template.name).join(', ')}]`,
          );

          // Initialize parameter manager for first template
          if (templates.length > 0) {
            parameterManager = new PTBParameterManager(
              templates[0].id || templates[0].name,
            );

            // Set required parameters from template schema
            if (templates[0].inputSchema) {
              parameterManager.setRequiredParameters(templates[0].inputSchema);
            }

            // Set direct parameters (replaces prefilledParams)
            if (prefilledParams) {
              parameterManager.setDirectParameters(prefilledParams);
            }

            // Extract parameters from user input via LLM
            if (userInput) {
              await parameterManager.collectFromUserInput(
                userInput,
                templates[0],
                selectedChatModel,
              );
            }

            console.log(
              '[createPtbTransaction] Parameter manager initialized for:',
              templates[0].name,
            );
          }

          // Step 2: Determine which supporting tools to execute based on missing parameters
          console.log('[createPtbTransaction] Processing supporting tools for all templates');
          const allSupportingTools = new Set<string>();
          let allParamsProvided = true;
          const allMissingParams = new Set<string>();

          // Store extracted parameters for each template to use later in single template case
          const extractedParamsMap = new Map<any, any>();

          // Pre-check: Test parameter extraction to see if we have all required params
          if (userInput) {
            for (const template of templates) {
              const paramResult = await extractParametersWithLLM(
                userInput,
                template,
                '',
                selectedChatModel,
              );

              // Store extracted parameters for this template
              extractedParamsMap.set(template, paramResult);

              // Merge prefilledParams with extracted parameters for completeness check
              const mergedParams = { ...paramResult.parameters, ...userProvidedParams };

              // Re-check missing fields after merging with prefilledParams
              const requiredFields = template.inputSchema?.required || [];
              const actuallyMissingFields = requiredFields.filter(
                (field: string) => !mergedParams[field]
              );

              if (actuallyMissingFields.length > 0) {
                allParamsProvided = false;
                console.info(
                  `Template ${template.name}`,
                  `Missing params after merge: [${actuallyMissingFields.join(', ')}]`,
                );

                // Add missing parameters to our set
                actuallyMissingFields.forEach((param : any) =>
                  allMissingParams.add(param),
                );
              } else {
                console.info(
                  `Template ${template.name}`,
                  'All required parameters provided (userInput + prefilledParams)',
                );
              }
            }
          } else {
            allParamsProvided = false;

            for (const template of templates) {
              const supportingTools = (template as any).supportingTools;
              if (Array.isArray(supportingTools)) {
                supportingTools.forEach((tool) => allSupportingTools.add(tool));
              }
            }
          }

          // EARLY EXIT: If params are missing and supporting tools are needed,
          // guide LLM to execute tools sequentially instead of executing them here
          // Only exit if there are ACTUALLY missing params (not just false flag)
          if (!allParamsProvided && allSupportingTools.size > 0 && allMissingParams.size > 0) {
            // Collect supporting tools that need to be executed
            const toolsNeeded: string[] = [];

            for (const template of templates) {
              const supportingTools = (template as any).supportingTools;
              if (Array.isArray(supportingTools)) {
                supportingTools.forEach((tool) => {
                  if (!toolsNeeded.includes(tool)) {
                    toolsNeeded.push(tool);
                  }
                });
              }
            }

            console.log(
              'Early exit - guiding LLM to execute tools sequentially',
              `Missing params: [${Array.from(allMissingParams).join(', ')}], Tools needed: [${toolsNeeded.join(', ')}]`,
            );

            // Return guidance for LLM to execute supporting tools first
            return {
              success: false,
              error: 'MISSING_SUPPORTING_TOOL_DATA',
              message: `Before creating the PTB transaction, I need to gather some information first. Please execute these tools sequentially: ${toolsNeeded.map(tool => `\`${tool}\``).join(', ')}. After getting the results, you can call createPtbTransaction again with the complete parameters.`,
              missingParams: Array.from(allMissingParams),
              supportingToolsNeeded: toolsNeeded,
              templateName: templates[0].name,
            };
          }

          if (allParamsProvided) {
            console.log(
              'Skipping supporting tools',
              'User provided all required parameters',
            );
          } else {
            // Fallback: collect all supporting tools from templates if no smart mapping possible
            for (const template of templates) {
              const supportingTools = (template as any).supportingTools;
              console.info(
                `Template: ${template.name}`,
                `Raw supportingTools value: ${JSON.stringify(supportingTools)}`,
              );
              if (Array.isArray(supportingTools)) {
                supportingTools.forEach((tool) => allSupportingTools.add(tool));
                console.info(
                  `Template: ${template.name}`,
                  `supportingTools: [${supportingTools.join(', ')}]`,
                );
              } else if (supportingTools) {
                console.warn(
                  `Template: ${template.name}`,
                  `supportingTools is not an array: ${typeof supportingTools}`,
                );
              } else {
                console.info(
                  `Template: ${template.name}`,
                  `No supportingTools defined`,
                );
              }
            }

            console.info(
              'Supporting tools check',
              `Found ${allSupportingTools.size} tools (fallback mode), userAddress: ${userAddress ? 'provided' : 'missing'}`,
            );
          }

          // Check if parameter manager is complete first
          if (parameterManager?.isComplete()) {
            console.log(
              'Parameter manager reports all parameters complete - skipping tool execution',
            );
            allParamsProvided = true;
          }

          if (allSupportingTools.size > 0 && !allParamsProvided) {
            // Filter tools based on address requirement (now from metadata)
            const toolsToExecute = Array.from(allSupportingTools).filter(
              (toolName) => {
                const config = getToolExecutionConfig(toolName);
                if (config?.requiresAddress && !userAddress) {
                  console.warn(
                    `Skipping ${toolName}`,
                    'userAddress required but not provided',
                  );
                  return false;
                }
                return true;
              },
            );

            if (toolsToExecute.length > 0) {
              console.log(
                'Executing supportingTools',
                `Invoking ${toolsToExecute.length} tools: [${toolsToExecute.join(', ')}]`,
              );

              // Execute tools SEQUENTIALLY, pausing immediately when selection is needed
              for (const toolName of toolsToExecute) {
                if (!SUPPORTING_TOOLS[toolName]) {
                  console.warn(`Unknown supporting tool: ${toolName}`);
                  toolResults[toolName] = {
                    success: false,
                    error: 'Unknown supporting tool',
                  };
                  continue;
                }

                try {
                  const config = getToolExecutionConfig(toolName);

                  // Check if tool can be skipped (using tool's own logic)
                  if (
                    config?.canSkip?.({
                      toolResults,
                      parameterManager,
                      toolName,
                    })
                  ) {
                    console.log(
                      `Skipping ${toolName} - canSkip returned true`,
                    );
                    toolResults[toolName] = toolResults[toolName] || { success: true, skipped: true };
                    continue;
                  }

                  // Check general skip conditions
                  if (
                    toolResults[toolName]?.success ||
                    toolResults[toolName]?.userSelectionComplete
                  ) {
                    console.log(
                      `Skipping ${toolName} - already completed`,
                    );
                    continue;
                  }

                  console.log('Executing supporting tool', `Invoking ${toolName}`);

                  // Prepare parameters using tool's config
                  let toolParams: any = {};

                  // Add default params
                  if (config?.defaultParams) {
                    const defaults =
                      typeof config.defaultParams === 'function'
                        ? config.defaultParams(userAddress)
                        : config.defaultParams;
                    toolParams = { ...toolParams, ...defaults };
                  }

                  // Add userAddress if required
                  if (config?.requiresAddress && userAddress) {
                    toolParams.userAddress = userAddress;
                  }

                  // Prepare tool-specific params dynamically
                  if (config?.prepareParams) {
                    const customParams = config.prepareParams({
                      userAddress,
                      parameterManager,
                      templates,
                      extractedParamsMap,
                      finalParams: parameterManager?.getFinalParameters(),
                    });
                    toolParams = { ...toolParams, ...customParams };
                  }

                  // Execute the tool
                  const toolResult =
                    await SUPPORTING_TOOLS[toolName].execute(toolParams);

                  if (toolResult.success) {
                    console.log(
                      'Supporting tool completed',
                      `${toolName} executed successfully`,
                    );
                    toolResults[toolName] = toolResult;

                    // IMMEDIATE PAUSE: If this tool requires user selection, pause now
                    if (
                      toolResult.requiresUserSelection &&
                      toolResult.selectionWidget &&
                      !toolResult.userSelectionComplete
                    ) {
                      console.log(
                        `${toolName} requires user selection - pausing immediately (sequential execution)`,
                      );

                      return {
                        success: true,
                        requiresUserSelection: true,
                        selectionWidget: toolResult.selectionWidget,
                        toolName: toolName,
                        message: `Please make a selection to continue with the transaction.`,
                        pausedAt: 'supporting-tool-selection',

                        // Return only THIS tool result
                        supportingToolResults: [{
                          toolCallId: `${toolName}-${Date.now()}`,
                          toolName: toolName,
                          result: toolResult,
                        }],

                        // Instructions for resuming execution
                        resumeInstructions: {
                          message:
                            'After making your selection, call createPtbTransaction again with the selected parameters to continue.',
                          nextStep: 'ptb-parameter-integration',
                        },
                      };
                    }
                  } else {
                    console.error(`${toolName} failed`, toolResult.error);
                    toolResults[toolName] = {
                      success: false,
                      error: toolResult.error,
                      requiresUserInput: true,
                      toolName: toolName,
                    };
                  }
                } catch (error) {
                  console.error(
                    `${toolName} error`,
                    error instanceof Error
                      ? error.message
                      : 'Unknown error',
                  );
                  toolResults[toolName] = {
                    success: false,
                    error:
                      error instanceof Error
                        ? error.message
                        : 'Unknown error',
                    requiresUserInput: true,
                    toolName: toolName,
                  };
                }
              }

              console.log(
                'Supporting tools execution complete',
                `All tools completed: [${Object.keys(toolResults).join(', ')}]`,
              );
            }
          }

          // Step 3: Use operation-specific parameters and merge supporting tool data
          console.log(
            'Using operation-specific parameters from template selection',
          );
          const finalParams = prefilledParams || {};

          // Auto-merge supporting tool data when available
          if (Object.keys(toolResults).length > 0) {
            console.info('Supporting tool data available for user selection');
            console.info(
              'Available data sources',
              Object.keys(toolResults).join(', '),
            );

            // Auto-extract parameters from supporting tools for seamless UX
            for (const [toolName, toolData] of Object.entries(toolResults)) {
              if (toolData?.ptbIntegration) {
                console.log(
                  `Auto-extracting parameters from ${toolName}:`,
                  Object.keys(toolData.ptbIntegration),
                );
                Object.assign(finalParams, toolData.ptbIntegration);
              }
              // Also extract userCoins if available (for swap operations)
              if (toolData?.userCoins) {
                console.log(`Auto-extracting userCoins from ${toolName}`);
                finalParams.userCoins = toolData.userCoins;
              }
            }
          }

          // Merge operation-specific parameters for UI display ONLY
          // During execution, each operation will use its own extractedParams
          let hasMockValues = false;

          if (detectedOperations.length > 0) {
            // Multi-operation case: use parameters from detectedOperations
            for (const operation of detectedOperations) {
              // Check for mock values but don't filter them out yet
              for (const [key, value] of Object.entries(
                operation.extractedParams,
              )) {
                if (typeof value === 'string') {
                  const isMockValue =
                    value.includes('0x00000000') ||
                    value === 'string' ||
                    value.includes('placeholder') ||
                    value.includes('mock');
                  if (isMockValue) {
                    console.warn(`Found mock value for ${key}`, value);
                    hasMockValues = true;
                  }
                }
              }

              Object.assign(finalParams, operation.extractedParams);
            }
          } else {
            // Single template case: use parameters from extractedParamsMap
            for (const [_template, paramResult] of extractedParamsMap) {
              if (paramResult?.parameters) {
                Object.assign(finalParams, paramResult.parameters);
              }
            }
          }

          console.info(
            'Final merged parameters for UI',
            `${Object.keys(finalParams).length} total: ${Object.keys(finalParams).join(', ')}`,
          );

          // DEBUG: Show final parameter values
          console.info(
            'Parameter values',
            JSON.stringify(finalParams, null, 2),
          );

          // Step 4: Check if we should return widgets first for parameter collection

          // Check if ALL required parameters are present for the primary template
          const primaryTemplate = templates[0];
          const requiredFields = primaryTemplate.inputSchema?.required || [];
          const missingRequiredFields = requiredFields.filter(
            (field: string) => !finalParams[field],
          );
          const hasAllRequiredParams = missingRequiredFields.length === 0;

          console.info(
            'Parameter completeness check',
            `Required: [${requiredFields.join(', ')}], Missing: [${missingRequiredFields.join(', ')}], Complete: ${hasAllRequiredParams}`,
          );

          if (
            (!hasAllRequiredParams || hasMockValues) &&
            allSupportingTools.size > 0
          ) {
            console.info(
              'Parameter collection mode',
              `Missing required parameters: [${missingRequiredFields.join(', ')}] - checking if supporting tools provided data`,
            );

            // Check if supporting tools have completed execution
            const toolsExecuted = Object.keys(toolResults).length > 0;

            // Check if any tool failed with a resource-not-found error
            const toolsFailed = Object.values(toolResults).some(
              (result: any) => result?.success === false
            );

            // If tools were executed and required params are STILL missing,
            // it means the required resources (pools, kiosks, listings, etc.) don't exist
            // This applies whether tools succeeded (but returned no data) or explicitly failed
            if (toolsExecuted && missingRequiredFields.length > 0) {
              console.error(
                'Supporting tools completed but required parameters still missing',
                `Missing: [${missingRequiredFields.join(', ')}], Tools failed: ${toolsFailed}`,
              );

              throw new Error(
                `Cannot create transaction: required parameters ${missingRequiredFields.join(', ')} are not available. This usually means the required resource (liquidity pool, kiosk, listing, etc.) doesn't exist or wasn't found.`
              );
            }

            // Create individual tool results for each supporting tool to display widgets
            const toolResultWidgets = [];
            for (const [toolName, toolData] of Object.entries(toolResults)) {
              if (toolData?.success) {
                toolResultWidgets.push({
                  toolName,
                  toolCallId: `${toolName}-${Date.now()}`,
                  result: toolData,
                });
              }
            }

            // Return template data with supporting tool results for widget display
            // Create combined template for multi-operation or use single template
            let templateData: any;

            if (templates.length > 1) {
              // Multi-operation: Create combined template
              const allParameters = new Map();
              const allTags = new Set();

              // First pass: Create parameter mapping by checking for conflicts across templates
              const parameterMapping = new Map();
              const usedParameterNames = new Set(); // Track used parameter names across all templates

              templates.forEach((template, index) => {
                if (template.inputSchema?.properties) {
                  Object.keys(template.inputSchema.properties).forEach(
                    (originalParam) => {
                      let mappedParam = originalParam;

                      // Check if this parameter name is already used by a previous template
                      if (usedParameterNames.has(originalParam)) {
                        // Parameter conflict - use descriptive naming
                        const operationPrefix = template.name
                          .toLowerCase()
                          .replace(/[^a-z]/g, '');
                        mappedParam = `${originalParam}_${operationPrefix}`;
                      }

                      // Mark this parameter name as used
                      usedParameterNames.add(mappedParam);

                      if (!parameterMapping.has(index)) {
                        parameterMapping.set(index, {});
                      }
                      parameterMapping.get(index)[originalParam] = mappedParam;
                    },
                  );
                }
              });

              // Second pass: Build parameters and TypeScript code with correct mapping
              let combinedTypescriptCode = '';
              templates.forEach((template, index) => {
                // Merge parameters from all templates
                if (template.inputSchema?.properties) {
                  Object.entries(template.inputSchema.properties).forEach(
                    ([key, value]) => {
                      const mapping = parameterMapping.get(index) || {};
                      const mappedKey = mapping[key] || key;

                      if (!allParameters.has(mappedKey)) {
                        allParameters.set(mappedKey, {
                          ...(value as any),
                          operationIndex: index,
                          operationName: template.name,
                          originalParameter: key,
                        });
                      }
                    },
                  );
                }

                // Combine TypeScript code with parameter mapping
                if (template.typescriptCode) {
                  let mappedCode = template.typescriptCode;

                  // Replace parameter references with mapped parameter names
                  const mapping = parameterMapping.get(index) || {};
                  console.log(
                    `Template ${index} (${template.name}) parameter mapping:`,
                    mapping,
                  );
                  console.log(
                    `Original code length: ${mappedCode.length} chars`,
                  );

                  Object.entries(mapping).forEach(
                    ([originalParam, mappedParam]) => {
                      // Replace inputs.originalParam with inputs.mappedParam
                      const regex = new RegExp(
                        `inputs\\.${originalParam}\\b`,
                        'g',
                      );
                      const beforeReplace = mappedCode;
                      mappedCode = mappedCode.replace(
                        regex,
                        `inputs.${mappedParam}`,
                      );
                      if (beforeReplace !== mappedCode) {
                        console.log(
                          `Replaced inputs.${originalParam} with inputs.${mappedParam}`,
                        );
                      }
                    },
                  );

                  console.log(
                    `Final mapped code for ${template.name}:`,
                    mappedCode,
                  );
                  combinedTypescriptCode += `\n// Operation ${index + 1}: ${template.name}\n${mappedCode}\n`;
                }

                // Merge tags
                if (template.tags) {
                  template.tags.forEach((tag: string) => allTags.add(tag));
                }
              });

              // Generate a proper UUID for combined template
              const combinedId = randomUUID();

              console.log(
                `Final combined TypeScript code:\n`,
                combinedTypescriptCode,
              );

              templateData = {
                id: combinedId,
                name: `Combined: ${templates.map((t) => t.name).join(' + ')}`,
                description: `Multi-operation transaction: ${templates.map((t) => t.name).join(' and ')}`,
                tags: Array.from(allTags),
                contractAddress: null, // Multi-operation doesn't have single contract
                functionName: null, // Multi-operation doesn't have single function
                supportingTools: Array.from(allSupportingTools),
                inputSchema: {
                  properties: Object.fromEntries(allParameters),
                  required: templates.flatMap(
                    (t) => t.inputSchema?.required || [],
                  ),
                },
                typescriptCode: combinedTypescriptCode,
                // Include information about multiple operations
                multiOperations: templates.map((t, index) => ({
                  name: t.name,
                  description: t.description,
                  supportingTools: t.supportingTools || [],
                  inputSchema: t.inputSchema,
                  typescriptCode: t.typescriptCode,
                  parameterMapping: parameterMapping.get(index) || {},
                })),
              };
            } else {
              // Single operation: Use template as-is
              const template = templates[0];
              templateData = {
                id: template.id,
                name: template.name,
                description: template.description,
                tags: template.tags || [],
                contractAddress: template.contractAddress || null,
                functionName: template.functionName || null,
                supportingTools: Array.from(allSupportingTools),
                inputSchema: template.inputSchema,
                typescriptCode: template.typescriptCode,
              };
            }

            const parameterCollectionResponse = {
              success: true,
              mode: 'parameter_collection',
              templateName: templateData.name,
              templateData,
              prefilledParams: finalParams, // Pre-fill user-provided parameters
              extractedFromInput: userInput,
              walletData: toolResults,
              supportingToolsInvoked: Array.from(allSupportingTools),
              // Only include supportingToolResults if we actually executed tools and got results
              ...(toolResultWidgets.length > 0 && { supportingToolResults: toolResultWidgets }),
              transaction: null,
              message:
                missingRequiredFields.length > 0
                  ? `I need some additional information to complete this transaction. Missing required parameters: ${missingRequiredFields.join(', ')}. Please provide these values to continue.`
                  : `I found your wallet data. Please provide any remaining parameters so I can show you the transaction details.`,
            };

            return parameterCollectionResponse;
          }

          // Step 5: Transaction Building - Single or Combined (only if we have parameters)
          let transactionResult: any;
          const allEffects: string[] = [];

          // Decision logic for single vs combined transactions
          const shouldUseCombined = templates.length > 1; // Only combine when truly multiple templates

          if (!shouldUseCombined && templates.length === 1) {
            // Single template execution
            const template = templates[0];
            transactionResult = await buildTransactionFromPTB(
              template,
              finalParams,
              userAddress || 'unknown',
              undefined, // client parameter
              toolResults, // supporting data
            );
            allEffects.push(`${template.name} operation completed`);
          } else {
            // Multi-operation combined transaction - OLD WORKING VERSION APPROACH

            const tx = new Transaction();
            const effects: string[] = [];
            const operationNames: string[] = [];
            const allParams: Record<string, any> = {};

            for (const operation of detectedOperations) {
              const { template, extractedParams } = operation;

              operationNames.push(template.name);

              // Filter and merge parameters (remove mock values)
              const cleanParams = Object.fromEntries(
                Object.entries(extractedParams).filter(([_key, value]) => {
                  if (typeof value === 'string') {
                    const isMockValue =
                      value.includes('0x00000000') ||
                      value === 'string' ||
                      value.includes('placeholder') ||
                      value.includes('mock');
                    if (isMockValue) {
                      return false;
                    }
                  }
                  return true;
                }),
              );
              Object.assign(allParams, cleanParams);

              try {
                // Add effect description
                const effectDesc = generateEffectDescription(
                  template,
                  extractedParams,
                );
                effects.push(effectDesc);
              } catch (error) {
                // Continue with other operations instead of failing completely
                effects.push(
                  `${template.name} operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            }

            // Step 6: Create combined template metadata with generated TypeScript code
            const combinedTemplate = {
              id: randomUUID(),
              name: `Combined: ${operationNames.join(' + ')}`,
              description: `Multi-operation transaction: ${operationNames.join(', ')}`,
              tags: [
                'combined',
                'multi-operation',
                ...detectedOperations.flatMap((op) => op.template.tags || []),
              ].filter((tag, index, arr) => arr.indexOf(tag) === index),
              contractAddress: null, // Combined operations don't have a single contract
              functionName: null, // Combined operations don't have a single function
              inputSchema: {
                properties: detectedOperations.reduce((acc, op) => {
                  const props = op.template.inputSchema?.properties || {};
                  Object.assign(acc, props);
                  return acc;
                }, {}),
                required: detectedOperations
                  .flatMap((op) => op.template.inputSchema?.required || [])
                  .filter((field, index, arr) => arr.indexOf(field) === index),
              },
              // Generate executable TypeScript code that recreates all operations
              typescriptCode:
                generateCombinedTypescriptCode(detectedOperations),
            };

            // Now execute the COMBINED template as a single operation
            const executeCode = new Function(
              'tx',
              'inputs',
              'userAddress',
              `
            try {
              ${combinedTemplate.typescriptCode}
              return tx;
            } catch (error) {
              console.error('Combined operation error:', error);
              throw error;
            }
          `,
            );

            executeCode(tx, allParams, userAddress);

            transactionResult = {
              transaction: tx,
              preview: {
                description: `Combined transaction with ${detectedOperations.length} operations`,
                effects,
              },
              combinedTemplate,
              allParams,
            };
          }

          // Step 6: Response Generation - Use appropriate template format
          let templateData: any;
          let responseParams: any;

          if (shouldUseCombined && templates.length > 1) {
            // Use the combined template we created
            templateData = transactionResult.combinedTemplate;
            responseParams = transactionResult.allParams;
          } else {
            // Single operation - use individual template
            const mergedInputSchema =
              templates.length === 1
                ? templates[0].inputSchema
                : mergeInputSchemas(templates);

            templateData = {
              id: templates[0].id,
              name:
                templates.length === 1
                  ? templates[0].name
                  : `Combined: ${templates.map((t) => t.name).join(' + ')}`,
              description:
                templates.length === 1
                  ? templates[0].description
                  : `Multi-operation transaction: ${templates.map((t) => t.name).join(', ')}`,
              tags: templates
                .flatMap((t) => t.tags || [])
                .filter((tag, index, arr) => arr.indexOf(tag) === index),
              contractAddress: templates[0].contractAddress || null,
              functionName: templates[0].functionName || null,
              supportingTools: Array.from(allSupportingTools),
              inputSchema: mergedInputSchema,
              typescriptCode: templates[0].typescriptCode,
              templates: templates, // Include all templates for reference
            };
            responseParams = finalParams;
          }

          // Don't emit success status - transaction is ready, no need to show status
          // dataStream.write({
          //   type: 'data-tool-status',
          //   data: {
          //     toolName: 'createPtbTransaction',
          //     status: 'success',
          //     message: createPtbTransactionMetadata.status.success
          //   }
          // });

          return {
            success: true,
            mode: templates.length === 1 ? 'single' : 'multi',
            templateName: templateData.name,
            templateData,
            prefilledParams: responseParams,
            extractedFromInput: userInput,
            walletData: toolResults,
            supportingToolsInvoked: Array.from(allSupportingTools),
            transaction: {
              transactionData: transactionResult.transaction,
              preview: transactionResult.preview,
            },
            message:
              shouldUseCombined && templates.length > 1
                ? `Combined ${templates.length} operations into a single transaction.`
                : `Created PTB transaction. ${Array.from(allSupportingTools).length > 0 ? `Invoked tools: ${Array.from(allSupportingTools).join(', ')}. ` : ''}Ready for your input.`,
          };
        })(); // Close async IIFE

        // Store promise
        pendingCalls.set(callKey, callPromise);

        // Execute and cleanup
        try {
          const result = await callPromise;
          return result;
        } finally {
          // Remove from pending after short delay (allow other duplicate calls to be caught)
          setTimeout(() => pendingCalls.delete(callKey), 2000);
        }
      } catch (error) {
        // Don't emit error status - let the error message speak for itself
        // dataStream.write({
        //   type: 'data-tool-status',
        //   data: {
        //     toolName: 'createPtbTransaction',
        //     status: 'error',
        //     message: createPtbTransactionMetadata.status.error
        //   }
        // });

        console.error('PTB transaction failed:', error);
        throw new Error(
          `Failed to create PTB transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    },
  });
};

// Utility functions from create-combined-ptb for multi-operation support

/**
 * Generate executable TypeScript code that recreates all combined operations
 */
function generateCombinedTypescriptCode(
  operations: DetectedOperation[],
): string {
  const codeBlocks = operations.map((operation, index) => {
    const { template } = operation;
    if (!template.typescriptCode) {
      return `// ${template.name} operation (no code available)`;
    }

    return `
// ${template.name} operation (${index + 1}/${operations.length})
${template.typescriptCode}`;
  });

  const combinedCode = `// Combined PTB with ${operations.length} operations
// Generated automatically to ensure transaction integrity

// Parse array parameters that might come as comma-separated strings
console.log('Raw inputs received:', JSON.stringify(inputs, null, 2));

// Helper function to ensure array format
function ensureArray(value, fieldName) {
  if (Array.isArray(value)) {
    console.log('[Combined PTB]', fieldName, 'is already array:', value);
    return value;
  }
  if (typeof value === 'string' && value.includes(',')) {
    const parsed = value.split(',').map(s => s.trim());
    console.log('[Combined PTB] Parsed', fieldName, 'from string to array:', parsed);
    return parsed;
  }
  console.log('[Combined PTB]', fieldName, 'format unclear:', value);
  return Array.isArray(value) ? value : [value];
}

// Parse parameters for combined operations
if (inputs.amounts && inputs.recipients) {
  inputs.amounts = ensureArray(inputs.amounts, 'amounts');
  inputs.recipients = ensureArray(inputs.recipients, 'recipients');
}

${codeBlocks.join('\n')}

console.log('Combined PTB executed ${operations.length} operations successfully');`;

  console.log('Generated combined code:');
  console.log(combinedCode);
  return combinedCode;
}

// Use actual LLM to extract operation intents and generate search queries
async function extractOperationIntents(
  userInput: string,
  selectedChatModel: string,
): Promise<string[]> {
  try {
    const { generateObject } = await import('ai');
    const { z } = await import('zod');
    const { myProvider } = await import('../providers');

    const extractionPrompt = `
# ROLE: AI Blockchain Intent Parser

You are an expert AI assistant that analyzes user input to identify and extract all requested blockchain/crypto operations. Your purpose is to convert natural language requests into standardized, actionable search queries that can be used to find relevant code templates or functions.

---

### INSTRUCTIONS

Follow these steps to process the user input:

1.  **Deconstruct the Input**: Carefully read the user's request. Look for keywords like "and", "then", "also", or distinct clauses that separate multiple intended operations. **IMPORTANT**: Single coherent actions should NOT be split - "place NFT in kiosk" is ONE operation, not two.
2.  **Identify Core Actions**: For each distinct intention, identify the fundamental blockchain operation being requested (e.g., creating something, moving something, trading something). **Focus on the primary intent** - if user says "place NFT in kiosk", the intent is placing, not minting.
3.  **Extract & Standardize**:
    * **Action (Verb)**: Determine the primary action. Standardize it to one of: \`mint\`, \`transfer\`, \`send\`, \`swap\`, \`stake\`, \`create\`, \`deploy\`, \`place\`, \`list\`, \`buy\`, \`bid\`, \`unlist\`.
    * **Object (Noun)**: Determine the object of the action. Standardize it to one of: \`nft\`, \`token\`, \`sui\`, \`wallet\`, \`rewards\`, \`contract\`, \`kiosk\`, \`collection\`, \`listings\`. **Special case**: Use "listings" when the user mentions "listing ID", "listing", or buying from an existing marketplace listing.
    * **Platform/Context (Important)**: If the user mentions a specific marketplace or platform (e.g., "tradeport", "hyperspace", "kiosk"), always include it in the search query for better template matching. This is critical for finding marketplace-specific templates.
4.  **Formulate Search Queries**: Combine the standardized Action and Object with Platform context into a concise 2-4 word search query string. **Platform context is critical** - use patterns like "tradeport buy nft", "hyperspace list nft", "mint nft", "transfer sui", "place kiosk".
5.  **Handle Ambiguity**:
    * If the user mentions generic terms like "money", "crypto", or "coins" without specifying a token, provide broad queries like \`["send sui", "transfer token"]\` to cover the most likely intentions.
    * If the input does not contain any actionable blockchain operation (e.g., it's a question like "what is a wallet?" or a greeting), return an empty list.
6.  **Format the Output**: **You must return only a single JSON object**. This object will have one key, \`"operations"\`, which contains a list of all the extracted search query strings. Do not add any other text or explanation outside of the JSON object.

---

### EXAMPLES

-   **User Input**: "I want to mint an NFT and then transfer some SUI to my friend."
    -   **Output**: \`{ "operations": ["mint nft", "transfer sui"] }\`

-   **User Input**: "Create an NFT with the name 'My Art', then send 0.5 SUI to 0x123..."
    -   **Output**: \`{ "operations": ["mint nft", "send sui"] }\`

-   **User Input**: "swap my tokens for USDC and stake the rewards"
    -   **Output**: \`{ "operations": ["swap token", "stake rewards"] }\`

-   **User Input**: "create a new multisig wallet"
    -   **Output**: \`{ "operations": ["create-multisig-wallet"] }\`

-   **User Input**: "send some money to my mom" (Ambiguous)
    -   **Output**: \`{ "operations": ["send sui", "transfer token"] }\`

-   **User Input**: "what is a blockchain?" (Non-actionable)
    -   **Output**: \`{ "operations": [] }\`

-   **User Input**: "I need to deploy a new smart contract"
    -   **Output**: \`{ "operations": ["deploy contract"] }\`

-   **User Input**: "place NFT in kiosk"
    -   **Output**: \`{ "operations": ["place kiosk"] }\`

-   **User Input**: "I want to place my NFT in a kiosk"
    -   **Output**: \`{ "operations": ["place kiosk"] }\`

-   **User Input**: "put NFT into kiosk"
    -   **Output**: \`{ "operations": ["place kiosk"] }\`

-   **User Input**: "list NFT for sale"
    -   **Output**: \`{ "operations": ["list nft"] }\`

-   **User Input**: "buy tradeport nft using ptb"
    -   **Output**: \`{ "operations": ["tradeport buy nft"] }\`

-   **User Input**: "purchase NFT from tradeport marketplace"
    -   **Output**: \`{ "operations": ["tradeport buy nft"] }\`

-   **User Input**: "bid on hyperspace nft"
    -   **Output**: \`{ "operations": ["hyperspace bid nft"] }\`


---

### USER INPUT TO ANALYZE

Analyze the following user input and provide the JSON output.

**User Input**: "${userInput}"`;

    const result = await generateObject({
      model: myProvider.languageModel(selectedChatModel),
      prompt: extractionPrompt,
      schema: z.object({
        operations: z
          .array(z.string())
          .describe('Array of search queries for blockchain operations'),
      }),
    });

    console.log('LLM extracted operations:', result.object.operations);
    return result.object.operations;
  } catch (error) {
    console.warn(
      'LLM extraction failed, falling back to basic keyword detection:',
      error,
    );
    return fallbackKeywordExtraction(userInput);
  }
}

// Fallback keyword extraction if LLM fails
function fallbackKeywordExtraction(userInput: string): string[] {
  const commonKeywords = [
    'mint',
    'transfer',
    'swap',
    'stake',
    'nft',
    'token',
    'sui',
    'multisig',
  ];
  const input = userInput.toLowerCase();
  const found = commonKeywords.filter((keyword) => input.includes(keyword));
  return found.length > 0 ? found : ['general'];
}

// Merge input schemas from multiple templates for combined transactions with grouping
function mergeInputSchemas(templates: any[]): any {
  const templateGroups: Record<string, any> = {};
  const allProperties: Record<string, any> = {};
  const allRequired: string[] = [];

  // Process each template's input schema and group parameters
  for (const template of templates) {
    const schema = template.inputSchema;
    if (!schema) continue;

    const templateName = template.name;
    const templateProperties: Record<string, any> = {};

    // Collect properties for this template
    if (schema.properties) {
      Object.entries(schema.properties).forEach(([key, value]) => {
        templateProperties[key] = value;
        allProperties[key] = {
          ...(typeof value === 'object' && value !== null ? value : {}),
          'x-ptb-template': templateName, // Custom property to track which PTB this belongs to
          'x-ptb-group': templateName,
        };
      });
    }

    // Store template group information
    templateGroups[templateName] = {
      title: templateName,
      description: template.description || `Parameters for ${templateName}`,
      properties: templateProperties,
      required: schema.required || [],
    };

    // Collect all required fields
    if (schema.required && Array.isArray(schema.required)) {
      allRequired.push(...schema.required);
    }
  }

  // Remove duplicates from required fields
  const uniqueRequired = [...new Set(allRequired)];

  // Return enhanced schema with grouping information
  return {
    type: 'object',
    properties: allProperties,
    required: uniqueRequired,
    title: `Combined Parameters (${templates.length} operations)`,
    description: `Parameters for all operations: ${templates.map((t) => t.name).join(', ')}`,

    // Custom properties for UI grouping
    'x-ptb-templates': templates.map((t) => ({
      name: t.name,
      description: t.description,
      properties: Object.keys(t.inputSchema?.properties || {}),
      required: t.inputSchema?.required || [],
    })),
    'x-ptb-groups': templateGroups,
  };
}

// Generate human-readable effect description for operations
function generateEffectDescription(
  template: any,
  params: Record<string, any>,
): string {
  const templateName = template.name || 'Unknown Operation';

  // Try to extract meaningful information from parameters
  const paramStrings: string[] = [];

  if (params.name && params.description) {
    paramStrings.push(`"${params.name}" - ${params.description}`);
  } else if (params.name) {
    paramStrings.push(`"${params.name}"`);
  }

  if (params.amount) {
    paramStrings.push(`${params.amount} ${params.tokenType}`);
  }

  if (params.recipient) {
    const shortRecipient =
      typeof params.recipient === 'string' && params.recipient.length > 16
        ? `${params.recipient.slice(0, 8)}...`
        : params.recipient;
    paramStrings.push(`to ${shortRecipient}`);
  }

  // Build the final description
  if (paramStrings.length > 0) {
    return `${templateName}: ${paramStrings.join(', ')}`;
  } else {
    return `${templateName}${template.description ? ` - ${template.description}` : ''}`;
  }
}
