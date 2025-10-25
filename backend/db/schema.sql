-- SuiVisor Multi-User Database Schema
-- Option 3: Hybrid Architecture (Production-Ready)

-- User accounts table
CREATE TABLE IF NOT EXISTS user_accounts (
    user_address TEXT PRIMARY KEY,  -- ASI:One sender address
    deposit_address TEXT UNIQUE NOT NULL,  -- Unique Sui deposit address
    deposit_keypair_seed TEXT NOT NULL,  -- Encrypted seed for deposit address
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed'))
);

-- User balances table (virtual balances)
CREATE TABLE IF NOT EXISTS user_balances (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    token_type TEXT NOT NULL,  -- 'SUI', 'USDC', etc.
    balance NUMERIC(20, 9) DEFAULT 0 NOT NULL,  -- Support up to 9 decimals
    locked_balance NUMERIC(20, 9) DEFAULT 0,  -- For pending transactions
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_address, token_type)
);

-- Deposit transactions table
CREATE TABLE IF NOT EXISTS deposit_transactions (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    sui_digest TEXT UNIQUE NOT NULL,  -- Blockchain transaction hash
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,  -- User's deposit address
    token_type TEXT NOT NULL,
    amount NUMERIC(20, 9) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'swept', 'failed')),
    block_height BIGINT,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    swept_at TIMESTAMP
);

-- User transactions table (operations performed by agent)
CREATE TABLE IF NOT EXISTS user_transactions (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('transfer', 'swap', 'stake', 'withdraw')),
    sui_digest TEXT UNIQUE NOT NULL,
    from_token TEXT NOT NULL,
    to_token TEXT,
    amount NUMERIC(20, 9) NOT NULL,
    recipient TEXT,
    gas_used NUMERIC(20, 9),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

-- Sweep operations table (consolidation to main wallet)
CREATE TABLE IF NOT EXISTS sweep_operations (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    from_address TEXT NOT NULL,  -- User's deposit address
    to_address TEXT NOT NULL,  -- Agent's main wallet
    token_type TEXT NOT NULL,
    amount NUMERIC(20, 9) NOT NULL,
    sui_digest TEXT UNIQUE NOT NULL,
    gas_used NUMERIC(20, 9),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

-- Withdrawal requests table
CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    token_type TEXT NOT NULL,
    amount NUMERIC(20, 9) NOT NULL,
    recipient_address TEXT NOT NULL,
    sui_digest TEXT UNIQUE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_address TEXT REFERENCES user_accounts(user_address),
    action TEXT NOT NULL,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_user_balances_user ON user_balances(user_address);
CREATE INDEX idx_deposit_tx_user ON deposit_transactions(user_address);
CREATE INDEX idx_deposit_tx_status ON deposit_transactions(status);
CREATE INDEX idx_user_tx_user ON user_transactions(user_address);
CREATE INDEX idx_user_tx_created ON user_transactions(created_at DESC);
CREATE INDEX idx_sweep_ops_status ON sweep_operations(status);
CREATE INDEX idx_withdrawal_status ON withdrawal_requests(status);
CREATE INDEX idx_audit_log_user ON audit_log(user_address);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER update_user_balances_updated_at
    BEFORE UPDATE ON user_balances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_last_active
    BEFORE UPDATE ON user_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
