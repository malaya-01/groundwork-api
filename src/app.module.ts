import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth';
import { MapsModule } from './maps/maps';
import { LogsModule } from './logs/logs';
import { ReviewsModule } from './reviews/reviews';
import { MetricsModule } from './metrics/metrics';

@Module({
  imports: [
    // Used only where @UseGuards(ThrottlerGuard) is applied (login / setup): 10 tries per minute.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    DbModule,
    AuthModule,
    MapsModule,
    LogsModule,
    ReviewsModule,
    MetricsModule,
  ],
})
export class AppModule {}
