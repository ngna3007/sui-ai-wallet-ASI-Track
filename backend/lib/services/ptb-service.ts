import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { primaryDb, primarySchema, ptbDb, ptbSchema } from '../db/connections';
import { calculateEmbedding, cosineSimilarity } from './embeddings';

export interface PTBSearchResult {
  id: string;
  name: string;
  description: string | null;
  typescriptCode: string | null;
  inputSchema: any;
  outputSchema: any;
  tags: string[] | null;
  contractAddress: string | null;
  functionName: string | null;
  supportingTools: string[] | null;
  similarityScore?: number;
  matchType: 'semantic' | 'keyword' | 'exact';
}

export interface PTBExecutionRecord {
  id: number;
  ptbId: string;
  inputData: any;
  status: 'pending' | 'success' | 'failed';
  suiTxDigest?: string;
  gasUsed?: string;
  createdAt: Date;
}

export class PTBService {
  /**
   * Search PTB templates using embeddings for semantic matching with keyword fallback
   */
  async searchPTBTemplates(
    query: string,
    limit = 10,
  ): Promise<PTBSearchResult[]> {
    try {
      const searchQuery = query.toLowerCase().trim();
      console.log(`🔍 Searching PTBs for: "${searchQuery}"`);

      // First try embeddings-based semantic search
      try {
        const results = await this.searchPTBsSemantic(searchQuery, { limit });
        if (results.length > 0) {
          console.log(`✅ Found ${results.length} results via semantic search`);
          return results;
        }
      } catch (error) {
        console.log('⚠️ Semantic search failed, falling back to keyword search');
        console.error('Semantic search error:', error);
      }

      // Fallback to keyword search
      console.log('🔤 Using keyword search fallback');
      return await this.searchPTBsKeyword(searchQuery, { limit });
    } catch (error) {
      console.error('Error searching PTB templates:', error);
      throw new Error('Failed to search PTB templates');
    }
  }

  /**
   * Semantic search using embeddings
   */
  private async searchPTBsSemantic(
    query: string,
    options: { limit?: number; threshold?: number } = {},
  ): Promise<PTBSearchResult[]> {
    const { limit = 10, threshold = 0.1 } = options;

    // Generate embedding for the query
    const queryEmbedding = await calculateEmbedding(query);
    console.log(
      `🧠 Generated embedding with ${queryEmbedding.length} dimensions`,
    );

    // Get all PTBs with embeddings
    const allPTBs = await ptbDb
      .select()
      .from(ptbSchema.ptbRegistry)
      .where(
        and(
          eq(ptbSchema.ptbRegistry.isActive, true),
          isNotNull(ptbSchema.ptbRegistry.embedding),
        ),
      );

    // Calculate similarities
    const similarities = allPTBs
      .filter((ptb) => ptb.embedding)
      .map((ptb) => {
        // Handle both JSON string and direct array formats from database
        let embedding: number[];
        if (typeof ptb.embedding === 'string') {
          try {
            embedding = JSON.parse(ptb.embedding);
          } catch (error) {
            console.warn(`Failed to parse embedding for ${ptb.name}:`, error);
            return null;
          }
        } else if (Array.isArray(ptb.embedding)) {
          embedding = ptb.embedding as number[];
        } else {
          console.warn(
            `Invalid embedding format for ${ptb.name}:`,
            typeof ptb.embedding,
          );
          return null;
        }

        if (!Array.isArray(embedding) || embedding.length === 0) {
          console.warn(`Invalid embedding array for ${ptb.name}`);
          return null;
        }

        try {
          const similarity = cosineSimilarity(queryEmbedding, embedding);
          return {
            ptb,
            similarity,
          };
        } catch (error) {
          console.warn(`Error calculating similarity for ${ptb.name}:`, error);
          return null;
        }
      })
      .filter((result) => result !== null)
      .filter((result) => result?.similarity >= threshold)
      .sort((a, b) => b?.similarity - a?.similarity)
      .slice(0, limit) as Array<{ ptb: any; similarity: number }>;

    console.log(
      `📊 Found ${similarities.length} semantic matches above threshold ${threshold}`,
    );

    // Log top 3 results for debugging
    if (similarities.length > 0) {
      console.log('🔍 Top 3 semantic matches:');
      similarities.slice(0, 3).forEach((result, index) => {
        console.log(
          `  ${index + 1}. ${result.ptb.name} (similarity: ${result.similarity.toFixed(3)})`,
        );
      });
    }

    return similarities.map(({ ptb, similarity }) => {
      // Debug: Log what columns are actually returned from database

      return {
        ...ptb,
        matchType: 'semantic' as const,
        similarityScore: similarity,
      };
    });
  }

