"""
Sui Assistant Coordinator - The Brain

This agent is the user-facing interface through ASI:One. It:
1. Receives natural language queries from users via Chat Protocol
2. Parses intent and routes to specialist agents
3. Aggregates responses and makes decisions
4. Provides clear, actionable responses to users

This is the "brain" of the SuiVisor system.
"""

import sys
import os
from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional, Dict, Any, List

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    chat_protocol_spec,
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
    StartSessionContent,
    EndSessionContent,
)

from shared.config import get_agent_config, AGENT_ADDRESSES, ASI_ONE_AGENT
from shared.models import (
    PriceRequest, PriceResponse,
    RiskCheckRequest, RiskCheckResponse,
    SwapRequest, TransferRequest, StakeRequest, TransactionResponse,
    UserIntent, SupervisorDecision, TaskCompletionReport,
    TransactionType, AgentStatus,
)
from shared.utils import (
    create_text_chat,
    extract_text_from_chat,
    create_acknowledgement,
    log_agent_activity,
    get_current_timestamp,
    format_currency,
    format_token_amount,
)


# ============================================================================
# AGENT INITIALIZATION
# ============================================================================

# Get agent configuration
config = get_agent_config("COORDINATOR")

# Create agent instance
agent = Agent(
    name=config["name"],
    seed=config["seed"],
    port=config["port"],
    endpoint=config["endpoint"],
    mailbox=config["mailbox"],
)

# Print agent address (needed for Agentverse registration)
print(f"Sui Assistant Coordinator Address: {agent.address}")

# Initialize Chat Protocol (CRITICAL for ASI:One compatibility)
chat_proto = Protocol(spec=chat_protocol_spec)

# Protocol for structured output parsing (uses ASI:One LLM)
struct_output_proto = Protocol(name="StructuredOutputProtocol", version="0.1.0")


# ============================================================================
# MESSAGE MODELS FOR ASI:ONE STRUCTURED OUTPUT
# ============================================================================

from uagents import Model

class StructuredOutputPrompt(Model):
    """Send to ASI:One agent for NLP parsing"""
    prompt: str
    output_schema: Dict[str, Any]


class StructuredOutputResponse(Model):
    """Receive from ASI:One agent with parsed intent"""
    output: Dict[str, Any]


# ============================================================================
# INTENT PARSING (Natural Language Understanding)
# ============================================================================

INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["swap", "transfer", "stake", "check_price", "check_balance", "analyze_risk", "help", "unknown"],
            "description": "The primary action the user wants to perform"
        },
        "from_token": {
            "type": "string",
            "description": "Source token symbol (for swap)"
        },
        "to_token": {
            "type": "string",
            "description": "Destination token symbol (for swap or price check)"
        },
        "token": {
            "type": "string",
            "description": "Token symbol (for transfer, stake, balance)"
        },
        "amount": {
            "type": "number",
            "description": "Amount of tokens"
        },
        "recipient": {
            "type": "string",
            "description": "Recipient address (for transfer)"
        },
        "slippage": {
            "type": "number",
            "description": "Slippage tolerance (0.01 = 1%)"
        },
        "confidence": {
            "type": "number",
            "description": "Confidence score 0-1"
        }
    },
    "required": ["action", "confidence"]
}


async def parse_user_intent(ctx: Context, user_query: str) -> Optional[Dict[str, Any]]:
    """
    Parse user's natural language query using ASI:One LLM

    Args:
        ctx: Agent context
        user_query: User's natural language input

    Returns:
        Parsed intent dictionary or None if parsing fails
    """
    log_agent_activity(ctx, "Parsing user intent", {"query": user_query})

    try:
        # Send to ASI:One agent for structured output
        await ctx.send(
            ASI_ONE_AGENT,
            StructuredOutputPrompt(
                prompt=f"Parse this DeFi wallet query: {user_query}",
                output_schema=INTENT_SCHEMA
            )
        )

        # Wait for response (with timeout)
        response = await ctx.receive(timeout=10.0)

        if isinstance(response, StructuredOutputResponse):
            log_agent_activity(ctx, "Intent parsed successfully", response.output)
            return response.output
        else:
            ctx.logger.warning(f"Unexpected response type: {type(response)}")
            return None

    except Exception as e:
        ctx.logger.error(f"Intent parsing failed: {e}")
        return None


# ============================================================================
# SPECIALIST AGENT COORDINATION
# ============================================================================

async def consult_market_agent(ctx: Context, token_symbol: str) -> Optional[PriceResponse]:
    """Get current price from Market Intelligence Agent"""
    if not AGENT_ADDRESSES["MARKET"]:
        ctx.logger.warning("Market agent address not configured")
        return None

    try:
        log_agent_activity(ctx, "Consulting market agent", {"token": token_symbol})

        response = await ctx.send_and_receive(
            AGENT_ADDRESSES["MARKET"],
            PriceRequest(token_symbol=token_symbol),
            timeout=5.0
        )

        if isinstance(response, PriceResponse):
            return response
        return None

    except Exception as e:
        ctx.logger.error(f"Market agent consultation failed: {e}")
        return None


