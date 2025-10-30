"""
Sui AI Assistant - Single Agent for Agentverse

This is a standalone agent that handles ALL DeFi operations internally.
- Uses Anthropic Claude for intent parsing
- Makes direct API calls to backend (no sub-agents)
- No Bureau (Agentverse doesn't support it)
- Compatible with ASI:One chat interface

Upload this as 'agent.py' in Agentverse.
"""
import os
import re
import json
import httpx
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from uuid import uuid4

from openai import OpenAI
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    chat_protocol_spec,
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
)

# Load environment variables for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not available in Agentverse, env vars come from secrets

# ============================================================================
# CONFIGURATION
# ============================================================================

AGENT_NAME = "suivisor"
AGENT_SEED = os.getenv("SUIVISOR_SEED", "suivisor_secret_seed_phrase_change_in_production")
AGENT_PORT = int(os.getenv("SUIVISOR_PORT", "8000"))
AGENT_MAILBOX = os.getenv("SUIVISOR_MAILBOX", None)
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
BACKEND_API_KEY = os.getenv("BACKEND_API_KEY")  # API key for backend authentication
CMC_API_KEY = os.getenv("COINMARKETCAP_API_KEY")
ASI_ONE_API_KEY = os.getenv("ASI_ONE_API_KEY")  # ASI1 API key
X_BEARER_TOKEN = os.getenv("X_BEARER_TOKEN")  # Twitter/X Bearer token for API v2 (optional)

# ASI1 client (OpenAI-compatible)
ai_client = OpenAI(
    api_key=ASI_ONE_API_KEY,
    base_url="https://api.asi1.ai/v1"
) if ASI_ONE_API_KEY else None

# Use asi1-mini model (128K context, ideal for everyday agent workflows)
AI_MODEL = "asi1-mini"

# Helper function to get headers with API key
def get_backend_headers():
    """Get headers with API key for backend requests"""
    headers = {"Content-Type": "application/json"}
    if BACKEND_API_KEY:
        headers["X-API-Key"] = BACKEND_API_KEY
    return headers

# ============================================================================
# X API CACHING (for free tier: 1 request per 15 minutes)
# ============================================================================

# In-memory cache for X API responses
# Structure: {query: {"data": response_data, "timestamp": datetime}}
X_API_CACHE = {}
CACHE_TTL_SECONDS = 900  # 15 minutes

def get_cached_news(query: str) -> Optional[dict]:
    """Get cached news data if available and not expired"""
    if query not in X_API_CACHE:
        return None

    cached = X_API_CACHE[query]
    cached_time = cached["timestamp"]
    age_seconds = (datetime.now(timezone.utc) - cached_time).total_seconds()

    if age_seconds < CACHE_TTL_SECONDS:
        return cached["data"]
    else:
        # Expired, remove from cache
        del X_API_CACHE[query]
        return None

def cache_news(query: str, data: dict):
    """Cache news data with current timestamp"""
    X_API_CACHE[query] = {
        "data": data,
        "timestamp": datetime.now(timezone.utc)
    }

# Create agent
agent = Agent(
    name=AGENT_NAME,
    seed=AGENT_SEED,
    port=AGENT_PORT,
    endpoint=[f"http://127.0.0.1:{AGENT_PORT}/submit"],
    mailbox=AGENT_MAILBOX,
)

# Chat protocol
chat_proto = Protocol(name="AgentChatProtocol", version="0.1.0", spec=chat_protocol_spec)

print(f"\n{'='*60}")
print(f"🤖 Sui AI Assistant")
print(f"{'='*60}")
print(f"Address: {agent.address}")
print(f"Port: {AGENT_PORT}")
print(f"Mailbox: {AGENT_MAILBOX or 'Local mode'}")
print(f"Backend: {BACKEND_URL}")
print(f"AI: {'ASI1 Mini' if ai_client else 'Regex fallback'}")
print(f"{'='*60}\n")

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def extract_text_from_chat(msg: ChatMessage) -> str:
    """Extract text content from ChatMessage"""
    for content in msg.content:
        if hasattr(content, 'text'):
            return content.text
    return ""

def create_text_chat(text: str, msg_id: Optional[str] = None) -> ChatMessage:
    """Create a text chat message"""
    return ChatMessage(
        msg_id=msg_id or str(uuid4()),
        timestamp=datetime.now(timezone.utc),
        content=[TextContent(text=text)]
    )

def create_acknowledgement(msg_id: str) -> ChatAcknowledgement:
    """Create acknowledgement message"""
    return ChatAcknowledgement(
        acknowledged_msg_id=msg_id,
        timestamp=datetime.now(timezone.utc).isoformat()
    )

# ============================================================================
# INTENT PARSING WITH LLM
# ============================================================================

def parse_intent_with_llm(query: str) -> dict:
    """Parse user intent using Anthropic Claude or regex fallback"""
    if not ai_client:
        return parse_intent_regex(query)

    try:
        response = ai_client.chat.completions.create(
            model=AI_MODEL,
            max_tokens=1024,
            messages=[
                {"role": "system", "content": """You are a conversational DeFi intent parser for Sui AI Assistant - a custodial wallet system.

CONTEXT: This is a custodial wallet. Each user has a unique deposit address. Users deposit SUI to that address, then use their balance for swaps, NFTs, etc.

Available actions:
- balance: Check wallet balance (shows user's deposited funds)
- deposit: Get unique deposit address (users need this to fund their account)
- swap: Exchange tokens (needs: amount, from_token, to_token) - uses deposited balance
- nft_mint: Create NFT (needs: nft_name, description, image_url) - uses deposited balance
- nft_list: View owned NFTs
- nft_transfer: Send NFT (needs: nft_id, recipient)
- price: Check token price (needs: token)
- news: Get crypto/DeFi news from X/Twitter (optional: query for specific topics)
- help: Show capabilities, answer "what can you do", general questions, greetings
- unknown: Unrecognizable intent

Conversational queries that should map to "help":
- Greetings: "hi", "hello", "hey", "greetings"
- Questions about capabilities: "can I ask", "what can you do", "are you able", "do you support"
- General questions about "how it works", "what is deposit address", etc.

Examples:
- "hi" → {"action": "help"}
- "what is deposit address" → {"action": "help"}
- "how does this work" → {"action": "help"}
- "check my balance" → {"action": "balance"}
- "deposit" or "how do I deposit" → {"action": "deposit"}
- "swap 10 SUI to USDC" → {"action": "swap", "parameters": {"amount": 10, "from_token": "SUI", "to_token": "USDC"}}
- "I want to mint nft" → {"action": "nft_mint", "parameters": {}}
- "mint nft 'Cool Art' with description 'My artwork' and image https://example.com/img.png" → {"action": "nft_mint", "parameters": {"nft_name": "Cool Art", "description": "My artwork", "image_url": "https://example.com/img.png"}}
- "crypto news" or "what's happening in DeFi" → {"action": "news", "parameters": {}}
- "news about SUI" → {"action": "news", "parameters": {"query": "SUI"}}

Respond ONLY with JSON:
{
  "action": "action_name",
  "parameters": {...},
  "confidence": 0.0-1.0
}"""},
                {"role": "user", "content": f"Parse this query: {query}"}
            ]
        )

        text = response.choices[0].message.content
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return {"action": "unknown", "parameters": {}, "confidence": 0.0}
    except Exception as e:
        print(f"⚠️ LLM parsing failed, using regex: {e}")
        return parse_intent_regex(query)

