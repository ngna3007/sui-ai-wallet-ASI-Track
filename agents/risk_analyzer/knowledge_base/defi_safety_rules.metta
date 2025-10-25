;; ============================================================================
;; SuiVisor DeFi Safety Rules Knowledge Base (MeTTa)
;;
;; This knowledge base contains structured rules for assessing transaction
;; safety in decentralized finance operations on Sui blockchain.
;;
;; MeTTa (Meta Type Talk) enables symbolic reasoning with explicit rules,
;; allowing the Risk Analyzer agent to make deterministic safety decisions.
;; ============================================================================

;; ============================================================================
;; GAS LIMIT RULES
;; ============================================================================

;; Safe gas limits for different operations (in SUI)
(SafeGasLimit Swap 0.05)
(SafeGasLimit Transfer 0.02)
(SafeGasLimit Stake 0.03)
(SafeGasLimit Unstake 0.03)

;; Minimum gas reserve to keep in wallet
(MinimumGasReserve 0.1)

;; Maximum acceptable gas for any single transaction
(MaximumGas 0.5)


;; ============================================================================
;; SLIPPAGE TOLERANCE RULES
;; ============================================================================

;; Safe slippage tolerance for swaps (as decimal, e.g., 0.01 = 1%)
(SafeSlippage DefaultSwap 0.01)
(SafeSlippage LowLiquidity 0.03)
(SafeSlippage HighVolatility 0.05)

;; Maximum acceptable slippage
(MaximumSlippage 0.10)


;; ============================================================================
;; TRANSACTION AMOUNT LIMITS
;; ============================================================================

;; Maximum single transaction amounts (in token units)
(MaxTransactionAmount SUI 100)
(MaxTransactionAmount USDC 10000)
(MaxTransactionAmount USDT 10000)

;; Minimum transaction amounts (to avoid dust)
(MinTransactionAmount SUI 0.01)
(MinTransactionAmount USDC 0.01)


;; ============================================================================
;; TRUSTED PROTOCOLS
;; ============================================================================

;; Verified DeFi protocols on Sui
(TrustedProtocol Cetus verified)
(TrustedProtocol Turbos verified)
(TrustedProtocol SuiSwap verified)
(TrustedProtocol Aftermath verified)

;; Protocol risk levels
(ProtocolRisk Cetus low)
(ProtocolRisk Turbos low)
(ProtocolRisk SuiSwap medium)


;; ============================================================================
;; TRUSTED TOKENS
;; ============================================================================

;; Official tokens on Sui
(TrustedToken SUI official)
(TrustedToken USDC official)
(TrustedToken USDT official)

;; Token risk classifications
(TokenRisk SUI low)
(TokenRisk USDC low)
(TokenRisk USDT low)


;; ============================================================================
;; HIGH-RISK PATTERNS
;; ============================================================================

;; Patterns that indicate high risk
(HighRiskPattern MultiHopSwap)
(HighRiskPattern CrossChainBridge)
(HighRiskPattern UnverifiedToken)
(HighRiskPattern UnknownRecipient)
(HighRiskPattern ExcessiveGas)


;; ============================================================================
;; ADDRESS VALIDATION RULES
;; ============================================================================

;; Known safe addresses (validators, contracts)
(SafeAddress "0x0000000000000000000000000000000000000000000000000000000000000002" SuiSystem)
(SafeAddress "0x0000000000000000000000000000000000000000000000000000000000000003" SuiFramework)

;; Address format requirements
(RequiresHexFormat Address)
(AddressLength 64)
(AddressPrefix "0x")


;; ============================================================================
;; RISK SCORING RULES
;; ============================================================================

;; Risk score calculations (0.0 = no risk, 1.0 = maximum risk)
(RiskScore ExcessiveAmount 0.7)
(RiskScore HighSlippage 0.6)
(RiskScore UnverifiedProtocol 0.8)
(RiskScore UnknownToken 0.9)
(RiskScore InvalidAddress 1.0)


