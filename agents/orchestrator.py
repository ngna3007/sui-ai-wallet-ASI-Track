"""
Orchestrator Agent - Main agent with Anthropic Claude LLM for intent parsing

This agent:
1. Receives ChatMessages from ASI:One
2. Uses Claude to parse natural language into structured intents
3. Routes to appropriate specialist agents
4. Formats responses for users
"""
import os
import json
import re
from typing import Optional
from anthropic import Anthropic
from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import (
    chat_protocol_spec,
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
)
from datetime import datetime, timezone
from uuid import uuid4

from models import (
    BalanceRequest, BalanceResponse,
    DepositRequest, DepositResponse,
    SwapRequest, SwapResponse,
    NFTMintRequest, NFTMintResponse,
    NFTListRequest, NFTListResponse,
    NFTTransferRequest, NFTTransferResponse,
    PriceRequest, PriceResponse,
    HelpRequest, HelpResponse
)

# Configuration
AGENT_NAME = "suivisor"
AGENT_SEED = os.getenv("SUIVISOR_SEED", "suivisor_secret_seed_phrase_change_in_production")
AGENT_PORT = int(os.getenv("SUIVISOR_PORT", "8000"))
AGENT_MAILBOX = os.getenv("SUIVISOR_MAILBOX", None)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Create orchestrator agent
orchestrator = Agent(
    name=AGENT_NAME,
    seed=AGENT_SEED,
    port=AGENT_PORT,
    endpoint=[f"http://127.0.0.1:{AGENT_PORT}/submit"],
    mailbox=AGENT_MAILBOX,
)

# Anthropic client
anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# Pending responses tracker
pending_responses = {}

# Agent addresses (will be set by Bureau)
agent_addresses = {}

print(f"\n{'='*60}")
print(f"🤖 SuiVisor Orchestrator Agent")
print(f"{'='*60}")
print(f"Address: {orchestrator.address}")
print(f"Port: {AGENT_PORT}")
print(f"Mailbox: {AGENT_MAILBOX or 'Not configured (local mode)'}")
print(f"AI: {'Anthropic Claude' if anthropic_client else 'Disabled (regex fallback)'}")
print(f"{'='*60}\n")


def set_agent_addresses(addresses: dict):
    """Set agent addresses for routing"""
    global agent_addresses
    agent_addresses = addresses


# ============================================================================
# CHAT PROTOCOL UTILITIES
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
# LLM INTENT PARSING
# ============================================================================

def parse_intent_with_llm(query: str) -> dict:
    """Parse user intent using Anthropic Claude"""
    if not anthropic_client:
        return parse_intent_regex(query)  # Fallback to regex

    try:
        response = anthropic_client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            system="""You are a DeFi intent parser for Sui blockchain. Parse user queries into structured actions.

Available actions:
- balance: Check wallet balance
- deposit: Get deposit address
- swap: Exchange tokens (e.g., SUI to USDC)
- nft_mint: Create new NFT
- nft_list: Show user's NFTs
- nft_transfer: Transfer NFT to another address
- price: Get token price
- help: Show help information
- unknown: Cannot determine intent

Extract parameters:
- amount: numeric value
- from_token, to_token: token symbols (SUI, USDC, USDT)
- nft_name: NFT name in quotes
- nft_id: 0x hex address (40-64 chars)
- recipient: 0x hex address (64 chars)

Respond ONLY with JSON:
{
  "action": "action_name",
  "parameters": {...},
  "confidence": 0.0-1.0
}""",
            messages=[{
                "role": "user",
                "content": f"Parse this command: {query}"
            }]
        )

        # Extract JSON from response
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

    # Detect action
    if any(word in query_lower for word in ["balance", "how much", "wallet"]):
        intent["action"] = "balance"
    elif any(word in query_lower for word in ["deposit", "fund", "add money", "top up"]):
        intent["action"] = "deposit"
    elif any(word in query_lower for word in ["mint", "create nft", "new nft"]):
        intent["action"] = "nft_mint"
        # Extract NFT name
        name_match = re.search(r'["\']([^"\']+)["\']', query)
        if name_match:
            intent["parameters"]["nft_name"] = name_match.group(1)
    elif any(word in query_lower for word in ["my nfts", "show nft", "list nft"]):
        intent["action"] = "nft_list"
    elif any(word in query_lower for word in ["transfer nft", "send nft"]):
        intent["action"] = "nft_transfer"
        # Extract addresses
        addresses = re.findall(r'(0x[a-fA-F0-9]{40,64})', query)
        if len(addresses) >= 2:
            intent["parameters"]["nft_id"] = addresses[0]
            intent["parameters"]["recipient"] = addresses[1]
        elif len(addresses) == 1:
            intent["parameters"]["nft_id"] = addresses[0]
    elif any(word in query_lower for word in ["swap", "exchange", "trade"]):
        intent["action"] = "swap"
        # Extract amount and tokens
        amount_match = re.search(r'(\d+\.?\d*)\s*(sui|usdc|usdt)', query_lower)
        if amount_match:
            intent["parameters"]["amount"] = float(amount_match.group(1))
        tokens = re.findall(r'\b(sui|usdc|usdt)\b', query_lower)
        if len(tokens) >= 2:
            intent["parameters"]["from_token"] = tokens[0].upper()
            intent["parameters"]["to_token"] = tokens[1].upper()
    elif any(word in query_lower for word in ["price", "cost", "worth", "value"]):
        intent["action"] = "price"
        tokens = re.findall(r'\b(sui|usdc|usdt|btc|eth)\b', query_lower)
        if tokens:
            intent["parameters"]["token"] = tokens[0].upper()
    elif any(word in query_lower for word in ["help", "what can you", "capabilities"]):
        intent["action"] = "help"

    return intent