def parse_intent_regex(query: str) -> dict:
    """Fallback regex-based intent parsing"""
    query_lower = query.lower()
    intent = {"action": "unknown", "parameters": {}, "confidence": 0.8}

    # Conversational greetings and general questions map to "help"
    if any(word in query_lower for word in ["hi", "hello", "hey", "greetings"]):
        intent["action"] = "help"
    elif any(phrase in query_lower for phrase in ["can i ask", "can you", "are you able", "do you support", "what can you"]):
        intent["action"] = "help"
    elif any(word in query_lower for word in ["balance", "how much"]):
        intent["action"] = "balance"
    elif any(word in query_lower for word in ["deposit", "fund", "add money"]):
        intent["action"] = "deposit"
    elif any(word in query_lower for word in ["mint", "create nft"]):
        intent["action"] = "nft_mint"
        # Extract NFT name from quotes
        name_match = re.search(r'["\']([^"\']+)["\']', query)
        if name_match:
            intent["parameters"]["nft_name"] = name_match.group(1)
        # Extract description - look for patterns like "with description 'X'" or "description 'X'"
        desc_match = re.search(r'(?:with\s+)?description\s+["\']([^"\']+)["\']', query, re.IGNORECASE)
        if desc_match:
            intent["parameters"]["description"] = desc_match.group(1)
        # Extract image URL - look for http/https URLs
        url_match = re.search(r'(?:image\s+|url\s+)?(https?://[^\s]+)', query, re.IGNORECASE)
        if url_match:
            intent["parameters"]["image_url"] = url_match.group(1)
    elif any(word in query_lower for word in ["my nfts", "show nft", "list nft"]):
        intent["action"] = "nft_list"
    elif any(word in query_lower for word in ["transfer nft", "send nft"]):
        intent["action"] = "nft_transfer"
        addresses = re.findall(r'(0x[a-fA-F0-9]{40,64})', query)
        if len(addresses) >= 2:
            intent["parameters"]["nft_id"] = addresses[0]
            intent["parameters"]["recipient"] = addresses[1]
    elif any(word in query_lower for word in ["swap", "exchange", "trade"]):
        intent["action"] = "swap"
        amount_match = re.search(r'(\d+\.?\d*)\s*(sui|usdc|usdt)', query_lower)
        if amount_match:
            intent["parameters"]["amount"] = float(amount_match.group(1))
        tokens = re.findall(r'\b(sui|usdc|usdt)\b', query_lower)
        if len(tokens) >= 2:
            intent["parameters"]["from_token"] = tokens[0].upper()
            intent["parameters"]["to_token"] = tokens[1].upper()
    elif any(word in query_lower for word in ["price", "cost", "worth"]):
        intent["action"] = "price"
        tokens = re.findall(r'\b(sui|usdc|usdt|btc|eth)\b', query_lower)
        if tokens:
            intent["parameters"]["token"] = tokens[0].upper()
    elif "help" in query_lower:
        intent["action"] = "help"

    return intent

# ============================================================================
# LLM RESPONSE GENERATOR
# ============================================================================

def generate_natural_response(ctx: Context, user_query: str, action: str, result_data: dict) -> str:
    """Generate natural response using LLM based on action result"""

    if not ai_client:
        # Fallback without LLM - return simple formatted response
        if not result_data.get("success"):
            return f"❌ {result_data.get('error', 'An error occurred')}"
        return f"✅ Operation completed: {result_data.get('data', {})}"

    try:
        # Prepare context for LLM
        system_context = """You are Sui AI Assistant, a friendly AI assistant for a custodial Sui wallet.

Generate natural, conversational responses based on the operation result.

Guidelines:
- Be friendly and helpful
- Use emojis sparingly but appropriately
- Keep responses concise but informative
- **IMPORTANT: Use proper line breaks (\n\n) to separate paragraphs and make responses readable**
- **Format data clearly with line breaks between items**
- If there's an error, explain it clearly and suggest next steps
- For successful operations, confirm what happened and what the user can do next
- Match the tone of the user's query

FORMATTING RULES:
- Put each piece of information on a new line
- Use double newlines (\n\n) between sections
- For lists or multiple data points, put each on its own line
- Example: "Price: $2.71\n\n24h Change: +7.44%\n24h Volume: $859M\nMarket Cap: $9.84B"

SPECIAL: Multi-Operation Atomic Transactions
- If result has "mode": "multi-operation", this was an atomic transaction with multiple operations
- Celebrate the atomicity: "✅ Atomic transaction successful!"
- List what operations were executed (use "effects" or "operations" fields)
- Example: "✅ Atomic transaction successful! Executed 2 operations: transferred 0.1 SUI to 0x78df...b8ed and minted NFT 'cat'"
- Always show the transaction hash with explorer link

IMPORTANT CONTEXT:
- This is a custodial wallet system
- Users have unique deposit addresses
- Users must deposit SUI first before using swaps/NFTs
"""

        # Format result data as context
        result_context = f"""
User Query: "{user_query}"
Action: {action}
Result: {json.dumps(result_data, indent=2)}
"""

        response = ai_client.chat.completions.create(
            model=AI_MODEL,
            max_tokens=512,
            messages=[
                {"role": "system", "content": system_context},
                {"role": "user", "content": result_context}
            ]
        )

        return response.choices[0].message.content

    except Exception as e:
        ctx.logger.error(f"❌ LLM response generation failed: {e}")
        # Fallback
        if not result_data.get("success"):
            return f"❌ {result_data.get('error', 'An error occurred')}"
        return f"✅ Operation completed successfully"

# ============================================================================
# API HANDLERS (Return structured data)
# ============================================================================

async def handle_balance(ctx: Context, user_address: str) -> dict:
    """Get user balance - returns structured data (reads from blockchain)"""
    ctx.logger.info(f"💰 Fetching balance for {user_address[:12]}...")
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            # Get user's deposit address
            response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                params={"userAddress": user_address},
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Backend error (status {response.status_code}). The backend might be sleeping - please try again in a moment."
                }

            result = response.json()
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get('error', 'Unknown error')
                }

            user = result.get("user", {})
            deposit_address = user.get("depositAddress")

            if not deposit_address:
                return {
                    "success": False,
                    "error": "No deposit address found"
                }

            # Read balance directly from blockchain
            ctx.logger.info(f"🔍 Reading balance from blockchain: {deposit_address[:12]}...")
            balance_response = await client.get(
                f"{BACKEND_URL}/api/balance",
                params={"address": deposit_address},
                headers=get_backend_headers()
            )

            if balance_response.status_code == 200:
                balance_data = balance_response.json()
                ctx.logger.info("✅ Balance retrieved from blockchain")
                return {
                    "success": True,
                    "data": {
                        "balances": balance_data.get("balances", {}),
                        "depositAddress": deposit_address
                    }
                }
            else:
                return {
                    "success": False,
                    "error": "Failed to read blockchain balance"
                }

    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "Request timed out. The backend might be waking up - please try again in 30 seconds."
        }
    except Exception as e:
        ctx.logger.error(f"❌ Balance error: {e}")
        return {
            "success": False,
            "error": "Connection error. The backend might be sleeping - please try again in a moment."
        }

