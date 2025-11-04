import { Command } from 'commander';
import figlet from 'figlet';
import gradient from 'gradient-string';
import init from './commands/init';
import project from './commands/project';
import account from './commands/account';
import agent from './commands/agent';
import { version } from './gen/version';
import { formatError, getExitCode } from './utils/error-handler';

async function main() {
  try {
    const brand = gradient(['#28e2ad', '#0b77e6']);

    const title = figlet.textSync('calljmp', {
      font: 'Speed',
      horizontalLayout: 'default',
      verticalLayout: 'default',
      width: 80,
      whitespaceBreak: false,
    });

    console.log(brand(title));
    console.log();

    const program = new Command()
      .name('calljmp')
      .description('CLI for Calljmp')
      .version(version(), '-v, --version', 'Display version information')
      .helpOption('-h, --help', 'Display help for command')
      .addCommand(init)
      .addCommand(project)
      .addCommand(account)
      .addCommand(agent);

    if (process.argv.length <= 2) {
      program.outputHelp();
    } else {
      await program.parseAsync(process.argv);
    }
  } catch (error) {
    formatError(error);
    process.exit(getExitCode(error));
  }
}

process.on('unhandledRejection', reason => {
  formatError(reason);
  process.exit(getExitCode(reason));
});

process.on('uncaughtException', error => {
  formatError(error);
  process.exit(getExitCode(error));
});

main();
