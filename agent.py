"""
SuiVisor Multi-Agent System - Main Entry Point

This file runs a Bureau (agent group) that coordinates:
- Orchestrator agent (main agent with Claude LLM for chat)
- Balance agent (handles balance & deposit queries)
- Swap agent (handles token swaps)
- NFT agent (handles NFT operations)
- Price agent (handles price queries)

All agents run together in one process and communicate internally.
"""
from uagents import Bureau
from agents.orchestrator import orchestrator, set_agent_addresses
from agents.balance_agent import balance_agent
from agents.swap_agent import swap_agent
from agents.nft_agent import nft_agent
from agents.price_agent import price_agent

# Create Bureau (agent group)
bureau = Bureau()

# Register agents
# Note: The orchestrator must be registered first as it's the main entry point
bureau.add(orchestrator)
bureau.add(balance_agent)
bureau.add(swap_agent)
bureau.add(nft_agent)
bureau.add(price_agent)

# Set agent addresses for routing
set_agent_addresses({
    "balance_agent": balance_agent.address,
    "swap_agent": swap_agent.address,
    "nft_agent": nft_agent.address,
    "price_agent": price_agent.address
})

print("\n🏛️  Bureau Configuration")
print("="*60)
print(f"Orchestrator: {orchestrator.address}")
print(f"Balance Agent: {balance_agent.address}")
print(f"Swap Agent: {swap_agent.address}")
print(f"NFT Agent: {nft_agent.address}")
print(f"Price Agent: {price_agent.address}")
print("="*60)
print("\n🚀 Starting SuiVisor Multi-Agent System...\n")

if __name__ == "__main__":
    bureau.run()
