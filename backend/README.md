# 🚀 SuiVisor Multi-User Wallet Backend

Production-ready TypeScript backend implementing a multi-user custodial wallet system for Fetch.ai agents on the Sui blockchain. Features include intelligent transaction building with PTB registry, semantic search, LLM parameter extraction, and comprehensive NFT/token management.

## Architecture Overview

### Multi-User Wallet System (Option 3 Hybrid)

SuiVisor implements a hybrid custodial wallet architecture where:

1. **Each User Gets a Unique Deposit Address**
   - Users are identified by their Fetch.ai agent address (e.g., `agent1q...`)
   - System derives a deterministic Sui deposit address (e.g., `0xabcd...`) for each user
   - Users deposit SUI/tokens to their personal deposit address

2. **Agent Wallet Executes All Transactions**
   - Single agent wallet (`0x7c10...`) holds all assets on-chain
   - Executes all transactions on behalf of users (swaps, transfers, NFT operations)
   - Users never need private keys or gas tokens

3. **Database Tracks Ownership**
   - PostgreSQL database maintains per-user balances
   - Tracks NFT ownership by user
   - Records all transaction history
   - Real-time balance updates from on-chain sweeping

### Three Wallet Types

```
┌─────────────────────────────────────────────────────────────┐
│ User (Fetch.ai Agent)                                       │
│ Address: agent1qw3k5l2m8p9r7s6t4u5v6...                     │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ User's Deposit Address (Deterministic)               │   │
│ │ 0xabcd1234... (derived from agent address)           │   │
│ │ - Receives deposits from external sources            │   │
│ │ - Auto-swept to agent wallet                         │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ deposits detected & swept
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent Wallet (Custodial)                                    │
│ 0x7c10a9b8fc5d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2   │
│                                                              │
│ - Holds ALL assets on-chain                                 │
│ - Executes transactions for all users                       │
│ - Pays gas fees                                             │
│ - Managed by backend service                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ ownership tracked in DB
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Database (PostgreSQL)                                       │
│                                                              │
│ user_accounts:                                              │
│   - agent1qw3k... → balance: 100 SUI                        │
│   - agent1qx5n... → balance: 50 SUI                         │
│                                                              │
│ user_nfts:                                                  │
│   - agent1qw3k... → NFT_123 (status: owned)                 │
│   - agent1qx5n... → NFT_456 (status: transferred)           │
└─────────────────────────────────────────────────────────────┘
```

## Features

### ✅ Core Wallet Operations
- **Multi-User Management**: Isolated balances and assets per user
- **Deterministic Deposit Addresses**: Unique address for each agent
- **Automatic Sweeping**: Deposits auto-transferred to agent wallet
- **Balance Tracking**: Real-time balance updates in database

### ✅ Transaction Capabilities
- **Token Swaps**: Cetus DEX integration with pool discovery
- **NFT Minting**: Create custom NFTs with metadata
- **NFT Transfers**: Transfer NFTs with ownership verification
- **Gas Abstraction**: Users never pay gas fees

### ✅ Intelligent PTB System
- **Semantic Search**: Vector embeddings (Voyage AI) for template matching
- **LLM Parameter Extraction**: Claude-powered natural language understanding
- **Dynamic PTB Building**: Execute TypeScript templates dynamically
- **PTB Registry**: Extensible template library in database

### ✅ Production Ready
- **Error Handling**: Comprehensive error logging and recovery
- **Database Transactions**: ACID compliance with Drizzle ORM
- **Health Monitoring**: Health check endpoints
- **Graceful Shutdown**: Clean process termination

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment variables (see below)
cp ../.env.example ../.env

# Start development server with auto-reload
npm run dev

# Or production server
npm start