async def consult_risk_agent(ctx: Context, risk_request: RiskCheckRequest) -> Optional[RiskCheckResponse]:
    """Get risk assessment from Risk Analyzer Agent"""
    if not AGENT_ADDRESSES["RISK"]:
        ctx.logger.warning("Risk agent address not configured")
        return None

    try:
        log_agent_activity(ctx, "Consulting risk agent", {
            "type": risk_request.transaction_type,
            "amount": risk_request.amount
        })

        response = await ctx.send_and_receive(
            AGENT_ADDRESSES["RISK"],
            risk_request,
            timeout=5.0
        )

        if isinstance(response, RiskCheckResponse):
            return response
        return None

    except Exception as e:
        ctx.logger.error(f"Risk agent consultation failed: {e}")
        return None


async def execute_transaction(ctx: Context, tx_request: Any) -> Optional[TransactionResponse]:
    """Execute transaction via Transaction Executor Agent"""
    if not AGENT_ADDRESSES["EXECUTOR"]:
        ctx.logger.warning("Executor agent address not configured")
        return None

    try:
        log_agent_activity(ctx, "Executing transaction", {"type": type(tx_request).__name__})

        response = await ctx.send_and_receive(
            AGENT_ADDRESSES["EXECUTOR"],
            tx_request,
            timeout=30.0  # Longer timeout for blockchain operations
        )

        if isinstance(response, TransactionResponse):
            return response
        return None

    except Exception as e:
        ctx.logger.error(f"Transaction execution failed: {e}")
        return None


# ============================================================================
# DECISION MAKING & ORCHESTRATION
# ============================================================================

async def handle_swap_request(ctx: Context, intent: Dict[str, Any], sender: str) -> str:
    """Handle swap transaction request"""
    from_token = intent.get("from_token")
    to_token = intent.get("to_token")
    amount = intent.get("amount")

    if not all([from_token, to_token, amount]):
        return "❌ I need more information. Please specify: which token to swap from, which token to swap to, and the amount."

    # Step 1: Get current price
    await ctx.send(sender, create_text_chat(f"🔍 Checking {to_token} price..."))
    price_info = await consult_market_agent(ctx, to_token)

    if not price_info:
        return f"❌ Unable to get price for {to_token}. Please try again."

    estimated_output = amount * price_info.price if from_token == "SUI" else amount / price_info.price
    price_text = f"Current {to_token} price: {format_currency(price_info.price)}\nEstimated output: {format_token_amount(estimated_output, to_token)}"

    await ctx.send(sender, create_text_chat(price_text))

    # Step 2: Risk assessment
    await ctx.send(sender, create_text_chat("🛡️ Analyzing transaction safety..."))

    risk_check = await consult_risk_agent(
        ctx,
        RiskCheckRequest(
            transaction_type=TransactionType.SWAP,
            from_token=from_token,
            to_token=to_token,
            amount=amount,
            slippage_tolerance=intent.get("slippage", 0.01),
        )
    )

    if not risk_check or not risk_check.is_safe:
        warnings = "\n".join(f"⚠️ {w}" for w in (risk_check.warnings if risk_check else ["Unknown risk"]))
        return f"❌ Transaction flagged as risky:\n{warnings}\n\nTransaction cancelled for your safety."

    await ctx.send(sender, create_text_chat(f"✅ Safety check passed: {risk_check.risk_level.value} risk"))

    # Step 3: Execute swap
    await ctx.send(sender, create_text_chat("⚙️ Executing swap on Sui blockchain..."))

    tx_result = await execute_transaction(
        ctx,
        SwapRequest(
            from_token=from_token,
            to_token=to_token,
            amount=amount,
            slippage_tolerance=intent.get("slippage", 0.01),
            wallet_address="0x..."  # TODO: Get from user session
        )
    )

    if not tx_result or tx_result.status != AgentStatus.SUCCESS:
        error_msg = tx_result.error_message if tx_result else "Unknown error"
        return f"❌ Swap failed: {error_msg}"

    # Step 4: Success response
    return f"""✅ Swap completed successfully!

📊 Details:
  • Swapped: {format_token_amount(amount, from_token)}
  • Received: ~{format_token_amount(estimated_output, to_token)}
  • Gas used: {format_token_amount(tx_result.gas_used or 0, 'SUI')}
  • Transaction: {tx_result.transaction_hash}

🔗 View on Sui Explorer"""


