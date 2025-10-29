/**
 * Embeddings service using Voyage AI or Google Gemini
 * Integrated from ai-wallet-main for improved PTB search
 */

// Primary embedding function - tries Voyage AI first, falls back to Gemini
export async function calculateEmbedding(text: string): Promise<number[]> {
  const hasVoyage = !!process.env.VOYAGE_API_KEY;
  const hasGemini = !!process.env.GOOGLE_API_KEY;

  if (!hasVoyage && !hasGemini) {
    throw new Error('Either VOYAGE_API_KEY or GOOGLE_API_KEY is required for embedding generation');
  }

  let embedding: number[];

  // Try Voyage AI first if available
  if (hasVoyage) {
    try {
      console.log('Using Voyage AI for embedding generation');
      embedding = await generateVoyageEmbedding(text);
    } catch (error: any) {
      console.warn('Voyage AI failed, trying Gemini fallback:', error.message);
      if (!hasGemini) throw error;
      embedding = await generateGeminiEmbedding(text);
    }
  } else {
    console.log('Using Google Gemini for embedding generation');
    embedding = await generateGeminiEmbedding(text);
  }

  // Validate dimensions
  if (!embedding || embedding.length !== 1536) {
    throw new Error(
      `Invalid embedding dimensions: expected 1536, got ${embedding?.length || 0}`,
    );
  }

  return embedding;
}

// Voyage AI embedding generation
async function generateVoyageEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: 'voyage-large-2',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voyage API error: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as any;
  return data.data[0].embedding;
}

// Google Gemini embedding generation (text-embedding-004 with native output)
async function generateGeminiEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: {
          parts: [{ text }],
        },
        // Don't specify outputDimensionality to get the full native dimensions
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as any;
  const embedding = data.embedding.values as number[];

  console.log(`✅ Gemini embedding generated: ${embedding.length} dimensions`);
  
  // If embedding is not 1536, we need to handle it
  if (embedding.length !== 1536) {
    console.log(`⚠️  Warning: Gemini returned ${embedding.length} dimensions, expected 1536`);
    // Pad to 1536 if needed
    if (embedding.length < 1536) {
      const padded = new Array(1536).fill(0);
      for (let i = 0; i < embedding.length; i++) {
        padded[i] = embedding[i];
      }
      return padded;
    }
    // Truncate if too large
    return embedding.slice(0, 1536);
  }

  return embedding;
}

// Calculate cosine similarity between two embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Find the most similar PTBs to a user intent
export function findSimilarPTBs(
  intentEmbedding: number[],
  ptbs: Array<{
    id: string;
    name: string;
    description: string;
    embedding: number[] | null;
  }>,
  threshold = 0.6, // Higher threshold for semantic similarity with Voyage AI
  limit = 15,
): Array<{ ptb: any; similarity: number }> {
  const similarities = ptbs
    .filter((ptb) => ptb.embedding && ptb.embedding.length > 0)
    .map((ptb) => ({
      ptb,
      similarity: cosineSimilarity(intentEmbedding, ptb.embedding as number[]),
    }))
    .filter((result) => result.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return similarities;
}
