-- SuiVisor Multi-User Database Schema
-- Non-Custodial Architecture: Each user manages funds in their own deposit wallet

-- User accounts table
CREATE TABLE IF NOT EXISTS user_accounts (
    user_address TEXT PRIMARY KEY,  -- ASI:One sender address
    deposit_address TEXT UNIQUE NOT NULL,  -- Unique Sui deposit address
    deposit_keypair_seed TEXT NOT NULL,  -- Encrypted seed for deposit address
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed'))
);

-- Deposit transactions table (tracks incoming deposits to user's address)
CREATE TABLE IF NOT EXISTS deposit_transactions (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    sui_digest TEXT UNIQUE NOT NULL,  -- Blockchain transaction hash
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,  -- User's deposit address
    token_type TEXT NOT NULL,
    amount NUMERIC(20, 9) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    block_height BIGINT,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

-- User transactions table (PTB operations executed from user's deposit wallet)
CREATE TABLE IF NOT EXISTS user_transactions (
    id SERIAL PRIMARY KEY,
    user_address TEXT NOT NULL REFERENCES user_accounts(user_address),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('transfer', 'swap', 'stake', 'mint', 'ptb')),
    sui_digest TEXT UNIQUE NOT NULL,
    from_token TEXT,
    to_token TEXT,
    amount NUMERIC(20, 9),
    recipient TEXT,
    gas_used NUMERIC(20, 9),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
    error_message TEXT,
    metadata JSONB,  -- Additional data like NFT details, PTB template, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

-- Balance cache table (optional performance optimization)
CREATE TABLE IF NOT EXISTS balance_cache (
    deposit_address TEXT NOT NULL,
    token_type TEXT NOT NULL,
    balance NUMERIC(20, 9) NOT NULL,
    cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    PRIMARY KEY (deposit_address, token_type)
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
CREATE INDEX IF NOT EXISTS idx_deposit_tx_user ON deposit_transactions(user_address);
CREATE INDEX IF NOT EXISTS idx_deposit_tx_status ON deposit_transactions(status);
CREATE INDEX IF NOT EXISTS idx_user_tx_user ON user_transactions(user_address);
CREATE INDEX IF NOT EXISTS idx_user_tx_created ON user_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_cache_expires ON balance_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_address);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER update_user_last_active
    BEFORE UPDATE ON user_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Comments for documentation
COMMENT ON TABLE user_accounts IS 'Non-custodial: Each user has their own deposit address that holds their funds';
COMMENT ON TABLE balance_cache IS 'Optional cache for blockchain balance queries - expires after 30 seconds';
COMMENT ON TABLE user_transactions IS 'Tracks PTB operations executed from user deposit wallets';
