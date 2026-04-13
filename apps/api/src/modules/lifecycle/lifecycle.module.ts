import { Module } from '@nestjs/common';
import { DataLifecycleService } from './data-lifecycle.service';
import { LifecycleController } from './lifecycle.controller';

@Module({
  controllers: [LifecycleController],
  providers: [DataLifecycleService],
  exports: [DataLifecycleService],
})
export class LifecycleModule {}
