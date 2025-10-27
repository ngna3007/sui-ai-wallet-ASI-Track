"""
NFT Agent - Handles NFT minting, listing, and transfers
"""
import os
import httpx
from uagents import Agent, Context
from models import (
    NFTMintRequest, NFTMintResponse,
    NFTListRequest, NFTListResponse,
    NFTTransferRequest, NFTTransferResponse
)

# Configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")

# Create NFT Agent
nft_agent = Agent(
    name="nft_agent",
    seed="nft_agent_secret_seed_789"
)


@nft_agent.on_message(model=NFTMintRequest, replies=NFTMintResponse)
async def handle_mint_request(ctx: Context, sender: str, msg: NFTMintRequest):
    """Handle NFT minting request"""
    ctx.logger.info(f"🎨 Minting NFT: {msg.nft_name}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/mint-nft",
                json={
                    "userAddress": msg.user_address,
                    "name": msg.nft_name,
                    "description": msg.description,
                    "imageUrl": msg.image_url
                }
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    NFTMintResponse(
                        success=False,
                        nft_name=msg.nft_name,
                        error=f"Backend error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            result = response.json()

            if not result.get("success"):
                await ctx.send(
                    sender,
                    NFTMintResponse(
                        success=False,
                        nft_name=msg.nft_name,
                        error=result.get("error", "Unknown error"),
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            await ctx.send(
                sender,
                NFTMintResponse(
                    success=True,
                    nft_id=result.get("nftObjectId"),
                    nft_name=msg.nft_name,
                    transaction_hash=result.get("transactionHash"),
                    explorer_url=result.get("explorerUrl"),
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info("✅ NFT minted successfully")

    except Exception as e:
        ctx.logger.error(f"❌ NFT minting failed: {e}")
        await ctx.send(
            sender,
            NFTMintResponse(
                success=False,
                nft_name=msg.nft_name,
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )


@nft_agent.on_message(model=NFTListRequest, replies=NFTListResponse)
async def handle_list_request(ctx: Context, sender: str, msg: NFTListRequest):
    """Handle NFT list request"""
    ctx.logger.info(f"🖼️ Listing NFTs for {msg.user_address[:12]}...")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{BACKEND_URL}/api/user/nfts",
                params={"userAddress": msg.user_address, "status": msg.status}
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    NFTListResponse(
                        success=False,
                        nfts=[],
                        count=0,
                        error=f"Backend error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            result = response.json()

            if not result.get("success"):
                await ctx.send(
                    sender,
                    NFTListResponse(
                        success=False,
                        nfts=[],
                        count=0,
                        error=result.get("error", "Unknown error"),
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            await ctx.send(
                sender,
                NFTListResponse(
                    success=True,
                    nfts=result.get("nfts", []),
                    count=result.get("count", 0),
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info("✅ NFT list retrieved")

    except Exception as e:
        ctx.logger.error(f"❌ NFT list failed: {e}")
        await ctx.send(
            sender,
            NFTListResponse(
                success=False,
                nfts=[],
                count=0,
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )


@nft_agent.on_message(model=NFTTransferRequest, replies=NFTTransferResponse)
async def handle_transfer_request(ctx: Context, sender: str, msg: NFTTransferRequest):
    """Handle NFT transfer request"""
    ctx.logger.info(f"📤 Transferring NFT {msg.nft_object_id[:16]}...")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BACKEND_URL}/api/transfer-nft",
                json={
                    "userAddress": msg.user_address,
                    "nftObjectId": msg.nft_object_id,
                    "recipientAddress": msg.recipient_address
                }
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    NFTTransferResponse(
                        success=False,
                        nft_id=msg.nft_object_id,
                        recipient=msg.recipient_address,
                        error=f"Backend error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            result = response.json()

            if not result.get("success"):
                await ctx.send(
                    sender,
                    NFTTransferResponse(
                        success=False,
                        nft_id=msg.nft_object_id,
                        recipient=msg.recipient_address,
                        error=result.get("error", "Unknown error"),
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            await ctx.send(
                sender,
                NFTTransferResponse(
                    success=True,
                    nft_id=msg.nft_object_id,
                    recipient=msg.recipient_address,
                    transaction_hash=result.get("transactionHash"),
                    explorer_url=result.get("explorerUrl"),
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info("✅ NFT transferred successfully")

    except Exception as e:
        ctx.logger.error(f"❌ NFT transfer failed: {e}")
        await ctx.send(
            sender,
            NFTTransferResponse(
                success=False,
                nft_id=msg.nft_object_id,
                recipient=msg.recipient_address,
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )
