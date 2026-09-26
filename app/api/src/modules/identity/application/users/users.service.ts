import type { User } from '../../domain/entities/user.interface.js';
import type { UserRepository } from '../ports/user.repository.js';

export class UsersService {
  constructor(private readonly userRepository: UserRepository) {}

  findOne(email: string): Promise<User | null> {
    const emailNormalized = email.trim().toLowerCase();
    return this.userRepository.findByEmail(emailNormalized);
  }

  findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  create(user: User): Promise<User> {
    return this.userRepository.create(user);
  }
}
