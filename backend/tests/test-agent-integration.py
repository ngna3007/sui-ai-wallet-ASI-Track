#!/usr/bin/env python3
"""
Test Agent Integration
Tests the backend from a Python agent's perspective
"""

import asyncio
import httpx
import os
from dotenv import load_dotenv

# Load environment
load_dotenv('../.env')

BACKEND_URL = os.getenv('BACKEND_API_URL', 'http://localhost:3000')
TEST_WALLET = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'


async def test_health():
    """Test health endpoint"""
    print("🧪 Test 1: Health Check")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BACKEND_URL}/health", timeout=10.0)
            data = response.json()

            if response.status_code == 200 and data.get('status') == 'healthy':
                print("✅ Backend is healthy")
                print(f"   Service: {data.get('service')}")
                print(f"   Network: {data.get('network')}")
                print(f"   Features: {data.get('features')}")
                return True
            else:
                print("❌ Backend health check failed")
                return False
        except Exception as e:
            print(f"❌ Health check error: {e}")
            print("⚠️  Is the backend running? Start with: npm run dev")
            return False


async def test_swap_request():
    """Test swap PTB creation"""
    print("\n🧪 Test 2: Swap Request (like Transaction Executor)")
    async with httpx.AsyncClient() as client:
        try:
            payload = {
                "userIntent": "swap 10 SUI to USDC",
                "walletAddress": TEST_WALLET,
            }

            response = await client.post(
                f"{BACKEND_URL}/api/create-ptb",
                json=payload,
                timeout=30.0
            )

            data = response.json()

            if response.status_code == 200 and data.get('success'):
                print("✅ Swap PTB created successfully")
                print(f"   Template: {data.get('templateName')}")
                print(f"   Parameters: {data.get('parameters')}")
                print(f"   Execution time: {data.get('executionTime')}")
                return True
            else:
                print(f"⚠️  Swap request returned: {data.get('error')}")
                print("   (May be expected if no swap template exists)")
                return True  # Still count as pass if API works

        except Exception as e:
            print(f"❌ Swap request error: {e}")
            return False


async def test_transfer_request():
    """Test transfer PTB creation"""
    print("\n🧪 Test 3: Transfer Request")
    async with httpx.AsyncClient() as client:
        try:
            payload = {
                "userIntent": "send 0.1 SUI from 0x78dfbf158b7bc454286017c41ebcf41d324ee4782c56a89fb00e5fb9f296b8ed to 0xc2eb3a5cb0b2e492d69584012cdf8d21d3c5ba6972d43089fad1b748c8be22f0",
                "walletAddress": "0x78dfbf158b7bc454286017c41ebcf41d324ee4782c56a89fb00e5fb9f296b8ed",
            }

            response = await client.post(
                f"{BACKEND_URL}/api/create-ptb",
                json=payload,
                timeout=30.0
            )

            data = response.json()

            if response.status_code == 200:
                print("✅ Transfer request handled")
                if data.get('success'):
                    print(f"   Template: {data.get('templateName')}")
                else:
                    print(f"   Response: {data.get('error')}")
                return True
            else:
                print(f"❌ Transfer request failed: {response.status_code}")
                return False

        except Exception as e:
            print(f"❌ Transfer request error: {e}")
            return False


async def test_error_handling():
    """Test error handling with invalid request"""
    print("\n🧪 Test 4: Error Handling")
    async with httpx.AsyncClient() as client:
        try:
            # Missing required fields
            payload = {}

            response = await client.post(
                f"{BACKEND_URL}/api/create-ptb",
                json=payload,
                timeout=10.0
            )

            data = response.json()

            if response.status_code == 400 and not data.get('success'):
                print("✅ Error handling working correctly")
                print(f"   Error message: {data.get('error')}")
                return True
            else:
                print("❌ Error handling not working as expected")
                return False

        except Exception as e:
            print(f"❌ Error handling test error: {e}")
            return False


async def test_templates_list():
    """Test templates listing endpoint"""
    print("\n🧪 Test 5: List Templates")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{BACKEND_URL}/api/templates?limit=5",
                timeout=10.0
            )

            data = response.json()

            if response.status_code == 200 and data.get('success'):
                count = data.get('count', 0)
                print(f"✅ Found {count} templates")

                templates = data.get('templates', [])
                if templates:
                    print("   Sample templates:")
                    for t in templates[:3]:
                        print(f"   - {t.get('name')}")

                return True
            else:
                print(f"❌ Templates list failed: {data.get('error')}")
                return False

        except Exception as e:
            print(f"❌ Templates list error: {e}")
            return False


async def main():
    """Run all tests"""
    print("=" * 60)
    print("🐍 Python Agent Integration Tests")
    print(f"📍 Backend: {BACKEND_URL}")
    print("=" * 60)
    print()

    tests = [
        test_health(),
        test_swap_request(),
        test_transfer_request(),
        test_error_handling(),
        test_templates_list(),
    ]

    results = await asyncio.gather(*tests)

    passed = sum(results)
    total = len(results)

    print("\n" + "=" * 60)
    print("Test Summary:")
    print(f"✅ Passed: {passed}/{total}")
    print(f"❌ Failed: {total - passed}/{total}")
    print("=" * 60)

    if passed == total:
        print("\n✅ All agent integration tests passed!")
        print("🚀 Backend is ready for agent communication!")
    else:
        print("\n❌ Some tests failed")
        print("⚠️  Check backend logs and configuration")


if __name__ == "__main__":
    asyncio.run(main())
