"""
Market Intelligence Agent - The Data Provider

This agent provides market data and price intelligence by:
1. Fetching real-time token prices from CoinMarketCap
2. Tracking price movements and trends
3. Providing market analysis to other agents
4. Sending price alerts

This is the "eyes" of the SuiVisor system - it monitors markets.
"""

import sys
import os
from typing import Optional, Dict, Any

# Add parent directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from uagents import Agent, Context, Protocol
from shared.config import get_agent_config, COINMARKETCAP_API_KEY, COINMARKETCAP_API_URL
from shared.models import (
    PriceRequest, PriceResponse,
    MarketAlertRequest,
)
from shared.utils import (
    log_agent_activity,
    get_current_timestamp,
    http_get,
)


# ============================================================================
# AGENT INITIALIZATION
# ============================================================================

config = get_agent_config("MARKET")

agent = Agent(
    name=config["name"],
    seed=config["seed"],
    port=config["port"],
    endpoint=config["endpoint"],
    mailbox=config["mailbox"],
)

print(f"Market Intelligence Agent Address: {agent.address}")

# Market data protocol
market_proto = Protocol(name="MarketIntelligenceProtocol", version="1.0.0")


# ============================================================================
# COINMARKETCAP API INTEGRATION
# ============================================================================

# Token symbol to CoinMarketCap ID mapping
TOKEN_ID_MAP = {
    "SUI": "20947",  # Sui
    "USDC": "3408",  # USD Coin
    "USDT": "825",   # Tether
    "BTC": "1",      # Bitcoin
    "ETH": "1027",   # Ethereum
}


async def fetch_price_from_cmc(token_symbol: str, quote_currency: str = "USD") -> Optional[Dict[str, Any]]:
    """
    Fetch current price from CoinMarketCap API

    Args:
        token_symbol: Token symbol (e.g., "SUI", "USDC")
        quote_currency: Quote currency (default: "USD")

    Returns:
        Price data dictionary or None if fetch fails
    """
    if not COINMARKETCAP_API_KEY:
        return None

    # Get CoinMarketCap ID for token
    token_id = TOKEN_ID_MAP.get(token_symbol.upper())
    if not token_id:
        return None

    # Construct API URL
    url = f"{COINMARKETCAP_API_URL}/cryptocurrency/quotes/latest"
    params = {
        "id": token_id,
        "convert": quote_currency
    }
    headers = {
        "X-CMC_PRO_API_KEY": COINMARKETCAP_API_KEY,
        "Accept": "application/json"
    }

    # Fetch data
    success, data, error = await http_get(url, params=params, headers=headers)

    if not success or not data:
        return None

    try:
        # Extract price data
        token_data = data["data"][token_id]
        quote = token_data["quote"][quote_currency]

        return {
            "symbol": token_symbol.upper(),
            "price": quote["price"],
            "change_24h": quote["percent_change_24h"],
            "volume_24h": quote["volume_24h"],
            "market_cap": quote["market_cap"],
            "last_updated": quote["last_updated"]
        }
    except (KeyError, TypeError) as e:
        return None


# ============================================================================
# PRICE QUERY HANDLER
# ============================================================================

@market_proto.on_message(PriceRequest, replies={PriceResponse})
async def handle_price_request(ctx: Context, sender: str, msg: PriceRequest):
    """
    Handle price query request from other agents

    This is called by Portfolio Supervisor when users ask for prices
    """
    log_agent_activity(ctx, "Processing price request", {
        "token": msg.token_symbol,
        "quote": msg.quote_currency
    })

    # Fetch price from CoinMarketCap
    price_data = await fetch_price_from_cmc(msg.token_symbol, msg.quote_currency)

    if not price_data:
        ctx.logger.error(f"Failed to fetch price for {msg.token_symbol}")

        # Send error response (price = 0 indicates failure)
        await ctx.send(sender, PriceResponse(
            token_symbol=msg.token_symbol,
            price=0.0,
            quote_currency=msg.quote_currency,
            change_24h=0.0,
            volume_24h=None,
            timestamp=get_current_timestamp()
        ))
        return

    # Send successful response
    await ctx.send(sender, PriceResponse(
        token_symbol=price_data["symbol"],
        price=price_data["price"],
        quote_currency=msg.quote_currency,
        change_24h=price_data["change_24h"],
        volume_24h=price_data["volume_24h"],
        timestamp=get_current_timestamp()
    ))

    log_agent_activity(ctx, "Price sent successfully", {
        "token": msg.token_symbol,
        "price": price_data["price"]
    })


