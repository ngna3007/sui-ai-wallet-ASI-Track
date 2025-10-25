"""
Transaction Executor Agent - The Action Taker

This agent executes blockchain transactions on Sui network by:
1. Receiving transaction requests from Portfolio Supervisor
2. Calling your existing Next.js backend API
3. Executing PTB (Programmable Transaction Blocks) on Sui
4. Returning transaction confirmations

This is the "hands" of the SuiVisor system - it takes action.
"""

import sys
import os
from typing import Optional

# Add parent directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from uagents import Agent, Context, Protocol
from shared.config import get_agent_config, BACKEND_ENDPOINTS
from shared.models import (
    SwapRequest, TransferRequest, StakeRequest, TransactionResponse,
    TransactionType, AgentStatus,
)
from shared.utils import (
    log_agent_activity,
    get_current_timestamp,
    http_post,
    validate_sui_address,
    validate_positive_number,
)


# ============================================================================
# AGENT INITIALIZATION
# ============================================================================

config = get_agent_config("EXECUTOR")

agent = Agent(
    name=config["name"],
    seed=config["seed"],
    port=config["port"],
    endpoint=config["endpoint"],
    mailbox=config["mailbox"],
)

print(f"Transaction Executor Agent Address: {agent.address}")

# Transaction execution protocol
tx_proto = Protocol(name="TransactionExecutionProtocol", version="1.0.0")


# ============================================================================
# SWAP EXECUTION
# ============================================================================

@tx_proto.on_message(SwapRequest, replies={TransactionResponse})
async def handle_swap(ctx: Context, sender: str, msg: SwapRequest):
    """
    Execute token swap on Sui blockchain

    Calls your existing backend API endpoint for swap execution
    """
    log_agent_activity(ctx, "Processing swap request", {
        "from": msg.from_token,
        "to": msg.to_token,
        "amount": msg.amount
    })

    # Validate inputs
    valid, error = validate_positive_number(msg.amount, "swap amount")
    if not valid:
        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.SWAP,
            amount=msg.amount,
            error_message=error,
            timestamp=get_current_timestamp()
        ))
        return

    # Prepare unified PTB backend request
    api_payload = {
        "userIntent": f"swap {msg.amount} {msg.from_token} to {msg.to_token}",
        "walletAddress": msg.wallet_address,
    }

    ctx.logger.info(f"Calling PTB API: {BACKEND_ENDPOINTS['PTB']}")

    try:
        # Call unified PTB backend
        success, response_data, error_msg = await http_post(
            BACKEND_ENDPOINTS["PTB"],
            api_payload,
            timeout=30
        )

        if success and response_data:
            # Extract transaction details from backend response
            tx_hash = response_data.get("transactionHash")
            gas_used = response_data.get("gasUsed", 0.0)

            ctx.logger.info(f"Swap successful: {tx_hash}")

            await ctx.send(sender, TransactionResponse(
                status=AgentStatus.SUCCESS,
                transaction_hash=tx_hash,
                transaction_type=TransactionType.SWAP,
                amount=msg.amount,
                gas_used=gas_used,
                timestamp=get_current_timestamp()
            ))
        else:
            ctx.logger.error(f"Swap failed: {error_msg}")

            await ctx.send(sender, TransactionResponse(
                status=AgentStatus.FAILURE,
                transaction_type=TransactionType.SWAP,
                amount=msg.amount,
                error_message=error_msg or "Unknown error from backend",
                timestamp=get_current_timestamp()
            ))

    except Exception as e:
        ctx.logger.error(f"Swap execution error: {e}")

        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.SWAP,
            amount=msg.amount,
            error_message=str(e),
            timestamp=get_current_timestamp()
        ))


# ============================================================================
# TRANSFER EXECUTION
# ============================================================================

