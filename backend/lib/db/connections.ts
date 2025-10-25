import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Database connection configuration with timeouts and retries
const dbConfig = {
  connect_timeout: 30, // 30 seconds connect timeout
  idle_timeout: 30, // 30 seconds idle timeout
  max_lifetime: 60 * 30, // 30 minutes max connection lifetime
  max: 10, // max 10 connections
  onnotice: () => {}, // suppress notices
  retry: 3, // retry failed connections
};

// Single unified database connection
const client = postgres(process.env.DATABASE_URL || '', dbConfig);
const db = drizzle(client, { schema });

// Aliases for backwards compatibility
export const primaryDb = db;
export const ptbDb = db;

// Type-safe database instances
export type PrimaryDatabase = typeof db;
export type PTBDatabase = typeof db;

// Export schemas for external use (aliases)
export { schema as primarySchema, schema as ptbSchema };
