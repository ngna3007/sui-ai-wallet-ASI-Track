import type { InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const user = pgTable('User', {
  id: uuid().primaryKey().notNull().defaultRandom(),
  email: varchar({ length: 128 }).notNull(), // Increased to support wallet addresses
  password: varchar({ length: 64 }),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable('Chat', {
  id: uuid().primaryKey().notNull().defaultRandom(),
  createdAt: timestamp().notNull(),
  title: text().notNull(),
  userId: uuid()
    .notNull()
    .references(() => user.id),
  visibility: varchar({ enum: ['public', 'private'] })
    .notNull()
    .default('private'),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable('Message', {
  id: uuid().primaryKey().notNull().defaultRandom(),
  chatId: uuid()
    .notNull()
    .references(() => chat.id),
  role: varchar().notNull(),
  parts: json().notNull(),
  attachments: json().notNull(),
  createdAt: timestamp().notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  'Vote',
  {
    chatId: uuid()
      .notNull()
      .references(() => chat.id),
    messageId: uuid()
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('kind', {
      enum: ['text', 'ptb'],
    })
      .notNull()
      .default('text'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  },
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  }),
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  'Stream',
  {
    id: uuid('id').notNull().defaultRandom(),
    chatId: uuid('chatId').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  }),
);

export type Stream = InferSelectModel<typeof stream>;

// ---------------------------
// PTB Tables (kept)
// ---------------------------

export const transactionStatusEnum = pgEnum('transaction_status', [
  'pending',
  'success',
  'failed',
]);

const ptbFields = {
  id: uuid().primaryKey().defaultRandom(),
};

// PTB Registry table
export const ptbRegistry = pgTable('ptb_registry', {
  ...ptbFields,
  name: text().notNull(),
  description: text(),
  typescriptCode: text(),
  inputSchema: jsonb().notNull(),
  outputSchema: jsonb().notNull(),
  isActive: boolean().notNull().default(true),
  embedding: jsonb(),
  tags: text().array(),
  sourceCodeUrl: text(),
  contractAddress: text(),
  functionName: text(),
  createdByUserId: integer(),
  package_id: text(),
  supportingTools: jsonb(),
});

// Executed Transactions table (PTB)
export const ptbExecutedTransactions = pgTable('executed_transactions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp().defaultNow().notNull(),
  userId: uuid()
    .references(() => user.id, { onDelete: 'cascade' })
    .notNull(),
  ptbId: uuid().references(() => ptbRegistry.id),
  inputData: jsonb().notNull(),
  outputData: jsonb(),
  suiTxDigest: text().unique(),
  suiTxBlock: text(),
  gasUsed: text(),
  gasPrice: text(),
  gasBudget: text(),
  status: transactionStatusEnum().notNull().default('pending'),
  messageId: text(),
});

// Type exports for PTB entities
export type PtbRegistry = InferSelectModel<typeof ptbRegistry>;
export type PtbExecutedTransaction = InferSelectModel<
  typeof ptbExecutedTransactions
>;
