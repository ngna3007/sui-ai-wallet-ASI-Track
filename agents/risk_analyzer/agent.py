"""
Risk Analyzer Agent - The Safety Guardian

This agent assesses transaction safety using MeTTa knowledge graph reasoning:
1. Validates addresses and transaction parameters
2. Queries MeTTa knowledge base for safety rules
3. Calculates risk scores and provides recommendations
4. Prevents unsafe transactions

This is the "shield" of the SuiVisor system - it keeps users safe.

** USES SINGULARITYNET METTA - CRITICAL FOR PRIZE ELIGIBILITY **
"""

import sys
import os
from typing import Optional, List, Tuple

# Add parent directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from uagents import Agent, Context, Protocol

try:
    from hyperon import MeTTa, GroundingSpace
    METTA_AVAILABLE = True
except ImportError:
    print("⚠️ WARNING: hyperon (MeTTa) not installed!")
    print("Install with: pip install hyperon")
    METTA_AVAILABLE = False

from shared.config import get_agent_config, METTA_KB_PATH
from shared.models import (
    RiskCheckRequest, RiskCheckResponse,
    AddressValidationRequest, AddressValidationResponse,
    RiskLevel,
)
from shared.utils import (
    log_agent_activity,
    validate_sui_address,
    validate_positive_number,
    validate_percentage,
)


# ============================================================================
# AGENT INITIALIZATION
# ============================================================================

config = get_agent_config("RISK")

agent = Agent(
    name=config["name"],
    seed=config["seed"],
    port=config["port"],
    endpoint=config["endpoint"],
    mailbox=config["mailbox"],
)

print(f"Risk Analyzer Agent Address: {agent.address}")

# Risk analysis protocol
risk_proto = Protocol(name="RiskAnalysisProtocol", version="1.0.0")


# ============================================================================
# METTA KNOWLEDGE BASE INTEGRATION
# ============================================================================

class MeTTaRiskAnalyzer:
    """
    MeTTa-powered risk analyzer using symbolic reasoning

    This class interfaces with the MeTTa knowledge base to make
    deterministic safety decisions based on explicit rules.
    """

    def __init__(self):
        self.metta = None
        self.initialized = False

        if METTA_AVAILABLE:
            try:
                self.metta = MeTTa()
                kb_file = os.path.join(METTA_KB_PATH, "defi_safety_rules.metta")

                if os.path.exists(kb_file):
                    with open(kb_file, 'r') as f:
                        kb_content = f.read()
                        self.metta.run(kb_content)

                    self.initialized = True
                    print(f"✅ MeTTa knowledge base loaded: {kb_file}")
                else:
                    print(f"⚠️ MeTTa knowledge base not found: {kb_file}")
            except Exception as e:
                print(f"❌ Failed to initialize MeTTa: {e}")
        else:
            print("⚠️ MeTTa not available - using fallback risk analysis")

    def query(self, query_string: str) -> Optional[str]:
        """Execute MeTTa query and return result"""
        if not self.initialized or not self.metta:
            return None

        try:
            result = self.metta.run(query_string)
            return str(result) if result else None
        except Exception as e:
            print(f"MeTTa query error: {e}")
            return None

    def is_safe_gas(self, gas_amount: float) -> bool:
        """Check if gas amount is safe using MeTTa rules"""
        if not self.initialized:
            # Fallback: simple threshold check
            return 0.0 < gas_amount < 0.5

        result = self.query(f"(? (safe-gas {gas_amount}))")
        return "True" in str(result) if result else False

    def is_safe_slippage(self, slippage: float) -> bool:
        """Check if slippage tolerance is safe using MeTTa rules"""
        if not self.initialized:
            # Fallback: 5% max
            return 0.0 <= slippage <= 0.05

        result = self.query(f"(? (safe-slippage {slippage}))")
        return "True" in str(result) if result else False

    def is_safe_amount(self, token: str, amount: float) -> bool:
        """Check if transaction amount is within safe limits"""
        if not self.initialized:
            # Fallback: reasonable limits
            limits = {"SUI": 100, "USDC": 10000, "USDT": 10000}
            return 0.01 < amount < limits.get(token.upper(), 1000)

        result = self.query(f'(? (safe-amount "{token}" {amount}))')
        return "True" in str(result) if result else False

    def is_trusted_token(self, token: str) -> bool:
        """Check if token is in the trusted list"""
        if not self.initialized:
            # Fallback: whitelist
            return token.upper() in ["SUI", "USDC", "USDT"]

        result = self.query(f'(? (trusted-token "{token}"))')
        return "True" in str(result) if result else False

    def get_risk_level_from_score(self, score: float) -> str:
        """Determine risk level from score using MeTTa rules"""
        if not self.initialized:
            # Fallback: threshold-based
            if score < 0.3:
                return "low"
            elif score < 0.6:
                return "medium"
            elif score < 0.8:
                return "high"
            else:
                return "critical"

        result = self.query(f"(? (calculate-risk-level {score}))")
        if result and any(level in str(result) for level in ["low", "medium", "high", "critical"]):
            for level in ["low", "medium", "high", "critical"]:
                if level in str(result).lower():
                    return level
        return "medium"  # Default


