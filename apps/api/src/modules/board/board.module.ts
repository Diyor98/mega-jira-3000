import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGateway } from './board.gateway';
import { EventService } from './event.service';

@Module({
  imports: [AuthModule],
  providers: [BoardGateway, EventService],
  exports: [EventService],
})
export class BoardModule {}
