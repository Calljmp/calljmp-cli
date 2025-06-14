export default async function retry<T>(
  fn: () => Promise<T>,
  {
    retries = 3,
    delay = 2000,
    shouldRetry,
  }: {
    retries?: number;
    delay?: number;
    shouldRetry?: (error: any, attempt: number, total: number) => boolean;
  } = {}
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (shouldRetry && !shouldRetry(error, attempt, retries)) {
        throw error;
      }
      if (attempt < retries - 1) {
        const backoffDelay = delay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