# Initialize MeTTa analyzer (singleton)
metta_analyzer = MeTTaRiskAnalyzer()


# ============================================================================
# RISK ASSESSMENT LOGIC
# ============================================================================

def calculate_risk_score(request: RiskCheckRequest, ctx: Context) -> Tuple[float, List[str], List[str]]:
    """
    Calculate comprehensive risk score for a transaction

    Returns:
        Tuple of (risk_score, warnings, recommendations)
        risk_score: 0.0 (safe) to 1.0 (critical)
    """
    risk_score = 0.0
    warnings = []
    recommendations = []

    # Check 1: Gas validation
    if request.estimated_gas:
        if not metta_analyzer.is_safe_gas(request.estimated_gas):
            risk_score += 0.3
            warnings.append(f"Gas amount {request.estimated_gas} SUI exceeds safe limit")
            recommendations.append("Reduce transaction complexity or check gas estimation")

    # Check 2: Slippage tolerance
    if request.slippage_tolerance:
        if not metta_analyzer.is_safe_slippage(request.slippage_tolerance):
            risk_score += 0.25
            warnings.append(f"Slippage tolerance {request.slippage_tolerance*100:.1f}% is high")
            recommendations.append("Reduce slippage or wait for better market conditions")

    # Check 3: Transaction amount
    token_to_check = request.from_token or request.to_token
    if token_to_check:
        if not metta_analyzer.is_safe_amount(token_to_check, request.amount):
            risk_score += 0.25
            warnings.append(f"Transaction amount {request.amount} {token_to_check} is outside safe range")
            recommendations.append("Consider splitting into smaller transactions")

    # Check 4: Token trust
    if request.from_token and not metta_analyzer.is_trusted_token(request.from_token):
        risk_score += 0.3
        warnings.append(f"Token {request.from_token} is not in trusted list")
        recommendations.append("Verify token contract address before proceeding")

    if request.to_token and not metta_analyzer.is_trusted_token(request.to_token):
        risk_score += 0.3
        warnings.append(f"Token {request.to_token} is not in trusted list")
        recommendations.append("Verify token contract address before proceeding")

    # Check 5: Recipient address (for transfers)
    if request.recipient_address:
        is_valid, error = validate_sui_address(request.recipient_address)
        if not is_valid:
            risk_score += 0.5
            warnings.append(f"Invalid recipient address: {error}")
            recommendations.append("Double-check the recipient address")

    # Cap risk score at 1.0
    risk_score = min(risk_score, 1.0)

    # Add general recommendations if no specific ones
    if not recommendations:
        recommendations.append("Transaction parameters look safe")

    return risk_score, warnings, recommendations


# ============================================================================
# RISK CHECK HANDLER
# ============================================================================

