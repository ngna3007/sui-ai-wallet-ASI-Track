import { generateDummyPassword } from './db/schema-utils';

export const isProductionEnvironment = process.env.NODE_ENV === 'production';
export const isDevelopmentEnvironment = process.env.NODE_ENV === 'development';
export const isTestEnvironment = false;

export const DUMMY_PASSWORD = generateDummyPassword();

// Regex to identify guest users (typically have generated email addresses)
export const guestRegex = /^guest_\w+@/;
