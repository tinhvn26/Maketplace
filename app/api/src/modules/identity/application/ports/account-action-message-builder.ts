import type { AccountActionPurpose } from '../../domain/types/account-action-purpose.type.js';

export const ACCOUNT_ACTION_MESSAGE_BUILDER = Symbol(
  'ACCOUNT_ACTION_MESSAGE_BUILDER',
);

export interface AccountActionMessageInput {
  purpose: AccountActionPurpose;
  token: string;
  expiresInMinutes: number;
}

export interface AccountActionMessage {
  subject: string;
  text: string;
}

export interface AccountActionMessageBuilder {
  build(input: AccountActionMessageInput): AccountActionMessage;
}