  /**
   * Keyword search fallback
   */
  async searchPTBsKeyword(
    query: string,
    options: { limit?: number } = {},
  ): Promise<PTBSearchResult[]> {
    const { limit = 10 } = options;
    const searchQuery = query.toLowerCase().trim();

    // First try exact name match
    const exactResults = await ptbDb
      .select()
      .from(ptbSchema.ptbRegistry)
      .where(
        and(
          eq(ptbSchema.ptbRegistry.isActive, true),
          sql`LOWER(${ptbSchema.ptbRegistry.name}) = ${searchQuery}`,
        ),
      )
      .limit(limit);

    if (exactResults.length > 0) {
      return exactResults.map((ptb) => ({
        ...ptb,
        supportingTools: Array.isArray(ptb.supportingTools)
          ? ptb.supportingTools
          : null,
        matchType: 'exact' as const,
        similarityScore: 1.0,
      }));
    }

    // Then try keyword search on name, description, and tags
    const keywordResults = await ptbDb
      .select()
      .from(ptbSchema.ptbRegistry)
      .where(
        and(
          eq(ptbSchema.ptbRegistry.isActive, true),
          sql`(
            LOWER(${ptbSchema.ptbRegistry.name}) LIKE ${`%${searchQuery}%`} OR
            LOWER(${ptbSchema.ptbRegistry.description}) LIKE ${`%${searchQuery}%`} OR
            EXISTS (
              SELECT 1 FROM unnest(${ptbSchema.ptbRegistry.tags}) AS tag 
              WHERE LOWER(tag) LIKE ${`%${searchQuery}%`}
            )
          )`,
        ),
      )
      .limit(limit);

    return keywordResults.map((ptb) => ({
      ...ptb,
      supportingTools: Array.isArray(ptb.supportingTools)
        ? ptb.supportingTools
        : null,
      matchType: 'keyword' as const,
      similarityScore: 0.8,
    }));
  }

