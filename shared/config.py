"""
Configuration for SuiVisor Multi-Agent System

Contains agent addresses, API endpoints, and system configuration.
"""

import os
from typing import Dict, Any


# ============================================================================
# AGENT CONFIGURATION
# ============================================================================

# Agent names (must be unique)
AGENT_NAMES = {
    "COORDINATOR": "suivisor-assistant-coordinator",
    "EXECUTOR": "suivisor-transaction-executor",
    "MARKET": "suivisor-market-intelligence",
    "RISK": "suivisor-risk-analyzer",
}

# Agent addresses (will be populated after deployment)
# Format: "agent1q..." from Agentverse
AGENT_ADDRESSES: Dict[str, str] = {
    "COORDINATOR": os.getenv("COORDINATOR_ADDRESS", ""),
    "EXECUTOR": os.getenv("EXECUTOR_ADDRESS", ""),
    "MARKET": os.getenv("MARKET_ADDRESS", ""),
    "RISK": os.getenv("RISK_ADDRESS", ""),
}

# Agent seeds (for development - use secure vault in production)
AGENT_SEEDS = {
    "COORDINATOR": os.getenv("COORDINATOR_SEED", "suivisor-coordinator-seed-secure-phrase"),
    "EXECUTOR": os.getenv("EXECUTOR_SEED", "suivisor-executor-seed-secure-phrase"),
    "MARKET": os.getenv("MARKET_SEED", "suivisor-market-seed-secure-phrase"),
    "RISK": os.getenv("RISK_SEED", "suivisor-risk-seed-secure-phrase"),
}

# Agent ports (for local development)
AGENT_PORTS = {
    "COORDINATOR": 8000,
    "EXECUTOR": 8001,
    "MARKET": 8002,
    "RISK": 8003,
}


# ============================================================================
# BACKEND API CONFIGURATION
# ============================================================================

# Your existing Next.js backend API
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:3000/api")

# Specific endpoints
BACKEND_ENDPOINTS = {
    "SWAP": f"{BACKEND_API_URL}/swap",
    "TRANSFER": f"{BACKEND_API_URL}/transfer",
    "STAKE": f"{BACKEND_API_URL}/stake",
    "GET_BALANCE": f"{BACKEND_API_URL}/balance",
}


# ============================================================================
# EXTERNAL API CONFIGURATION
# ============================================================================

# CoinMarketCap API (you already have this)
COINMARKETCAP_API_KEY = os.getenv("COINMARKETCAP_API_KEY", "")
COINMARKETCAP_API_URL = "https://pro-api.coinmarketcap.com/v1"

# Sui Network
SUI_NETWORK = os.getenv("SUI_NETWORK", "testnet")  # mainnet, testnet, devnet
SUI_RPC_URL = os.getenv("SUI_RPC_URL", "https://fullnode.testnet.sui.io")


# ============================================================================
# ASI ALLIANCE CONFIGURATION
# ============================================================================

# ASI:One LLM for structured output (from documentation)
ASI_ONE_OPENAI_AGENT = "agent1qtlpfshtlcxekgrfcpmv7m9zpajuwu7d5jfyachvpa4u3dkt6k0uwwp2lct"
ASI_ONE_CLAUDE_AGENT = "agent1qvk7q2av3e2y5gf5s90nfzkc8a48q3wdqeevwrtgqfdl0k78rspd6f2l4dx"

# Use OpenAI agent by default for structured output parsing
ASI_ONE_AGENT = os.getenv("ASI_ONE_AGENT", ASI_ONE_OPENAI_AGENT)


# ============================================================================
# METTA CONFIGURATION
# ============================================================================

# MeTTa knowledge base path
METTA_KB_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "agents",
    "risk_analyzer",
    "knowledge_base"
)


# ============================================================================
# OPERATIONAL LIMITS (Safety)
# ============================================================================

# Transaction limits (in USD equivalent)
MAX_TRANSACTION_AMOUNT_USD = float(os.getenv("MAX_TRANSACTION_USD", "10000"))
MIN_TRANSACTION_AMOUNT_USD = float(os.getenv("MIN_TRANSACTION_USD", "0.01"))

# Gas limits (in SUI)
MAX_GAS_LIMIT_SUI = float(os.getenv("MAX_GAS_SUI", "0.5"))
MIN_GAS_RESERVE_SUI = float(os.getenv("MIN_GAS_RESERVE_SUI", "0.1"))

# Slippage tolerance
DEFAULT_SLIPPAGE_TOLERANCE = 0.01  # 1%
MAX_SLIPPAGE_TOLERANCE = 0.05  # 5%

# Rate limiting (requests per minute)
RATE_LIMIT_PER_USER = int(os.getenv("RATE_LIMIT", "10"))


# ============================================================================
# LOGGING & MONITORING
# ============================================================================

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
ENABLE_METRICS = os.getenv("ENABLE_METRICS", "true").lower() == "true"


# ============================================================================
# DEPLOYMENT MODE
# ============================================================================

DEPLOYMENT_MODE = os.getenv("DEPLOYMENT_MODE", "local")  # local, agentverse, production

# Mailbox configuration for Agentverse
USE_MAILBOX = DEPLOYMENT_MODE in ["agentverse", "production"]
PUBLISH_MANIFEST = True  # Always publish for discoverability


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_agent_config(agent_type: str) -> Dict[str, Any]:
    """Get complete configuration for an agent"""
    return {
        "name": AGENT_NAMES[agent_type],
        "seed": AGENT_SEEDS[agent_type],
        "port": AGENT_PORTS[agent_type] if DEPLOYMENT_MODE == "local" else None,
        "endpoint": [f"http://localhost:{AGENT_PORTS[agent_type]}/submit"] if DEPLOYMENT_MODE == "local" else None,
        "mailbox": USE_MAILBOX,
        "publish_manifest": PUBLISH_MANIFEST,
    }


def validate_config():
    """Validate that all required configuration is set"""
    errors = []

    if not COINMARKETCAP_API_KEY:
        errors.append("COINMARKETCAP_API_KEY not set")

    if DEPLOYMENT_MODE in ["agentverse", "production"]:
        for agent_type, address in AGENT_ADDRESSES.items():
            if not address:
                errors.append(f"{agent_type}_ADDRESS not set for deployment")

    if errors:
        raise ValueError(f"Configuration errors: {', '.join(errors)}")

    return True


if __name__ == "__main__":
    # Test configuration
    print("SuiVisor Configuration")
    print("=" * 50)
    print(f"Deployment Mode: {DEPLOYMENT_MODE}")
    print(f"Backend API: {BACKEND_API_URL}")
    print(f"Sui Network: {SUI_NETWORK}")
    print(f"Use Mailbox: {USE_MAILBOX}")
    print("\nAgent Names:")
    for agent_type, name in AGENT_NAMES.items():
        print(f"  {agent_type}: {name}")

    try:
        validate_config()
        print("\n✅ Configuration valid!")
    except ValueError as e:
        print(f"\n❌ Configuration errors: {e}")
