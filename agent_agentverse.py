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

from anthropic import Anthropic
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    chat_protocol_spec,
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
)

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
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Anthropic client
anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# Helper function to get headers with API key
def get_backend_headers():
    """Get headers with API key for backend requests"""
    headers = {"Content-Type": "application/json"}
    if BACKEND_API_KEY:
        headers["X-API-Key"] = BACKEND_API_KEY
    return headers

# Create agent
agent = Agent(
    name=AGENT_NAME,
    seed=AGENT_SEED,
    port=AGENT_PORT,
    endpoint=[f"http://127.0.0.1:{AGENT_PORT}/submit"],
    mailbox=AGENT_MAILBOX,
)

# Chat protocol
chat_proto = Protocol(spec=chat_protocol_spec)

print(f"\n{'='*60}")
print(f"🤖 Sui AI Assistant")
print(f"{'='*60}")
print(f"Address: {agent.address}")
print(f"Port: {AGENT_PORT}")
print(f"Mailbox: {AGENT_MAILBOX or 'Local mode'}")
print(f"Backend: {BACKEND_URL}")
print(f"AI: {'Anthropic Claude' if anthropic_client else 'Regex fallback'}")
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
    if not anthropic_client:
        return parse_intent_regex(query)

    try:
        response = anthropic_client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            system="""You are a conversational DeFi intent parser for Sui blockchain. Parse user queries into structured actions.

Available actions:
- balance: Check wallet balance
- deposit: Get deposit address
- swap: Exchange tokens (needs: amount, from_token, to_token)
- nft_mint: Create NFT (needs: nft_name, description, image_url)
- nft_list: View owned NFTs
- nft_transfer: Send NFT (needs: nft_id, recipient)
- price: Check token price (needs: token)
- help: Show capabilities, answer "what can you do", general questions, greetings
- unknown: Unrecognizable intent

Conversational queries that should map to "help":
- Greetings: "hi", "hello", "hey", "greetings"
- Questions about capabilities: "can I ask", "what can you do", "are you able", "do you support"
- General questions without specific DeFi intent

Examples:
- "hi" → {"action": "help"}
- "can I ask you something" → {"action": "help"}
- "what can you do" → {"action": "help"}
- "check my balance" → {"action": "balance"}
- "swap 10 SUI to USDC" → {"action": "swap", "parameters": {"amount": 10, "from_token": "SUI", "to_token": "USDC"}}
- "I want to mint nft" → {"action": "nft_mint", "parameters": {}}
- "mint nft 'Cool Art' with description 'My artwork' and image https://example.com/img.png" → {"action": "nft_mint", "parameters": {"nft_name": "Cool Art", "description": "My artwork", "image_url": "https://example.com/img.png"}}

Respond ONLY with JSON:
{
  "action": "action_name",
  "parameters": {...},
  "confidence": 0.0-1.0
}""",
            messages=[{"role": "user", "content": f"Parse this query: {query}"}]
        )

        text = response.content[0].text
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
# API HANDLERS
# ============================================================================

async def handle_balance(ctx: Context, user_address: str) -> str:
    """Get user balance"""
    ctx.logger.info(f"💰 Fetching balance for {user_address[:12]}...")
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                params={"userAddress": user_address},
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return f"❌ Backend error: {response.status_code}\n\nThe backend might be sleeping. Please try again!"

            result = response.json()
            if not result.get("success"):
                return f"❌ Error: {result.get('error', 'Unknown error')}"

            user = result.get("user", {})
            balances = user.get("balances", {})
            deposit_addr = user.get("depositAddress", "N/A")

            response_text = "💰 Your Wallet Balance\n\n"
            for token, amount in balances.items():
                response_text += f"- {token}: {amount}\n"
            response_text += f"\n📍 Deposit Address\n{deposit_addr}\n\nSend SUI to this address to add funds!"

            ctx.logger.info("✅ Balance retrieved")
            return response_text
    except httpx.TimeoutException:
        return "❌ Request timed out. The backend might be waking up - please try again in 30 seconds!"
    except Exception as e:
        ctx.logger.error(f"❌ Balance error: {e}")
        return f"❌ Connection error. The backend might be sleeping.\n\nPlease try again in a moment!"

