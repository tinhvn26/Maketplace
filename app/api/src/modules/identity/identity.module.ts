import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { InMemoryUserRepository } from './infrastructure/in-memory-user.repository.js';
import { ScryptPasswordHasher } from './infrastructure/scrypt-password.hasher.js';
import { PASSWORD_HASHER } from './ports/password-hasher.js';
import { USER_REPOSITORY } from './ports/user.repository.js';

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