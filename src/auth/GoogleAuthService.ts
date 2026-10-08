/**
 * GoogleAuthService — stub for Phase 1.
 *
 * Full implementation in Phase 4.
 * This file defines the interface contract that the rest of the extension
 * will program against. All phases use this interface; only the
 * implementation changes in Phase 4.
 */
export interface GoogleAuthService {
  /** Initiates the OAuth flow and stores tokens securely. */
  signIn(): Promise<void>;
  /** Revokes tokens and clears SecretStorage. */
  signOut(): Promise<void>;
  /** Returns true if a valid (non-expired) token exists. */
  isAuthenticated(): Promise<boolean>;
  /** Returns a valid access token, refreshing if necessary. Never logs the token. */
  getAccessToken(): Promise<string>;
}
