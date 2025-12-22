import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Configure for serverless with Neon connection pooling
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Log slow queries in development
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// Cache the client in all environments to prevent connection leaks
// In serverless, this helps reuse connections within warm instances
globalForPrisma.prisma = prisma;

export default prisma;

