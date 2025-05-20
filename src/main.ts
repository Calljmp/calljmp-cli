import { Command } from 'commander';
import figlet from 'figlet';
import gradient from 'gradient-string';
import start from './commands/start';
import database from './commands/database';
import setup from './commands/setup';
import { version } from './version';
import service from './commands/service';
import secrets from './commands/secrets';

async function main() {
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
    .version(await version());

  program
    .addCommand(setup())
    .addCommand(start())
    .addCommand(database())
    .addCommand(service())
    .addCommand(secrets());

  program.parse(process.argv);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