async def handle_deposit(ctx: Context, user_address: str) -> str:
    """Get deposit address"""
    ctx.logger.info(f"📍 Fetching deposit address...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                params={"userAddress": user_address},
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return f"❌ Backend error: {response.status_code}"

            result = response.json()
            if not result.get("success"):
                return f"❌ Error: {result.get('error', 'Unknown error')}"

            user = result.get("user", {})
            deposit_addr = user.get("depositAddress", "N/A")
            balances = user.get("balances", {})
            sui_balance = balances.get("SUI", 0)

            response_text = f"📍 Your Deposit Address\n\n{deposit_addr}\n\n💰 Current Balance: {sui_balance} SUI\n\nSend SUI to this address from any wallet to add funds!"

            ctx.logger.info("✅ Deposit address retrieved")
            return response_text
    except Exception as e:
        ctx.logger.error(f"❌ Deposit error: {e}")
        return f"❌ Error: {str(e)}"

async def handle_swap(ctx: Context, user_address: str, from_token: str, to_token: str, amount: float) -> str:
    """Execute token swap"""
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
                return f"❌ Backend error: {response.status_code}\n\nThe backend might be sleeping. Please try again!"

            result = response.json()
            if not result.get("success"):
                return f"❌ Swap failed: {result.get('error', 'Unknown error')}"

            tx_hash = result.get("transactionHash", "N/A")
            tx_short = tx_hash[:16] + "..." if tx_hash != "N/A" else "N/A"
            explorer_url = result.get("explorerUrl", "")

            response_text = f"✅ Swap completed!\n\n🔄 Swapped: {amount} {from_token} → {to_token}\n🔗 Transaction: {tx_short}\n\n📊 View on Explorer:\n{explorer_url}\n\nType 'balance' to check your updated balance!"

            ctx.logger.info("✅ Swap completed")
            return response_text
    except httpx.TimeoutException:
        return "❌ Request timed out. The backend might be waking up - please try again in 30 seconds!"
    except Exception as e:
        ctx.logger.error(f"❌ Swap error: {e}")
        return f"❌ Connection error. The backend might be sleeping.\n\nPlease try again in a moment!"

async def handle_nft_mint(ctx: Context, user_address: str, nft_name: str, description: str, image_url: str) -> str:
    """Mint NFT"""
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
                return f"❌ Backend error: {response.status_code}\n\nThe backend might be sleeping. Please try again in a moment!"

            result = response.json()
            if not result.get("success"):
                return f"❌ Minting failed: {result.get('error', 'Unknown error')}"

            nft_id = result.get("nftObjectId", "N/A")
            nft_short = nft_id[:16] + "..." if nft_id != "N/A" else "N/A"
            tx_hash = result.get("transactionHash", "N/A")
            tx_short = tx_hash[:16] + "..." if tx_hash != "N/A" else "N/A"
            explorer_url = result.get("explorerUrl", "")

            response_text = f"✅ NFT Minted Successfully!\n\n🎨 Name: {nft_name}\n🆔 NFT ID: {nft_short}\n🔗 Transaction: {tx_short}\n\n📊 View on Explorer:\n{explorer_url}\n\nType 'my nfts' to see all your NFTs!"

            ctx.logger.info("✅ NFT minted")
            return response_text
    except httpx.TimeoutException:
        ctx.logger.error("❌ NFT mint timeout")
        return "❌ Request timed out. The backend might be waking up - please try again in 30 seconds!"
    except Exception as e:
        ctx.logger.error(f"❌ NFT mint error: {e}")
        return f"❌ Connection error. The backend might be sleeping.\n\nPlease try again in a moment!"

async def handle_nft_list(ctx: Context, user_address: str) -> str:
    """List user's NFTs"""
    ctx.logger.info(f"🖼️ Listing NFTs...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/nfts",
                params={"userAddress": user_address, "status": "owned"},
                headers=get_backend_headers()
            )
            if response.status_code != 200:
                return f"❌ Backend error: {response.status_code}"

            result = response.json()
            if not result.get("success"):
                return f"❌ Error: {result.get('error', 'Unknown error')}"

            nfts = result.get("nfts", [])
            count = result.get("count", 0)

            if count == 0:
                return "🖼️ Your NFTs\n\nYou don't own any NFTs yet.\n\nType 'mint nft \"My Cool NFT\"' to create one!"

            response_text = f"🖼️ Your NFTs ({count} total)\n\n"
            for nft in nfts[:10]:
                nft_name = nft.get("name", "Unnamed")
                nft_id = nft.get("nftObjectId", "N/A")
                response_text += f"- {nft_name}\n  ID: {nft_id[:16]}...\n"

            if count > 10:
                response_text += f"\n... and {count - 10} more NFTs"

            ctx.logger.info("✅ NFT list retrieved")
            return response_text
    except Exception as e:
        ctx.logger.error(f"❌ NFT list error: {e}")
        return f"❌ Error: {str(e)}"

async def handle_nft_transfer(ctx: Context, user_address: str, nft_id: str, recipient: str) -> str:
    """Transfer NFT"""
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
                return f"❌ Backend error: {response.status_code}"

            result = response.json()
            if not result.get("success"):
                return f"❌ Transfer failed: {result.get('error', 'Unknown error')}"

            nft_short = nft_id[:16] + "..."
            recipient_short = f"{recipient[:12]}...{recipient[-8:]}"
            tx_hash = result.get("transactionHash", "N/A")
            tx_short = tx_hash[:16] + "..." if tx_hash != "N/A" else "N/A"
            explorer_url = result.get("explorerUrl", "")

            response_text = f"✅ NFT Transferred Successfully!\n\n🆔 NFT ID: {nft_short}\n📥 To: {recipient_short}\n🔗 Transaction: {tx_short}\n\n📊 View on Explorer:\n{explorer_url}"

            ctx.logger.info("✅ NFT transferred")
            return response_text
    except Exception as e:
        ctx.logger.error(f"❌ NFT transfer error: {e}")
        return f"❌ Transfer error: {str(e)}"

async def handle_price(ctx: Context, token: str) -> str:
    """Get token price from CoinMarketCap"""
    ctx.logger.info(f"💵 Fetching price for {token}")

    if not CMC_API_KEY:
        return "❌ CoinMarketCap API key not configured"

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(
                "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
                params={"symbol": token.upper()},
                headers={"X-CMC_PRO_API_KEY": CMC_API_KEY}
            )
            if response.status_code != 200:
                return f"❌ CoinMarketCap API error: {response.status_code}"

            data = response.json()
            token_data = data["data"][token.upper()]
            quote = token_data["quote"]["USD"]

            price = quote["price"]
            change_24h = quote["percent_change_24h"]
            volume_24h = quote["volume_24h"]
            market_cap = quote["market_cap"]

            change_emoji = "📈" if change_24h > 0 else "📉"
            response_text = f"{change_emoji} {token.upper()} Price Information\n\n💰 Current Price: ${price:.4f}\n📊 24h Change: {change_24h:+.2f}%\n📈 24h Volume: ${volume_24h:,.0f}\n💎 Market Cap: ${market_cap:,.0f}\n\nData from CoinMarketCap"

            ctx.logger.info(f"✅ Price retrieved: ${price:.4f}")
            return response_text
    except httpx.TimeoutException:
        return "❌ Request timed out. Please try again!"
    except Exception as e:
        ctx.logger.error(f"❌ Price error: {e}")
        return f"❌ Error fetching price. Please try again!"

def generate_help_response(ctx: Context, user_query: str) -> str:
    """Generate dynamic help response using LLM or fallback"""

    # App description for LLM
    app_description = """
Sui AI Assistant is an AI-powered Sui wallet assistant that helps users with DeFi operations on the Sui blockchain.

Capabilities:
- Check wallet balance and get deposit address
- Swap tokens (SUI, USDC, USDT) via Cetus DEX
- Mint, view, and transfer NFTs
- Check real-time cryptocurrency prices via CoinMarketCap
- Natural language understanding for commands

Examples:
- "check my balance" - View your token balances
- "swap 10 SUI to USDC" - Exchange tokens
- "mint nft 'My Cool Art'" - Create a new NFT
- "my nfts" - View your NFT collection
- "price of SUI" - Get current market price
"""

    if not anthropic_client:
        # Fallback if no LLM available
        return "👋 Hi! I'm Sui AI Assistant, your AI Sui wallet assistant!\n\nI can help with:\n💰 Balance & Deposits\n🔄 Token Swaps\n🎨 NFT Operations\n💵 Price Checks\n\nJust tell me what you want to do!"

    try:
        response = anthropic_client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=512,
            system=f"""You are Sui AI Assistant, a friendly AI assistant for Sui blockchain DeFi operations.

{app_description}

Respond to user queries naturally and helpfully. Use emojis sparingly. Be concise but informative.
Format your response in a conversational way that matches the user's query tone.""",
            messages=[{"role": "user", "content": user_query}]
        )

        return response.content[0].text
    except Exception as e:
        ctx.logger.error(f"❌ LLM help generation failed: {e}")
        # Fallback message
        return "👋 Hi! I'm Sui AI Assistant, your AI Sui wallet assistant!\n\nI can help with:\n💰 Balance & Deposits\n🔄 Token Swaps\n🎨 NFT Operations\n💵 Price Checks\n\nJust tell me what you want to do!"

