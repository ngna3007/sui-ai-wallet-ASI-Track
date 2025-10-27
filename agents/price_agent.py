"""
Price Agent - Handles token price queries via CoinMarketCap
"""
import os
import httpx
from uagents import Agent, Context
from models import PriceRequest, PriceResponse

# Configuration
CMC_API_KEY = os.getenv("COINMARKETCAP_API_KEY")

# Create Price Agent
price_agent = Agent(
    name="price_agent",
    seed="price_agent_secret_seed_101"
)


@price_agent.on_message(model=PriceRequest, replies=PriceResponse)
async def handle_price_request(ctx: Context, sender: str, msg: PriceRequest):
    """Handle token price request"""
    ctx.logger.info(f"💵 Fetching price for {msg.token_symbol}")

    if not CMC_API_KEY:
        await ctx.send(
            sender,
            PriceResponse(
                success=False,
                token=msg.token_symbol,
                error="CoinMarketCap API key not configured",
                original_msg_id=msg.original_msg_id
            )
        )
        return

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
                params={"symbol": msg.token_symbol.upper()},
                headers={"X-CMC_PRO_API_KEY": CMC_API_KEY}
            )

            if response.status_code != 200:
                await ctx.send(
                    sender,
                    PriceResponse(
                        success=False,
                        token=msg.token_symbol,
                        error=f"CoinMarketCap API error: {response.status_code}",
                        original_msg_id=msg.original_msg_id
                    )
                )
                return

            data = response.json()
            token_data = data["data"][msg.token_symbol.upper()]
            quote = token_data["quote"]["USD"]

            await ctx.send(
                sender,
                PriceResponse(
                    success=True,
                    token=msg.token_symbol.upper(),
                    price=quote["price"],
                    change_24h=quote["percent_change_24h"],
                    volume_24h=quote["volume_24h"],
                    market_cap=quote["market_cap"],
                    original_msg_id=msg.original_msg_id
                )
            )
            ctx.logger.info(f"✅ Price fetched: ${quote['price']:.4f}")

    except Exception as e:
        ctx.logger.error(f"❌ Price fetch failed: {e}")
        await ctx.send(
            sender,
            PriceResponse(
                success=False,
                token=msg.token_symbol,
                error=str(e),
                original_msg_id=msg.original_msg_id
            )
        )
