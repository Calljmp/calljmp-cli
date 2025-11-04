import gradient from 'gradient-string';
import { ServiceError, ServiceErrorCode } from '../common';

const errorGradient = gradient(['#ff6b6b', '#ee5a6f']);

export function formatError(error: unknown): void {
  console.error();

  if (error instanceof ServiceError) {
    formatServiceError(error);
  } else if (error instanceof Error) {
    formatStandardError(error);
  } else if (typeof error === 'string') {
    formatStringError(error);
  } else {
    formatUnknownError(error);
  }

  console.error();
}

function formatServiceError(error: ServiceError): void {
  const category = getErrorCategory(error.code);
  console.error(errorGradient(category));
  console.error(`  ${error.message}`);
}

function formatStandardError(error: Error): void {
  console.error(errorGradient('✖ Error'));
  console.error(`  ${error.message}`);
}

function formatStringError(error: string): void {
  console.error(errorGradient('✖ Error'));
  console.error(`  ${error}`);
}

function formatUnknownError(error: unknown): void {
  console.error(errorGradient('✖ Unexpected Error'));
  console.error(`  ${JSON.stringify(error, null, 2)}`);
}

function getErrorCategory(code: ServiceErrorCode): string {
  switch (code) {
    case ServiceErrorCode.Unauthorized:
      return 'Authentication Error';
    case ServiceErrorCode.Forbidden:
      return 'Permission Denied';
    case ServiceErrorCode.NotFound:
      return 'Resource Not Found';
    case ServiceErrorCode.BadRequest:
      return 'Invalid Request';
    case ServiceErrorCode.TooManyRequests:
      return 'Rate Limit Exceeded';
    case ServiceErrorCode.UsageExceeded:
      return 'Usage Limit Exceeded';
    case ServiceErrorCode.ResourceBusy:
      return 'Resource Busy';
    case ServiceErrorCode.UserAlreadyExists:
      return 'User Already Exists';
    case ServiceErrorCode.UserNotFound:
      return 'User Not Found';
    case ServiceErrorCode.ProjectAlreadyExists:
      return 'Project Already Exists';
    case ServiceErrorCode.Internal:
    default:
      return 'Internal Error';
  }
}

export function getExitCode(error: unknown): number {
  if (error instanceof ServiceError) {
    switch (error.code) {
      case ServiceErrorCode.Unauthorized:
      case ServiceErrorCode.Forbidden:
        return 2;
      case ServiceErrorCode.NotFound:
        return 3;
      case ServiceErrorCode.BadRequest:
        return 4;
      case ServiceErrorCode.UsageExceeded:
      case ServiceErrorCode.TooManyRequests:
        return 5;
      default:
        return 1;
    }
  }

  return 1;
}