async def handle_deposit(ctx: Context, user_address: str) -> dict:
    """Get deposit address - returns structured data (with blockchain balance)"""
    ctx.logger.info(f"📍 Fetching deposit address...")
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            # Get user info (deposit address)
            response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                params={"userAddress": user_address},
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Backend error (status {response.status_code})"
                }

            result = response.json()
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get('error', 'Unknown error')
                }

            user = result.get("user", {})
            deposit_address = user.get("depositAddress")

            if not deposit_address:
                return {
                    "success": False,
                    "error": "No deposit address found"
                }

            # Read balance from blockchain
            ctx.logger.info(f"🔍 Reading balance from blockchain...")
            balance_response = await client.get(
                f"{BACKEND_URL}/api/balance",
                params={"address": deposit_address},
                headers=get_backend_headers()
            )

            balances = {}
            if balance_response.status_code == 200:
                balance_data = balance_response.json()
                balances = balance_data.get("balances", {})

            ctx.logger.info("✅ Deposit address retrieved")
            return {
                "success": True,
                "data": {
                    "depositAddress": deposit_address,
                    "currentBalance": balances
                }
            }
    except Exception as e:
        ctx.logger.error(f"❌ Deposit error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def handle_swap(ctx: Context, user_address: str, from_token: str, to_token: str, amount: float) -> dict:
    """Execute token swap - returns structured data"""
    ctx.logger.info(f"🔄 Swapping {amount} {from_token} → {to_token}")
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/swap",
                json={
                    "userAddress": user_address,
                    "fromCoin": from_token,
                    "toCoin": to_token,
                    "amount": amount,
                    "slippage": 0.01
                },
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Backend error (status {response.status_code}). The backend might be sleeping - please try again."
                }

            result = response.json()
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get('error', 'Unknown error')
                }

            ctx.logger.info("✅ Swap completed")
            return {
                "success": True,
                "data": {
                    "amount": amount,
                    "fromToken": from_token,
                    "toToken": to_token,
                    "transactionHash": result.get("transactionHash", "N/A"),
                    "explorerUrl": result.get("explorerUrl", "")
                }
            }
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "Request timed out. The backend might be waking up - please try again in 30 seconds."
        }
    except Exception as e:
        ctx.logger.error(f"❌ Swap error: {e}")
        return {
            "success": False,
            "error": "Connection error. The backend might be sleeping - please try again in a moment."
        }

async def handle_nft_mint(ctx: Context, user_address: str, nft_name: str, description: str, image_url: str) -> dict:
    """Mint NFT - returns structured data"""
    ctx.logger.info(f"🎨 Minting NFT: {nft_name}")
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/mint-nft",
                json={
                    "userAddress": user_address,
                    "name": nft_name,
                    "description": description,
                    "imageUrl": image_url
                },
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Backend error (status {response.status_code}). The backend might be sleeping - please try again in a moment."
                }

            result = response.json()
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get('error', 'Unknown error')
                }

            ctx.logger.info("✅ NFT minted")
            return {
                "success": True,
                "data": {
                    "nftName": nft_name,
                    "nftObjectId": result.get("nftObjectId", "N/A"),
                    "transactionHash": result.get("transactionHash", "N/A"),
                    "explorerUrl": result.get("explorerUrl", "")
                }
            }
    except httpx.TimeoutException:
        ctx.logger.error("❌ NFT mint timeout")
        return {
            "success": False,
            "error": "Request timed out. The backend might be waking up - please try again in 30 seconds."
        }
    except Exception as e:
        ctx.logger.error(f"❌ NFT mint error: {e}")
        return {
            "success": False,
            "error": "Connection error. The backend might be sleeping - please try again in a moment."
        }

async def handle_nft_list(ctx: Context, user_address: str) -> dict:
    """List user's NFTs - returns structured data"""
    ctx.logger.info(f"🖼️ Listing NFTs...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/nfts",
                params={"userAddress": user_address, "status": "owned"},
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Backend error (status {response.status_code})"
                }

            result = response.json()
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get('error', 'Unknown error')
                }

            ctx.logger.info("✅ NFT list retrieved")
            return {
                "success": True,
                "data": {
                    "nfts": result.get("nfts", []),
                    "count": result.get("count", 0)
                }
            }
    except Exception as e:
        ctx.logger.error(f"❌ NFT list error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def handle_nft_transfer(ctx: Context, user_address: str, nft_id: str, recipient: str) -> dict:
    """Transfer NFT - returns structured data"""
    ctx.logger.info(f"📤 Transferring NFT...")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/transfer-nft",
                json={
                    "userAddress": user_address,
                    "nftObjectId": nft_id,
                    "recipientAddress": recipient
                },
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Backend error (status {response.status_code})"
                }

            result = response.json()
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get('error', 'Unknown error')
                }

            ctx.logger.info("✅ NFT transferred")
            return {
                "success": True,
                "data": {
                    "nftObjectId": nft_id,
                    "recipientAddress": recipient,
                    "transactionHash": result.get("transactionHash", "N/A"),
                    "explorerUrl": result.get("explorerUrl", "")
                }
            }
    except Exception as e:
        ctx.logger.error(f"❌ NFT transfer error: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def handle_price(ctx: Context, token: str) -> dict:
    """Get token price from CoinMarketCap - returns structured data"""
    ctx.logger.info(f"💵 Fetching price for {token}")

    if not CMC_API_KEY:
        return {
            "success": False,
            "error": "CoinMarketCap API key not configured"
        }

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(
                "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
                params={"symbol": token.upper()},
                headers={"X-CMC_PRO_API_KEY": CMC_API_KEY}
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"CoinMarketCap API error (status {response.status_code})"
                }

            data = response.json()
            token_data = data["data"][token.upper()]
            quote = token_data["quote"]["USD"]

            ctx.logger.info(f"✅ Price retrieved: ${quote['price']:.4f}")
            return {
                "success": True,
                "data": {
                    "token": token.upper(),
                    "price": quote["price"],
                    "percent_change_24h": quote["percent_change_24h"],
                    "volume_24h": quote["volume_24h"],
                    "market_cap": quote["market_cap"]
                }
            }
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "Request timed out. Please try again!"
        }
    except Exception as e:
        ctx.logger.error(f"❌ Price error: {e}")
        return {
            "success": False,
            "error": "Error fetching price. Please try again!"
        }

