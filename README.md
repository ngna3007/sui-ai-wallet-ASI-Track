# 🤖 Sui AI Assistant: An Autonomous Agent for Natural Language Interaction with the Sui Blockchain

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)
![uAgents](https://img.shields.io/badge/uAgents-Framework-00D4AA.svg)
![Sui](https://img.shields.io/badge/Sui-Blockchain-4DA2FF.svg)
![ASI Alliance](https://img.shields.io/badge/ASI-Alliance-0056FF.svg)

---

## 🌟 Agent Information

### **Primary Agent (Agentverse)**
- **Agent Name:** `Sui AI Assistant`
- **Agent Address:** `agent1qv2almrdfrwh45dnwuz0cfsgpkv7kht5ngy7r53c847xsw77q07ez5y00su`
- **URL:** https://agentverse.ai/agents/details/agent1qv2almrdfrwh45dnwuz0cfsgpkv7kht5ngy7r53c847xsw77q07ez5y00su/profile
- **Network:** Sui Testnet
- **Backend:** Render-hosted TypeScript backend
- **ASI:One Compatible:** ✅ Yes
- **Chat Protocol:** ✅ Enabled
- **Real Transactions:** ✅ Live on testnet

### **How to Interact**
1. Open [ASI:One](https://asi.one) or [Agentverse](https://agentverse.ai)
2. Send message to agent address
3. Try commands:
   - "Check my balance"
   - "Swap 10 SUI to USDC"
   - "Mint NFT called 'My Art'"
   - "Transfer NFT [object_id] to [address]"

---

## 🎯 Overview

**Sui AI Assistant** is a production-ready multi-user custodial wallet system that enables Fetch.ai agents to execute real blockchain transactions on Sui. Built for the ASI Alliance Hackathon, it bridges AI agent communication with DeFi operations through a hybrid architecture.

### What Makes Sui AI Assistant Special?

- **🔐 Hybrid Architecture**: Each agent gets unique deposit address (non-custodial tracking), agent wallet executes transactions (custodial)
- **💱 Real DeFi Operations**: Live token swaps via Cetus DEX, NFT minting/transfers on Sui testnet
- **🤖 AI-Powered**: Natural language processing with Claude, semantic PTB template matching
- **⚡ Gas Abstraction**: Agent wallet pays all gas fees
- **🛡️ Database-Tracked Ownership**: PostgreSQL tracks deposit addresses and NFT ownership (balances read from blockchain)
- **📦 PTB Registry**: Extensible template library for programmable transactions

### Key Capabilities

✅ **Transfer token** - Transfer tokens to any valid wallet address (now only SUI)

✅ **Token Swaps** - Cetus DEX with MeTTa knowledge graph for automatic address discovery

✅ **NFT Management** - Mint custom NFTs, transfer with ownership verification

✅ **Balance Tracking** - Blockchain balance queries for deposit addresses (no sweep, no DB balance)

✅ **Transaction History** - Complete audit trail per user

✅ **Semantic Search** - AI-powered transaction template matching

✅ **Natural Language** - Chat with agents in plain English

✅ **ASI Alliance Tech** - Fetch.ai uAgents + SingularityNET MeTTa + ASI1 AI

---

## 🏗️ Architecture

### Multi-User Wallet System (Option 3 Hybrid)

Sui AI Assistant implements a hybrid custodial architecture optimized for AI agents:

```
┌─────────────────────────────────────────────────────────────┐
│ User (Fetch.ai Agent)                                       │
│ Address: agent1qw3k5l2m8p9r7s6t4u5v6...                     │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ User's Deposit Address (Deterministic)               │   │
│ │ 0xabcd1234... (derived from agent address)           │   │
│ │ - Receives deposits from external sources            │   │
│ │ - Funds STAY HERE (not swept)                        │   │
│ │ - Balance read from blockchain on demand             │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ balance queries (no sweep!)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent Wallet (Custodial)                                    │
│ 0x7c10a9b8fc5d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2   │
│                                                              │
│ - Holds AGENT'S OWN assets on-chain                         │
│ - Executes transactions for all users                       │
│ - Pays gas fees                                             │
│ - Managed by backend service                                │
│ - ⚠️ Note: Currently NOT funded by user deposits            │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ transactions recorded in DB
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Database (PostgreSQL - Neon)                                │
│                                                              │
│ user_accounts:                                              │
│   - agent1qw3k... → depositAddress: 0xabcd...               │
│   - agent1qx5n... → depositAddress: 0xdef4...               │
│                                                              │
│ user_nfts:                                                  │
│   - agent1qw3k... → NFT_123 (status: owned)                 │
│   - agent1qx5n... → NFT_456 (status: transferred)           │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

**1. User Gets Deposit Address (Non-Custodial Setup)**
```
User: "what's my deposit address?"
  ↓
Agent → Backend: GET /api/user/info?userAddress=agent1q...
  ↓
Backend creates unique deposit address (derived from user address)
  ↓
Database: user_accounts stores (user_address, deposit_address, seed)
  ↓
Returns: "Your deposit address is 0xabcd..."
```

**2. User Deposits Funds**
```
User sends 100 SUI → deposit_address (0xabcd...) externally
  ↓
User: "check balance"
  ↓
Agent → Backend: GET /api/balance?address=0xabcd...
  ↓
Backend reads balance DIRECTLY from Sui blockchain (no sweep, no DB balance)
  ↓
Database: deposit_transactions records detection (audit only)
  ↓
Returns: "You have 100 SUI" (funds stay in deposit_address)
```

**3. User Requests Swap (Agent Wallet Execution)**
```
Agent message: "swap 10 SUI to USDC"
  ↓
Python Agent → Knowledge Graph: Get token addresses & DEX config
  ↓
Python Agent → Backend: POST /api/swap
{userAddress, fromToken, toToken, amount, tokenAddresses...}
  ↓
Backend uses AGENT WALLET (not user's deposit address)
  ↓
Agent wallet executes swap on Cetus DEX
  ↓
Database: user_transactions records transaction (audit trail)
  ↓
Returns: transaction hash & explorer URL
```
**⚠️ Note:** Current implementation uses agent wallet as custodian for swaps, NOT user's deposit address.

**4. User Mints NFT (Agent Wallet Execution)**
```
Agent message: "mint NFT 'My Art'"
  ↓
Python Agent → Backend: POST /api/mint-nft
{userAddress, name, description, imageUrl}
  ↓
Backend ensures user exists (calls getOrCreateUser)
  ↓
Agent wallet mints NFT using PTB template
  ↓
NFT owned by agent_wallet on-chain (custodial)
  ↓
Database: user_nfts records ownership mapping
{userAddress, nftObjectId, status: 'owned'}
  ↓
Returns: NFT object ID & transaction hash
```
**⚠️ Note:** NFT is minted by agent wallet. Database tracks logical ownership.

### Three Wallet Types

1. **User's Fetch.ai Address** (`agent1q...`)
   - User's identity in ASI ecosystem
   - Never needs private key

2. **User's Deposit Address** (`0xabcd...`)
   - Deterministically derived from agent address
   - Receives external deposits
   - **Funds stay here** (NOT swept - balance read from blockchain)
   - Currently used ONLY for balance checks

3. **Agent's Custodial Wallet** (`0x7c10...`)
   - Single wallet executing all transactions (swaps, NFT mints, etc.)
   - Holds agent's own assets on-chain
   - Pays all gas fees
   - **Current limitation**: User deposits don't fund operations (agent wallet acts independently)

---

## 🚀 Features

### ✅ Core Wallet Operations
- **Multi-User Management**: Isolated deposit addresses per agent
- **Deterministic Addresses**: Each agent gets unique deposit address
- **Blockchain Balance Reading**: Direct on-chain balance queries (no sweep)
- **Transaction History**: Complete audit trail per user
- **⚠️ Current Architecture**: Operations execute via agent wallet (custodial), not deposit addresses

### ✅ DeFi Capabilities
- **Token Swaps**: Cetus DEX with automatic pool discovery
- **Slippage Control**: Configurable slippage tolerance
- **Multi-Token Support**: SUI, USDC, and more
- **NFT Minting**: Custom NFTs with metadata
- **NFT Transfers**: Verified ownership transfers
- **Gas Abstraction**: Zero gas costs for users

### ✅ AI Integration
- **Semantic Search**: Vector embeddings (Voyage AI) for PTB template matching
- **LLM Extraction**: Claude-powered parameter extraction from natural language
- **PTB Registry**: Extensible template library
- **Natural Language**: Plain English commands
- **Context Awareness**: Maintains conversation state

### ✅ MeTTa-Inspired Knowledge Graph (ASI Alliance Tech)
- **Purpose**: Demonstrates SingularityNET's MeTTa approach to AI reasoning
- **Architecture**: Triple-store pattern (subject, predicate, object) with semantic queries
- **What it provides**:
  - Real Sui testnet token addresses (SUI, USDC, USDT, WAL, CETUS)
  - Token decimals for accurate calculations (9 for SUI, 6 for stablecoins)
  - DEX routing recommendations (Cetus)
  - Global configuration for Programmable Transaction Blocks
  - Pool discovery parameters for swap execution
- **Integration**: Agent queries knowledge graph before calling backend swap API
- **Benefit**: Enables swap operations without hardcoding blockchain addresses
- **Proven Working**: Successfully executed SUI→USDC swap (tx: `HWS5PzEBdBPTCiogaAr7ZZsopL5BTdmaDjtJDRPzWnAX`)
- **Extensible**: Add new tokens by editing `knowledge/metta_kg.py` (see docs below)

---

## 📊 Tech Stack

### Backend (TypeScript)
- **Runtime**: Node.js with Express
- **Blockchain**: Sui SDK (@mysten/sui)
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **AI Services**:
  - Anthropic Claude (parameter extraction)
  - Voyage AI (semantic embeddings)
- **DeFi**: Cetus SDK for DEX operations
- **Deployment**: Railway (backend), Neon (database)

### Agent (Python)
- **Framework**: Fetch.ai uAgents
- **AI Model**: ASI1 Mini (OpenAI-compatible API)
- **Knowledge Graph**: MeTTa-inspired triple-store for blockchain parameter discovery
- **Communication**: HTTPS to backend API
- **Platform**: Agentverse (hosted agents)
- **Integration**: ASI:One chat interface

### Infrastructure
- **Database**: Neon PostgreSQL (serverless)
- **Hosting**: Railway (auto-deploy from GitHub)
- **Network**: Sui Testnet
- **Monitoring**: Health checks, error logging

---

## 🛠️ Project Structure

```
Sui AI Assistant/
├── backend/                          # TypeScript backend service
│   ├── server.ts                     # Express API server
│   ├── lib/
│   │   ├── services/
│   │   │   ├── sui-client.ts         # Sui blockchain client
│   │   │   ├── sui-signer.ts         # Transaction signing
│   │   │   ├── ptb-service.ts        # Semantic search
│   │   │   └── embeddings.ts         # Voyage AI embeddings
│   │   ├── tools/
│   │   │   ├── cetus-pool-discovery.ts (plan)
│   │   │   ├── coin-info-discovery.ts (plan)  - For complex ops where need fetched data for params
│   │   │   └── get-sui-wallet-*.ts (plan)
│   │   └── helpers/
│   │       └── deposit-address.ts    # Address derivation
│   ├── db/
│   │   ├── drizzle-client.ts
│   │   ├── drizzle-schema.ts         # Database schema
│   │   └── migrations/
│   └── tests/
│       ├── test-all-endpoints.ts     # 11 endpoint tests
│       ├── test-nft-flow.ts          # NFT lifecycle
│       └── test-swap.ts              # Swap functionality
│
├── agent/                            # Python Fetch.ai agent
│   ├── agent_agentverse.py           # Main agent (Agentverse compatible)
│   └── knowledge/
│       └── metta_kg.py               # MeTTa-inspired knowledge graph
│
└── README.md                         # This file
```

## 💾 Database Schema

### `user_accounts`
- `user_address` (agent1q...) - Fetch.ai agent address
- `deposit_address` (0x...) - Derived Sui address
- `balance` - Current SUI balance
- `balance_last_updated` - Last sweep timestamp

### `user_nfts`
- `user_address` - Owner's agent address
- `nft_object_id` - Sui NFT object ID
- `status` - owned | transferred | burned
- `mint_tx_digest` - Minting transaction
- `transfer_tx_digest` - Transfer transaction (if any)
- `recipient_address` - Transfer recipient (if any)

### `user_transactions`
- `user_address` - Transaction initiator
- `tx_hash` - Sui transaction hash
- `tx_type` - deposit | swap | mint_nft | transfer_nft
- `amount` - Transaction amount (if applicable)
- `status` - pending | success | failed

### `ptb_registry`
- `name` - Template identifier (@commandoss/mint-nft)
- `typescriptCode` - Executable PTB code
- `inputSchema` - Required parameters (JSON schema)
- `embedding` - Vector embedding for semantic search
- `supportingTools` - Required helper functions

---

## 🧠 MeTTa Knowledge Graph Integration

### Overview

The MeTTa-inspired knowledge graph is a core component demonstrating ASI Alliance technology integration. It implements SingularityNET's MeTTa concepts for AI reasoning, providing blockchain parameter discovery without hardcoding addresses.

### Architecture

**Triple-Store Pattern**: Knowledge is represented as (subject, predicate, object) tuples:

```python
# Example triples from knowledge/metta_kg.py:
("SUI", "coin_type", "0x2::sui::SUI")
("SUI", "decimals", "9")
("USDC", "coin_type", "0x0588cff9a50e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC")
("USDC", "decimals", "6")
("Cetus", "supports_pair", "SUI/USDC")
("Cetus", "liquidity_SUI/USDC", "high")
```

**Semantic Queries**: Pattern matching with wildcards for knowledge retrieval:

```python
# Query all facts about SUI
kg.query("SUI", None, None)

# Query all DEXes supporting SUI/USDC
kg.query(None, "supports_pair", "SUI/USDC")

# Get SUI's decimals
kg.get_property("SUI", "decimals")  # Returns "9"
```

**Reasoning Engine**: Infers best DEX for token pairs based on liquidity and risk:

```python
# Infer best DEX for SUI → USDC
kg.infer_best_dex("SUI", "USDC")  # Returns "Cetus" with reasoning
```

### Query Functions

```python
from knowledge.metta_kg import query_knowledge

# Get complete coin information
coin_info = query_knowledge("coin_info", coin_symbol="SUI")
# Returns: {
#     "symbol": "SUI",
#     "address": "0x2::sui::SUI",
#     "coinType": "0x2::sui::SUI",
#     "decimals": 9
# }

# Get complete swap parameters
swap_params = query_knowledge("swap_params", coin_in="SUI", coin_out="USDC")
# Returns: {
#     "tokenFrom": {...},  # SUI info
#     "tokenTo": {...},    # USDC info
#     "dex": "Cetus",
#     "globalConfig": "0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e",
#     "network": "testnet"
# }

# Get gas estimate
gas_estimate = query_knowledge("gas_estimate", operation="swap")
# Returns: "0.01" (SUI)
```

### Integration Flow

1. **User Request**: "swap 0.01 SUI to USDC"
2. **LLM Extraction**: Agent extracts from_token="SUI", to_token="USDC", amount=0.01
3. **Knowledge Graph Query**: `query_knowledge("swap_params", coin_in="SUI", coin_out="USDC")`
4. **KG Response**: Returns SUI address, USDC address, decimals, Cetus config
5. **Payload Enhancement**: Agent adds KG data to backend API request
6. **Backend Processing**: Uses addresses for pool discovery and transaction building
7. **Transaction Execution**: Swap executed on-chain with correct parameters
8. **Digest Returned**: Transaction hash sent back to user

### Supported Tokens

Current testnet tokens in knowledge graph:

| Token  | Address | Decimals | Testnet |
|--------|---------|----------|---------|
| SUI    | `0x2::sui::SUI` | 9 | ✅ |
| USDC   | `0x0588cff9...::usdc::USDC` | 6 | ✅ |
| USDT   | `0x50b3637d...::usdt::USDT` | 6 | ✅ |
| WAL    | `0x8270feb7...::wal::WAL` | 9 | ✅ |
| CETUS  | `0xa6f859be...::cetus::CETUS` | 9 | ✅ |

**Tested Pairs**:
- ✅ SUI ↔ USDC (proven working, high liquidity)
- ✅ SUI ↔ USDT (high liquidity)
- ✅ SUI ↔ CETUS (medium liquidity)
- ⚠️ SUI ↔ WAL (low liquidity, may fail)

### Adding New Tokens

To add support for a new token, edit `knowledge/metta_kg.py`:

```python
# Step 1: Add token definition
("NEWTOKEN", "coin_type", "0xADDRESS::module::TYPE"),
("NEWTOKEN", "decimals", "9"),
("NEWTOKEN", "address", "0xADDRESS::module::TYPE"),
("NEWTOKEN", "is_type", "coin"),

# Step 2: Add Cetus support
("Cetus", "supports_token", "NEWTOKEN"),
("Cetus", "supports_pair", "SUI/NEWTOKEN"),
("Cetus", "liquidity_SUI/NEWTOKEN", "medium"),

# Step 3: Test the swap
python test_sui_newtoken_swap.py
```

### Swap Limitations

Users should be aware of these constraints:

- **Token Support**: Limited to 5 tokens (extensible)
- **Pool Availability**: Token pair must have active pool on Cetus testnet
- **Liquidity**: Low liquidity pools may fail with MoveAbort errors
- **Minimum Amount**: Small amounts (< 0.001 SUI) may fail; recommend 0.01+ SUI
- **Best Pairs**: SUI↔USDC and SUI↔USDT have highest success rate

The agent's system prompt includes these warnings and will guide users to working pairs if swaps fail.

### Testing

```bash
# Check supported tokens
python check_supported_tokens.py

# Test SUI → USDC swap (proven working)
python test_sui_usdc_swap.py

# Test knowledge graph queries
python test_enhanced_kg.py

# Test swap payload generation
python test_swap_payload.py

# Full end-to-end test (requires funded wallet)
python test_real_swap_e2e.py
```

### Proven Results

**Live Testnet Transaction**:
- Swap: 0.01 SUI → USDC
- Transaction Digest: `HWS5PzEBdBPTCiogaAr7ZZsopL5BTdmaDjtJDRPzWnAX`
- Explorer: https://suiscan.xyz/testnet/tx/HWS5PzEBdBPTCiogaAr7ZZsopL5BTdmaDjtJDRPzWnAX
- Status: ✅ Success

This demonstrates the knowledge graph successfully providing real blockchain parameters for production swap execution.

---

## 🧪 Testing

### Comprehensive Test Suite (11/11 Passing)

```bash
cd backend
npm run test:all
```

**Test Coverage:**
✅ Health check
✅ Get user balance (new user)
✅ Get user balance (existing)
✅ List templates
✅ Get template by name
✅ Swap SUI → USDC
✅ Mint NFT
✅ Get user's owned NFTs
✅ Transfer NFT
✅ Verify NFT marked as transferred
✅ Get transaction history

### NFT Flow Test (5 Steps)
```bash
npm run test:nft
```

✅ Step 1: Mint NFT and record in database
✅ Step 2: Verify ownership in database
✅ Step 3: Transfer NFT on-chain
✅ Step 4: Mark as transferred in database
✅ Step 5: Remove from owned list

### Swap Test
```bash
npm run test:swap
```

Validates Cetus pool discovery and swap execution.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL database (Neon recommended)
- Sui wallet with testnet SUI

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials:
# - DATABASE_URL (PostgreSQL)
# - AGENT_PRIVATE_KEY (Sui wallet)
# - ANTHROPIC_API_KEY
# - VOYAGE_API_KEY

# Run migrations
npm run db:push

# Start development server
npm run dev

# Server runs on http://localhost:3000
```

### Agent Setup

```bash
cd agent

# Install dependencies
pip install uagents httpx

# Configure agent
export BACKEND_URL="http://localhost:3000"

# Run agent locally
python main.py

# Or deploy to Agentverse
# 1. Go to agentverse.ai
# 2. Create new agent
# 3. Upload main.py
# 4. Set environment variables
# 5. Deploy
```

### Testing

```bash
# Run all tests
npm run test:all

# Test specific flows
npm run test:nft
npm run test:swap
```

---

## 📖 Environment Variables

Required in `backend/.env`:

```bash
# Database
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Sui Network
SUI_NETWORK=testnet
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
AGENT_PRIVATE_KEY=suiprivkey1q...

# AI Services
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...

# Server
BACKEND_URL=http://localhost:3000
BACKEND_PORT=3000
NODE_ENV=development
```

---

## 📈 Performance

- **Balance Query**: ~50-100ms (database lookup)
- **Swap Execution**: ~2-3s (on-chain transaction + confirmation)
- **NFT Minting**: ~2-3s (on-chain transaction)
- **Semantic Search**: ~100-200ms (with embedding cache)
- **LLM Extraction**: ~300-500ms (Claude API call)
- **Total Request**: ~450-1000ms (excluding blockchain confirmation)

---

## 🔐 Security

### ✅ Implemented
- Input validation on all endpoints
- SQL injection protection (parameterized queries)
- Balance verification before transactions
- NFT ownership verification before transfers
- Transaction atomicity with database transactions
- Error handling and logging

### ⚠️ Production Requirements
- **API Authentication**: JWT or API key authentication
- **Rate Limiting**: Prevent abuse of expensive operations
- **Key Management**: Use AWS KMS or HashiCorp Vault
- **Database Encryption**: Encrypt sensitive data at rest
- **Audit Logging**: Log all financial operations
- **Withdrawal Limits**: Daily/hourly caps
- **Multi-Sig**: For large withdrawals
- **Monitoring**: Real-time alerts for suspicious activity

---

## 🚢 Deployment

### Current Setup
- **Backend**: Railway (auto-deploy from GitHub)
- **Database**: Neon PostgreSQL (serverless)
- **Agent**: Agentverse (hosted with mailbox)
- **Network**: Sui Testnet
- **Status**: ✅ All tests passing (8/8 local tests)

## 🔮 Future Enhancements

- [ ] Support for more DEXs (Turbos, Aftermath)
- [ ] Staking integration (native SUI staking)
- [ ] Multi-token swaps (A → B → C routing)
- [ ] NFT marketplace integration (Tradeport, Clutchy)
- [ ] Push notifications for deposits
- [ ] Webhook support for transaction status
- [ ] Multi-signature withdrawals for security
- [ ] Sui Kiosk standard support
- [ ] Batch transaction optimization
- [ ] DCA (Dollar Cost Averaging) strategies
- [ ] Portfolio analytics dashboard
- [ ] Multi-chain support (expand beyond Sui)

---

## 📚 Resources

### Documentation
- [Sui Documentation](https://docs.sui.io)
- [Fetch.ai uAgents](https://fetch.ai/docs)
- [Cetus DEX Docs](https://docs.cetus.zone)
- [Agentverse](https://agentverse.ai/docs)

### Tools
- [Sui Explorer (Testnet)](https://suiscan.xyz/testnet)
- [Sui Wallet](https://chrome.google.com/webstore/detail/sui-wallet)
- [ASI:One Chat](https://asi.one)
- [Neon Database](https://neon.tech)
- [Railway](https://railway.app)

### Community
- [Sui Discord](https://discord.gg/sui)
- [Fetch.ai Discord](https://discord.gg/fetchai)
- [GitHub Issues](https://github.com/ngna3007)

---

## 👥 Support

For questions, issues, or contributions:

- **Email**: ngocanh30075@gmail.com
- **GitHub**: https://github.com/ngna3007

---

## 📝 License

MIT License - see LICENSE file for details

---

## 🏆 Hackathon Submission

**Built for**: ASI Alliance Hackathon
**Track**: Innovation Lab / DeFi
**Category**: AI Agents × Blockchain Integration

**Key Innovations:**
1. **Multi-User Custodial Architecture** - Novel approach for agent wallets with deterministic deposit addresses
2. **MeTTa Knowledge Graph Integration** - SingularityNET's MeTTa concepts for blockchain parameter discovery
3. **Semantic PTB Registry** - AI-powered transaction template matching with vector embeddings
4. **Gas Abstraction** - Zero friction for AI agent users
5. **ASI Alliance Tech Stack** - Fetch.ai uAgents + MeTTa reasoning + ASI1 AI model
6. **Production Ready** - Live testnet with proven swap execution (tx: HWS5Pz...)

**Live Demo:**
- Agent Address: `agent1qfn954mwxwcr54g0qdd3f3gypxfhc2kqdqj5pkjx22zpcutr2p7sqzdj2rm`
- Interact via ASI:One or Agentverse
- Backend: Railway-hosted with Neon PostgreSQL
- All 11 tests passing, NFT flow validated

---

**Built with 💙 for ASI Alliance Hackathon**
