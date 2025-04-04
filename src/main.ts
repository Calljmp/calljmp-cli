import { Command } from 'commander';
import figlet from 'figlet';
import gradient from 'gradient-string';
import buildConfig from './config';
import account from './commands/account';
import configure from './commands/configure';
import database from './commands/database';
import start from './commands/start';

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
  .option('-p, --project <directory>', 'Project directory', '.')
  .option('-m, --module <directory>', 'Module directory', './src/service');

const config = () => buildConfig(program);

program
  .addCommand(configure(config))
  .addCommand(account(config))
  .addCommand(database(config))
  .addCommand(start(config));

program.parse(process.argv);
