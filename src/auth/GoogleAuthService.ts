import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import { URL } from 'url';
import {
  GoogleAuthTokens,
  GoogleTokenResponse,
  GoogleUserInfo,
  AuthConfig,
  PKCEPair,
  REQUIRED_SCOPES,
} from './types.js';
import { AuthenticationError } from '../errors/errors.js';
import { Logger } from '../utils/logger.js';

export const SECRET_STORAGE_KEY = 'classroomSubmit.googleAuthTokens';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const AUTH_TIMEOUT_MS = 180000; // 3 minutes timeout

export interface GoogleAuthService {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  getAccessToken(): Promise<string>;
  getUserInfo(): Promise<GoogleUserInfo | undefined>;
}

export class GoogleAuthServiceImpl implements GoogleAuthService {
  private readonly logger = Logger.getInstance();
  private readonly secrets: vscode.SecretStorage;
  private readonly configProvider: () => AuthConfig;
  private cachedUserInfo?: GoogleUserInfo | undefined;

  constructor(
    secrets: vscode.SecretStorage,
    configProvider: () => AuthConfig,
  ) {
    this.secrets = secrets;
    this.configProvider = configProvider;
  }

  /**
   * Generates a cryptographically random PKCE verifier and S256 challenge.
   */
  public generatePKCE(): PKCEPair {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  /**
   * Generates a random state string for CSRF mitigation.
   */
  public generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Checks if valid tokens are currently stored.
   */
  public async isAuthenticated(): Promise<boolean> {
    try {
      const tokens = await this.getStoredTokens();
      if (!tokens || !tokens.accessToken) {
        return false;
      }
      // If expired but we have a refresh token, consider authenticated
      // (it will be refreshed when access token is requested).
      if (Date.now() >= tokens.expiresAt - 60000) {
        return Boolean(tokens.refreshToken);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets a valid access token, automatically refreshing if expired or about to expire.
   * NEVER logs the token.
   */
  public async getAccessToken(): Promise<string> {
    const tokens = await this.getStoredTokens();
    if (!tokens || !tokens.accessToken) {
      throw new AuthenticationError(
        'Not signed in. Please sign in to Google Classroom first.',
        'NOT_AUTHENTICATED',
      );
    }

    // Check if token is still valid (with 60 second safety buffer)
    if (Date.now() < tokens.expiresAt - 60000) {
      return tokens.accessToken;
    }

    // Token is expired; attempt refresh
    if (!tokens.refreshToken) {
      await this.signOut();
      throw new AuthenticationError(
        'Google session expired and no refresh token is available. Please sign in again.',
        'EXPIRED_NO_REFRESH',
      );
    }

    this.logger.info('Access token expired. Refreshing using refresh token…');
    const refreshed = await this.refreshTokens(tokens.refreshToken);
    return refreshed.accessToken;
  }

  /**
   * Performs the full OAuth 2.0 PKCE sign-in flow.
   */
  public async signIn(): Promise<void> {
    const config = this.configProvider();
    this.validateConfig(config);

    const pkce = this.generatePKCE();
    const state = this.generateState();
    const redirectUrl = new URL(config.redirectUri);
    const port = parseInt(redirectUrl.port || '5000', 10);
    const callbackPath = redirectUrl.pathname || '/auth/google/callback';

    this.logger.info(`Starting local OAuth loopback server on port ${port}…`);

    const authCode = await this.startLoopbackAndAuthorize({
      port,
      callbackPath,
      state,
      config,
      pkce,
    });

    this.logger.info('Authorization code received. Exchanging for tokens…');
    const tokens = await this.exchangeCodeForTokens(authCode, pkce.codeVerifier, config);

    await this.storeTokens(tokens);
    this.logger.info('OAuth tokens stored securely in SecretStorage.');

    // Fetch and cache user profile
    try {
      this.cachedUserInfo = await this.fetchUserInfo(tokens.accessToken);
      if (this.cachedUserInfo?.email) {
        this.logger.info(`Signed in successfully as ${this.cachedUserInfo.email}.`);
      }
    } catch (err) {
      this.logger.warn(`Could not fetch user profile: ${String(err)}`);
    }
  }

  /**
   * Revokes the token and clears it from SecretStorage.
   */
  public async signOut(): Promise<void> {
    this.logger.info('Signing out and clearing credentials…');
    this.cachedUserInfo = undefined;

    try {
      const tokens = await this.getStoredTokens();
      if (tokens) {
        const tokenToRevoke = tokens.refreshToken || tokens.accessToken;
        if (tokenToRevoke) {
          await this.revokeToken(tokenToRevoke);
        }
      }
    } catch (err) {
      this.logger.warn(`Token revocation request error (continuing logout): ${String(err)}`);
    } finally {
      await this.secrets.delete(SECRET_STORAGE_KEY);
      this.logger.info('Credentials removed from SecretStorage.');
    }
  }

  /**
   * Retrieves profile information for the authenticated user.
   */
  public async getUserInfo(): Promise<GoogleUserInfo | undefined> {
    if (this.cachedUserInfo) {
      return this.cachedUserInfo;
    }
    try {
      const accessToken = await this.getAccessToken();
      this.cachedUserInfo = await this.fetchUserInfo(accessToken);
      return this.cachedUserInfo;
    } catch {
      return undefined;
    }
  }

  /**
   * Internal helper: validates OAuth configuration before initiating flow.
   */
  private validateConfig(config: AuthConfig): void {
    if (!config.clientId || !config.clientId.trim()) {
      throw new AuthenticationError(
        'Google OAuth Client ID is not configured. Please set classroomSubmit.clientId in settings.',
        'INVALID_CONFIG',
      );
    }
    if (!config.clientSecret || !config.clientSecret.trim()) {
      throw new AuthenticationError(
        'Google OAuth Client Secret is not configured. Please set classroomSubmit.clientSecret in settings.',
        'INVALID_CONFIG',
      );
    }
    try {
      new URL(config.redirectUri);
    } catch {
      throw new AuthenticationError(
        `Invalid redirect URI configuration: ${config.redirectUri}`,
        'INVALID_CONFIG',
      );
    }
  }

  /**
   * Internal helper: builds Google OAuth authorization URL.
   */
  public buildAuthorizationUrl(config: AuthConfig, pkce: PKCEPair, state: string): string {
    const authUrl = new URL(OAUTH_AUTH_URL);
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    return authUrl.toString();
  }

  /**
   * Spawns a temporary loopback HTTP server to receive the authorization code.
   */
  private startLoopbackAndAuthorize(options: {
    port: number;
    callbackPath: string;
    state: string;
    config: AuthConfig;
    pkce: PKCEPair;
  }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let server: http.Server | undefined;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        if (server) {
          try {
            server.close();
          } catch {
            // ignore cleanup errors
          }
          server = undefined;
        }
      };

      server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${options.port}`);

        if (reqUrl.pathname !== options.callbackPath) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        const queryCode = reqUrl.searchParams.get('code');
        const queryState = reqUrl.searchParams.get('state');
        const queryError = reqUrl.searchParams.get('error');

        if (queryError) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Sign-in Cancelled</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#1e1e1e;color:#fff;}h1{color:#f44336;}</style></head>
            <body>
              <h1>Authentication Cancelled</h1>
              <p>Google sign-in was cancelled or denied (${queryError}). You can close this window.</p>
            </body>
            </html>
          `);
          cleanup();
          reject(
            new AuthenticationError(
              `Google sign-in was cancelled or denied: ${queryError}`,
              'USER_CANCELLED',
            ),
          );
          return;
        }

        if (!queryCode || queryState !== options.state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Sign-in Error</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#1e1e1e;color:#fff;}h1{color:#f44336;}</style></head>
            <body>
              <h1>Authentication Error</h1>
              <p>State parameter validation failed (possible CSRF attempt). You can close this window.</p>
            </body>
            </html>
          `);
          cleanup();
          reject(
            new AuthenticationError(
              'OAuth state parameter validation mismatch.',
              'CSRF_DETECTED',
            ),
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Sign-in Successful</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#1e1e1e;color:#fff;}h1{color:#4caf50;}</style></head>
          <body>
            <h1>✓ Sign-in Successful</h1>
            <p>You have signed in to Google Classroom. You can close this browser tab and return to VS Code.</p>
          </body>
          </html>
        `);

        cleanup();
        resolve(queryCode);
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        cleanup();
        if (err.code === 'EADDRINUSE') {
          reject(
            new AuthenticationError(
              `Port ${options.port} is already in use. Please ensure no other process is listening on port ${options.port}.`,
              'PORT_IN_USE',
            ),
          );
        } else {
          reject(
            new AuthenticationError(
              `Could not start local authentication server: ${err.message}`,
              'NETWORK_ERROR',
            ),
          );
        }
      });

