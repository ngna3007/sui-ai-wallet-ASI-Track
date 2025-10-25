/**
 * Embeddings service using Voyage AI
 * Integrated from ai-wallet-main for improved PTB search
 */

// Primary embedding function using Voyage AI
export async function calculateEmbedding(text: string): Promise<number[]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is required for embedding generation');
  }

  console.log('Using Voyage AI for embedding generation');
  const embedding = await generateVoyageEmbedding(text);

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
    throw new Error(`Voyage API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
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