;; ============================================================================
;; SAFETY CHECK FUNCTIONS
;; ============================================================================

;; Function: Check if gas amount is safe
(: safe-gas (-> Float Bool))
(= (safe-gas $gas)
   (and
      (< $gas (MaximumGas))
      (> $gas 0.0)))

;; Function: Check if slippage is acceptable
(: safe-slippage (-> Float Bool))
(= (safe-slippage $slippage)
   (and
      (< $slippage (MaximumSlippage))
      (>= $slippage 0.0)))

;; Function: Check if transaction amount is within limits
(: safe-amount (-> String Float Bool))
(= (safe-amount $token $amount)
   (and
      (< $amount (MaxTransactionAmount $token))
      (> $amount (MinTransactionAmount $token))))

;; Function: Check if token is trusted
(: trusted-token (-> String Bool))
(= (trusted-token $token)
   (TrustedToken $token official))

;; Function: Check if protocol is verified
(: verified-protocol (-> String Bool))
(= (verified-protocol $protocol)
   (TrustedProtocol $protocol verified))


;; ============================================================================
;; COMPOSITE SAFETY CHECKS
;; ============================================================================

;; Function: Comprehensive swap safety check
(: safe-swap-transaction (-> String String Float Float Bool))
(= (safe-swap-transaction $fromToken $toToken $amount $slippage)
   (and
      (trusted-token $fromToken)
      (trusted-token $toToken)
      (safe-amount $fromToken $amount)
      (safe-slippage $slippage)))

;; Function: Comprehensive transfer safety check
(: safe-transfer-transaction (-> String Float String Bool))
(= (safe-transfer-transaction $token $amount $recipient)
   (and
      (trusted-token $token)
      (safe-amount $token $amount)
      (RequiresHexFormat Address)))


;; ============================================================================
;; RISK LEVEL DETERMINATION
;; ============================================================================

;; Function: Determine overall risk level
(: calculate-risk-level (-> Float String))
(= (calculate-risk-level $score)
   (if (< $score 0.3) "low"
   (if (< $score 0.6) "medium"
   (if (< $score 0.8) "high" "critical"))))


;; ============================================================================
;; RECOMMENDATION GENERATION
;; ============================================================================

;; Recommendations based on risk factors
(Recommendation HighSlippage "Consider reducing slippage tolerance to minimize price impact")
(Recommendation LargeAmount "Consider splitting into multiple smaller transactions")
(Recommendation UnverifiedToken "Only proceed if you trust this token source")
(Recommendation LowGas "Ensure sufficient gas reserves for transaction completion")


;; ============================================================================
;; SECURITY BEST PRACTICES
;; ============================================================================

;; General security guidelines
(BestPractice "Always verify recipient addresses before transfers")
(BestPractice "Start with small amounts when using new protocols")
(BestPractice "Keep minimum gas reserve for emergency transactions")
(BestPractice "Double-check token addresses to avoid scams")
(BestPractice "Use established DEXs with high liquidity")


;; ============================================================================
;; TEMPORAL RULES (Time-based restrictions)
;; ============================================================================

;; Daily transaction limits for safety
(DailyTransactionLimit USDC 50000)
(DailyTransactionLimit SUI 500)

;; Cool-down period between large transactions (in minutes)
(TransactionCooldown LargeAmount 30)


;; ============================================================================
;; QUERY EXAMPLES (for testing)
;; ============================================================================

;; Example 1: Is this swap safe?
;; (? (safe-swap-transaction SUI USDC 10 0.01))
;; Expected: True (safe)

;; Example 2: Is this slippage too high?
;; (? (safe-slippage 0.15))
;; Expected: False (exceeds maximum)

;; Example 3: What's the risk level for score 0.75?
;; (? (calculate-risk-level 0.75))
;; Expected: "high"

;; Example 4: Is this gas amount safe?
;; (? (safe-gas 0.6))
;; Expected: False (exceeds maximum)
