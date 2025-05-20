import { Log, LogLevel, LogOptions } from 'miniflare';

export class Logger extends Log {
  constructor(level: LogLevel = LogLevel.INFO, _opts?: LogOptions) {
    super(level);
  }

  protected override log(message: string): void {
    console.log(message);
  }

  override logWithLevel(level: LogLevel, message: string): void {
    if (this.level >= level) {
      this.log(message);
    }
  }

  override error(e: Error | string | unknown, error?: Error | unknown): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(...[e, error].filter(Boolean));
    }
  }

  override warn(message: string): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(message);
    }
  }

  override info(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.log(message);
    }
  }

  override debug(message: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(message);
    }
  }

  override verbose(message: string): void {
    if (this.level >= LogLevel.VERBOSE) {
      console.log(message);
    }
  }
}

export default new Logger();