# ============================================================================
# CHAT HANDLERS
# ============================================================================

@chat_proto.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    """Handle incoming chat messages"""
    ctx.logger.info(f"📨 Received message from {sender[:12]}...")

    # Send acknowledgement
    await ctx.send(sender, create_acknowledgement(msg.msg_id))

    # Extract user query
    user_query = extract_text_from_chat(msg)
    if not user_query:
        return

    ctx.logger.info(f"💬 Query: {user_query}")

    try:
        # Parse intent
        intent = parse_intent_with_llm(user_query)
        action = intent["action"]
        params = intent.get("parameters", {})

        ctx.logger.info(f"🎯 Action: {action}")

        # Handle action
        response_text = ""

        if action == "balance":
            response_text = await handle_balance(ctx, sender)
        elif action == "deposit":
            response_text = await handle_deposit(ctx, sender)
        elif action == "swap":
            if not all(k in params for k in ["amount", "from_token", "to_token"]):
                response_text = "❌ I need the amount and both tokens for a swap.\nExample: 'swap 10 SUI to USDC'"
            else:
                response_text = await handle_swap(
                    ctx, sender,
                    params["from_token"],
                    params["to_token"],
                    params["amount"]
                )
        elif action == "nft_mint":
            if "nft_name" not in params or not params["nft_name"]:
                response_text = "🎨 Sure! To mint an NFT, I need:\n\n1️⃣ **Name**: What's the NFT called?\n2️⃣ **Description**: Tell me about it\n3️⃣ **Image URL**: Link to the image\n\nYou can tell me like:\n'mint nft \"Cool Art\" with description \"My awesome artwork\" and image https://example.com/image.png'\n\nOr just give me the name first, and I'll ask for the rest!"
            elif "description" not in params or not params["description"]:
                response_text = f"Great! You want to mint **{params['nft_name']}**\n\n📝 Now, what's the description for this NFT?"
            elif "image_url" not in params or not params["image_url"]:
                response_text = f"Perfect! Almost there...\n\n📸 What's the image URL for **{params['nft_name']}**?\n\n(Provide a direct link to an image)"
            else:
                response_text = await handle_nft_mint(
                    ctx, sender,
                    params["nft_name"],
                    params["description"],
                    params["image_url"]
                )
        elif action == "nft_list":
            response_text = await handle_nft_list(ctx, sender)
        elif action == "nft_transfer":
            if "nft_id" not in params or "recipient" not in params:
                response_text = "❌ Please provide both NFT ID and recipient address.\nExample: 'transfer nft 0xabc... to 0xdef...'"
            else:
                response_text = await handle_nft_transfer(
                    ctx, sender,
                    params["nft_id"],
                    params["recipient"]
                )
        elif action == "price":
            token = params.get("token", "SUI")
            response_text = await handle_price(ctx, token)
        elif action == "help":
            response_text = generate_help_response(ctx, user_query)
        else:
            # Handle conversational queries more flexibly
            query_lower = user_query.lower()
            if any(word in query_lower for word in ["hi", "hello", "hey", "greetings"]):
                response_text = "👋 Hi there! I'm Sui AI Assistant, your AI Sui wallet assistant.\n\nI can help you with DeFi operations on Sui blockchain!\n\nType 'help' to see what I can do, or just tell me what you'd like to do in natural language! 🚀"
            elif any(word in query_lower for word in ["thanks", "thank you", "thx"]):
                response_text = "You're welcome! 😊\n\nNeed anything else? Just ask!"
            elif any(word in query_lower for word in ["can you", "are you able", "do you"]):
                response_text = "Yes! I can help with:\n\n💰 Balance & Deposits\n🔄 Token Swaps\n🎨 NFT Operations\n💵 Price Checks\n\nJust tell me what you'd like to do, or type 'help' for examples!"
            else:
                response_text = "I'm not quite sure what you'd like to do.\n\nI can help with:\n- Check balance: 'check my balance'\n- Token swaps: 'swap 10 SUI to USDC'\n- Mint NFTs: 'mint nft \"My Art\"'\n- View NFTs: 'my nfts'\n- Check prices: 'price of SUI'\n\nJust tell me what you want in natural language! Type 'help' for more examples."

        # Send response
        await ctx.send(sender, create_text_chat(response_text))

    except Exception as e:
        ctx.logger.error(f"❌ Error: {e}")
        await ctx.send(sender, create_text_chat(
            f"❌ Sorry, I encountered an error: {str(e)}\n\nPlease try again or type 'help' for assistance."
        ))

@chat_proto.on_message(ChatAcknowledgement)
async def handle_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    """Handle acknowledgement messages"""
    ctx.logger.info(f"✅ Acknowledgement received")

# Include protocol
agent.include(chat_proto, publish_manifest=True)

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    agent.run()
