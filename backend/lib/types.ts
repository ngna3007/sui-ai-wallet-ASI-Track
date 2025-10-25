import type { InferUITool, UIMessage } from 'ai';
import { z } from 'zod';
import type { createDocument } from './ai/tools/create-document';
import type { createPtbTransaction } from './ai/tools/create-ptb-transaction';
import type { getCoinChart } from './ai/tools/get-coin-chart';
import type { getCoinChartCompare } from './ai/tools/get-coin-chart-compare';
import type { getCoinInfo } from './ai/tools/get-coin-info';
import type { getCoinWidget } from './ai/tools/get-coin-widget';
import type { getFearGreedIndex } from './ai/tools/get-fear-greed-index';
import type { getPriceConversion } from './ai/tools/get-price-conversion';
import type { getPtbTemplates } from './ai/tools/get-ptb-templates';
import type { getSuiWalletBalances } from './ai/tools/get-sui-wallet-balances';
import type { getTransactionDetails } from './ai/tools/get-transaction-details';
import type { getSuiWalletCoins } from './ai/tools/get-sui-wallet-coins';
import type { getSuiWalletNfts } from './ai/tools/get-sui-wallet-nfts';
import type { getSuiWalletKiosks } from './ai/tools/get-sui-wallet-kiosks';
import type { getSuiWalletTransactions } from './ai/tools/get-sui-wallet-transactions';
import type { requestSuggestions } from './ai/tools/request-suggestions';
import type { searchPtbTemplates } from './ai/tools/search-ptb-templates';
import type { tradeportGetTradingCollections } from './ai/tools/tradeport-get-trading-collections';
import type { tradeportGetMintingCollections } from './ai/tools/tradeport-get-minting-collections';
import type { updateDocument } from './ai/tools/update-document';

import type { ArtifactKind } from '@/components/artifacts/artifact';
import type { Suggestion } from './db/schema';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type coinChartTool = InferUITool<typeof getCoinChart>;
type coinChartCompareTool = InferUITool<typeof getCoinChartCompare>;
type coinInfoTool = InferUITool<typeof getCoinInfo>;
type coinWidgetTool = InferUITool<typeof getCoinWidget>;
type fearGreedIndexTool = InferUITool<typeof getFearGreedIndex>;
type priceConversionTool = InferUITool<typeof getPriceConversion>;
type suiWalletTransactionsTool = InferUITool<typeof getSuiWalletTransactions>;
type suiWalletBalancesTool = InferUITool<typeof getSuiWalletBalances>;
type suiWalletCoinsTool = InferUITool<typeof getSuiWalletCoins>;
type suiWalletNftsTool = InferUITool<typeof getSuiWalletNfts>;
type suiWalletKiosksTool = InferUITool<typeof getSuiWalletKiosks>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type createPtbTransactionTool = InferUITool<
  ReturnType<typeof createPtbTransaction>
>;
type searchPtbTemplatesTool = InferUITool<typeof searchPtbTemplates>;
type getPtbTemplatesTool = InferUITool<typeof getPtbTemplates>;
type tradeportGetTradingCollectionsTool = InferUITool<
  typeof tradeportGetTradingCollections
>;
type tradeportGetMintingCollectionsTool = InferUITool<
  typeof tradeportGetMintingCollections
>;
type getTransactionDetailsTool = InferUITool<typeof getTransactionDetails>;

export type ChatTools = {
  getCoinChart: coinChartTool;
  getCoinChartCompare: coinChartCompareTool;
  getCoinInfo: coinInfoTool;
  getCoinWidget: coinWidgetTool;
  getFearGreedIndex: fearGreedIndexTool;
  getPriceConversion: priceConversionTool;
  getSuiWalletTransactions: suiWalletTransactionsTool;
  getSuiWalletBalances: suiWalletBalancesTool;
  getSuiWalletCoins: suiWalletCoinsTool;
  getSuiWalletNfts: suiWalletNftsTool;
  getSuiWalletKiosks: suiWalletKiosksTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  createPtbTransaction: createPtbTransactionTool;
  searchPtbTemplates: searchPtbTemplatesTool;
  getPtbTemplates: getPtbTemplatesTool;
  tradeportGetTradingCollections: tradeportGetTradingCollectionsTool;
  tradeportGetMintingCollections: tradeportGetMintingCollectionsTool;
  getTransactionDetails: getTransactionDetailsTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  chartDelta: string;
  ptb: string;
  ptbLog: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  'data-tool-dynamic': {
    toolName: string;
    toolCallId: string;
    state: 'input-streaming' | 'call' | 'result' | 'partial-call';
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  'tool-status': {
    toolName: string;
    status: 'running' | 'success' | 'error';
    message: string;
  };
  'data-tool-status': {
    toolName: string;
    status: 'running' | 'success' | 'error';
    message: string;
  };
};

// ChatMessage type - use type assertion to work around AI SDK constraints
export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
}