# ============================================================================
# RESPONSE FORMATTING
# ============================================================================

def format_balance_response(resp: BalanceResponse) -> str:
    """Format balance response for user"""
    if not resp.success:
        return f"❌ Sorry, I couldn't retrieve your balance: {resp.error}"

    response = "💰 Your Wallet Balance\n\n"
    for token, amount in resp.balances.items():
        response += f"- {token}: {amount}\n"
    response += f"\n📍 Deposit Address\n{resp.deposit_address}\n\nSend SUI to this address to add funds!"
    return response


def format_deposit_response(resp: DepositResponse) -> str:
    """Format deposit info for user"""
    if not resp.success:
        return f"❌ Sorry, I couldn't retrieve your deposit address: {resp.error}"

    return f"📍 Your Deposit Address\n\n{resp.deposit_address}\n\n💰 Current Balance: {resp.sui_balance} SUI\n\nSend SUI to this address from any wallet to add funds!"


def format_swap_response(resp: SwapResponse, price_info: str = "") -> str:
    """Format swap response for user"""
    if not resp.success:
        return f"❌ Swap failed: {resp.error}"

    tx_short = resp.transaction_hash[:16] + "..." if resp.transaction_hash else "N/A"
    return f"""✅ Swap completed!

{price_info}🔄 Swapped: {resp.amount} {resp.from_token} → {resp.to_token}
🔗 Transaction: {tx_short}

📊 View on Explorer:
{resp.explorer_url}

Type 'balance' to check your updated balance!"""


def format_nft_mint_response(resp: NFTMintResponse) -> str:
    """Format NFT mint response for user"""
    if not resp.success:
        return f"❌ Minting failed: {resp.error}"

    nft_short = resp.nft_id[:16] + "..." if resp.nft_id else "N/A"
    tx_short = resp.transaction_hash[:16] + "..." if resp.transaction_hash else "N/A"
    return f"""✅ NFT Minted Successfully!

🎨 Name: {resp.nft_name}
🆔 NFT ID: {nft_short}
🔗 Transaction: {tx_short}

📊 View on Explorer:
{resp.explorer_url}

Type 'my nfts' to see all your NFTs!"""


def format_nft_list_response(resp: NFTListResponse) -> str:
    """Format NFT list for user"""
    if not resp.success:
        return f"❌ Sorry, I couldn't retrieve your NFTs: {resp.error}"

    if resp.count == 0:
        return "🖼️ Your NFTs\n\nYou don't own any NFTs yet.\n\nType 'mint nft \"My Cool NFT\"' to create one!"

    response = f"🖼️ Your NFTs ({resp.count} total)\n\n"
    for nft in resp.nfts[:10]:
        nft_name = nft.get("name", "Unnamed")
        nft_id = nft.get("nftObjectId", "N/A")
        response += f"- {nft_name}\n  ID: {nft_id[:16]}...\n"

    if resp.count > 10:
        response += f"\n... and {resp.count - 10} more NFTs"

    return response