@risk_proto.on_message(RiskCheckRequest, replies={RiskCheckResponse})
async def handle_risk_check(ctx: Context, sender: str, msg: RiskCheckRequest):
    """
    Perform comprehensive risk assessment using MeTTa reasoning

    This is called by Portfolio Supervisor before executing transactions
    """
    log_agent_activity(ctx, "Processing risk check", {
        "type": msg.transaction_type,
        "amount": msg.amount
    })

    # Calculate risk score using MeTTa knowledge base
    risk_score, warnings, recommendations = calculate_risk_score(msg, ctx)

    # Determine risk level using MeTTa rules
    risk_level_str = metta_analyzer.get_risk_level_from_score(risk_score)
    risk_level = RiskLevel(risk_level_str)

    # Determine if transaction is safe
    is_safe = risk_score < 0.6  # Threshold for approval

    # Build reasoning explanation
    reasoning = f"MeTTa-based risk analysis: Score {risk_score:.2f}/1.0. "
    if metta_analyzer.initialized:
        reasoning += "Evaluated against DeFi safety rules knowledge base. "
    else:
        reasoning += "Using fallback heuristics (MeTTa unavailable). "

    reasoning += f"Classification: {risk_level.value} risk. "
    if is_safe:
        reasoning += "Transaction approved."
    else:
        reasoning += "Transaction flagged - manual review recommended."

    # Send response
    await ctx.send(sender, RiskCheckResponse(
        risk_level=risk_level,
        is_safe=is_safe,
        warnings=warnings,
        recommendations=recommendations,
        confidence_score=1.0 - (risk_score * 0.2),  # Higher risk = lower confidence
        reasoning=reasoning
    ))

    log_agent_activity(ctx, "Risk assessment complete", {
        "risk_level": risk_level.value,
        "is_safe": is_safe,
        "score": risk_score
    })


# ============================================================================
# ADDRESS VALIDATION HANDLER
# ============================================================================

@risk_proto.on_message(AddressValidationRequest, replies={AddressValidationResponse})
async def handle_address_validation(ctx: Context, sender: str, msg: AddressValidationRequest):
    """
    Validate Sui blockchain address format

    Standalone address validation service for other agents
    """
    log_agent_activity(ctx, "Validating address", {"address": msg.address[:10] + "..."})

    is_valid, error = validate_sui_address(msg.address)
    warnings = [error] if error else []

    # Determine address type (basic heuristic)
    address_type = None
    if is_valid:
        # Check against known system addresses (from MeTTa KB)
        if msg.address.endswith("0002"):
            address_type = "system_contract"
        elif msg.address.endswith("0003"):
            address_type = "framework"
        else:
            address_type = "wallet"

    await ctx.send(sender, AddressValidationResponse(
        is_valid=is_valid,
        address_type=address_type,
        warnings=warnings
    ))


# ============================================================================
# AGENT LIFECYCLE
# ============================================================================

@agent.on_event("startup")
async def on_startup(ctx: Context):
    """Agent initialization"""
    ctx.logger.info("Risk Analyzer Agent started")
    ctx.logger.info(f"Agent address: {agent.address}")

    if metta_analyzer.initialized:
        ctx.logger.info("✅ MeTTa knowledge base ready for symbolic reasoning")
    else:
        ctx.logger.warning("⚠️ MeTTa not available - using fallback heuristics")


# ============================================================================
# PROTOCOL REGISTRATION
# ============================================================================

agent.include(risk_proto, publish_manifest=True)


# ============================================================================
# RUN AGENT
# ============================================================================

if __name__ == "__main__":
    print("="*60)
    print("SuiVisor - Risk Analyzer Agent")
    print("="*60)
    print(f"Agent Name: {agent.name}")
    print(f"Agent Address: {agent.address}")
    print(f"MeTTa Integration: {'✅ Active' if metta_analyzer.initialized else '⚠️ Fallback Mode'}")
    print("="*60)
    print("\n🚀 Starting agent...")
    agent.run()
