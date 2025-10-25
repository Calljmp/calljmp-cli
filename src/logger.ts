export enum LogLevel {
  Info = 1,
  Warn = 2,
  Error = 3,
  Debug = 4,
  Verbose = 5,
}

export class Logger {
  constructor(readonly level: LogLevel = LogLevel.Info) {}

  private _log(message: string): void {
    console.log(message);
  }

  logWithLevel(level: LogLevel, message: string): void {
    if (this.level >= level) {
      this._log(message);
    }
  }

  error(e: Error | string | unknown, error?: Error | unknown): void {
    if (this.level >= LogLevel.Error) {
      console.error(...[e, error].filter(Boolean));
    }
  }

  warn(message: string): void {
    if (this.level >= LogLevel.Warn) {
      console.warn(message);
    }
  }

  info(message: string): void {
    if (this.level >= LogLevel.Info) {
      this._log(message);
    }
  }

  debug(message: string): void {
    if (this.level >= LogLevel.Debug) {
      console.debug(message);
    }
  }

  verbose(message: string): void {
    if (this.level >= LogLevel.Verbose) {
      this._log(message);
    }
  }
}

export default new Logger();
