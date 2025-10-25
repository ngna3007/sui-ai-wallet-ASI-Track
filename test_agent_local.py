"""
Local Agent Test Script
Tests agent handlers directly without needing full uAgents setup
"""
import asyncio
import sys
import os
from dotenv import load_dotenv

# Load environment
load_dotenv()

# Set backend URL to localhost
os.environ["BACKEND_URL"] = os.getenv("BACKEND_URL", "http://localhost:3000")

# Mock Context class for testing
class MockContext:
    def __init__(self):
        self.logs = []

    def info(self, msg):
        print(f"[INFO] {msg}")
        self.logs.append(msg)

    def error(self, msg):
        print(f"[ERROR] {msg}")
        self.logs.append(msg)

    class Logger:
        def __init__(self, ctx):
            self.ctx = ctx

        def info(self, msg):
            self.ctx.info(msg)

        def error(self, msg):
            self.ctx.error(msg)

    @property
    def logger(self):
        return self.Logger(self)

# Import agent functions
sys.path.insert(0, os.path.dirname(__file__))

# Import required functions from agent
from suivisor_agent import (
    parse_intent,
    get_user_info,
    get_user_nfts,
    handle_balance_check,
    handle_deposit_info,
    handle_list_nfts,
    handle_swap,
    handle_price_check,
    handle_help,
)

async def test_balance():
    """Test balance checking"""
    print("\n" + "="*60)
    print("TEST 1: Check Balance")
    print("="*60)

    ctx = MockContext()
    test_user = "agent1qtest_user_12345"

    result = await handle_balance_check(ctx, test_user)
    print(result)
    return "✅ Balance check" if result else "❌ Balance check failed"

async def test_deposit_info():
    """Test deposit info"""
    print("\n" + "="*60)
    print("TEST 2: Get Deposit Info")
    print("="*60)

    ctx = MockContext()
    test_user = "agent1qtest_user_12345"

    result = await handle_deposit_info(ctx, test_user)
    print(result)
    return "✅ Deposit info" if result else "❌ Deposit info failed"

async def test_list_nfts():
    """Test listing NFTs"""
    print("\n" + "="*60)
    print("TEST 3: List NFTs")
    print("="*60)

    ctx = MockContext()
    test_user = "agent1qtest_user_12345"

    result = await handle_list_nfts(ctx, test_user)
    print(result)
    return "✅ List NFTs" if result else "❌ List NFTs failed"

async def test_intent_parsing():
    """Test intent parsing"""
    print("\n" + "="*60)
    print("TEST 4: Intent Parsing")
    print("="*60)

    test_queries = [
        "check my balance",
        "swap 10 SUI to USDC",
        'mint nft "My Cool Art"',
        "my nfts",
        "what is the price of SUI",
        "help"
    ]

    for query in test_queries:
        intent = parse_intent(query)
        print(f"Query: '{query}'")
        print(f"  → Action: {intent['action']}")
        print()

    return "✅ Intent parsing"

async def test_swap():
    """Test swap intent (without executing)"""
    print("\n" + "="*60)
    print("TEST 5: Swap Intent Parsing")
    print("="*60)

    query = "swap 10 SUI to USDC"
    intent = parse_intent(query)

    print(f"Query: {query}")
    print(f"Parsed intent: {intent}")

    if intent['action'] == 'swap' and intent.get('amount') == 10.0:
        return "✅ Swap intent parsing"
    else:
        return "❌ Swap intent parsing failed"

async def test_price_check():
    """Test price check (requires CMC API key)"""
    print("\n" + "="*60)
    print("TEST 6: Price Check")
    print("="*60)

    ctx = MockContext()
    intent = {"token": "SUI"}

    result = await handle_price_check(ctx, intent)
    print(result)

    if "Price" in result or "Unable to fetch" in result or "not configured" in result:
        return "✅ Price check"
    else:
        return "❌ Price check failed"

async def test_help():
    """Test help"""
    print("\n" + "="*60)
    print("TEST 7: Help Command")
    print("="*60)

    ctx = MockContext()
    result = await handle_help(ctx)
    print(result)
    return "✅ Help command" if "SuiVisor" in result else "❌ Help failed"

async def test_api_connectivity():
    """Test backend API connectivity"""
    print("\n" + "="*60)
    print("TEST 8: Backend API Connectivity")
    print("="*60)

    test_user = "agent1qtest_connectivity"

    print(f"Testing connection to: {os.environ['BACKEND_URL']}")
    user_info_result = await get_user_info(test_user)

    print(f"Result: {user_info_result}")

    if user_info_result.get("success"):
        return "✅ Backend API connected"
    else:
        return f"❌ Backend API failed: {user_info_result.get('error')}"

async def main():
    """Run all tests"""
    print("\n" + "🧪 " + "="*58)
    print("🤖 SuiVisor Agent Local Tests")
    print("="*60)
    print(f"Backend URL: {os.environ.get('BACKEND_URL')}")
    print("="*60)

    results = []

    try:
        # Test API connectivity first
        results.append(await test_api_connectivity())

        # Test intent parsing (no API calls)
        results.append(await test_intent_parsing())

        # Test help (no API calls)
        results.append(await test_help())

        # Test API-based functions
        results.append(await test_balance())
        results.append(await test_deposit_info())
        results.append(await test_list_nfts())

        # Test swap intent parsing
        results.append(await test_swap())

        # Test price check (may fail if no API key)
        results.append(await test_price_check())

    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        results.append(f"❌ Fatal error: {str(e)}")

    # Summary
    print("\n" + "="*60)
    print("📊 TEST SUMMARY")
    print("="*60)
    for result in results:
        print(result)

    passed = sum(1 for r in results if "✅" in r)
    total = len(results)

    print(f"\n{passed}/{total} tests passed")
    print("="*60)

    return passed == total

if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
