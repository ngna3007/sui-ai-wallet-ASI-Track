#!/bin/bash

# SuiVisor Backend Test Runner
# Runs all backend tests in sequence

set -e

echo "======================================================================"
echo "🧪 SuiVisor Backend Test Suite"
echo "======================================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if backend is running
echo "🔍 Checking if backend is running..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running${NC}"
else
    echo -e "${RED}❌ Backend is NOT running${NC}"
    echo -e "${YELLOW}⚠️  Start backend with: npm run dev${NC}"
    exit 1
fi

echo ""

# Test 1: Database Connection
echo "======================================================================"
echo "Test 1: Database Connection"
echo "======================================================================"
tsx test-db-connection.ts
echo ""

# Test 2: API Endpoints
echo "======================================================================"
echo "Test 2: API Endpoints (TypeScript)"
echo "======================================================================"
tsx test-api-endpoints.ts
echo ""

# Test 3: Agent Integration
echo "======================================================================"
echo "Test 3: Agent Integration (Python)"
echo "======================================================================"
python3 test-agent-integration.py
echo ""

# All tests passed
echo "======================================================================"
echo -e "${GREEN}✅ All tests completed successfully!${NC}"
echo "======================================================================"
echo ""
echo "🚀 Backend is fully operational and ready for:"
echo "   - Python agent communication"
echo "   - Semantic PTB search"
echo "   - LLM parameter extraction"
echo "   - Transaction building"
echo ""
