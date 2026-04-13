import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { BoardModule } from '../board/board.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BoardModule, NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
