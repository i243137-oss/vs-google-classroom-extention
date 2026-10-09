import * as assert from 'assert';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  GoogleAuthServiceImpl,
  SECRET_STORAGE_KEY,
} from '../../src/auth/GoogleAuthService.js';
import {
  GoogleAuthTokens,
  AuthConfig,
  REQUIRED_SCOPES,
} from '../../src/auth/types.js';
import { AuthenticationError } from '../../src/errors/errors.js';

class MockSecretStorage implements vscode.SecretStorage {
  private storage = new Map<string, string>();

  public async get(key: string): Promise<string | undefined> {
    return this.storage.get(key);
  }

  public async store(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  public async keys(): Promise<string[]> {
    return Array.from(this.storage.keys());
  }

  public onDidChange = () => ({ dispose: () => {} });
}

suite('Phase 4 — Google OAuth Authentication', () => {
  let mockSecrets: MockSecretStorage;
  let testConfig: AuthConfig;
  let authService: GoogleAuthServiceImpl;
  let originalFetch: typeof globalThis.fetch;

  setup(() => {
    mockSecrets = new MockSecretStorage();
    testConfig = {
      clientId: 'test-client-id-123.apps.googleusercontent.com',
      clientSecret: 'test-client-secret-xyz',
      redirectUri: 'http://localhost:5000/auth/google/callback',
    };
    authService = new GoogleAuthServiceImpl(mockSecrets, () => testConfig);
    originalFetch = globalThis.fetch;
  });

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  suite('PKCE and State Generation', () => {
    test('generatePKCE creates high-entropy base64url verifier and challenge', () => {
      const pkce = authService.generatePKCE();

      assert.ok(pkce.codeVerifier.length >= 43, 'Verifier must be at least 43 chars');
      assert.match(
        pkce.codeVerifier,
        /^[A-Za-z0-9\-_~]+$/,
        'Verifier must use base64url characters',
      );

      const expectedChallenge = crypto
        .createHash('sha256')
        .update(pkce.codeVerifier)
        .digest('base64url');
      assert.strictEqual(
        pkce.codeChallenge,
        expectedChallenge,
        'Challenge must match SHA256 of verifier',
      );
    });

    test('generateState creates random hex string', () => {
      const state1 = authService.generateState();
      const state2 = authService.generateState();

      assert.strictEqual(state1.length, 32, 'State must be 32 hex chars');
      assert.notStrictEqual(state1, state2, 'State must be random per invocation');
    });

    test('buildAuthorizationUrl constructs valid Google OAuth URL with required scopes', () => {
      const pkce = authService.generatePKCE();
      const state = authService.generateState();
      const urlStr = authService.buildAuthorizationUrl(testConfig, pkce, state);
      const parsed = new URL(urlStr);

      assert.strictEqual(parsed.hostname, 'accounts.google.com');
      assert.strictEqual(parsed.searchParams.get('client_id'), testConfig.clientId);
      assert.strictEqual(parsed.searchParams.get('redirect_uri'), testConfig.redirectUri);
      assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
      assert.strictEqual(parsed.searchParams.get('code_challenge'), pkce.codeChallenge);
      assert.strictEqual(parsed.searchParams.get('code_challenge_method'), 'S256');
      assert.strictEqual(parsed.searchParams.get('state'), state);
      assert.strictEqual(parsed.searchParams.get('access_type'), 'offline');
      assert.strictEqual(parsed.searchParams.get('prompt'), 'consent');

      // Verify scopes
      const scopes = parsed.searchParams.get('scope')?.split(' ') || [];
      for (const requiredScope of REQUIRED_SCOPES) {
        assert.ok(
          scopes.includes(requiredScope),
          `Missing required scope: ${requiredScope}`,
        );
      }
    });
  });

  suite('Secret Storage and Authentication State', () => {
    test('isAuthenticated returns false when storage is empty', async () => {
      const isAuthed = await authService.isAuthenticated();
      assert.strictEqual(isAuthed, false);
    });

    test('isAuthenticated returns true when valid active token is stored', async () => {
      const tokens: GoogleAuthTokens = {
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
        scopes: ['openid', 'email'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(tokens));

      const isAuthed = await authService.isAuthenticated();
      assert.strictEqual(isAuthed, true);
    });

    test('isAuthenticated returns true when token is expired but refresh token exists', async () => {
      const tokens: GoogleAuthTokens = {
        accessToken: 'expired-access-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() - 5000, // expired 5 seconds ago
        scopes: ['openid'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(tokens));

      const isAuthed = await authService.isAuthenticated();
      assert.strictEqual(isAuthed, true);
    });

    test('isAuthenticated returns false when token is expired and no refresh token exists', async () => {
      const tokens: GoogleAuthTokens = {
        accessToken: 'expired-access-token',
        expiresAt: Date.now() - 5000,
        scopes: ['openid'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(tokens));

      const isAuthed = await authService.isAuthenticated();
      assert.strictEqual(isAuthed, false);
    });

    test('getAccessToken returns active token directly without network call', async () => {
      const tokens: GoogleAuthTokens = {
        accessToken: 'active-mock-token',
        expiresAt: Date.now() + 3600 * 1000,
        scopes: ['openid'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(tokens));

      const token = await authService.getAccessToken();
      assert.strictEqual(token, 'active-mock-token');
    });

    test('getAccessToken throws AuthenticationError when not logged in', async () => {
      await assert.rejects(
        () => authService.getAccessToken(),
        (err: Error) => {
          assert.strictEqual(err.name, 'AuthenticationError');
          assert.strictEqual((err as AuthenticationError).code, 'NOT_AUTHENTICATED');
          return true;
        },
      );
    });
  });

  suite('Token Exchange and Refresh Logic', () => {
    test('exchangeCodeForTokens parses successful token response', async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'newly-exchanged-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid email',
          }),
        } as unknown as Response;
      };

      const tokens = await authService.exchangeCodeForTokens(
        'mock-auth-code',
        'mock-verifier',
        testConfig,
      );

      assert.strictEqual(tokens.accessToken, 'newly-exchanged-access-token');
      assert.strictEqual(tokens.refreshToken, 'new-refresh-token');
      assert.ok(tokens.expiresAt > Date.now());
      assert.deepStrictEqual(tokens.scopes, ['openid', 'email']);
    });

    test('exchangeCodeForTokens handles OAuth error response cleanly', async () => {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Code has expired or has already been used.',
          }),
        } as unknown as Response;
      };

      await assert.rejects(
        () =>
          authService.exchangeCodeForTokens(
            'expired-code',
            'mock-verifier',
            testConfig,
          ),
        (err: Error) => {
          assert.strictEqual(err.name, 'AuthenticationError');
          assert.strictEqual((err as AuthenticationError).code, 'TOKEN_EXCHANGE_FAILED');
          assert.ok(err.message.includes('expired or has already been used'));
          return true;
        },
      );
    });

    test('refreshTokens refreshes expired token and updates SecretStorage', async () => {
      const initialTokens: GoogleAuthTokens = {
        accessToken: 'stale-token',
        refreshToken: 'persistent-refresh-token',
        expiresAt: Date.now() - 1000,
        scopes: ['openid', 'email'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(initialTokens));

      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'refreshed-access-token',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid email',
          }),
        } as unknown as Response;
      };

      const refreshed = await authService.refreshTokens('persistent-refresh-token');
      assert.strictEqual(refreshed.accessToken, 'refreshed-access-token');
      assert.strictEqual(refreshed.refreshToken, 'persistent-refresh-token');

      // Verify updated in SecretStorage
      const stored = await authService.getStoredTokens();
      assert.strictEqual(stored?.accessToken, 'refreshed-access-token');
    });

    test('refreshTokens detects revoked access and purges SecretStorage', async () => {
      const initialTokens: GoogleAuthTokens = {
        accessToken: 'stale-token',
        refreshToken: 'revoked-refresh-token',
        expiresAt: Date.now() - 1000,
        scopes: ['openid'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(initialTokens));

      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          }),
        } as unknown as Response;
      };

      await assert.rejects(
        () => authService.refreshTokens('revoked-refresh-token'),
        (err: Error) => {
          assert.strictEqual(err.name, 'AuthenticationError');
          assert.strictEqual((err as AuthenticationError).code, 'REVOKED_ACCESS');
          return true;
        },
      );

      // Verify purged from storage
      const stored = await authService.getStoredTokens();
      assert.strictEqual(stored, undefined);
    });
  });

  suite('Sign Out and Revocation', () => {
    test('signOut removes credentials from SecretStorage and revokes token', async () => {
      const tokens: GoogleAuthTokens = {
        accessToken: 'token-to-revoke',
        refreshToken: 'refresh-to-revoke',
        expiresAt: Date.now() + 3600 * 1000,
        scopes: ['openid'],
      };
      await mockSecrets.store(SECRET_STORAGE_KEY, JSON.stringify(tokens));

      let revocationCalled = false;
      globalThis.fetch = async (url: string | URL | Request) => {
        if (String(url).includes('oauth2.googleapis.com/revoke')) {
          revocationCalled = true;
          return { ok: true, status: 200 } as unknown as Response;
        }
        return { ok: true, status: 200 } as unknown as Response;
      };

      await authService.signOut();

      assert.strictEqual(revocationCalled, true, 'Revoke endpoint should be invoked');
      const stored = await mockSecrets.get(SECRET_STORAGE_KEY);
      assert.strictEqual(stored, undefined, 'SecretStorage must be empty after signOut');
    });
  });

  suite('Configuration Validation', () => {
    test('throws INVALID_CONFIG if clientId is empty', async () => {
      const badService = new GoogleAuthServiceImpl(mockSecrets, () => ({
        clientId: '',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:5000/auth/google/callback',
      }));

      await assert.rejects(
        () => badService.signIn(),
        (err: Error) => {
          assert.strictEqual(err.name, 'AuthenticationError');
          assert.strictEqual((err as AuthenticationError).code, 'INVALID_CONFIG');
          return true;
        },
      );
    });

    test('throws INVALID_CONFIG if clientSecret is empty', async () => {
      const badService = new GoogleAuthServiceImpl(mockSecrets, () => ({
        clientId: 'id',
        clientSecret: '',
        redirectUri: 'http://localhost:5000/auth/google/callback',
      }));

      await assert.rejects(
        () => badService.signIn(),
        (err: Error) => {
          assert.strictEqual(err.name, 'AuthenticationError');
          assert.strictEqual((err as AuthenticationError).code, 'INVALID_CONFIG');
          return true;
        },
      );
    });
  });
});
