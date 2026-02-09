import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

export const DATABASE_POOL = 'DATABASE_POOL';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 50, // Connection pool size for high concurrency
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        });

        // Log connection errors
        pool.on('error', (err) => {
          console.error('Unexpected database pool error', err);
        });

        return pool;
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
