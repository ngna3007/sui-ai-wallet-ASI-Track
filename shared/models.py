"""
Shared Message Models for SuiVisor Multi-Agent System

These models define the communication protocol between agents.
All agents use these models to ensure compatibility.
"""

from uagents import Model
from typing import Optional, List, Dict, Any
from enum import Enum


# ============================================================================
# ENUMS
# ============================================================================

class TransactionType(str, Enum):
    """Types of blockchain transactions"""
    SWAP = "swap"
    TRANSFER = "transfer"
    STAKE = "stake"
    UNSTAKE = "unstake"


class RiskLevel(str, Enum):
    """Risk assessment levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AgentStatus(str, Enum):
    """Agent operation status"""
    SUCCESS = "success"
    FAILURE = "failure"
    PENDING = "pending"
    ERROR = "error"


# ============================================================================
# MARKET INTELLIGENCE MESSAGES
# ============================================================================

class PriceRequest(Model):
    """Request current price for a token"""
    token_symbol: str
    quote_currency: str = "USD"


class PriceResponse(Model):
    """Response with token price information"""
    token_symbol: str
    price: float
    quote_currency: str
    change_24h: float
    volume_24h: Optional[float] = None
    timestamp: str


class MarketAlertRequest(Model):
    """Request to set up price alerts"""
    token_symbol: str
    threshold_price: float
    alert_type: str  # "above" or "below"


# ============================================================================
# RISK ANALYSIS MESSAGES
# ============================================================================

class RiskCheckRequest(Model):
    """Request risk analysis for a transaction"""
    transaction_type: TransactionType
    from_token: Optional[str] = None
    to_token: Optional[str] = None
    amount: float
    recipient_address: Optional[str] = None
    slippage_tolerance: Optional[float] = None
    estimated_gas: Optional[float] = None


class RiskCheckResponse(Model):
    """Response with risk assessment"""
    risk_level: RiskLevel
    is_safe: bool
    warnings: List[str]
    recommendations: List[str]
    confidence_score: float  # 0.0 to 1.0
    reasoning: str  # Explanation from MeTTa knowledge base


class AddressValidationRequest(Model):
    """Request to validate a Sui address"""
    address: str


class AddressValidationResponse(Model):
    """Response with address validation result"""
    is_valid: bool
    address_type: Optional[str] = None  # "wallet", "contract", etc.
    warnings: List[str]


# ============================================================================
# TRANSACTION EXECUTION MESSAGES
# ============================================================================

class SwapRequest(Model):
    """Request to execute a token swap"""
    from_token: str
    to_token: str
    amount: float
    slippage_tolerance: float = 0.01
    wallet_address: str


class TransferRequest(Model):
    """Request to transfer tokens"""
    token: str
    amount: float
    recipient_address: str
    wallet_address: str


class StakeRequest(Model):
    """Request to stake tokens"""
    token: str
    amount: float
    validator_address: Optional[str] = None
    wallet_address: str


class TransactionResponse(Model):
    """Response from transaction execution"""
    status: AgentStatus
    transaction_hash: Optional[str] = None
    transaction_type: TransactionType
    amount: float
    gas_used: Optional[float] = None
    error_message: Optional[str] = None
    timestamp: str


# ============================================================================
# PORTFOLIO SUPERVISOR MESSAGES
# ============================================================================

class UserIntent(Model):
    """Parsed user intent from natural language"""
    action: str  # "swap", "transfer", "stake", "check_price", "analyze_risk"
    parameters: Dict[str, Any]
    confidence: float
    original_query: str


class SupervisorDecision(Model):
    """Decision made by portfolio supervisor"""
    approved: bool
    action_plan: str
    agents_to_consult: List[str]
    reasoning: str


class TaskCompletionReport(Model):
    """Final report from supervisor to user"""
    success: bool
    summary: str
    details: Dict[str, Any]
    transaction_hash: Optional[str] = None
    recommendations: List[str]


# ============================================================================
# AGENT HEALTH & STATUS
# ============================================================================

class AgentHealthCheck(Model):
    """Health check request"""
    timestamp: str


class AgentHealthResponse(Model):
    """Health check response"""
    agent_name: str
    status: str  # "healthy", "degraded", "down"
    uptime_seconds: int
    last_activity: str
    capabilities: List[str]


# ============================================================================
# ERROR HANDLING
# ============================================================================

class ErrorReport(Model):
    """Standard error report format"""
    error_type: str
    error_message: str
    agent_name: str
    timestamp: str
    context: Optional[Dict[str, Any]] = None
    recoverable: bool
