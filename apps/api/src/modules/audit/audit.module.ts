import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { AuditController } from './audit.controller';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
