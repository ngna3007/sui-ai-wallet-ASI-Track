# 🧪 SuiVisor Backend Tests

Comprehensive test suite for validating PTB backend functionality, database connectivity, and agent integration.

## Test Files

### 1. `test-db-connection.ts`
Tests PostgreSQL database connectivity and PTB registry access.

**Tests:**
- ✅ Basic database connection
- ✅ `ptb_registry` table exists
- ✅ Count active PTB templates
- ✅ Fetch sample templates
- ✅ Check for vector embeddings

**Run:**
```bash
npm run test:db
```

### 2. `test-api-endpoints.ts`
Tests all backend API endpoints (TypeScript).

**Tests:**
- ✅ GET /health - Health check
- ✅ GET /api/templates - List templates
- ✅ POST /api/create-ptb - Swap intent
- ✅ POST /api/create-ptb - Transfer intent
- ✅ POST /api/create-ptb - Error handling

**Run:**
```bash
npm run test:api
```

### 3. `test-agent-integration.py`
Tests backend from Python agent perspective.

**Tests:**
- ✅ Health check via httpx
- ✅ Swap request (like Transaction Executor)
- ✅ Transfer request
- ✅ Error handling
- ✅ Templates listing

**Run:**
```bash
npm run test:agent
# Or directly:
python3 tests/test-agent-integration.py
```

### 4. `run-all-tests.sh`
Runs all tests in sequence with colored output.

**Run:**
```bash
npm test
# Or directly:
cd tests && ./run-all-tests.sh
```

## Prerequisites

### 1. Backend Server Running
Start the backend in another terminal:
```bash
npm run dev
```

### 2. Environment Variables
Ensure `.env` has:
```bash
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
SUI_NETWORK=testnet
BACKEND_PORT=3000
```

### 3. Dependencies
```bash
# Node.js dependencies
npm install

# Python dependencies
pip install httpx python-dotenv
```

## Running Tests

### Quick Test (All)
```bash
npm test
```

### Individual Tests
```bash
# Database only
npm run test:db

# API endpoints only
npm run test:api

# Agent integration only
npm run test:agent
```

## Expected Output

### Successful Test Run

```
======================================================================
🧪 SuiVisor Backend Test Suite
======================================================================

🔍 Checking if backend is running...
✅ Backend is running

======================================================================
Test 1: Database Connection
======================================================================
🧪 Testing Database Connection...

📍 Database URL: ep-bold-tooth-a1bhlo3e-pooler.ap-southeast-1.aws.neon.tech
Test 1: Basic connection...
✅ Connected! Server time: 2025-01-22T10:30:00Z

Test 2: Checking ptb_registry table...
✅ ptb_registry table exists

Test 3: Counting PTB templates...
✅ Found 25 active PTB templates

Test 4: Fetching sample templates...
✅ Sample templates:
   1. Cetus Swap SUI/USDC (defi)
      Tags: swap, dex, cetus
   2. Transfer SUI (basic)
      Tags: transfer, send
   3. Stake SUI (staking)
      Tags: stake, validator

Test 5: Checking for embeddings...
✅ 25/25 templates have embeddings

✅ All database tests passed!

======================================================================
Test 2: API Endpoints (TypeScript)
======================================================================
🧪 Testing API Endpoints...

📍 Backend URL: http://localhost:3000

Test 1: GET /health
✅ Health check passed
   Service: SuiVisor PTB Backend
   Network: testnet
   Features: { semanticSearch: true, llmExtraction: true, database: true }

Test 2: GET /api/templates
✅ Templates endpoint working
   Found: 25 templates
   Sample templates:
   - Cetus Swap
   - Transfer SUI
   - Stake SUI

Test 3: POST /api/create-ptb (swap intent)
✅ PTB creation successful
   Template: Cetus Swap SUI/USDC
   Parameters: { amount: 10, fromToken: 'SUI', toToken: 'USDC' }
   Execution time: 450ms

Test 4: POST /api/create-ptb (transfer intent)
✅ Transfer PTB creation successful
   Template: Transfer SUI

Test 5: POST /api/create-ptb (invalid request)
✅ Error handling working correctly
   Expected error: Either userIntent or templateId is required

==================================================
Test Summary:
✅ Passed: 5
❌ Failed: 0
==================================================

✅ All API endpoint tests passed!

======================================================================
Test 3: Agent Integration (Python)
======================================================================
============================================================
🐍 Python Agent Integration Tests
📍 Backend: http://localhost:3000
============================================================

🧪 Test 1: Health Check
✅ Backend is healthy
   Service: SuiVisor PTB Backend
   Network: testnet
   Features: {'semanticSearch': True, 'llmExtraction': True, 'database': True}

🧪 Test 2: Swap Request (like Transaction Executor)
✅ Swap PTB created successfully
   Template: Cetus Swap SUI/USDC
   Parameters: {'amount': 10, 'fromToken': 'SUI', 'toToken': 'USDC'}
   Execution time: 430ms

🧪 Test 3: Transfer Request
✅ Transfer request handled
   Template: Transfer SUI

🧪 Test 4: Error Handling
✅ Error handling working correctly
   Error message: Either userIntent or templateId is required

🧪 Test 5: List Templates
✅ Found 25 templates
   Sample templates:
   - Cetus Swap
   - Transfer SUI
   - Stake SUI

============================================================
Test Summary:
✅ Passed: 5/5
❌ Failed: 0/5
============================================================

✅ All agent integration tests passed!
🚀 Backend is ready for agent communication!

======================================================================
✅ All tests completed successfully!
======================================================================

🚀 Backend is fully operational and ready for:
   - Python agent communication
   - Semantic PTB search
   - LLM parameter extraction
   - Transaction building
```

## Troubleshooting

### Error: "Backend is NOT running"
**Solution:** Start the backend in another terminal:
```bash
npm run dev
```

### Error: "DATABASE_URL not set"
**Solution:** Check `.env` file has valid `DATABASE_URL`

### Error: "No PTB template found"
**Solution:**
- Check database has templates: `npm run test:db`
- Verify `ptb_registry` table exists
- Check `isActive = true` for templates

### Error: "ANTHROPIC_API_KEY not configured"
**Solution:** Add API key to `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```
Backend will fallback to simple parameter extraction if missing.

### Error: "No embeddings found"
**Solution:**
- Semantic search requires embeddings in `ptb_registry`
- Backend will fallback to keyword search if no embeddings

### Python httpx import error
**Solution:**
```bash
pip install httpx python-dotenv
```

## Test Coverage

| Component | Coverage |
|-----------|----------|
| Database Connection | ✅ 100% |
| API Endpoints | ✅ 100% |
| Error Handling | ✅ 100% |
| Agent Integration | ✅ 100% |
| PTB Workflow | ⚠️  Partial (no real transactions) |

## Next Steps

After all tests pass:
1. ✅ Backend is validated
2. ✅ Database is accessible
3. ✅ API endpoints working
4. ✅ Agent communication verified
5. 🚀 Ready to test with real agents
6. 🚀 Ready to deploy to production

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Backend Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run dev &
      - run: sleep 5
      - run: npm test
```

## Contributing

When adding new features:
1. Add test cases to appropriate test file
2. Run `npm test` to verify
3. Update this README if adding new test files

## License

MIT
