import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '../.env' });

export default {
  schema: './db/drizzle-schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
