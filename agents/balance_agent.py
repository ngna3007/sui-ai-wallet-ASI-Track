"""
Balance Agent - Handles balance checks and deposit info
"""
import os
import httpx
from uagents import Agent, Context
from models import (
    BalanceRequest, BalanceResponse,
    DepositRequest, DepositResponse
)

# Configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")

# Create Balance Agent
balance_agent = Agent(
    name="balance_agent",
    seed="balance_agent_secret_seed_123"
)


@balance_agent.on_message(model=BalanceRequest, replies=BalanceResponse)
async def handle_balance_request(ctx: Context, sender: str, msg: BalanceRequest):
    """Handle balance check request"""
    ctx.logger.info(f"💰 Balance check for {msg.user_address[:12]}...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                params={"userAddress": msg.user_address}
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    BalanceResponse(
                        success=False,
                        user_address=msg.user_address,
                        balances={},
                        deposit_address="",
                        error=f"Backend error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            result = response.json()

            if not result.get("success"):
                await ctx.send(
                    sender,
                    BalanceResponse(
                        success=False,
                        user_address=msg.user_address,
                        balances={},
                        deposit_address="",
                        error=result.get("error", "Unknown error"),
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            user = result.get("user", {})
            await ctx.send(
                sender,
                BalanceResponse(
                    success=True,
                    user_address=msg.user_address,
                    balances=user.get("balances", {}),
                    deposit_address=user.get("depositAddress", "N/A"),
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info("✅ Balance check completed")

    except Exception as e:
        ctx.logger.error(f"❌ Balance check failed: {e}")
        await ctx.send(
            sender,
            BalanceResponse(
                success=False,
                user_address=msg.user_address,
                balances={},
                deposit_address="",
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )


@balance_agent.on_message(model=DepositRequest, replies=DepositResponse)
async def handle_deposit_request(ctx: Context, sender: str, msg: DepositRequest):
    """Handle deposit address request"""
    ctx.logger.info(f"📍 Deposit info for {msg.user_address[:12]}...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/info",
                params={"userAddress": msg.user_address}
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    DepositResponse(
                        success=False,
                        deposit_address="",
                        sui_balance=0,
                        error=f"Backend error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            result = response.json()

            if not result.get("success"):
                await ctx.send(
                    sender,
                    DepositResponse(
                        success=False,
                        deposit_address="",
                        sui_balance=0,
                        error=result.get("error", "Unknown error"),
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            user = result.get("user", {})
            balances = user.get("balances", {})

            await ctx.send(
                sender,
                DepositResponse(
                    success=True,
                    deposit_address=user.get("depositAddress", "N/A"),
                    sui_balance=balances.get("SUI", 0),
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info("✅ Deposit info sent")

    except Exception as e:
        ctx.logger.error(f"❌ Deposit request failed: {e}")
        await ctx.send(
            sender,
            DepositResponse(
                success=False,
                deposit_address="",
                sui_balance=0,
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )
