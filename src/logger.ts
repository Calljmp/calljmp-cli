import { Log, LogLevel, LogOptions } from 'miniflare';
import chalk from 'chalk';

export class Logger extends Log {
  private prefix = chalk.gray('[calljmp] ');

  constructor(level: LogLevel = LogLevel.INFO, _opts?: LogOptions) {
    super(level);
  }

  protected override log(message: string): void {
    console.log(`${this.prefix}${message}`);
  }

  override logWithLevel(level: LogLevel, message: string): void {
    if (this.level >= level) {
      this.log(message);
    }
  }

  override error(e: Error | string, error?: Error): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(this.prefix, ...[e, error].filter(Boolean));
    }
  }

  override warn(message: string): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(`${this.prefix}${message}`);
    }
  }

  override info(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.log(`${this.prefix}${message}`);
    }
  }

  override debug(message: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(`${this.prefix}${message}`);
    }
  }

  override verbose(message: string): void {
    if (this.level >= LogLevel.VERBOSE) {
      console.log(`${this.prefix}${message}`);
    }
  }
}

export default new Logger();