async def handle_crypto_news(ctx: Context, query: Optional[str] = None) -> dict:
    """Fetch crypto/DeFi news from X (Twitter) - returns structured data"""
    ctx.logger.info(f"📰 Fetching crypto news...")

    if not X_BEARER_TOKEN:
        return {
            "success": False,
            "error": "X API not configured"
        }

    # Define search query
    search_query = query if query else "crypto OR DeFi OR SUI OR blockchain"

    # Check cache first (15-minute TTL to work with free tier: 1 request/15min)
    cached_data = get_cached_news(search_query)
    if cached_data:
        ctx.logger.info(f"💾 Serving cached news for query: '{search_query}'")
        return {
            "success": True,
            "data": cached_data,
            "cached": True
        }

    try:

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.twitter.com/2/tweets/search/recent",
                params={
                    "query": f"{search_query} -is:retweet lang:en",
                    "max_results": 10,
                    "tweet.fields": "created_at,public_metrics,author_id",
                    "expansions": "author_id",
                    "user.fields": "name,username,verified"
                },
                headers={"Authorization": f"Bearer {X_BEARER_TOKEN}"}
            )

            if response.status_code == 429:
                return {
                    "success": False,
                    "error": "Rate limit reached. X API allows limited requests per 15 minutes. Please try again later!"
                }
            elif response.status_code != 200:
                return {
                    "success": False,
                    "error": f"X API error (status {response.status_code})"
                }

            data = response.json()
            tweets = data.get("data", [])
            users = {user["id"]: user for user in data.get("includes", {}).get("users", [])}

            if not tweets:
                return {
                    "success": True,
                    "data": {
                        "tweets": [],
                        "count": 0,
                        "message": "No recent tweets found"
                    }
                }

            # Format tweets
            formatted_tweets = []
            for tweet in tweets[:5]:  # Limit to top 5
                author = users.get(tweet["author_id"], {})
                formatted_tweets.append({
                    "text": tweet["text"],
                    "author": author.get("name", "Unknown"),
                    "username": author.get("username", "unknown"),
                    "verified": author.get("verified", False),
                    "likes": tweet.get("public_metrics", {}).get("like_count", 0),
                    "retweets": tweet.get("public_metrics", {}).get("retweet_count", 0),
                    "created_at": tweet.get("created_at", "")
                })

            # Prepare response data
            response_data = {
                "tweets": formatted_tweets,
                "count": len(formatted_tweets),
                "query": search_query
            }

            # Cache the result (15-minute TTL)
            cache_news(search_query, response_data)
            ctx.logger.info(f"✅ Retrieved {len(formatted_tweets)} tweets (cached for 15min)")

            return {
                "success": True,
                "data": response_data
            }
    except httpx.TimeoutException as e:
        ctx.logger.error(f"❌ X API timeout after 15s: {e}")
        return {
            "success": False,
            "error": "X API request timed out. Please try again!"
        }
    except httpx.HTTPError as e:
        ctx.logger.error(f"❌ X API HTTP error: {e}")
        return {
            "success": False,
            "error": f"X API connection error: {str(e)}"
        }
    except Exception as e:
        ctx.logger.error(f"❌ News fetch error: {e}")
        import traceback
        ctx.logger.error(traceback.format_exc())
        return {
            "success": False,
            "error": f"Error fetching news: {str(e)}"
        }

def analyze_sentiment(tweets: list) -> dict:
    """Analyze sentiment from tweets using keyword matching"""
    if not tweets:
        return {"sentiment": "neutral", "bullish": 0, "bearish": 0, "neutral": 0}

    bullish_keywords = ["bullish", "moon", "pump", "buy", "long", "up", "gain", "profit", "growth", "rally", "🚀", "📈", "💎", "🔥", "💪"]
    bearish_keywords = ["bearish", "dump", "sell", "short", "down", "loss", "crash", "drop", "fall", "decline", "📉", "💩", "⚠️", "😰"]

    bullish_count = 0
    bearish_count = 0
    neutral_count = 0

    for tweet in tweets:
        text_lower = tweet.get("text", "").lower()

        # Count keyword occurrences
        bull_matches = sum(1 for keyword in bullish_keywords if keyword in text_lower)
        bear_matches = sum(1 for keyword in bearish_keywords if keyword in text_lower)

        if bull_matches > bear_matches:
            bullish_count += 1
        elif bear_matches > bull_matches:
            bearish_count += 1
        else:
            neutral_count += 1

    total = len(tweets)
    overall_sentiment = "neutral"

    if bullish_count > bearish_count and bullish_count > total * 0.4:
        overall_sentiment = "bullish"
    elif bearish_count > bullish_count and bearish_count > total * 0.4:
        overall_sentiment = "bearish"

    return {
        "sentiment": overall_sentiment,
        "bullish": bullish_count,
        "bearish": bearish_count,
        "neutral": neutral_count,
        "bullish_percent": round((bullish_count / total) * 100, 1) if total > 0 else 0,
        "bearish_percent": round((bearish_count / total) * 100, 1) if total > 0 else 0
    }

