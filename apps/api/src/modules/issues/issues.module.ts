import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { BoardModule } from '../board/board.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BoardModule, NotificationsModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
