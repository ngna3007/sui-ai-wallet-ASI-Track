"""
Message Models for SuiVisor Multi-Agent System

These Pydantic models define the message contracts between agents
"""
from typing import Dict, Any, List, Optional
from uagents import Model


# ============================================================================
# USER QUERY MESSAGES
# ============================================================================

class UserQuery(Model):
    """User query received from ASI:One chat"""
    user_address: str
    message: str
    original_msg_id: str


class ParsedIntent(Model):
    """LLM-parsed user intent from orchestrator"""
    user_address: str
    action: str  # balance, swap, nft_mint, nft_list, nft_transfer, price, risk, help, deposit
    parameters: Dict[str, Any]
    confidence: float
    original_query: str
    original_msg_id: str


# ============================================================================
# BALANCE AGENT MESSAGES
# ============================================================================

class BalanceRequest(Model):
    """Request to check user balance"""
    user_address: str
    original_msg_id: str


class BalanceResponse(Model):
    """Balance information response"""
    success: bool
    user_address: str
    balances: Dict[str, float]
    deposit_address: str
    error: Optional[str] = None
    original_msg_id: str


# ============================================================================
# SWAP AGENT MESSAGES
# ============================================================================

class SwapRequest(Model):
    """Request to execute token swap"""
    user_address: str
    from_token: str
    to_token: str
    amount: float
    slippage: float = 0.01
    original_msg_id: str


class SwapResponse(Model):
    """Swap execution response"""
    success: bool
    from_token: str
    to_token: str
    amount: float
    transaction_hash: Optional[str] = None
    explorer_url: Optional[str] = None
    error: Optional[str] = None
    original_msg_id: str


# ============================================================================
# NFT AGENT MESSAGES
# ============================================================================

class NFTMintRequest(Model):
    """Request to mint NFT"""
    user_address: str
    nft_name: str
    description: Optional[str] = "NFT created via SuiVisor"
    image_url: Optional[str] = "https://placehold.co/400x400/png?text=SuiVisor+NFT"
    original_msg_id: str


class NFTMintResponse(Model):
    """NFT minting response"""
    success: bool
    nft_id: Optional[str] = None
    nft_name: str
    transaction_hash: Optional[str] = None
    explorer_url: Optional[str] = None
    error: Optional[str] = None
    original_msg_id: str


class NFTListRequest(Model):
    """Request to list user's NFTs"""
    user_address: str
    status: str = "owned"
    original_msg_id: str


class NFTListResponse(Model):
    """NFT list response"""
    success: bool
    nfts: List[Dict[str, Any]]
    count: int
    error: Optional[str] = None
    original_msg_id: str


class NFTTransferRequest(Model):
    """Request to transfer NFT"""
    user_address: str
    nft_object_id: str
    recipient_address: str
    original_msg_id: str


class NFTTransferResponse(Model):
    """NFT transfer response"""
    success: bool
    nft_id: str
    recipient: str
    transaction_hash: Optional[str] = None
    explorer_url: Optional[str] = None
    error: Optional[str] = None
    original_msg_id: str


# ============================================================================
# PRICE AGENT MESSAGES
# ============================================================================

class PriceRequest(Model):
    """Request for token price"""
    token_symbol: str
    original_msg_id: str


class PriceResponse(Model):
    """Token price response"""
    success: bool
    token: str
    price: Optional[float] = None
    change_24h: Optional[float] = None
    volume_24h: Optional[float] = None
    market_cap: Optional[float] = None
    error: Optional[str] = None
    original_msg_id: str


# ============================================================================
# DEPOSIT INFO MESSAGES
# ============================================================================

class DepositRequest(Model):
    """Request for deposit address"""
    user_address: str
    original_msg_id: str


class DepositResponse(Model):
    """Deposit address response"""
    success: bool
    deposit_address: str
    sui_balance: float
    error: Optional[str] = None
    original_msg_id: str


# ============================================================================
# HELP MESSAGES
# ============================================================================

class HelpRequest(Model):
    """Request for help information"""
    original_msg_id: str


class HelpResponse(Model):
    """Help information response"""
    help_text: str
    original_msg_id: str
