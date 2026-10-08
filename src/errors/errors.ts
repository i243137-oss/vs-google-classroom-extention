/**
 * Typed error hierarchy for the Classroom Submit extension.
 *
 * Each error type maps to a specific failure domain, enabling
 * targeted error handling and student-friendly messaging.
 */

export class ClassroomSubmitError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ClassroomSubmitError';
    this.code = code;
    // Maintains proper prototype chain in transpiled output
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends ClassroomSubmitError {
  constructor(message: string, code: string = 'AUTH_ERROR') {
    super(message, code);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ClassroomApiError extends ClassroomSubmitError {
  public readonly httpStatus: number | undefined;

  constructor(message: string, code: string = 'CLASSROOM_API_ERROR', httpStatus?: number) {
    super(message, code);
    this.name = 'ClassroomApiError';
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DriveApiError extends ClassroomSubmitError {
  public readonly httpStatus: number | undefined;

  constructor(message: string, code: string = 'DRIVE_API_ERROR', httpStatus?: number) {
    super(message, code);
    this.name = 'DriveApiError';
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SubmissionError extends ClassroomSubmitError {
  constructor(message: string, code: string = 'SUBMISSION_ERROR') {
    super(message, code);
    this.name = 'SubmissionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkspaceError extends ClassroomSubmitError {
  constructor(message: string, code: string = 'WORKSPACE_ERROR') {
    super(message, code);
    this.name = 'WorkspaceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends ClassroomSubmitError {
  constructor(message: string, code: string = 'VALIDATION_ERROR') {
    super(message, code);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigurationError extends ClassroomSubmitError {
  constructor(message: string, code: string = 'CONFIG_ERROR') {
    super(message, code);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Maps HTTP status codes to student-friendly error messages
 * for Google API errors.
 */
export function friendlyHttpError(status: number, apiName: 'Classroom' | 'Drive'): string {
  switch (status) {
    case 400:
      return `${apiName} rejected the request. Please check your selection and try again.`;
    case 401:
      return 'Your Google session has expired. Please sign in again.';
    case 403:
      return `Google ${apiName} denied access. You may not have permission to perform this action. ` +
             'Make sure you are enrolled in the course and the assignment is open.';
    case 404:
      return `The ${apiName} resource was not found. It may have been deleted or moved.`;
    case 409:
      return 'A conflict occurred. The submission may have already been turned in.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
    case 503:
      return `Google ${apiName} is temporarily unavailable. Please try again later.`;
    default:
      return `An unexpected ${apiName} error occurred (HTTP ${status}). Please try again.`;
  }
}