def format_nft_transfer_response(resp: NFTTransferResponse) -> str:
    """Format NFT transfer response for user"""
    if not resp.success:
        return f"❌ Transfer failed: {resp.error}"

    nft_short = resp.nft_id[:16] + "..."
    recipient_short = f"{resp.recipient[:12]}...{resp.recipient[-8:]}"
    tx_short = resp.transaction_hash[:16] + "..." if resp.transaction_hash else "N/A"
    return f"""✅ NFT Transferred Successfully!

🆔 NFT ID: {nft_short}
📥 To: {recipient_short}
🔗 Transaction: {tx_short}

📊 View on Explorer:
{resp.explorer_url}"""


def format_price_response(resp: PriceResponse) -> str:
    """Format price response for user"""
    if not resp.success:
        return f"❌ Unable to fetch {resp.token} price: {resp.error}"

    change_emoji = "📈" if resp.change_24h > 0 else "📉"
    return f"""{change_emoji} {resp.token} Price Information

💰 Current Price: ${resp.price:.4f}
📊 24h Change: {resp.change_24h:+.2f}%
📈 24h Volume: ${resp.volume_24h:,.0f}
💎 Market Cap: ${resp.market_cap:,.0f}

Data from CoinMarketCap"""


def format_help_response() -> str:
    """Format help message"""
    return """👋 Hi! I'm SuiVisor, your AI-powered Sui wallet assistant!

💰 Balance & Deposits
- 'check my balance'
- 'show deposit address'

🔄 Token Swaps
- 'swap 10 SUI to USDC'
- 'exchange 100 USDC for SUI'

🎨 NFT Operations
- 'mint nft "My Cool Art"'
- 'my nfts'
- 'transfer nft 0xabc... to 0xdef...'

💵 Price Checks
- 'price of SUI'
- 'check USDC price'

Just tell me what you want to do in natural language! 🚀

🔗 Powered by Anthropic Claude & Sui blockchain"""


# ============================================================================
# CHAT PROTOCOL HANDLERS
# ============================================================================

