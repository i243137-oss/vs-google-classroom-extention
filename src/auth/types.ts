/**
 * Authentication type definitions for Google OAuth 2.0.
 *
 * SECURITY NOTICE:
 * Never log or expose tokens, secrets, or authorization codes.
 */

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt: number; // Unix timestamp in milliseconds
  scopes: string[];
  idToken?: string | undefined;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string | undefined;
  refresh_token?: string | undefined;
  id_token?: string | undefined;
  error?: string | undefined;
  error_description?: string | undefined;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email?: boolean | undefined;
  name: string;
  given_name?: string | undefined;
  family_name?: string | undefined;
  picture?: string | undefined;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

export const REQUIRED_SCOPES: readonly string[] = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;
