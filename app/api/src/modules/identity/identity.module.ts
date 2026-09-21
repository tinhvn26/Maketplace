import { Module } from '@nestjs/common';
import { AuthController } from './presentation/http/auth.controller.js';
import { AuthService } from './application/auth/auth.service.js';
import { InMemoryUserRepository } from './infrastructure/persistence/in-memory-user.repository.js';
import { ScryptPasswordHasher } from './infrastructure/providers/scrypt-password.hasher.js';
import { PASSWORD_HASHER } from './application/ports/password-hasher.js';
import { USER_REPOSITORY } from './application/ports/user.repository.js';

@Module({
    imports: [],
    controllers: [AuthController],
    providers: [
        AuthService,
        { provide: USER_REPOSITORY, useClass: InMemoryUserRepository },
        { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    ],
    exports: [AuthService],
})
export class IdentityModule {}