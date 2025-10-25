CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text,
	"action" text NOT NULL,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"sui_digest" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"token_type" text NOT NULL,
	"amount" numeric(20, 9) NOT NULL,
	"status" text DEFAULT 'pending',
	"block_height" bigint,
	"detected_at" timestamp DEFAULT now(),
	"confirmed_at" timestamp,
	"swept_at" timestamp,
	CONSTRAINT "deposit_transactions_sui_digest_unique" UNIQUE("sui_digest")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sweep_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"token_type" text NOT NULL,
	"amount" numeric(20, 9) NOT NULL,
	"sui_digest" text NOT NULL,
	"gas_used" numeric(20, 9),
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	"confirmed_at" timestamp,
	CONSTRAINT "sweep_operations_sui_digest_unique" UNIQUE("sui_digest")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_accounts" (
	"user_address" text PRIMARY KEY NOT NULL,
	"deposit_address" text NOT NULL,
	"deposit_keypair_seed" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"last_active" timestamp DEFAULT now(),
	"status" text DEFAULT 'active',
	CONSTRAINT "user_accounts_deposit_address_unique" UNIQUE("deposit_address")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"token_type" text NOT NULL,
	"balance" numeric(20, 9) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(20, 9) DEFAULT '0',
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_nfts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"nft_object_id" text NOT NULL,
	"nft_type" text,
	"name" text,
	"description" text,
	"image_url" text,
	"status" text DEFAULT 'owned',
	"mint_tx_digest" text NOT NULL,
	"transfer_tx_digest" text,
	"recipient_address" text,
	"minted_at" timestamp DEFAULT now(),
	"transferred_at" timestamp,
	CONSTRAINT "user_nfts_nft_object_id_unique" UNIQUE("nft_object_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"transaction_type" text NOT NULL,
	"sui_digest" text NOT NULL,
	"from_token" text NOT NULL,
	"to_token" text,
	"amount" numeric(20, 9) NOT NULL,
	"recipient" text,
	"gas_used" numeric(20, 9),
	"status" text DEFAULT 'pending',
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"confirmed_at" timestamp,
	CONSTRAINT "user_transactions_sui_digest_unique" UNIQUE("sui_digest")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"token_type" text NOT NULL,
	"amount" numeric(20, 9) NOT NULL,
	"recipient_address" text NOT NULL,
	"sui_digest" text,
	"status" text DEFAULT 'pending',
	"requested_at" timestamp DEFAULT now(),
	"processed_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	CONSTRAINT "withdrawal_requests_sui_digest_unique" UNIQUE("sui_digest")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sweep_operations" ADD CONSTRAINT "sweep_operations_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_nfts" ADD CONSTRAINT "user_nfts_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_transactions" ADD CONSTRAINT "user_transactions_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_address_user_accounts_user_address_fk" FOREIGN KEY ("user_address") REFERENCES "public"."user_accounts"("user_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_user" ON "audit_log" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deposit_tx_user" ON "deposit_transactions" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deposit_tx_status" ON "deposit_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sweep_ops_status" ON "sweep_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_balances_user" ON "user_balances" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_nfts_user" ON "user_nfts" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_nfts_status" ON "user_nfts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_tx_user" ON "user_transactions" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_tx_created" ON "user_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_withdrawal_status" ON "withdrawal_requests" USING btree ("status");