async def handle_market_research(ctx: Context, token: Optional[str] = None, category: Optional[str] = None) -> dict:
    """Comprehensive market research combining price, news, and sentiment"""
    ctx.logger.info(f"🔬 Market research: token={token}, category={category}")

    research_data = {
        "token": token,
        "category": category,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    # 1. Get price data if token specified
    if token and CMC_API_KEY:
        price_result = await handle_price(ctx, token)
        if price_result.get("success"):
            research_data["price"] = price_result["data"]

    # 2. Get relevant tweets with sentiment
    if X_BEARER_TOKEN:
        # Build search query
        if token:
            search_query = f"{token} crypto"
        elif category:
            search_query = f"{category} crypto"
        else:
            search_query = "crypto trending"

        ctx.logger.info(f"📡 Calling X API with query: {search_query}")
        news_result = await handle_crypto_news(ctx, search_query)
        ctx.logger.info(f"📡 X API returned: success={news_result.get('success')}")

        if news_result.get("success"):
            tweets = news_result["data"]["tweets"]
            research_data["news"] = {
                "tweets": tweets,
                "count": len(tweets)
            }

            # Analyze sentiment
            ctx.logger.info(f"🔍 Analyzing sentiment for {len(tweets)} tweets")
            sentiment = analyze_sentiment(tweets)
            research_data["sentiment"] = sentiment
        else:
            ctx.logger.warning(f"⚠️ X API failed: {news_result.get('error')}")
            # Add helpful context for LLM fallback
            research_data["api_status"] = {
                "news_available": False,
                "reason": news_result.get('error', 'Unknown error'),
                "fallback_mode": True
            }
            # Check if it's cached data
            if news_result.get('cached'):
                research_data["api_status"]["note"] = "Using cached news data from earlier"

    # 3. Always return what we have (even if partial)
    has_data = "price" in research_data or "news" in research_data

    # Add API status info
    research_data["available_data"] = {
        "price_data": "price" in research_data,
        "news_data": "news" in research_data,
        "sentiment_data": "sentiment" in research_data
    }

    if not has_data:
        # No real-time data - provide context for LLM to use built-in knowledge
        research_data["fallback_mode"] = True
        research_data["note"] = "Real-time data unavailable (APIs rate-limited or not configured). Use general crypto knowledge to help the user."
        if token:
            research_data["guidance"] = f"Provide general insights about {token} based on your knowledge: project overview, use cases, ecosystem, and general market position. Clarify that specific price/sentiment data isn't available right now."
        elif category:
            research_data["guidance"] = f"Provide general insights about {category} sector: what it is, notable projects, typical characteristics, and factors to consider. Clarify that specific real-time data isn't available right now."

    ctx.logger.info(f"✅ Market research complete (price: {'price' in research_data}, news: {'news' in research_data})")
    return {
        "success": True,  # Always succeed, let LLM handle partial data
        "data": research_data
    }

def generate_help_response(ctx: Context, user_query: str) -> str:
    """Generate dynamic help response using LLM or fallback"""

    # App description for LLM
    app_description = """
Sui AI Assistant - Your AI-powered wallet for Sui blockchain.

🏦 UNDERSTANDING YOUR DEPOSIT ACCOUNT:
This is a custodial wallet where we manage transactions for you. Here's how it works:

WHY: Instead of managing private keys yourself, you get a unique deposit address. This makes it safer and easier - just send SUI tokens there, and I handle everything else.

HOW TO USE:
1. Ask for your "deposit address" - you'll get a unique Sui address
2. Send SUI tokens to that address (from any wallet or exchange)
3. Once deposited, you can use commands like "check balance", "swap tokens", "mint NFT", etc.
4. All operations use YOUR deposited balance - we execute transactions on your behalf

Think of it like a bank account: you deposit funds, then tell me what to do with them!

KEY FEATURES:

💰 BALANCE & DEPOSITS:
- "deposit" or "deposit address" - Get your unique deposit address
- "check balance" - View your current balances
- Important: Deposit SUI first before using other features!

🔄 TOKEN SWAPS (⚠️ EXPERIMENTAL):
- "swap 10 SUI to USDC" - Exchange tokens via Cetus DEX
- Supports: SUI, USDC, USDT
- WARNING: This feature is still in development. You may need to manually provide pool ID and coin type information from Cetus DEX (https://app.cetus.zone) if automated parameter detection fails.

🎨 NFT OPERATIONS:
- "mint nft 'Name' with description 'Desc' and image https://..." - Create NFT
- "my nfts" - View your collection
- "transfer nft [id] to [address]" - Send NFT

💵 PRICE CHECKS:
- "price of SUI" - Real-time crypto prices from CoinMarketCap

📰 CRYPTO NEWS:
- "crypto news" - Latest updates from X/Twitter
- "news about SUI" - Search specific tokens

🔬 MARKET RESEARCH:
- "analyze SUI" - Comprehensive analysis with price + sentiment + news
- "research memecoins" - Category-based market research
"""

    if not ai_client:
        # Fallback if no LLM available
        return "👋 Hi! I'm Sui AI Assistant, your AI-powered wallet for Sui blockchain!\n\n🏦 YOUR DEPOSIT ACCOUNT:\nInstead of managing private keys, you get a unique deposit address. Just send SUI there, and I handle everything!\n\nHOW TO START:\n1. Ask for your 'deposit address'\n2. Send SUI tokens there\n3. Use commands: 'check balance', 'mint NFT', etc.\n\n✨ KEY FEATURES:\n💰 Balance & Deposits\n🔄 Token Swaps (⚠️ experimental - may need manual params)\n🎨 NFT Operations\n💵 Crypto Prices\n📰 Crypto News\n🔬 Market Research\n\nWhat would you like to do?"

    try:
        response = ai_client.chat.completions.create(
            model=AI_MODEL,
            max_tokens=512,
            messages=[
                {"role": "system", "content": f"""You are Sui AI Assistant, a friendly AI assistant for Sui blockchain DeFi operations.

{app_description}

Respond to user queries naturally and helpfully. Use emojis sparingly. Be concise but informative.
Format your response in a conversational way that matches the user's query tone."""},
                {"role": "user", "content": user_query}
            ]
        )

        return response.choices[0].message.content
    except Exception as e:
        ctx.logger.error(f"❌ LLM help generation failed: {e}")
        # Fallback message
        return "👋 Hi! I'm Sui AI Assistant!\n\n🏦 Get your deposit address first, send SUI there, then use features like:\n💰 Balance & Deposits\n🔄 Token Swaps (⚠️ experimental)\n🎨 NFT Operations\n💵 Price Checks\n📰 Crypto News\n\nWhat would you like to do?"

async def handle_atomic_transaction(ctx: Context, user_address: str, intent: str) -> dict:
    """Execute multiple operations atomically using /api/create-ptb endpoint"""
    ctx.logger.info(f"⚛️ Atomic transaction: {intent}")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/create-ptb",
                headers=get_backend_headers(),
                json={
                    "userIntent": intent,
                    "walletAddress": user_address
                }
            )

            data = response.json()

            if response.status_code == 200 and data.get("success"):
                tx_hash = data.get("transactionHash")
                template_name = data.get("templateName", "Unknown")
                mode = data.get("mode", "single")

                result = {
                    "success": True,
                    "transaction_hash": tx_hash,
                    "explorer_url": f"https://suiscan.xyz/testnet/tx/{tx_hash}",
                    "template": template_name,
                    "mode": mode
                }

                # Add multi-op specific info if available
                if mode == "multi-operation":
                    result["operation_count"] = data.get("operationCount", 0)
                    result["operations"] = data.get("operations", [])
                    result["effects"] = data.get("effects")  # Effects summary from backend
                    
                    # Log multi-op success with details
                    ctx.logger.info(f"✅ Multi-op atomic transaction successful: {result['operation_count']} operations in tx {tx_hash}")
                else:
                    ctx.logger.info(f"✅ Single-op transaction successful: {tx_hash}")
                
                return result
            else:
                error_msg = data.get("error", "Unknown error")
                ctx.logger.error(f"❌ Atomic transaction failed: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg
                }

    except Exception as e:
        ctx.logger.error(f"❌ Error executing atomic transaction: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# ============================================================================
# CONVERSATION HISTORY STORAGE
# ============================================================================

# Store conversation history per user (in-memory, limited to last 10 messages)
# Format: {sender_address: [{"role": "user", "content": "..."}, {"role": "assistant", "content": [...]}]}
conversation_history: Dict[str, list] = {}

def serialize_tool_calls(tool_calls):
    """Convert OpenAI tool_calls objects to serializable dictionaries"""
    if not tool_calls:
        return None

    return [
        {
            "id": tc.id,
            "type": tc.type,
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments
            }
        }
        for tc in tool_calls
    ]

def get_conversation_history(sender: str, max_messages: int = 10) -> list:
    """Get conversation history for a sender (last N messages)"""
    history = conversation_history.get(sender, [])
    # Return last N messages (each turn = user + assistant)
    return history[-max_messages:] if len(history) > max_messages else history

def add_to_conversation_history(sender: str, user_msg: str, assistant_response: list):
    """Add a turn to conversation history"""
    if sender not in conversation_history:
        conversation_history[sender] = []

    # Add user message
    conversation_history[sender].append({"role": "user", "content": user_msg})

    # Add assistant response (including tool calls)
    conversation_history[sender].append({"role": "assistant", "content": assistant_response})

    # Keep only last 20 messages (10 turns) to avoid token limits
    conversation_history[sender] = conversation_history[sender][-20:]

# ============================================================================
# CHAT HANDLERS
# ============================================================================

@agent.on_event("startup")
async def startup(ctx: Context):
    """Initialize agent on startup"""
    ctx.logger.info("Agent started successfully")
    ctx.logger.info(f"Agent address: {agent.address}")