@tx_proto.on_message(TransferRequest, replies={TransactionResponse})
async def handle_transfer(ctx: Context, sender: str, msg: TransferRequest):
    """
    Execute token transfer on Sui blockchain

    Calls your existing backend API endpoint for transfer
    """
    log_agent_activity(ctx, "Processing transfer request", {
        "token": msg.token,
        "amount": msg.amount,
        "recipient": msg.recipient_address
    })

    # Validate inputs
    valid, error = validate_positive_number(msg.amount, "transfer amount")
    if not valid:
        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.TRANSFER,
            amount=msg.amount,
            error_message=error,
            timestamp=get_current_timestamp()
        ))
        return

    # Validate recipient address
    valid, error = validate_sui_address(msg.recipient_address)
    if not valid:
        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.TRANSFER,
            amount=msg.amount,
            error_message=f"Invalid recipient address: {error}",
            timestamp=get_current_timestamp()
        ))
        return

    # Prepare unified PTB backend request
    api_payload = {
        "userIntent": f"transfer {msg.amount} {msg.token} to {msg.recipient_address}",
        "walletAddress": msg.wallet_address,
    }

    ctx.logger.info(f"Calling PTB API: {BACKEND_ENDPOINTS['PTB']}")

    try:
        success, response_data, error_msg = await http_post(
            BACKEND_ENDPOINTS["PTB"],
            api_payload,
            timeout=30
        )

        if success and response_data:
            tx_hash = response_data.get("transactionHash")
            gas_used = response_data.get("gasUsed", 0.0)

            ctx.logger.info(f"Transfer successful: {tx_hash}")

            await ctx.send(sender, TransactionResponse(
                status=AgentStatus.SUCCESS,
                transaction_hash=tx_hash,
                transaction_type=TransactionType.TRANSFER,
                amount=msg.amount,
                gas_used=gas_used,
                timestamp=get_current_timestamp()
            ))
        else:
            ctx.logger.error(f"Transfer failed: {error_msg}")

            await ctx.send(sender, TransactionResponse(
                status=AgentStatus.FAILURE,
                transaction_type=TransactionType.TRANSFER,
                amount=msg.amount,
                error_message=error_msg or "Unknown error from backend",
                timestamp=get_current_timestamp()
            ))

    except Exception as e:
        ctx.logger.error(f"Transfer execution error: {e}")

        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.TRANSFER,
            amount=msg.amount,
            error_message=str(e),
            timestamp=get_current_timestamp()
        ))


# ============================================================================
# STAKE EXECUTION
# ============================================================================

@tx_proto.on_message(StakeRequest, replies={TransactionResponse})
async def handle_stake(ctx: Context, sender: str, msg: StakeRequest):
    """
    Execute token staking on Sui blockchain

    Calls your existing backend API endpoint for staking
    """
    log_agent_activity(ctx, "Processing stake request", {
        "token": msg.token,
        "amount": msg.amount
    })

    # Validate inputs
    valid, error = validate_positive_number(msg.amount, "stake amount")
    if not valid:
        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.STAKE,
            amount=msg.amount,
            error_message=error,
            timestamp=get_current_timestamp()
        ))
        return

    # Prepare unified PTB backend request
    validator_text = f" with validator {msg.validator_address}" if msg.validator_address else ""
    api_payload = {
        "userIntent": f"stake {msg.amount} {msg.token}{validator_text}",
        "walletAddress": msg.wallet_address,
    }

    ctx.logger.info(f"Calling PTB API: {BACKEND_ENDPOINTS['PTB']}")

    try:
        success, response_data, error_msg = await http_post(
            BACKEND_ENDPOINTS["PTB"],
            api_payload,
            timeout=30
        )

        if success and response_data:
            tx_hash = response_data.get("transactionHash")
            gas_used = response_data.get("gasUsed", 0.0)

            ctx.logger.info(f"Stake successful: {tx_hash}")

            await ctx.send(sender, TransactionResponse(
                status=AgentStatus.SUCCESS,
                transaction_hash=tx_hash,
                transaction_type=TransactionType.STAKE,
                amount=msg.amount,
                gas_used=gas_used,
                timestamp=get_current_timestamp()
            ))
        else:
            ctx.logger.error(f"Stake failed: {error_msg}")

            await ctx.send(sender, TransactionResponse(
                status=AgentStatus.FAILURE,
                transaction_type=TransactionType.STAKE,
                amount=msg.amount,
                error_message=error_msg or "Unknown error from backend",
                timestamp=get_current_timestamp()
            ))

    except Exception as e:
        ctx.logger.error(f"Stake execution error: {e}")

        await ctx.send(sender, TransactionResponse(
            status=AgentStatus.ERROR,
            transaction_type=TransactionType.STAKE,
            amount=msg.amount,
            error_message=str(e),
            timestamp=get_current_timestamp()
        ))


# ============================================================================
# AGENT LIFECYCLE
# ============================================================================

@agent.on_event("startup")
async def on_startup(ctx: Context):
    """Agent initialization"""
    ctx.logger.info("Transaction Executor Agent started")
    ctx.logger.info(f"Agent address: {agent.address}")
    ctx.logger.info(f"Backend API: {BACKEND_ENDPOINTS['SWAP']}")


# ============================================================================
# PROTOCOL REGISTRATION
# ============================================================================

agent.include(tx_proto, publish_manifest=True)


# ============================================================================
# RUN AGENT
# ============================================================================

if __name__ == "__main__":
    print("="*60)
    print("SuiVisor - Transaction Executor Agent")
    print("="*60)
    print(f"Agent Name: {agent.name}")
    print(f"Agent Address: {agent.address}")
    print("="*60)
    print("\n🚀 Starting agent...")
    agent.run()