from uagents import Protocol
chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    """Main handler for incoming chat messages from ASI:One"""
    ctx.logger.info(f"📨 Received message from {sender}")

    # Send acknowledgement
    await ctx.send(sender, create_acknowledgement(msg.msg_id))

    # Extract text
    user_query = extract_text_from_chat(msg)
    if not user_query:
        ctx.logger.warning("Empty message received")
        return

    ctx.logger.info(f"💬 Query: {user_query}")

    try:
        # Parse intent with LLM
        intent = parse_intent_with_llm(user_query)
        action = intent["action"]
        params = intent.get("parameters", {})

        ctx.logger.info(f"🎯 Action: {action} (confidence: {intent.get('confidence', 0):.2f})")

        # Store context for response handling
        request_id = str(uuid4())
        pending_responses[request_id] = {"sender": sender, "action": action, "query": user_query}

        # Route to appropriate agent
        if action == "balance":
            await ctx.send(
                agent_addresses["balance_agent"],
                BalanceRequest(user_address=sender, original_msg_id=request_id)
            )

        elif action == "deposit":
            await ctx.send(
                agent_addresses["balance_agent"],
                DepositRequest(user_address=sender, original_msg_id=request_id)
            )

        elif action == "swap":
            if not all(k in params for k in ["amount", "from_token", "to_token"]):
                await ctx.send(sender, create_text_chat(
                    "❌ I need the amount and both tokens for a swap.\nExample: 'swap 10 SUI to USDC'"
                ))
                return

            await ctx.send(
                agent_addresses["swap_agent"],
                SwapRequest(
                    user_address=sender,
                    from_token=params["from_token"],
                    to_token=params["to_token"],
                    amount=params["amount"],
                    original_msg_id=request_id
                )
            )

        elif action == "nft_mint":
            nft_name = params.get("nft_name", "My NFT")
            await ctx.send(
                agent_addresses["nft_agent"],
                NFTMintRequest(
                    user_address=sender,
                    nft_name=nft_name,
                    original_msg_id=request_id
                )
            )

        elif action == "nft_list":
            await ctx.send(
                agent_addresses["nft_agent"],
                NFTListRequest(user_address=sender, original_msg_id=request_id)
            )

        elif action == "nft_transfer":
            if "nft_id" not in params or "recipient" not in params:
                await ctx.send(sender, create_text_chat(
                    "❌ Please provide both NFT ID and recipient address.\nExample: 'transfer nft 0xabc... to 0xdef...'"
                ))
                return

            await ctx.send(
                agent_addresses["nft_agent"],
                NFTTransferRequest(
                    user_address=sender,
                    nft_object_id=params["nft_id"],
                    recipient_address=params["recipient"],
                    original_msg_id=request_id
                )
            )

        elif action == "price":
            token = params.get("token", "SUI")
            await ctx.send(
                agent_addresses["price_agent"],
                PriceRequest(token_symbol=token, original_msg_id=request_id)
            )

        elif action == "help":
            await ctx.send(sender, create_text_chat(format_help_response()))

        else:
            await ctx.send(sender, create_text_chat(
                "I'm not sure what you want to do.\n\nI can help with:\n- Check balance: 'balance'\n- Deposit address: 'deposit'\n- Token swaps: 'swap 10 SUI to USDC'\n- Mint NFTs: 'mint nft \"My Art\"'\n- View NFTs: 'my nfts'\n- Check prices: 'price of SUI'\n\nType 'help' for more info!"
            ))

    except Exception as e:
        ctx.logger.error(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        await ctx.send(sender, create_text_chat(
            f"❌ Sorry, I encountered an error: {str(e)}\n\nPlease try again or type 'help' for assistance."
        ))


# Response handlers for sub-agents
@orchestrator.on_message(model=BalanceResponse)
async def handle_balance_response(ctx: Context, sender: str, msg: BalanceResponse):
    """Handle balance response from balance agent"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_balance_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@orchestrator.on_message(model=DepositResponse)
async def handle_deposit_response(ctx: Context, sender: str, msg: DepositResponse):
    """Handle deposit response from balance agent"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_deposit_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@orchestrator.on_message(model=SwapResponse)
async def handle_swap_response(ctx: Context, sender: str, msg: SwapResponse):
    """Handle swap response from swap agent"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_swap_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@orchestrator.on_message(model=NFTMintResponse)
async def handle_nft_mint_response(ctx: Context, sender: str, msg: NFTMintResponse):
    """Handle NFT mint response"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_nft_mint_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@orchestrator.on_message(model=NFTListResponse)
async def handle_nft_list_response(ctx: Context, sender: str, msg: NFTListResponse):
    """Handle NFT list response"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_nft_list_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@orchestrator.on_message(model=NFTTransferResponse)
async def handle_nft_transfer_response(ctx: Context, sender: str, msg: NFTTransferResponse):
    """Handle NFT transfer response"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_nft_transfer_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@orchestrator.on_message(model=PriceResponse)
async def handle_price_response(ctx: Context, sender: str, msg: PriceResponse):
    """Handle price response"""
    if msg.original_msg_id not in pending_responses:
        return

    req_ctx = pending_responses.pop(msg.original_msg_id)
    response_text = format_price_response(msg)
    await ctx.send(req_ctx["sender"], create_text_chat(response_text))
    ctx.logger.info("✅ Response sent to user")


@chat_proto.on_message(ChatAcknowledgement)
async def handle_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    """Handle acknowledgements"""
    ctx.logger.info(f"✅ Acknowledgement received from {sender}")


# ============================================================================
# AGENT LIFECYCLE
# ============================================================================

@orchestrator.on_event("startup")
async def on_startup(ctx: Context):
    """Agent startup"""
    ctx.logger.info(f"🚀 SuiVisor orchestrator started")
    ctx.logger.info(f"📍 Address: {orchestrator.address}")
    ctx.logger.info(f"🤖 AI: {'Anthropic Claude' if anthropic_client else 'Regex fallback'}")
    ctx.logger.info(f"💬 Ready for ASI:One chat!")


@orchestrator.on_event("shutdown")
async def on_shutdown(ctx: Context):
    """Agent shutdown"""
    ctx.logger.info("👋 SuiVisor orchestrator shutting down")


# Include Chat Protocol
orchestrator.include(chat_proto, publish_manifest=True)
