/**
 * Use LLM to intelligently parse parameters from user input
 * Based on ai-wallet-main implementation
 */

import { generateText } from 'ai';
import { myProvider } from './providers';
import { enhanceParametersWithContext } from './context-resolver';
import { cache, CacheKeys } from '@/lib/cache/redis-cache';

// Deduplication map for parallel requests
const pendingExtractions = new Map<string, Promise<LLMParameterResult>>();

export interface LLMParameterResult {
  success: boolean;
  parameters: Record<string, any>;
  allRequiredProvided: boolean;
  missingFields: string[];
}

/**
 * Use LLM to extract parameters from user input based on PTB schema
 */
export async function extractParametersWithLLM(
  userInput: string,
  ptb: any,
  conversationContext: string,
  selectedChatModel: string,
  recentTransactions?: any[],
): Promise<LLMParameterResult> {
  if (!ptb.inputSchema?.properties) {
    return {
      success: false,
      parameters: {},
      allRequiredProvided: false,
      missingFields: [],
    };
  }

  // OPTIMIZATION: Check cache first (30 second TTL for parameter extraction)
  const cacheKey = CacheKeys.llmParams(userInput, ptb.id || ptb.name);
  const cached = await cache.get<LLMParameterResult>(cacheKey);
  if (cached) {
    console.log('⚡ Using cached LLM parameter extraction');
    return cached;
  }

  // OPTIMIZATION: Deduplicate parallel requests
  const existingExtraction = pendingExtractions.get(cacheKey);
  if (existingExtraction) {
    console.log('⚡ Deduplicating parallel LLM parameter extraction');
    return await existingExtraction;
  }

  const properties = ptb.inputSchema.properties;
  const required = ptb.inputSchema.required || [];

  // Handle templates with no parameters required (like Create NFT Kiosk)
  if (Object.keys(properties).length === 0 && required.length === 0) {
    return {
      success: true,
      parameters: {},
      allRequiredProvided: true,
      missingFields: [],
    };
  }

  // Wrap extraction in promise for deduplication
  const extractionPromise = (async () => {
    // Create a detailed prompt for parameter extraction
    const systemPrompt = `You are a parameter extraction assistant. Your job is to extract structured parameters from user input.

Given a user's input and a schema, extract the parameters and return them as a JSON object.

PTB: ${ptb.name}
Description: ${ptb.description}

Required Parameters:
${required
  .map((field: string) => {
    const fieldInfo = properties[field];
    return `- ${field} (${fieldInfo.type}): ${fieldInfo.description || 'No description'}`;
  })
  .join('\n')}

Optional Parameters:
${Object.keys(properties)
  .filter((field) => !required.includes(field))
  .map((field) => {
    const fieldInfo = properties[field];
    return `- ${field} (${fieldInfo.type}): ${fieldInfo.description || 'No description'}`;
  })
  .join('\n')}

Context: ${conversationContext}

User Input: "${userInput}"

🎯 EXTRACTION TASK: Extract parameters from the user input that match ONLY the schema defined above for "${ptb.name}".

🚨 CRITICAL RULES:
1. ONLY extract parameters that are listed in the "Required Parameters" and "Optional Parameters" sections above
2. If the user input mentions multiple operations but a parameter is NOT in this PTB's schema, IGNORE it
3. If a parameter cannot be determined from the input, omit it from the JSON
4. Return a clean JSON object with only the schema-matching parameters

SCHEMA-BASED EXTRACTION:
- Look at the parameter list above and extract ONLY those fields from the user input
- Example: If schema only has "name", "description", "imageUrl" → extract only those, ignore "amount", "recipient" etc.
- Example: If schema only has "amount", "recipient" → extract only those, ignore "name", "description" etc.

IMPORTANT NOTES:
- For Transfer SUI: amount should be in SUI (e.g., "0.01", "0.1", "1")
- For recipient, use the full address provided
- DETECT MULTIPLE TRANSFERS: Look for words like "and", "another", "also", multiple addresses, or multiple amounts
- If multiple transfers mentioned, use arrays: "amounts": ["0.01", "0.01"], "recipients": ["0x123...", "0xabc..."]
- If single transfer, use single values: "amount": "0.01", "recipient": "0x123..."

Examples:
- Single: "send 0.01 SUI to 0x123..." → {"amount": "0.01", "recipient": "0x123..."}
- Multiple: "send 0.01 to 0x123... and 0.01 to 0xabc..." → {"amounts": ["0.01", "0.01"], "recipients": ["0x123...", "0xabc..."]}
- Multiple with "another": "send 0.01 to 0x123... and another 0.01 to 0xabc..." → {"amounts": ["0.01", "0.01"], "recipients": ["0x123...", "0xabc..."]}
- NFT: "dragon, fire breathing dragon, https://example.com/dragon.png" → {"name": "dragon", "description": "fire breathing dragon", "imageUrl": "https://example.com/dragon.png"}

Mixed Operations Examples:
- Input: "mint NFT with cat, cute cat, https://cat.jpg and send 0.01 to 0x123"
  - For Mint NFT PTB: {"name": "cat", "description": "cute cat", "imageUrl": "https://cat.jpg"}
  - For Transfer SUI PTB: {"amount": "0.01", "recipient": "0x123"}

- Input: "send 0.01 to 0x123 and another 0.01 to 0xabc and also mint test, test, https://img.jpg"
  - For Transfer SUI PTB: {"amounts": ["0.01", "0.01"], "recipients": ["0x123", "0xabc"]}  
  - For Mint NFT PTB: {"name": "test", "description": "test", "imageUrl": "https://img.jpg"}

- Input: "kostas, handsome, https://pbs.twimg.com/profile_images/1890911209982984192/5PCrJOo5_400x400.jpg"
  - For Mint NFT PTB: {"name": "kostas", "description": "handsome", "imageUrl": "https://pbs.twimg.com/profile_images/1890911209982984192/5PCrJOo5_400x400.jpg"}

Return only the JSON object, no other text:`;

    try {
      const { text: responseText } = await generateText({
        model: myProvider.languageModel(selectedChatModel),
        maxRetries: 2,
        temperature: 0.1, // Low temperature for consistent extraction
        system: systemPrompt,
        prompt: userInput,
      });

      console.log(`🧠 LLM parameter extraction response: "${responseText}"`);

      // Parse the JSON response
      let extractedParams: Record<string, any> = {};
      try {
        // Clean the response in case there's extra text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedParams = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON object found in response');
        }
      } catch (parseError) {
        console.error('Failed to parse LLM response as JSON:', parseError);
        return {
          success: false,
          parameters: {},
          allRequiredProvided: false,
          missingFields: required,
        };
      }

      // Validate that all required parameters are provided
      const missingFields = required.filter(
        (field: string) =>
          extractedParams[field] === undefined ||
          extractedParams[field] === null ||
          extractedParams[field] === '',
      );

      const allRequiredProvided = missingFields.length === 0;

      console.log(`🧠 LLM extracted parameters:`, extractedParams);

      // Auto-fix token addresses for swap operations when they're missing
      if (
        (ptb.name === '@cetus/swap' ||
          ptb.name.toLowerCase().includes('swap')) &&
        userInput
      ) {
        if (!extractedParams.tokenFromAddress && extractedParams.coinType1) {
          extractedParams.tokenFromAddress = extractedParams.coinType1;
          console.log(
            `🔧 Auto-mapped tokenFromAddress from coinType1:`,
            extractedParams.tokenFromAddress,
          );
        }
        if (!extractedParams.tokenToAddress && extractedParams.coinType2) {
          extractedParams.tokenToAddress = extractedParams.coinType2;
          console.log(
            `🔧 Auto-mapped tokenToAddress from coinType2:`,
            extractedParams.tokenToAddress,
          );
        }
      }

      // Enhance with contextual resolution if recent transactions provided
      let finalParameters = extractedParams;
      if (recentTransactions && recentTransactions.length > 0) {
        finalParameters = enhanceParametersWithContext(
          extractedParams,
          userInput,
          required,
          recentTransactions,
        );
      }

      // Re-validate after context enhancement
      const missingFieldsAfterContext = required.filter(
        (field: string) =>
          finalParameters[field] === undefined ||
          finalParameters[field] === null ||
          finalParameters[field] === '',
      );

      const allRequiredProvidedAfterContext =
        missingFieldsAfterContext.length === 0;

      console.log(`🧠 Missing required fields:`, missingFieldsAfterContext);
      console.log(`🧠 All required provided:`, allRequiredProvidedAfterContext);
      console.log(`🧠 Required fields for PTB:`, required);
      console.log(`🧠 PTB properties:`, Object.keys(properties));

      return {
        success: true,
        parameters: finalParameters,
        allRequiredProvided: allRequiredProvidedAfterContext,
        missingFields: missingFieldsAfterContext,
      };
    } catch (error) {
      console.error('LLM parameter extraction failed:', error);
      return {
        success: false,
        parameters: {},
        allRequiredProvided: false,
        missingFields: required,
      };
    }
  })(); // Close async IIFE

  // Store promise for deduplication
  pendingExtractions.set(cacheKey, extractionPromise);

  try {
    const result = await extractionPromise;
    // Cache result for 30 seconds
    await cache.set(cacheKey, result, 30);
    return result;
  } finally {
    // Cleanup after short delay
    setTimeout(() => pendingExtractions.delete(cacheKey), 2000);
  }
}
