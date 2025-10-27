"""
Swap Agent - Handles token swaps via Cetus DEX
"""
import os
import httpx
from uagents import Agent, Context
from models import SwapRequest, SwapResponse

# Configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")

# Create Swap Agent
swap_agent = Agent(
    name="swap_agent",
    seed="swap_agent_secret_seed_456"
)


@swap_agent.on_message(model=SwapRequest, replies=SwapResponse)
async def handle_swap_request(ctx: Context, sender: str, msg: SwapRequest):
    """Handle token swap request"""
    ctx.logger.info(f"🔄 Swap: {msg.amount} {msg.from_token} → {msg.to_token}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/swap",
                json={
                    "userAddress": msg.user_address,
                    "fromCoin": msg.from_token,
                    "toCoin": msg.to_token,
                    "amount": msg.amount,
                    "slippage": msg.slippage
                }
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    SwapResponse(
                        success=False,
                        from_token=msg.from_token,
                        to_token=msg.to_token,
                        amount=msg.amount,
                        error=f"Backend error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            result = response.json()

            if not result.get("success"):
                await ctx.send(
                    sender,
                    SwapResponse(
                        success=False,
                        from_token=msg.from_token,
                        to_token=msg.to_token,
                        amount=msg.amount,
                        error=result.get("error", "Unknown error"),
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            await ctx.send(
                sender,
                SwapResponse(
                    success=True,
                    from_token=msg.from_token,
                    to_token=msg.to_token,
                    amount=msg.amount,
                    transaction_hash=result.get("transactionHash"),
                    explorer_url=result.get("explorerUrl"),
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info("✅ Swap completed successfully")

    except Exception as e:
        ctx.logger.error(f"❌ Swap failed: {e}")
        await ctx.send(
            sender,
            SwapResponse(
                success=False,
                from_token=msg.from_token,
                to_token=msg.to_token,
                amount=msg.amount,
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )
