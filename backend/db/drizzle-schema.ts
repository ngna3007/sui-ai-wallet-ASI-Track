/**
 * Drizzle ORM Schema for SuiVisor Multi-User Wallet
 */
import { pgTable, text, numeric, timestamp, serial, bigint, index, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// User accounts table
export const userAccounts = pgTable('user_accounts', {
  userAddress: text('user_address').primaryKey(),
  depositAddress: text('deposit_address').notNull().unique(),
  depositKeypairSeed: text('deposit_keypair_seed').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  lastActive: timestamp('last_active').defaultNow(),
  status: text('status', { enum: ['active', 'suspended', 'closed'] }).default('active'),
});

// User balances table
export const userBalances = pgTable('user_balances', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => userAccounts.userAddress),
  tokenType: text('token_type').notNull(),
  balance: numeric('balance', { precision: 20, scale: 9 }).default('0').notNull(),
  lockedBalance: numeric('locked_balance', { precision: 20, scale: 9 }).default('0'),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userAddressIdx: index('idx_user_balances_user').on(table.userAddress),
}));

// Deposit transactions table
export const depositTransactions = pgTable('deposit_transactions', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => userAccounts.userAddress),
  suiDigest: text('sui_digest').notNull().unique(),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  tokenType: text('token_type').notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  status: text('status', { enum: ['pending', 'confirmed', 'swept', 'failed'] }).default('pending'),
  blockHeight: bigint('block_height', { mode: 'number' }),
  detectedAt: timestamp('detected_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
  sweptAt: timestamp('swept_at'),
}, (table) => ({
  userAddressIdx: index('idx_deposit_tx_user').on(table.userAddress),
  statusIdx: index('idx_deposit_tx_status').on(table.status),
}));

// User transactions table
export const userTransactions = pgTable('user_transactions', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => userAccounts.userAddress),
  transactionType: text('transaction_type', {
    enum: ['transfer', 'swap', 'stake', 'withdraw']
  }).notNull(),
  suiDigest: text('sui_digest').notNull().unique(),
  fromToken: text('from_token').notNull(),
  toToken: text('to_token'),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  recipient: text('recipient'),
  gasUsed: numeric('gas_used', { precision: 20, scale: 9 }),
  status: text('status', { enum: ['pending', 'confirmed', 'failed'] }).default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
}, (table) => ({
  userAddressIdx: index('idx_user_tx_user').on(table.userAddress),
  createdAtIdx: index('idx_user_tx_created').on(table.createdAt),
}));

// Sweep operations table
export const sweepOperations = pgTable('sweep_operations', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => userAccounts.userAddress),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  tokenType: text('token_type').notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  suiDigest: text('sui_digest').notNull().unique(),
  gasUsed: numeric('gas_used', { precision: 20, scale: 9 }),
  status: text('status', { enum: ['pending', 'confirmed', 'failed'] }).default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
}, (table) => ({
  statusIdx: index('idx_sweep_ops_status').on(table.status),
}));

// Withdrawal requests table
export const withdrawalRequests = pgTable('withdrawal_requests', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => userAccounts.userAddress),
  tokenType: text('token_type').notNull(),
  amount: numeric('amount', { precision: 20, scale: 9 }).notNull(),
  recipientAddress: text('recipient_address').notNull(),
  suiDigest: text('sui_digest').unique(),
  status: text('status', {
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled']
  }).default('pending'),
  requestedAt: timestamp('requested_at').defaultNow(),
  processedAt: timestamp('processed_at'),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
}, (table) => ({
  statusIdx: index('idx_withdrawal_status').on(table.status),
}));

// Audit log table
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').references(() => userAccounts.userAddress),
  action: text('action').notNull(),
  details: jsonb('details'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userAddressIdx: index('idx_audit_log_user').on(table.userAddress),
}));

// User NFTs table
export const userNfts = pgTable('user_nfts', {
  id: serial('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => userAccounts.userAddress),
  nftObjectId: text('nft_object_id').notNull().unique(),
  nftType: text('nft_type'),
  name: text('name'),
  description: text('description'),
  imageUrl: text('image_url'),
  status: text('status', { enum: ['owned', 'transferred', 'burned'] }).default('owned'),
  mintTxDigest: text('mint_tx_digest').notNull(),
  transferTxDigest: text('transfer_tx_digest'),
  recipientAddress: text('recipient_address'),
  mintedAt: timestamp('minted_at').defaultNow(),
  transferredAt: timestamp('transferred_at'),
}, (table) => ({
  userAddressIdx: index('idx_user_nfts_user').on(table.userAddress),
  statusIdx: index('idx_user_nfts_status').on(table.status),
}));

// Relations
export const userAccountsRelations = relations(userAccounts, ({ many }) => ({
  balances: many(userBalances),
  deposits: many(depositTransactions),
  transactions: many(userTransactions),
  sweeps: many(sweepOperations),
  withdrawals: many(withdrawalRequests),
  auditLogs: many(auditLog),
  nfts: many(userNfts),
}));

export const userBalancesRelations = relations(userBalances, ({ one }) => ({
  user: one(userAccounts, {
    fields: [userBalances.userAddress],
    references: [userAccounts.userAddress],
  }),
}));

export const depositTransactionsRelations = relations(depositTransactions, ({ one }) => ({
  user: one(userAccounts, {
    fields: [depositTransactions.userAddress],
    references: [userAccounts.userAddress],
  }),
}));

export const userTransactionsRelations = relations(userTransactions, ({ one }) => ({
  user: one(userAccounts, {
    fields: [userTransactions.userAddress],
    references: [userAccounts.userAddress],
  }),
}));

export const sweepOperationsRelations = relations(sweepOperations, ({ one }) => ({
  user: one(userAccounts, {
    fields: [sweepOperations.userAddress],
    references: [userAccounts.userAddress],
  }),
}));

export const withdrawalRequestsRelations = relations(withdrawalRequests, ({ one }) => ({
  user: one(userAccounts, {
    fields: [withdrawalRequests.userAddress],
    references: [userAccounts.userAddress],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(userAccounts, {
    fields: [auditLog.userAddress],
    references: [userAccounts.userAddress],
  }),
}));

export const userNftsRelations = relations(userNfts, ({ one }) => ({
  user: one(userAccounts, {
    fields: [userNfts.userAddress],
    references: [userAccounts.userAddress],
  }),
}));
