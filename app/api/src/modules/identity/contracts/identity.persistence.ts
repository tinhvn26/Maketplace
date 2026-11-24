// For other modules' persistence adapters that must recheck an account inside
// their own write transaction. Never import this from domain/application.
export {
  activeAccountIdsSql,
  activeAccountWhere,
  findActiveAccount,
  lockAccount,
} from '../infrastructure/persistence/account.persistence.js';
export type { ActiveAccount } from '../infrastructure/persistence/account.persistence.js';