async def handle_price_check(ctx: Context, intent: Dict[str, Any]) -> str:
    """Handle price check request"""
    token = intent.get("to_token") or intent.get("token")

    if not token:
        return "❌ Please specify which token price you want to check."

    price_info = await consult_market_agent(ctx, token)

    if not price_info:
        return f"❌ Unable to get price for {token}. Please try again."

    change_emoji = "📈" if price_info.change_24h > 0 else "📉"
    return f"""{change_emoji} {token} Price Information

💰 Current Price: {format_currency(price_info.price)}
📊 24h Change: {price_info.change_24h:+.2f}%
📈 24h Volume: {format_currency(price_info.volume_24h or 0)}

Updated: {price_info.timestamp}"""


# ============================================================================
# CHAT PROTOCOL HANDLERS
# ============================================================================

@chat_proto.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    """
    Main handler for incoming chat messages from ASI:One

    This is the entry point for all user interactions.
    """
    log_agent_activity(ctx, "Received chat message", {"from": sender})

    # Send acknowledgement immediately (required by Chat Protocol)
    await ctx.send(sender, create_acknowledgement(msg.msg_id))

    # Extract text from message
    user_query = extract_text_from_chat(msg)

    if not user_query:
        ctx.logger.warning("Empty message received")
        return

    log_agent_activity(ctx, "Processing query", {"query": user_query})

    # Store sender for session management
    ctx.storage.set(str(ctx.session), sender)

    try:
        # Parse user intent using ASI:One NLP
        intent = await parse_user_intent(ctx, user_query)

        if not intent:
            response_text = "I'm sorry, I couldn't understand your request. I can help you swap tokens, check prices, transfer funds, and stake tokens on Sui blockchain. What would you like to do?"
        else:
            action = intent.get("action")

            # Route to appropriate handler
            if action == "swap":
                response_text = await handle_swap_request(ctx, intent, sender)
            elif action == "check_price":
                response_text = await handle_price_check(ctx, intent)
            elif action == "help":
                response_text = """🤖 SuiVisor - Your AI DeFi Portfolio Manager

I can help you with:
  • 💱 Swap tokens on Sui blockchain
  • 📤 Transfer tokens to other addresses
  • 🔒 Stake SUI tokens
  • 💰 Check token prices
  • 📊 Analyze transaction risks

Just tell me what you want to do in natural language!

Example: "Swap 10 SUI to USDC" """
            else:
                response_text = f"I understand you want to '{action}', but this feature is still being implemented. Try asking me to check a price or swap tokens!"

        # Send final response
        await ctx.send(sender, create_text_chat(response_text, end_session=False))

    except Exception as e:
        ctx.logger.error(f"Error processing message: {e}")
        error_response = f"❌ Sorry, I encountered an error: {str(e)}\nPlease try again."
        await ctx.send(sender, create_text_chat(error_response, end_session=False))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    """Handle acknowledgements from recipients"""
    log_agent_activity(ctx, "Received acknowledgement", {
        "from": sender,
        "msg_id": str(msg.acknowledged_msg_id)
    })


# ============================================================================
# STRUCTURED OUTPUT PROTOCOL HANDLER
# ============================================================================

@struct_output_proto.on_message(StructuredOutputResponse)
async def handle_structured_output(ctx: Context, sender: str, msg: StructuredOutputResponse):
    """Handle parsed intent from ASI:One agent"""
    log_agent_activity(ctx, "Received structured output", msg.output)

    # Store in context for retrieval by request handler
    session_id = str(ctx.session)
    ctx.storage.set(f"intent_{session_id}", msg.output)


# ============================================================================
# AGENT LIFECYCLE
# ============================================================================

@agent.on_event("startup")
async def on_startup(ctx: Context):
    """Agent initialization"""
    ctx.logger.info(f"Sui Assistant Coordinator started")
    ctx.logger.info(f"Agent address: {agent.address}")
    ctx.logger.info(f"Ready to receive messages via ASI:One")


@agent.on_event("shutdown")
async def on_shutdown(ctx: Context):
    """Cleanup on shutdown"""
    ctx.logger.info("Sui Assistant Coordinator shutting down")


# ============================================================================
# PROTOCOL REGISTRATION
# ============================================================================

# Include Chat Protocol (MANDATORY for ASI:One)
agent.include(chat_proto, publish_manifest=True)

# Include Structured Output Protocol
agent.include(struct_output_proto, publish_manifest=True)


# ============================================================================
# RUN AGENT
# ============================================================================

if __name__ == "__main__":
    print("="*60)
    print("SuiVisor - Sui Assistant Coordinator")
    print("="*60)
    print(f"Agent Name: {agent.name}")
    print(f"Agent Address: {agent.address}")
    print(f"Deployment Mode: {config['mailbox'] and 'Agentverse Mailbox' or 'Local'}")
    print("="*60)
    print("\n🚀 Starting agent...")
    agent.run()