# Run tests
npm run test:all
```

## API Endpoints

### User Management

#### POST /api/user/balance
Get or create user account and check balance.

**Request:**
```json
{
  "userAddress": "agent1qw3k5l2m8p9r7s6t4u5v6..."
}
```

**Response:**
```json
{
  "success": true,
  "userAddress": "agent1qw3k5l2m8p9r7s6t4u5v6...",
  "depositAddress": "0xabcd1234...",
  "balance": "100.5",
  "balanceLastUpdated": "2025-01-15T10:30:00Z"
}
```

#### GET /api/user/transactions
Get user transaction history.

**Query Parameters:**
- `userAddress` (required): User's agent address
- `limit` (optional): Number of transactions (default: 50)

**Response:**
```json
{
  "success": true,
  "count": 15,
  "transactions": [
    {
      "id": 123,
      "txHash": "6P6SUzt9khd...",
      "txType": "mint_nft",
      "amount": null,
      "status": "success",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### Token Operations

#### POST /api/swap
Execute token swap via Cetus DEX.

**Request:**
```json
{
  "userAddress": "agent1qw3k5l2m8p9r7s6t4u5v6...",
  "fromCoin": "SUI",
  "toCoin": "USDC",
  "amount": 10.5,
  "slippage": 0.01
}
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "F8CoER3NV1SxBQMF...",
  "pool": {
    "coinTypeA": "0x2::sui::SUI",
    "coinTypeB": "0x5d4b...::usdc::USDC",
    "poolId": "0x9c3b..."
  },
  "mode": "fast-path-real",
  "explorerUrl": "https://suiscan.xyz/testnet/tx/F8CoER3..."
}
```

### NFT Operations

#### POST /api/mint-nft
Mint a new NFT for user.

**Request:**
```json
{
  "userAddress": "agent1qw3k5l2m8p9r7s6t4u5v6...",
  "name": "My Awesome NFT",
  "description": "This is a test NFT",
  "imageUrl": "https://example.com/nft.png"
}
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "6P6SUzt9khd...",
  "nftObjectId": "0x8f3e2d1c...",
  "templateName": "@commandoss/mint-nft",
  "mode": "fast-path-real",
  "explorerUrl": "https://suiscan.xyz/testnet/tx/6P6SUz..."
}
```

#### POST /api/transfer-nft
Transfer NFT to another address.

**Request:**
```json
{
  "userAddress": "agent1qw3k5l2m8p9r7s6t4u5v6...",
  "nftObjectId": "0x8f3e2d1c...",
  "recipientAddress": "0x742d35cc6634..."
}
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "F8CoER3NV1Sx...",
  "nftObjectId": "0x8f3e2d1c...",
  "recipientAddress": "0x742d35cc6634...",
  "mode": "fast-path-real",
  "explorerUrl": "https://suiscan.xyz/testnet/tx/F8CoER..."
}
```

#### GET /api/user/nfts
Get user's NFTs.

**Query Parameters:**
- `userAddress` (required): User's agent address
- `status` (optional): Filter by status (owned, transferred, burned)

**Response:**
```json
{
  "success": true,
  "userAddress": "agent1qw3k5l2m8p9r7s6t4u5v6...",
  "count": 3,
  "nfts": [
    {
      "id": 1,
      "nftObjectId": "0x8f3e2d1c...",
      "name": "My Awesome NFT",
      "description": "This is a test NFT",
      "imageUrl": "https://example.com/nft.png",
      "status": "owned",
      "mintTxDigest": "6P6SUzt9khd...",
      "mintedAt": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### PTB Template System

#### POST /api/create-ptb
Create PTB transaction with semantic search and LLM extraction.

**Request:**
```json
{
  "userIntent": "swap 10 SUI to USDC with 1% slippage",
  "walletAddress": "0x7c10a9b8fc5d..."
}
```

**Response:**
```json
{
  "success": true,
  "transactionData": {...},
  "templateName": "Cetus Swap SUI/USDC",
  "parameters": {
    "amount": 10,
    "fromToken": "SUI",
    "toToken": "USDC"
  },
  "executionTime": "450ms"
}
```

#### GET /api/templates
List available PTB templates from registry.

**Response:**
```json
{
  "success": true,
  "count": 25,
  "templates": [
    {
      "name": "@commandoss/mint-nft",
      "description": "Mint a new NFT",
      "category": "nft",
      "isActive": true
    }
  ]
}
```

### Health Check

#### GET /health
System health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "SuiVisor Multi-User Wallet Backend",
  "network": "testnet",
  "agentAddress": "0x7c10a9b8fc5d...",
  "features": {
    "database": true,
    "agentWallet": true,
    "semanticSearch": true,
    "llmExtraction": true
  },
  "timestamp": 1737022800000
}
```

## Database Schema

### user_accounts
```sql
CREATE TABLE user_accounts (
  id SERIAL PRIMARY KEY,
  user_address TEXT UNIQUE NOT NULL,           -- agent1q...
  deposit_address TEXT UNIQUE NOT NULL,        -- 0xabcd... (derived)
  balance NUMERIC(20, 9) DEFAULT 0,            -- Current balance
  balance_last_updated TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### user_nfts
```sql
CREATE TABLE user_nfts (
  id SERIAL PRIMARY KEY,
  user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
  nft_object_id TEXT UNIQUE NOT NULL,          -- 0x8f3e...
  nft_type TEXT,
  name TEXT,
  description TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'owned',                  -- owned, transferred, burned
  mint_tx_digest TEXT NOT NULL,
  transfer_tx_digest TEXT,
  recipient_address TEXT,
  minted_at TIMESTAMP DEFAULT NOW(),
  transferred_at TIMESTAMP,

  INDEX idx_user_nfts_user (user_address),
  INDEX idx_user_nfts_status (status)
);
```

### user_transactions
```sql
CREATE TABLE user_transactions (
  id SERIAL PRIMARY KEY,
  user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
  tx_hash TEXT NOT NULL,
  tx_type TEXT NOT NULL,                        -- deposit, swap, mint_nft, transfer_nft
  amount NUMERIC(20, 9),
  status TEXT DEFAULT 'pending',                -- pending, success, failed
  metadata JSONB,
  timestamp TIMESTAMP DEFAULT NOW(),

  INDEX idx_user_txs_user (user_address),
  INDEX idx_user_txs_type (tx_type)
);
```

### ptb_registry
```sql
CREATE TABLE ptb_registry (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,                    -- @commandoss/mint-nft
  description TEXT,
  category TEXT,                                -- defi, nft, governance
  "typescriptCode" TEXT NOT NULL,               -- Executable template code
  "inputSchema" JSONB NOT NULL,                 -- Expected parameters
  embedding JSONB,                              -- Vector for semantic search
  tags TEXT[],
  "supportingTools" JSONB,                      -- Required helper tools
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW()
);
```

## Environment Variables

Required in `../.env`:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/database?sslmode=require

# Sui Network
SUI_NETWORK=testnet
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
AGENT_PRIVATE_KEY=suiprivkey1q...    # Agent wallet private key

# AI Services (for PTB system)
ANTHROPIC_API_KEY=sk-ant-...         # Claude for parameter extraction
VOYAGE_API_KEY=pa-...                 # Voyage AI for embeddings

# Server
BACKEND_URL=http://localhost:3000
BACKEND_PORT=3000
NODE_ENV=development
```

## Project Structure

```
backend/
├── server.ts                         # Express API server
├── lib/
│   ├── services/
│   │   ├── sui-client.ts             # Sui blockchain client
│   │   ├── sui-signer.ts             # Transaction signing with agent wallet
│   │   ├── ptb-service.ts            # Semantic search for templates
│   │   ├── ptb-transaction-builder.ts # Dynamic PTB execution
│   │   └── embeddings.ts             # Voyage AI embeddings
│   ├── tools/
│   │   ├── create-ptb-transaction.ts # PTB orchestrator
│   │   ├── cetus-pool-discovery.ts   # DEX pool discovery
│   │   ├── coin-info-discovery.ts    # Token metadata
│   │   └── get-sui-wallet-*.ts       # Wallet query tools
│   └── helpers/
│       └── deposit-address.ts        # Deterministic address derivation
├── db/
│   ├── drizzle-client.ts             # Drizzle ORM client
│   ├── drizzle-schema.ts             # Database schema definitions
│   └── migrations/                   # Schema migration scripts
└── tests/
    ├── test-all-endpoints.ts         # Comprehensive endpoint tests
    ├── test-nft-flow.ts              # NFT lifecycle test
    └── test-swap.ts                  # Swap functionality test
```

## Testing

### Run All Tests

```bash
# Run comprehensive test suite (11 tests)
npm run test:all

# Test specific flows
npm run test:nft
npm run test:swap
```

### Test Results

All 11 endpoint tests passing:
```
✅ Health check
✅ Get user balance (new user)
✅ Get user balance (existing user)
✅ List templates
✅ Get template by name
✅ Swap SUI → USDC
✅ Mint NFT
✅ Get user's owned NFTs
✅ Transfer NFT
✅ Verify NFT marked as transferred
✅ Get transaction history
```

NFT flow test (5 steps):
```
✅ Step 1: Mint NFT and record in database
✅ Step 2: Verify ownership in database
✅ Step 3: Transfer NFT on-chain
✅ Step 4: Mark as transferred in database
✅ Step 5: Remove from owned list
```

## Integration with Fetch.ai Agents

### Python Agent Example

```python
import httpx
from uagents import Agent, Context

wallet_agent = Agent(name="wallet_agent", seed="your_seed")

@wallet_agent.on_message(model=SwapRequest)
async def handle_swap(ctx: Context, sender: str, msg: SwapRequest):
    """Execute token swap for user"""

    response = await httpx.post(
        "http://localhost:3000/api/swap",
        json={
            "userAddress": sender,  # agent1q...
            "fromCoin": msg.from_coin,
            "toCoin": msg.to_coin,
            "amount": msg.amount,
            "slippage": 0.01
        },
        timeout=30.0
    )

    data = response.json()

    if data["success"]:
        await ctx.send(
            sender,
            SwapResponse(
                tx_hash=data["transactionHash"],
                explorer_url=data["explorerUrl"]
            )
        )
```

## How It Works

### 1. User Deposits

```
User sends 100 SUI → deposit_address (0xabcd...)
  ↓
Backend detects deposit via polling
  ↓
Sweep transaction: deposit_address → agent_wallet
  ↓
Database updated: user_accounts.balance += 100 SUI
```

### 2. User Requests Swap

```
Agent receives message: "swap 10 SUI to USDC"
  ↓
Agent calls: POST /api/swap
  ↓
Backend checks: user has ≥10 SUI balance
  ↓
Backend executes: agent_wallet performs swap on Cetus
  ↓
Database updated: user_accounts.balance -= 10 SUI, += USDC
  ↓
Transaction hash returned to agent
```

### 3. User Mints NFT

```
Agent receives message: "mint NFT called 'My Art'"
  ↓
Agent calls: POST /api/mint-nft
  ↓
Backend executes: agent_wallet mints NFT
  ↓
NFT created on-chain, owned by agent_wallet
  ↓
Database records: user_nfts.user_address = sender
  ↓
User "owns" NFT in database, can transfer anytime
```

## Performance

- **User Balance Query**: ~50-100ms (database)
- **Swap Execution**: ~2-3s (on-chain tx + confirmation)
- **NFT Minting**: ~2-3s (on-chain tx + confirmation)
- **Semantic Search**: ~100-200ms (with embedding cache)
- **LLM Extraction**: ~300-500ms (Claude API)

## Security Considerations

### ✅ Implemented
- Input validation on all endpoints
- SQL injection protection (parameterized queries via Drizzle)
- Balance verification before transactions
- NFT ownership verification before transfers
- Transaction atomicity with database transactions

### ⚠️ Production Requirements
- **API Authentication**: Add JWT/API key authentication
- **Rate Limiting**: Prevent abuse of expensive operations
- **Private Key Management**: Use secure key storage (AWS KMS, HashiCorp Vault)
- **Database Encryption**: Encrypt sensitive data at rest
- **Audit Logging**: Log all financial operations
- **Withdrawal Limits**: Implement daily/hourly withdrawal caps

## Deployment

### Recommended Stack
- **Hosting**: Railway, Render, Fly.io, or AWS ECS
- **Database**: Neon, Supabase, or AWS RDS (PostgreSQL)
- **Monitoring**: Sentry for errors, Datadog for metrics
- **Secrets**: Environment variables via platform

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Use `SUI_NETWORK=mainnet` for mainnet
- [ ] Enable API authentication
- [ ] Configure rate limiting
- [ ] Set up error monitoring (Sentry)
- [ ] Enable database backups
- [ ] Implement withdrawal limits
- [ ] Set up alerting for low agent wallet balance
- [ ] Review and restrict CORS origins

## Troubleshooting

### Error: "Insufficient balance"
- Check user's balance: `GET /api/user/balance`
- Verify deposits have been swept to agent wallet
- Check agent wallet has funds for gas

### Error: "NFT not found or not owned"
- Query user's NFTs: `GET /api/user/nfts?userAddress=...`
- Verify NFT hasn't been transferred already
- Check NFT status in database

### Error: "Pool not found"
- Verify token symbols are correct (case-sensitive)
- Check Cetus pool exists for token pair on current network
- Try with common pairs first (SUI/USDC)

### Error: "Database connection failed"
- Verify `DATABASE_URL` is set correctly
- Check database is accessible from server
- Ensure SSL mode matches database requirements

## Future Enhancements

- [ ] Support for more DEXs (Turbos, Aftermath)
- [ ] Staking integration
- [ ] Multi-token swaps (A → B → C)
- [ ] NFT marketplace integration
- [ ] Push notifications for deposits
- [ ] Webhook support for transaction status
- [ ] Multi-signature withdrawals for large amounts
- [ ] Support for Sui Kiosk standard

## Support

For questions, issues, or contributions:

- **Email**: ngocanh30075@gmail.com
- **GitHub**: https://github.com/ngna3007

## License

MIT
