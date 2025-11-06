import { Command, Option } from 'commander';
import chalk from 'chalk';
import { CliCommonOptions, CliOptions, Config } from '../config';
import { Authentication } from '../authentication';
import { Projects } from '../projects';
import { Vault } from '../vault';
import { Agents } from '../agents';

const Options = {
  name: new Option(
    '-n, --name <name>',
    'Name of the variable or secret to add to the vault.'
  ),
};

const list = new Command()
  .name('list')
  .aliases(['ls'])
  .description('List all variables and secrets in your project vault.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .action(async (options: CliOptions) => {
    const config = new Config(options);

    const authentication = new Authentication(config);
    if (!authentication.authorized) {
      await authentication.authorize();
    }

    const projects = new Projects(config);
    if (!projects.hasSelected) {
      await projects.select();
    }

    const project = await projects.selected();

    const vault = new Vault(config);
    const keyValues = await vault.list(project);

    if (keyValues.length === 0) {
      console.log(chalk.yellow('No variables or secrets found in vault.'));
    } else {
      console.log(chalk.green('Variables and secrets in vault:'));
      for (const kv of keyValues) {
        console.log(
          `  ${chalk.cyan(kv.keyName)}: ${kv.isSensitive ? chalk.red('*** (sensitive)') : chalk.green(JSON.stringify(kv.value))}`
        );
      }
    }
  });

const del = new Command()
  .name('delete')
  .aliases(['rm', 'del'])
  .description('Delete a variable or secret from your project vault.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .action(async (options: CliOptions & { name?: string }) => {
    const config = new Config(options);

    const authentication = new Authentication(config);
    if (!authentication.authorized) {
      await authentication.authorize();
    }

    const projects = new Projects(config);
    if (!projects.hasSelected) {
      await projects.select();
    }

    const project = await projects.selected();

    const vault = new Vault(config);
    await vault.delete(project, options.name);

    const agents = new Agents(config);
    await agents.generateTypes(project);
  });

const add = new Command()
  .name('add')
  .aliases(['create', 'new'])
  .description('Add a new variable or secret to your project vault.')
  .addOption(CliCommonOptions.project)
  .addOption(CliCommonOptions.baseUrl)
  .addOption(Options.name)
  .option(
    '-v, --value [value]',
    'Value of the variable or secret to add to the vault.'
  )
  .option(
    '-s, --sensitive',
    'Mark the variable or secret as sensitive (encrypted).',
    false
  )
  .option(
    '-d, --description [description]',
    'Description of the variable or secret.'
  )
  .action(
    async (
      options: CliOptions & {
        name?: string;
        value?: string;
        sensitive?: boolean;
        description?: string;
      }
    ) => {
      const config = new Config(options);

      const authentication = new Authentication(config);
      if (!authentication.authorized) {
        await authentication.authorize();
      }

      const projects = new Projects(config);
      if (!projects.hasSelected) {
        await projects.select();
      }

      const project = await projects.selected();

      const vault = new Vault(config);
      await vault.add(project, {
        name: options.name,
        value: options.value,
        isSensitive: options.sensitive,
        description: options.description,
      });

      const agents = new Agents(config);
      await agents.generateTypes(project);
    }
  );

const vault = new Command()
  .name('vault')
  .description('Manage runtime variables and secrets in your project.')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addCommand(add)
  .addCommand(del)
  .addCommand(list);

export default vault;
