export interface EmailVerificationRequester {
  requestVerification(email: string): Promise<void>;
}
