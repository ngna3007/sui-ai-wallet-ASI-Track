/**
 * Multi-Operation PTB Handler
 * Ported from frontend to enable atomic multi-operation transactions via backend API
 */

import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

interface DetectedOperation {
  operation: string;
  searchQuery: string;
}

/**
 * Use LLM to extract operation intents from user input
 * Ported from: /lib/ai/tools/create-ptb-transaction.ts (lines 1309-1415)
 */
export async function extractOperationIntents(userInput: string): Promise<string[]> {
  try {
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

-   **User Input**: "send some money to my mom" (Ambiguous)
    -   **Output**: \`{ "operations": ["send sui", "transfer token"] }\`

-   **User Input**: "what is a blockchain?" (Non-actionable)
    -   **Output**: \`{ "operations": [] }\`

-   **User Input**: "transfer 0.01 SUI to 0x78df..., then transfer another 0.01 SUI to same address, and also mint an NFT"
    -   **Output**: \`{ "operations": ["transfer sui", "transfer sui", "mint nft"] }\`

---

### USER INPUT TO ANALYZE

Analyze the following user input and provide the JSON output.

**User Input**: "${userInput}"`;

    console.log('🧠 [Multi-Op] Using Anthropic Claude for intent extraction');

    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      prompt: extractionPrompt,
    });

    console.log('🧠 [Multi-Op] LLM raw response:', text);

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️  [Multi-Op] No JSON found in LLM response, falling back');
      return fallbackKeywordExtraction(userInput);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const operations = parsed.operations || [];

    console.log('✅ [Multi-Op] Extracted operations:', operations);
    return operations;
  } catch (error) {
    console.warn(
      '⚠️  [Multi-Op] LLM extraction failed, falling back to keyword detection:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return fallbackKeywordExtraction(userInput);
  }
}

/**
 * Fallback keyword extraction if LLM fails
 */
function fallbackKeywordExtraction(userInput: string): string[] {
  const commonKeywords = [
    'mint',
    'transfer',
    'swap',
    'stake',
    'nft',
    'token',
    'sui',
  ];
  const input = userInput.toLowerCase();
  const found = commonKeywords.filter((keyword) => input.includes(keyword));
  return found.length > 0 ? found : ['general'];
}

/**
 * Generate executable TypeScript code that recreates all combined operations
 * Ported from: /lib/ai/tools/create-ptb-transaction.ts (lines 1258-1306)
 */
export function generateCombinedTypescriptCode(
  templates: Array<{ name: string; typescriptCode?: string }>,
): string {
  const codeBlocks = templates.map((template, index) => {
    if (!template.typescriptCode) {
      return `// ${template.name} operation (no code available)`;
    }

    return `
// ${template.name} operation (${index + 1}/${templates.length})
${template.typescriptCode}`;
  });

  const combinedCode = `// Combined PTB with ${templates.length} operations
// Generated automatically to ensure transaction integrity

// Fix for template compatibility: Add tx.Object alias for older templates
if (!tx.Object && tx.object) {
  tx.Object = tx.object;
}

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

console.log('Combined PTB executed ${templates.length} operations successfully');`;

  console.log('📝 [Multi-Op] Generated combined code:');
  console.log(combinedCode);
  return combinedCode;
}

/**
 * Generate human-readable effect description for operations
 */
export function generateEffectDescription(
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
    paramStrings.push(`${params.amount} ${params.tokenType || 'SUI'}`);
  }

  if (params.recipient) {
    const shortRecipient =
      typeof params.recipient === 'string' && params.recipient.length > 16
        ? `${params.recipient.slice(0, 8)}...${params.recipient.slice(-6)}`
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