      server.listen(options.port, '127.0.0.1', () => {
        const authUrl = this.buildAuthorizationUrl(options.config, options.pkce, options.state);
        this.logger.info('Opening default browser for Google sign-in…');
        void vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });

      // Set timeout
      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(
          new AuthenticationError(
            'Authentication timed out. Please try signing in again.',
            'USER_CANCELLED',
          ),
        );
      }, AUTH_TIMEOUT_MS);
    });
  }

  /**
   * Exchanges an authorization code and PKCE verifier for tokens.
   */
  public async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    config: AuthConfig,
  ): Promise<GoogleAuthTokens> {
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    });

    let res: Response;
    try {
      res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (err) {
      throw new AuthenticationError(
        `Network error during token exchange: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR',
      );
    }

    const data = (await res.json()) as GoogleTokenResponse;

    if (!res.ok || data.error) {
      const errMsg = data.error_description || data.error || `HTTP ${res.status}`;
      throw new AuthenticationError(
        `Failed to exchange authorization code: ${errMsg}`,
        'TOKEN_EXCHANGE_FAILED',
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: (data.scope || '').split(' ').filter(Boolean),
      idToken: data.id_token,
    };
  }

  /**
   * Refreshes the access token using a stored refresh token.
   */
  public async refreshTokens(refreshToken: string): Promise<GoogleAuthTokens> {
    const config = this.configProvider();
    this.validateConfig(config);

    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    let res: Response;
    try {
      res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (err) {
      throw new AuthenticationError(
        `Network failure while refreshing token: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR',
      );
    }

    const data = (await res.json()) as GoogleTokenResponse;

    if (!res.ok || data.error) {
      if (data.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
        await this.signOut();
        throw new AuthenticationError(
          'Google authentication has been revoked or expired. Please sign in again.',
          'REVOKED_ACCESS',
        );
      }
      throw new AuthenticationError(
        `Token refresh failed: ${data.error_description || data.error || `HTTP ${res.status}`}`,
        'TOKEN_REFRESH_FAILED',
      );
    }

    const currentTokens = await this.getStoredTokens();
    const updatedTokens: GoogleAuthTokens = {
      accessToken: data.access_token,
      // Google may not return a new refresh token; keep the existing one if so
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope ? data.scope.split(' ').filter(Boolean) : (currentTokens?.scopes || []),
      idToken: data.id_token || currentTokens?.idToken,
    };

    await this.storeTokens(updatedTokens);
    return updatedTokens;
  }

  /**
   * Calls Google's revoke endpoint to revoke the token.
   */
  public async revokeToken(token: string): Promise<void> {
    try {
      await fetch(`${OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (err) {
      this.logger.warn(`Failed to notify Google of token revocation: ${String(err)}`);
    }
  }

  /**
   * Fetches user profile from Google's UserInfo API.
   */
  public async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    let res: Response;
    try {
      res = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new AuthenticationError(
        `Failed to reach UserInfo endpoint: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR',
      );
    }

    if (!res.ok) {
      throw new AuthenticationError(
        `Failed to fetch user profile (HTTP ${res.status}).`,
        'USERINFO_FAILED',
      );
    }

    return (await res.json()) as GoogleUserInfo;
  }

  /**
   * Reads stored tokens from VS Code SecretStorage.
   */
  public async getStoredTokens(): Promise<GoogleAuthTokens | undefined> {
    const raw = await this.secrets.get(SECRET_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as GoogleAuthTokens;
    } catch {
      return undefined;
    }
  }

  /**
   * Writes tokens into VS Code SecretStorage.
   */
  public async storeTokens(tokens: GoogleAuthTokens): Promise<void> {
    await this.secrets.store(SECRET_STORAGE_KEY, JSON.stringify(tokens));
  }
}