  /**
   * Get PTB template by ID
   */
  async getPTBTemplate(id: string): Promise<PTBSearchResult | null> {
    try {
      const result = await ptbDb
        .select()
        .from(ptbSchema.ptbRegistry)
        .where(
          and(
            eq(ptbSchema.ptbRegistry.id, id),
            eq(ptbSchema.ptbRegistry.isActive, true),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      return {
        ...result[0],
        supportingTools: Array.isArray(result[0].supportingTools)
          ? result[0].supportingTools
          : null,
        matchType: 'exact' as const,
        similarityScore: 1.0,
      };
    } catch (error) {
      console.error('Error getting PTB template:', error);
      throw new Error('Failed to get PTB template');
    }
  }

  /**
   * Get all available PTB templates grouped by category
   */
  async getAllPTBTemplates(): Promise<{
    [category: string]: PTBSearchResult[];
  }> {
    try {
      const results = await ptbDb
        .select()
        .from(ptbSchema.ptbRegistry)
        .where(eq(ptbSchema.ptbRegistry.isActive, true))
        .orderBy(ptbSchema.ptbRegistry.name);

      // Group by primary tag or fallback categories
      const grouped: { [category: string]: PTBSearchResult[] } = {};

      results.forEach((ptb) => {
        const template: PTBSearchResult = {
          ...ptb,
          supportingTools: Array.isArray(ptb.supportingTools)
            ? ptb.supportingTools
            : null,
          matchType: 'exact' as const,
          similarityScore: 1.0,
        };

        // Determine category from tags or name
        let category = 'Other';
        if (ptb.tags && ptb.tags.length > 0) {
          const firstTag = ptb.tags[0].toLowerCase();
          if (firstTag.includes('nft')) category = 'NFT';
          else if (firstTag.includes('swap') || firstTag.includes('dex'))
            category = 'DeFi';
          else if (firstTag.includes('stake')) category = 'Staking';
          else if (firstTag.includes('multisig')) category = 'Security';
          else if (firstTag.includes('transfer')) category = 'Transfers';
          else category = firstTag.charAt(0).toUpperCase() + firstTag.slice(1);
        } else if (ptb.name.toLowerCase().includes('nft')) {
          category = 'NFT';
        } else if (ptb.name.toLowerCase().includes('swap')) {
          category = 'DeFi';
        } else if (ptb.name.toLowerCase().includes('stake')) {
          category = 'Staking';
        } else if (ptb.name.toLowerCase().includes('transfer')) {
          category = 'Transfers';
        }

        if (!grouped[category]) {
          grouped[category] = [];
        }
        grouped[category].push(template);
      });

      return grouped;
    } catch (error) {
      console.error('Error getting all PTB templates:', error);
      throw new Error('Failed to get PTB templates');
    }
  }

  /**
   * Record PTB execution in the PTB database
   */
  async recordExecution(
    ptbId: string,
    inputData: any,
    userId = '1', // Default user for now
  ): Promise<PTBExecutionRecord> {
    try {
      const result = await ptbDb
        .insert(ptbSchema.ptbExecutedTransactions)
        .values({
          userId,
          ptbId,
          inputData,
          status: 'pending',
        })
        .returning();

      return {
        id: result[0].id,
        ptbId: result[0].ptbId as string,
        inputData: result[0].inputData,
        status: result[0].status as 'pending' | 'success' | 'failed',
        createdAt: result[0].createdAt,
      };
    } catch (error) {
      console.error('Error recording PTB execution:', error);
      throw new Error('Failed to record PTB execution');
    }
  }

  /**
   * Update PTB execution status with transaction details
   */
  async updateExecutionStatus(
    executionId: number,
    status: 'pending' | 'success' | 'failed',
    txDigest?: string,
    gasUsed?: string,
    outputData?: any,
  ): Promise<void> {
    try {
      await ptbDb
        .update(ptbSchema.ptbExecutedTransactions)
        .set({
          status,
          suiTxDigest: txDigest,
          gasUsed,
          outputData,
        })
        .where(eq(ptbSchema.ptbExecutedTransactions.id, executionId));
    } catch (error) {
      console.error('Error updating execution status:', error);
      throw new Error('Failed to update execution status');
    }
  }

  /**
   * Get execution history for a PTB template
   */
  async getExecutionHistory(
    ptbId: string,
    limit = 20,
  ): Promise<PTBExecutionRecord[]> {
    try {
      const results = await ptbDb
        .select()
        .from(ptbSchema.ptbExecutedTransactions)
        .where(eq(ptbSchema.ptbExecutedTransactions.ptbId, ptbId))
        .orderBy(desc(ptbSchema.ptbExecutedTransactions.createdAt))
        .limit(limit);

      return results.map((exec) => ({
        id: exec.id,
        ptbId: exec.ptbId as string,
        inputData: exec.inputData,
        status: exec.status as 'pending' | 'success' | 'failed',
        suiTxDigest: exec.suiTxDigest || undefined,
        gasUsed: exec.gasUsed || undefined,
        createdAt: exec.createdAt,
      }));
    } catch (error) {
      console.error('Error getting execution history:', error);
      throw new Error('Failed to get execution history');
    }
  }

  /**
   * Get execution statistics for PTB templates
   */
  async getExecutionStats(ptbId?: string): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageGasUsed?: number;
  }> {
    try {
      const whereClause = ptbId
        ? eq(ptbSchema.ptbExecutedTransactions.ptbId, ptbId)
        : undefined;

      const stats = await ptbDb
        .select({
          total: sql<number>`COUNT(*)`,
          successful: sql<number>`SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
          avgGas: sql<number>`AVG(CASE WHEN ${ptbSchema.ptbExecutedTransactions.gasUsed} IS NOT NULL THEN CAST(${ptbSchema.ptbExecutedTransactions.gasUsed} AS NUMERIC) ELSE NULL END)`,
        })
        .from(ptbSchema.ptbExecutedTransactions)
        .where(whereClause);

      const result = stats[0];
      return {
        totalExecutions: Number(result.total) || 0,
        successfulExecutions: Number(result.successful) || 0,
        failedExecutions: Number(result.failed) || 0,
        averageGasUsed: result.avgGas ? Number(result.avgGas) : undefined,
      };
    } catch (error) {
      console.error('Error getting execution stats:', error);
      throw new Error('Failed to get execution statistics');
    }
  }

  /**
   * Create artifact document in primary database for PTB results
   */
  async createPTBArtifact(
    title: string,
    content: any,
    kind: 'text' | 'code' | 'image' | 'ptb',
    userId: string,
  ) {
    try {
      const result = await primaryDb
        .insert(primarySchema.document)
        .values({
          title,
          content:
            typeof content === 'string'
              ? content
              : JSON.stringify(content, null, 2),
          kind: kind === 'ptb' ? 'ptb' : 'text', // Only ptb and text are supported in DB
          userId,
          createdAt: new Date(),
        })
        .returning();

      return result[0];
    } catch (error) {
      console.error('Error creating PTB artifact:', error);
      throw new Error('Failed to create PTB artifact');
    }
  }
}

// Export singleton instance
export const ptbService = new PTBService();