# ============================================================================
# MARKET ALERT HANDLER (FUTURE FEATURE)
# ============================================================================

@market_proto.on_message(MarketAlertRequest)
async def handle_alert_request(ctx: Context, sender: str, msg: MarketAlertRequest):
    """
    Set up price alerts (future feature)

    This allows users to be notified when prices reach certain thresholds
    """
    log_agent_activity(ctx, "Processing alert request", {
        "token": msg.token_symbol,
        "threshold": msg.threshold_price,
        "type": msg.alert_type
    })

    # Store alert in agent storage
    alert_key = f"alert_{sender}_{msg.token_symbol}"
    ctx.storage.set(alert_key, {
        "threshold": msg.threshold_price,
        "type": msg.alert_type,
        "created_at": get_current_timestamp()
    })

    ctx.logger.info(f"Alert created: {alert_key}")


# ============================================================================
# PERIODIC PRICE MONITORING (OPTIONAL)
# ============================================================================

@agent.on_interval(period=300.0)  # Every 5 minutes
async def monitor_prices(ctx: Context):
    """
    Periodically check prices and trigger alerts

    This runs in the background to monitor market conditions
    """
    # Get all active alerts from storage
    alerts = {}
    for key, value in ctx.storage._data.items():
        if key.startswith("alert_"):
            alerts[key] = value

    if not alerts:
        return

    ctx.logger.info(f"Monitoring {len(alerts)} price alerts")

    # Check each alert
    for alert_key, alert_data in alerts.items():
        parts = alert_key.split("_")
        if len(parts) < 3:
            continue

        token_symbol = parts[2]

        # Fetch current price
        price_data = await fetch_price_from_cmc(token_symbol)

        if not price_data:
            continue

        current_price = price_data["price"]
        threshold = alert_data["threshold"]
        alert_type = alert_data["type"]

        # Check if alert should trigger
        triggered = False
        if alert_type == "above" and current_price > threshold:
            triggered = True
        elif alert_type == "below" and current_price < threshold:
            triggered = True

        if triggered:
            ctx.logger.info(f"Alert triggered: {token_symbol} ${current_price} ({alert_type} ${threshold})")
            # TODO: Send notification to user


# ============================================================================
# PRICE CACHING (PERFORMANCE OPTIMIZATION)
# ============================================================================

@agent.on_interval(period=60.0)  # Every 1 minute
async def cache_popular_prices(ctx: Context):
    """
    Pre-cache prices for frequently queried tokens

    This improves response time for common queries
    """
    popular_tokens = ["SUI", "USDC", "USDT"]

    for token in popular_tokens:
        price_data = await fetch_price_from_cmc(token)

        if price_data:
            cache_key = f"price_cache_{token}"
            ctx.storage.set(cache_key, {
                "data": price_data,
                "cached_at": get_current_timestamp()
            })

    ctx.logger.debug(f"Cached prices for {len(popular_tokens)} tokens")


# ============================================================================
# AGENT LIFECYCLE
# ============================================================================

@agent.on_event("startup")
async def on_startup(ctx: Context):
    """Agent initialization"""
    ctx.logger.info("Market Intelligence Agent started")
    ctx.logger.info(f"Agent address: {agent.address}")

    if not COINMARKETCAP_API_KEY:
        ctx.logger.warning("⚠️ COINMARKETCAP_API_KEY not set - price queries will fail!")

    ctx.logger.info(f"Monitoring {len(TOKEN_ID_MAP)} tokens")


# ============================================================================
# PROTOCOL REGISTRATION
# ============================================================================

agent.include(market_proto, publish_manifest=True)


# ============================================================================
# RUN AGENT
# ============================================================================

if __name__ == "__main__":
    print("="*60)
    print("SuiVisor - Market Intelligence Agent")
    print("="*60)
    print(f"Agent Name: {agent.name}")
    print(f"Agent Address: {agent.address}")
    print(f"Supported tokens: {', '.join(TOKEN_ID_MAP.keys())}")
    print("="*60)
    print("\n🚀 Starting agent...")
    agent.run()