@chat_proto.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    """Handle incoming chat messages"""
    try:
        ctx.logger.info(f"📨 Received ChatMessage from {sender[:12]}...")
        ctx.logger.info(f"Message ID: {msg.msg_id}")

        # Send acknowledgement
        await ctx.send(sender, create_acknowledgement(msg.msg_id))
    except Exception as e:
        ctx.logger.error(f"❌ Error in message handler: {e}")
        import traceback
        ctx.logger.error(traceback.format_exc())
        raise

    # Extract user query
    user_query = extract_text_from_chat(msg)
    if not user_query:
        return

    ctx.logger.info(f"💬 Query: {user_query}")

    if not ai_client:
        await ctx.send(sender, create_text_chat(
            "❌ AI service not configured. Please contact administrator."
        ))
        return

    # Fetch user info (including deposit address) for context
    # This ensures user is created if they don't exist
    user_deposit_address = None
    try:
        # DEBUG: Log the request details
        ctx.logger.info(f"🌐 Fetching user info from: {BACKEND_URL}/api/user/info")
        ctx.logger.info(f"📨 Request params: userAddress={sender}")
        headers_to_use = get_backend_headers()
        ctx.logger.info(f"🔑 Headers: {list(headers_to_use.keys())}")
        if BACKEND_API_KEY:
            ctx.logger.info(f"🔑 API Key: {BACKEND_API_KEY[:20]}...")
        else:
            ctx.logger.warning(f"⚠️ No BACKEND_API_KEY configured!")

        async with httpx.AsyncClient(timeout=30.0) as client:
            user_info_response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                headers=headers_to_use,
                params={"userAddress": sender}
            )
            if user_info_response.status_code == 200:
                user_data = user_info_response.json()

                # DEBUG: Log the full response
                ctx.logger.info(f"🔍 Backend response: {json.dumps(user_data, indent=2)}")

                # Check if response has nested structure
                if user_data.get("success"):
                    # Response format: {"success": true, "user": {"depositAddress": "0x..."}}
                    user_obj = user_data.get("user", {})
                    user_deposit_address = user_obj.get("depositAddress")
                    ctx.logger.info(f"📦 Extracted from user object: {user_deposit_address}")
                else:
                    # Response format: {"depositAddress": "0x..."}
                    user_deposit_address = user_data.get("depositAddress")
                    ctx.logger.info(f"📦 Extracted directly: {user_deposit_address}")

                ctx.logger.info(f"✅ User deposit address fetched: {user_deposit_address}")

                if not user_deposit_address:
                    ctx.logger.error(f"⚠️ No deposit address in response! Full response: {user_data}")
            else:
                ctx.logger.warning(f"⚠️ Failed to fetch user info: {user_info_response.status_code}")
    except Exception as e:
        ctx.logger.warning(f"⚠️ Could not fetch user deposit address: {e}")

    try:
        # Define available tools for Claude
        tools = [
            {
                "name": "check_balance",
                "description": "Check the user's wallet balance. Shows deposited SUI and other tokens.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "get_deposit_address",
                "description": "Get the user's unique deposit address. They need to send SUI to this address to fund their account.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "swap_tokens",
                "description": "⚠️ EXPERIMENTAL: Swap tokens using Cetus DEX. Supports SUI, USDC, USDT. WARNING: This feature is still in development. Users may need to manually provide pool_id and coin type information from Cetus DEX (https://app.cetus.zone) if automated detection fails. Inform users about this limitation before attempting swaps.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "amount": {"type": "number", "description": "Amount to swap"},
                        "from_token": {"type": "string", "description": "Source token (SUI, USDC, USDT)"},
                        "to_token": {"type": "string", "description": "Destination token (SUI, USDC, USDT)"}
                    },
                    "required": ["amount", "from_token", "to_token"]
                }
            },
            {
                "name": "mint_nft",
                "description": "Mint a new NFT on Sui blockchain. Extract parameters intelligently from user input - if they provide comma-separated values like 'meme, nice meme, img.png', parse them as name, description, image_url respectively.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "nft_name": {"type": "string", "description": "Name of the NFT"},
                        "description": {"type": "string", "description": "Description of the NFT"},
                        "image_url": {"type": "string", "description": "URL of the NFT image (can be any string if user doesn't provide valid URL)"}
                    },
                    "required": ["nft_name", "description", "image_url"]
                }
            },
            {
                "name": "list_nfts",
                "description": "List all NFTs owned by the user.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            },
            {
                "name": "transfer_nft",
                "description": "Transfer/send/withdraw an NFT to another address. Use this when user says 'transfer', 'send', 'withdraw' for NFTs. If user just minted an NFT and says 'send it to [address]', use the NFT ID from the mint result.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "nft_id": {"type": "string", "description": "Object ID of the NFT to transfer (e.g., 0x0de5ced21d6ca7...)"},
                        "recipient": {"type": "string", "description": "Recipient Sui address (starts with 0x)"}
                    },
                    "required": ["nft_id", "recipient"]
                }
            },
            {
                "name": "get_token_price",
                "description": "Get current price and market data for a cryptocurrency token from CoinMarketCap.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "token": {"type": "string", "description": "Token symbol (e.g., SUI, BTC, ETH)"}
                    },
                    "required": ["token"]
                }
            },
            {
                "name": "get_crypto_news",
                "description": "Get latest crypto/DeFi news from X (Twitter). Can search for specific topics.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Optional search query (e.g., 'SUI', 'memecoin', 'DeFi')"}
                    },
                    "required": []
                }
            },
            {
                "name": "research_market",
                "description": "Comprehensive market research combining price data, news, and sentiment analysis. Perfect for questions like 'analyze SUI', 'research memecoins', or 'what's trending'.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "token": {"type": "string", "description": "Specific token to research (e.g., 'SUI', 'BTC')"},
                        "category": {"type": "string", "description": "Category to research (e.g., 'memecoin', 'DeFi', 'NFT')"}
                    },
                    "required": []
                }
            },
            {
                "name": "execute_atomic_transaction",
                "description": """⚛️ ATOMIC MULTI-OPERATION TRANSACTION - Use this for MULTIPLE operations in ONE transaction.

WHEN TO USE (Multi-Op Scenarios):
✅ User requests 2+ operations together:
   - "transfer 0.1 SUI to 0x123... and mint an NFT"
   - "mint NFT and transfer it to 0x456..."
   - "transfer 0.5 SUI to Alice and 0.3 SUI to Bob"
   - "swap SUI to USDC then stake it"

✅ Sequential operations that should be atomic:
   - Operations connected by "and", "then", "also"
   - Multiple transfers in one request
   - Mint + transfer combinations
   
❌ DO NOT USE for single operations (use specific tools instead):
   - Just "check balance" → use check_balance
   - Just "mint NFT" → use mint_nft
   - Just "transfer SUI" → Not available as single tool, but if user ONLY wants to transfer (no other ops), you can still use this tool

HOW IT WORKS:
- Backend uses semantic search to match operations to PTB templates
- Automatically combines multiple templates into one atomic transaction
- All operations succeed together or all fail (transaction integrity)
- Supports: transfers, swaps, NFT minting, staking, and more

IMPORTANT: Pass the FULL user intent as-is. The backend will parse it intelligently.""",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "intent": {"type": "string", "description": "Natural language describing all operations to execute atomically. Include ALL details: amounts, addresses, token names, NFT info, etc. Example: 'transfer 0.1 SUI to 0x78df...b8ed and mint an NFT named cat with description black cat and image url https://example.com/image.jpg'"}
                    },
                    "required": ["intent"]
                }
            }
        ]

        # Get conversation history (for context across turns)
        history = get_conversation_history(sender, max_messages=10)
        ctx.logger.info(f"📜 Using {len(history)} previous messages for context")

        # Determine if this is the first message
        is_first_message = len(history) == 0

        # Build deposit address context
        deposit_address_context = ""
        if user_deposit_address:
            
            if is_first_message:
                deposit_address_context = """

⚠️ CRITICAL INSTRUCTION - MUST FOLLOW (FIRST MESSAGE ONLY) ⚠️
USER'S DEPOSIT ADDRESS: """ + user_deposit_address + """

When user says ANYTHING that looks like a greeting ("hi", "hello", "hey", "greetings", "what can you do", "help"), you MUST start your response with:

"👋 Welcome! Your deposit address is:
""" + user_deposit_address + """

Send SUI to this address to get started, then I can help you with swaps, NFTs, prices, and market research!"

DO NOT skip this. DO NOT give a generic greeting without the address. The deposit address MUST be in your first response to greetings.
"""
            else:
                # After first message, just provide the address as context (don't force showing it)
                deposit_address_context = """

CONTEXT - USER'S DEPOSIT ADDRESS: """ + user_deposit_address + """
(User already knows their deposit address from earlier conversation. Don't repeat it unless they specifically ask for it.)
"""
        else:
            ctx.logger.warning("⚠️ No deposit address available - user may need to be created")

        # System prompt
        system_prompt = """You are Sui AI Assistant - a helpful AI for a custodial Sui blockchain wallet.

CONTEXT:
- Custodial wallet system - you manage wallets for users
- Each user has a unique deposit address to fund their account
- Users must deposit SUI first before swaps/NFT operations
""" + deposit_address_context + """

YOUR CAPABILITIES:
You have tools to help users with:

💰 Balance & Deposits - Check balance, get deposit address

🔄 Token Swaps - Exchange SUI, USDC, USDT via Cetus DEX

🎨 NFT Operations - Mint, view, transfer NFTs

💵 Price Data - Real-time crypto prices from CoinMarketCap

📰 Crypto News - Latest updates from X/Twitter

🔬 Market Research - Comprehensive analysis with price + news + sentiment

⚛️ ATOMIC TRANSACTIONS (Multi-Operation):
- Use execute_atomic_transaction when user requests 2+ operations together
- Keywords: "and", "then", "also", multiple amounts/addresses in one message
- Examples that need atomic transactions:
  • "transfer 0.1 SUI and mint an NFT" → atomic
  • "mint NFT then transfer it" → atomic
  • "send SUI to Alice and Bob" → atomic
- Single operations use specific tools (mint_nft, swap_tokens, etc.)

🧠 TOOL SELECTION DECISION TREE:

1. COUNT THE OPERATIONS in user's request:
   - "mint NFT" = 1 operation → use mint_nft tool
   - "check balance" = 1 operation → use check_balance tool
   - "transfer 0.1 SUI AND mint NFT" = 2 operations → use execute_atomic_transaction
   - "send SUI to Alice AND Bob" = 2 operations → use execute_atomic_transaction

2. DETECT MULTI-OP KEYWORDS:
   - "and", "then", "also", "plus", "as well"
   - Multiple addresses/amounts in one message
   - Sequential actions ("do X then Y")

3. RULE OF THUMB:
   - If user wants ONE thing done → use specific tool (mint_nft, swap_tokens, etc.)
   - If user wants MULTIPLE things done → use execute_atomic_transaction
   - When in doubt: Count operations. 2+ = atomic transaction.

IMPORTANT PRINCIPLES:
- Be proactive: When users ask about investing/trading/buying, immediately use research_market to gather data
- Be helpful: Work with whatever data you get (even if partial). If some data is missing, acknowledge it but still provide value with what you have
- Be responsible: Always include disclaimer that this is research data/information, not financial advice
- Be direct: Don't ask for permission before using tools, just use them
- Be adaptive: If real-time data APIs are unavailable (rate limited or errors), use your built-in knowledge about crypto trends, projects, and market dynamics. Provide general insights with clear disclaimers that the info may not be current
- Use knowledge fallback: When APIs fail, don't just say "I can't help". Share what you know about crypto categories (DeFi, memecoins, L1s), notable projects, general market factors - just clarify the data isn't real-time
- Be natural: Talk like a knowledgeable friend, not a corporate bot. Use conversational language, avoid excessive formatting/emojis, keep it flowing naturally
- Parse casual input: When users provide comma-separated values or lists after you ask for parameters, extract them intelligently
  Example: If you asked for NFT details and user says "meme, nice meme, https://example.com/img.png" → extract as name="meme", description="nice meme", image_url="https://example.com/img.png"
  Even if they say "meme, nice meme, img" with incomplete URL, try to mint with what they give and explain if image URL is invalid

CONVERSATION CONTEXT & INTENT UNDERSTANDING (CRITICAL - READ CAREFULLY):

🧠 MEMORY & CONTEXT:
- You have access to previous conversation messages in the messages array
- ALWAYS look at the last 2-3 messages to understand what's happening
- If you just listed NFTs and user says "withdraw the nice meme one", you KNOW which NFT they mean - you literally just showed them the list!
- If user says "go on" or "continue" or "do it", they mean: continue with the action they JUST requested in their previous message

🔄 UNDERSTANDING SYNONYMS & VARIATIONS:
- "withdraw", "send", "transfer", "move" = ALL mean transfer_nft for NFTs
- "that one", "the nice meme", "meme (nice meme)" = referring to NFT from the list YOU just showed
- User doesn't need to provide NFT ID if you just listed it - YOU should extract it from your own previous response!

⚠️ CRITICAL: EXTRACT THEN EXECUTE - DON'T JUST ACKNOWLEDGE!

When user references an NFT from a previous list_nfts call, you MUST:

STEP 1 - EXTRACT NFT ID FROM CONVERSATION HISTORY:
- Look back at the most recent list_nfts tool result in the conversation
- The result has format: {"success": true, "data": {"nfts": [{"objectId": "0x...", "name": "...", "description": "..."}], "count": N}}
- Find the NFT object that matches the user's reference (by name or description)
- Extract the "objectId" value - this is the nft_id parameter you need

STEP 2 - CALL THE TOOL IMMEDIATELY:
- DO NOT respond with text like "Perfect! I found it. Now transferring..."
- DO NOT acknowledge and wait for confirmation
- IMMEDIATELY call transfer_nft with the extracted nft_id and the recipient address the user provided

WRONG BEHAVIOR (DO NOT DO THIS):
User: "withdraw meme (nice meme) to 0x78df..."
You: "Perfect! I found the NFT with description 'nice meme'. Now transferring it to your wallet..." [NO TOOL CALL]
Result: User frustrated because nothing happened

CORRECT BEHAVIOR (DO THIS):
User: "withdraw meme (nice meme) to 0x78df..."
You: [IMMEDIATELY call transfer_nft tool with nft_id="0x54b96..." and recipient="0x78df..."]
You: "✅ Successfully transferred meme (nice meme) to 0x78df..."

📝 STEP-BY-STEP NFT EXTRACTION PROCEDURE:
1. User says "transfer [nft reference] to [address]"
2. Search conversation history for most recent tool_result from list_nfts
3. Parse the JSON in that tool_result to get the nfts array
4. Match user's [nft reference] against name or description fields
5. Extract the objectId from the matched NFT object
6. CALL transfer_nft(nft_id=objectId, recipient=address) - DO NOT WAIT OR ASK

⚡ ACTION OVER WORDS:
- If you understand what the user wants and you have the data to do it → CALL THE TOOL
- Don't describe what you're about to do → JUST DO IT
- Don't say "I found it" → TRANSFER IT
- Actions speak louder than acknowledgments!

🎯 EXAMPLE FLOW (LEARN THIS EXACTLY):
1. User: "my nfts" 
   → You call list_nfts 
   → Tool returns: {"success": true, "data": {"nfts": [{"objectId": "0x54b96...", "name": "meme", "description": "nice meme"}]}}
   → You show user: "You have 1 NFT: meme (nice meme)"

2. User: "withdraw meme (nice meme) to 0x78df..."
   → You IMMEDIATELY extract objectId="0x54b96..." from step 1's tool result
   → You IMMEDIATELY call transfer_nft with nft_id="0x54b96..." and recipient="0x78df..."
   → You respond with the transfer result

NOT THIS:
2. User: "withdraw meme (nice meme) to 0x78df..."
   → You respond: "Perfect! I found it. Now transferring..." [NO TOOL CALL] ❌ WRONG!

💡 KEY PRINCIPLE:
If you can execute the action by extracting data from conversation history, EXECUTE IT IMMEDIATELY. Don't talk about executing it - just execute it!

FORMATTING RULES (CRITICAL):
- Always put spaces around dollar amounts: "from $238k to $514k" NOT "from238k to$514k"
- Use proper line breaks between sections: double newline (press enter twice)
- Format lists with line breaks: put each item on a new line
- Keep token names readable: "RATIO" not "**RATIO**"
- Example good formatting:
  "RATIO is showing activity with a reported 2.5x move recently (from $238k to $514k)

  APR, AKT, EDU - various trading signals floating around"

NOT: "**RATIO** − showingactivitywithareported2.5xmoverecently(from238kto$514k)"
"""

        # Debug: Log whether deposit address is in system prompt
        if user_deposit_address and is_first_message and "CRITICAL INSTRUCTION" in system_prompt:
            ctx.logger.info("✅ First message - deposit address greeting will be shown")
        elif user_deposit_address and not is_first_message:
            ctx.logger.info("✅ Continuing conversation - deposit address available in context")
        else:
            ctx.logger.warning(f"⚠️ Deposit address issue (address: {user_deposit_address}, first_msg: {is_first_message})")

        # Build messages array: system + history + current query (OpenAI format)
        messages = [{"role": "system", "content": system_prompt}] + history + [{"role": "user", "content": user_query}]

        # Convert Anthropic tool format to OpenAI format
        openai_tools = [{
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["input_schema"]
            }
        } for tool in tools]

        # Call ASI1 with tools
        response = ai_client.chat.completions.create(
            model=AI_MODEL,
            max_tokens=2048,
            tools=openai_tools,
            messages=messages
        )

        # Process response and execute tools (OpenAI format)
        response_text = ""
        tool_results = []
        message = response.choices[0].message

        # Get text response if available
        if message.content:
            response_text = message.content

        # Process tool calls if any
        if message.tool_calls:
            for tool_call in message.tool_calls:
                tool_name = tool_call.function.name
                tool_input = json.loads(tool_call.function.arguments)
                tool_id = tool_call.id

                ctx.logger.info(f"🔧 Tool: {tool_name}")

                # Execute tool
                tool_result = None
                try:
                    if tool_name == "check_balance":
                        tool_result = await handle_balance(ctx, sender)
                    elif tool_name == "get_deposit_address":
                        tool_result = await handle_deposit(ctx, sender)
                    elif tool_name == "swap_tokens":
                        tool_result = await handle_swap(
                            ctx, sender,
                            tool_input["from_token"],
                            tool_input["to_token"],
                            tool_input["amount"]
                        )
                    elif tool_name == "mint_nft":
                        tool_result = await handle_nft_mint(
                            ctx, sender,
                            tool_input["nft_name"],
                            tool_input["description"],
                            tool_input["image_url"]
                        )
                    elif tool_name == "list_nfts":
                        tool_result = await handle_nft_list(ctx, sender)
                    elif tool_name == "transfer_nft":
                        tool_result = await handle_nft_transfer(
                            ctx, sender,
                            tool_input["nft_id"],
                            tool_input["recipient"]
                        )
                    elif tool_name == "get_token_price":
                        tool_result = await handle_price(ctx, tool_input["token"])
                    elif tool_name == "get_crypto_news":
                        tool_result = await handle_crypto_news(ctx, tool_input.get("query"))
                    elif tool_name == "research_market":
                        tool_result = await handle_market_research(
                            ctx,
                            tool_input.get("token"),
                            tool_input.get("category")
                        )
                    elif tool_name == "execute_atomic_transaction":
                        tool_result = await handle_atomic_transaction(
                            ctx,
                            sender,
                            tool_input["intent"]
                        )
                except Exception as e:
                    ctx.logger.error(f"❌ Tool error: {e}")
                    tool_result = {
                        "success": False,
                        "error": str(e)
                    }

                # OpenAI tool result format
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": json.dumps(tool_result)
                })

        # If tools were called, get final response from ASI1
        if tool_results:
            # Build messages: system + history + user + assistant (with tool calls) + tool results
            follow_up_messages = [{"role": "system", "content": system_prompt}] + history + [
                {"role": "user", "content": user_query},
                {"role": "assistant", "content": message.content, "tool_calls": serialize_tool_calls(message.tool_calls)}
            ] + tool_results

            final_response = ai_client.chat.completions.create(
                model=AI_MODEL,
                max_tokens=2048,
                tools=openai_tools,
                messages=follow_up_messages
            )

            # Extract text from final response
            final_message = final_response.choices[0].message
            if final_message.content:
                response_text = final_message.content

            # Save conversation history (with tool call and final response)
            # Store the assistant's final response
            add_to_conversation_history(sender, user_query, [
                {"role": "assistant", "content": message.content, "tool_calls": serialize_tool_calls(message.tool_calls)},
                {"role": "assistant", "content": final_message.content}
            ])
        else:
            # Save conversation history (direct response without tools)
            add_to_conversation_history(sender, user_query, [{"role": "assistant", "content": message.content}])

        # Send response
        if response_text:
            await ctx.send(sender, create_text_chat(response_text))
        else:
            await ctx.send(sender, create_text_chat(
                "I'm here to help! Ask me about balance, swaps, NFTs, prices, or crypto news."
            ))

    except Exception as e:
        ctx.logger.error(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        await ctx.send(sender, create_text_chat(
            "❌ Sorry, I encountered an error. Please try again!"
        ))

@chat_proto.on_message(ChatAcknowledgement)
async def handle_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    """Handle acknowledgement messages"""
    ctx.logger.info(f"✅ Acknowledgement received from {sender[:12]}...")

# Include protocol
agent.include(chat_proto, publish_manifest=True)

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    agent.run()
