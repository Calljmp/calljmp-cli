import { Command } from 'commander';
import buildConfig, { ConfigOptions, writeConfig } from '../config';
import { configureIgnores } from '../configure';
import enquirer from 'enquirer';
import ora from 'ora';
import chalk from 'chalk';
import { Account } from '../account';
import logger from '../logger';
import { Project } from '../project';
import {
  Project as ProjectData,
  ServiceError,
  ServiceErrorCode,
} from '../common';
import path from 'path';
import retry from '../retry';
import * as ios from '../ios';
import * as android from '../android';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { detectProjectType, ProjectType } from '../mobile';

const execAsync = promisify(exec);

async function openFileExplorer(filePath: string) {
  try {
    const platform = os.platform();
    let command: string;

    switch (platform) {
      case 'darwin': {
        // Use -R flag to reveal and select the file in Finder
        command = `open -R "${filePath}"`;
        break;
      }
      case 'win32': {
        // Use explorer with /select to highlight the file
        command = `explorer /select,"${filePath.replace(/\//g, '\\')}"`;
        break;
      }
      case 'linux': {
        // Try different file managers, fallback to opening directory
        const directory = path.dirname(filePath);
        // Try nautilus (GNOME), dolphin (KDE), thunar (XFCE), or generic xdg-open
        command = `(nautilus --select "${filePath}" 2>/dev/null || dolphin --select "${filePath}" 2>/dev/null || thunar "${directory}" 2>/dev/null || xdg-open "${directory}")`;
        break;
      }
      default: {
        const dir = path.dirname(filePath);
        command = `xdg-open "${dir}"`;
        break;
      }
    }

    await execAsync(command);
    return true;
  } catch (error) {
    logger.error('Failed to open file explorer:', error);
    return false;
  }
}

function normalizeDragDropPath(inputPath: string): string {
  // Remove quotes and handle drag-and-drop paths
  let normalized = inputPath.trim();

  // Remove surrounding quotes if present
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  // Handle escaped characters from drag-and-drop
  // This removes backslashes that are used to escape special characters
  normalized = normalized.replace(/\\(.)/g, '$1');

  return normalized;
}

async function waitForFileDrop(): Promise<string | number> {
  return new Promise(resolve => {
    const spinner = ora(
      chalk.blue(
        'Waiting for .enc file... (drag and drop the file into this terminal or press Ctrl+C to cancel)'
      )
    ).start();

    let stdinData = '';
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      process.stdin.removeAllListeners('data');
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      spinner.stop();
    };

    const handleFoundFile = async (filePath: string) => {
      try {
        const normalizedPath = normalizeDragDropPath(filePath);
        await fs.access(normalizedPath);
        cleanup();
        spinner.stop();
        resolve(normalizedPath);
      } catch {
        // noop
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: string) => {
      const data = chunk.toString();

      // Handle Ctrl+C
      if (data === '\u0003') {
        cleanup();
        spinner.stop();
        process.exit(1);
      }

      // Check for Enter key press on empty input to allow manual entry
      if ((data === '\r' || data === '\n') && stdinData.trim() === '') {
        cleanup();
        spinner.stop();
        resolve(-1);
        return;
      }

      stdinData += data;

      if (data.includes('\n') || data.includes('\r') || data.includes(' ')) {
        const potentialPath = stdinData.replace(/[\r\n\s]+$/g, '').trim();
        if (potentialPath.length > 0) {
          if (
            potentialPath.includes('/') ||
            potentialPath.includes('\\') ||
            potentialPath.includes('.')
          ) {
            handleFoundFile(potentialPath);
            stdinData = '';
            return;
          }
        }
      }

      const currentPath = stdinData.trim();
      if (
        currentPath.length > 10 &&
        (currentPath.includes('/') || currentPath.includes('\\'))
      ) {
        const pathSeparators = (currentPath.match(/[/\\]/g) || []).length;
        if (
          pathSeparators >= 2 &&
          !currentPath.endsWith('/') &&
          !currentPath.endsWith('\\')
        ) {
          handleFoundFile(currentPath);
          stdinData = '';
          return;
        }
      }
    });

    timer = setTimeout(() => {
      if (!spinner.isSpinning) return;
      spinner.text = chalk.blue(
        'Waiting for .enc file... (drag and drop, or press Enter to type manually)'
      );
    }, 15_000);
  });
}

async function configureIosProject({
  project,
  selectedProject,
  projectDirectory,
}: {
  project: Project;
  selectedProject: ProjectData;
  projectDirectory: string;
}) {
  const iosProjectInfo = await ios
    .resolveProjectInfo({ projectDirectory })
    .catch(() => null);

  if (!iosProjectInfo) {
    logger.info(
      chalk.dim('No iOS project detected, skipping iOS configuration.')
    );
    return selectedProject;
  }

  logger.info(chalk.yellow('\niOS Project Configuration'));

  let bundleId: string | undefined = iosProjectInfo.bundleId;
  let teamId: string | undefined = iosProjectInfo.teamId;

  const promptForBundleId = () =>
    enquirer.prompt<{
      newBundleId: string;
    }>({
      type: 'input',
      name: 'newBundleId',
      message: 'Enter iOS Bundle ID (or leave blank to skip):',
      initial: bundleId,
      validate: (value: string) => {
        if (!value) return true; // allow skip
        if (!/^[a-zA-Z0-9.-]+$/.test(value)) {
          return 'Invalid iOS Bundle ID format';
        }
        return true;
      },
    });

  const promptForTeamId = () =>
    enquirer.prompt<{ newTeamId: string }>({
      type: 'input',
      name: 'newTeamId',
      message: 'Enter Apple Team ID (or leave blank to skip):',
      initial: teamId,
      validate: (value: string) => {
        if (!value) return true; // allow skip
        if (!/^[A-Z0-9]{10}$/.test(value)) {
          return 'Invalid Apple Team ID format';
        }
        return true;
      },
    });

  const { confirmBundleId } = await enquirer.prompt<{
    confirmBundleId: boolean;
  }>({
    type: 'confirm',
    name: 'confirmBundleId',
    message: `iOS Bundle ID: ${bundleId}. Use this value?`,
    initial: true,
  });

  if (!confirmBundleId) {
    const { newBundleId } = await promptForBundleId();
    bundleId = newBundleId || undefined;
  }

  if (teamId) {
    const { confirmTeamId } = await enquirer.prompt<{
      confirmTeamId: boolean;
    }>({
      type: 'confirm',
      name: 'confirmTeamId',
      message: `Apple Team ID: ${teamId}. Use this value?`,
      initial: true,
    });
    if (!confirmTeamId) {
      const { newTeamId } = await promptForTeamId();
      teamId = newTeamId || undefined;
    }
  } else {
    const { newTeamId } = await promptForTeamId();
    teamId = newTeamId || undefined;
  }

  if (teamId || bundleId) {
    const spinner = ora(chalk.blue('Configuring iOS project...')).start();
    try {
      const updatedProject = await project.update({
        projectId: selectedProject.id,
        appleIosTeamId: teamId,
        appleIosBundleId: bundleId,
      });
      spinner.stop();
      return updatedProject;
    } catch (error) {
      spinner.fail(chalk.red('Failed to configure iOS project!'));
      logger.error(error);
      process.exit(1);
    }
  }

  return selectedProject;
}

async function configureAndroidProject({
  project,
  selectedProject,
  projectDirectory,
}: {
  project: Project;
  selectedProject: ProjectData;
  projectDirectory: string;
}) {
  const androidProjectInfo = await android
    .resolveProjectInfo({ projectDirectory })
    .catch(() => null);

  if (!androidProjectInfo) {
    logger.info(
      chalk.dim('No Android project detected, skipping Android configuration.')
    );
    return { selectedProject, androidProjectInfo: null };
  }

  logger.info(chalk.yellow('\nAndroid Project Configuration'));

  let applicationId: string | undefined = androidProjectInfo.applicationId;

  const promptForApplicationId = () =>
    enquirer.prompt<{
      newApplicationId: string;
    }>({
      type: 'input',
      name: 'newApplicationId',
      message: 'Enter Android Application ID (or leave blank to skip):',
      initial: applicationId,
      validate: (value: string) => {
        if (!value) return true; // allow skip
        if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
          return 'Invalid Android Application ID format';
        }
        return true;
      },
    });

  const { confirmApplicationId } = await enquirer.prompt<{
    confirmApplicationId: boolean;
  }>({
    type: 'confirm',
    name: 'confirmApplicationId',
    message: `Android Application ID: ${applicationId}. Use this value?`,
    initial: true,
  });

  if (!confirmApplicationId) {
    const { newApplicationId } = await promptForApplicationId();
    applicationId = newApplicationId || undefined;
  }

  if (applicationId) {
    const spinner = ora(chalk.blue('Configuring Android project...')).start();
    try {
      const updatedProject = await project.update({
        projectId: selectedProject.id,
        googleAndroidPackageName: applicationId,
      });
      spinner.stop();
      return { selectedProject: updatedProject, androidProjectInfo };
    } catch (error) {
      spinner.fail(chalk.red('Failed to configure Android project!'));
      logger.error(error);
      process.exit(1);
    }
  }

  return { selectedProject, androidProjectInfo };
}

async function waitForProjectProvisioning({
  project,
  projectId,
}: {
  project: Project;
  projectId: number;
}) {
  const spinner = ora(
    chalk.blue('Waiting for project to be provisioned...')
  ).start();
  try {
    await retry(() => project.retrieve({ projectId }), {
      retries: 10,
      delay: 3000,
      shouldRetry: error => {
        if (
          error instanceof ServiceError &&
          error.code === ServiceErrorCode.ResourceBusy
        ) {
          return true;
        }
        return false;
      },
    });
    spinner.stop();
  } catch (error) {
    spinner.fail(
      chalk.red(
        'Timed out waiting for project to be provisioned! Please try again later.'
      )
    );
    logger.error(error);
    process.exit(1);
  }
}

async function configureServiceDirectories(cfg: any) {
  return await enquirer.prompt<{
    module: string;
    migrations: string;
    schema: string;
  }>([
    {
      type: 'input',
      name: 'module',
      message: 'Service module directory',
      initial: path.relative(cfg.project, cfg.module),
      required: true,
      validate: (value: string) => {
        if (!value) {
          return 'Service module directory is required';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'migrations',
      message: 'Migrations directory',
      initial: path.relative(cfg.project, cfg.migrations),
      required: true,
      validate: (value: string) => {
        if (!value) {
          return 'Migrations directory is required';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'schema',
      message: 'Schema directory',
      initial: path.relative(cfg.project, cfg.schema),
      required: true,
      validate: (value: string) => {
        if (!value) {
          return 'Schema directory is required';
        }
        return true;
      },
    },
  ]);
}

async function retrieveServiceBindings({
  project,
  projectId,
}: {
  project: Project;
  projectId: number;
}) {
  const spinner = ora(chalk.blue('Synchronizing service bindings...')).start();
  try {
    const bindings = await project.bindings({ projectId });
    spinner.stop();

    function printBindingsTree(bindings: Record<string, unknown>, indent = '') {
      Object.entries(bindings).forEach(([key, value], index, array) => {
        const isLast = index === array.length - 1;
        const prefix = isLast ? '└── ' : '├── ';
        const nextIndent = indent + (isLast ? '    ' : '│   ');

        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          logger.info(`${indent}${chalk.dim(prefix)}${key}`);
          printBindingsTree(value as Record<string, unknown>, nextIndent);
        } else {
          logger.info(`${indent}${chalk.dim(prefix)}${key}: ${value}`);
        }
      });
    }

    logger.info('Service bindings');
    printBindingsTree(bindings);

    return bindings;
  } catch (error) {
    spinner.fail(chalk.red('Failed to synchronize service bindings!'));
    logger.error(error);
    process.exit(1);
  }
}

async function configurePlayIntegrity({
  project,
  selectedProject,
  projectDirectory,
  androidProjectInfo,
}: {
  project: Project;
  selectedProject: ProjectData;
  projectDirectory: string;
  androidProjectInfo: android.ProjectInfo;
}) {
  if (selectedProject.googleAndroidPlayIntegrityHasResponseKeys) {
    return selectedProject;
  }

  logger.info(chalk.yellow('\nAndroid Play Integrity Setup'));
  logger.info(
    'Android Play Integrity helps protect your app from potentially risky and fraudulent interactions.\n'
  );

  const { setupPlayIntegrity } = await enquirer.prompt<{
    setupPlayIntegrity: boolean;
  }>({
    type: 'confirm',
    name: 'setupPlayIntegrity',
    message: 'Would you like to configure Play Integrity now?',
    initial: true,
  });

  if (!setupPlayIntegrity) {
    logger.info(chalk.dim('Skipping Play Integrity setup for now.'));
    return selectedProject;
  }

  logger.info('\nPlease follow these steps to configure Play Integrity API:');
  logger.info(chalk.cyan('1. Go to https://play.google.com/console'));
  logger.info(chalk.cyan('2. Select or create your app'));
  logger.info(
    chalk.cyan(
      '3. Navigate to: App Dashboard → Test and Release → App Integrity'
    )
  );
  logger.info(chalk.cyan('4. Click on "Play Integrity API settings"'));
  logger.info(chalk.cyan('5. Link your Google Cloud project'));

  const { readyForPem } = await enquirer.prompt<{ readyForPem: boolean }>({
    type: 'confirm',
    name: 'readyForPem',
    message:
      'Ready to download .pem file for upload to Play Console? This will download the public key to encrypt responses.',
    initial: true,
  });

  if (!readyForPem) {
    logger.info(chalk.dim('Skipping Play Integrity setup for now.'));
    return selectedProject;
  }

  const pemFilePath = path.join(projectDirectory, 'play-integrity-key.pem');
  const spinner = ora(chalk.blue('Downloading .pem file...')).start();

  try {
    const pemContent = await project.retrieveGoogleAndroidPlayIntegrityPem({
      projectId: selectedProject.id,
    });
    await fs.writeFile(pemFilePath, pemContent);
    spinner.succeed(chalk.green(`Downloaded .pem file to: ${pemFilePath}`));

    // Open the folder containing the .pem file
    logger.info(chalk.blue('\nOpening folder with the .pem file...'));
    const opened = await openFileExplorer(pemFilePath);
    if (opened) {
      logger.info(
        chalk.dim('The file explorer should now be open showing the .pem file.')
      );
    } else {
      logger.info(chalk.dim('Could not open file explorer automatically.'));
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to download .pem file!'));
    logger.error(error);
    process.exit(1);
  }

  logger.info(chalk.yellow('\nUpload to Play Console:'));
  logger.info(
    chalk.cyan(
      '1. In Play Console → App Integrity → Play Integrity API settings'
    )
  );
  logger.info(chalk.cyan('2. Find the "Classic requests" section'));
  logger.info(
    chalk.cyan(`3. Upload the downloaded file: ${path.basename(pemFilePath)}`)
  );
  logger.info(
    chalk.cyan('4. Download the "Classic requests encryption keys" (.enc file)')
  );
  logger.info(
    chalk.cyan(
      '5. Once you have the .enc file, you can drag and drop it into the terminal when prompted\n'
    )
  );

  let encFilePath: string;
  try {
    const result = await waitForFileDrop();

    // If user chose manual input, fall back to the prompt
    if (result === -1) {
      const { manualEncFilePath } = await enquirer.prompt<{
        manualEncFilePath: string;
      }>({
        type: 'input',
        name: 'manualEncFilePath',
        message: 'Enter the path to your .enc file:',
        initial: path.join(
          projectDirectory,
          `${androidProjectInfo.packageName}.enc`
        ),
        validate: async (value: string) => {
          if (!value) {
            return 'File path is required';
          }
          const normalizedPath = normalizeDragDropPath(value);
          try {
            await fs.access(normalizedPath);
          } catch {
            return 'File does not exist. Please check the path.';
          }
          if (!normalizedPath.endsWith('.enc')) {
            return 'File must have .enc extension';
          }
          return true;
        },
      });
      encFilePath = normalizeDragDropPath(manualEncFilePath);
    } else if (typeof result === 'string') {
      encFilePath = result;
    } else {
      logger.error(chalk.red('No .enc file provided!'));
      return selectedProject;
    }
  } catch (error) {
    logger.error('Error waiting for file:', error);
    return selectedProject;
  }

  const uploadSpinner = ora(
    chalk.blue('Uploading Play Integrity response keys...')
  ).start();

  try {
    const encFileBuffer = await fs.readFile(encFilePath);
    const base64ResponseKeys = encFileBuffer.toString('base64');

    const updatedProject = await project.update({
      projectId: selectedProject.id,
      googleAndroidPlayIntegrityResponseKeys: base64ResponseKeys,
    });

    uploadSpinner.succeed(
      chalk.green('Play Integrity API configured successfully!')
    );
    return updatedProject;
  } catch (error) {
    uploadSpinner.fail(chalk.red('Failed to upload response keys!'));
    logger.error(error);
    process.exit(1);
  }
}

async function createProject({ project }: { project: Project }) {
  const { name, description } = await enquirer.prompt<{
    name: string;
    description?: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Project name',
      required: true,
      validate: (value: string) => {
        if (!value) {
          return 'Project name is required';
        }
        if (!/^[a-z-]+$/.test(value)) {
          return 'Only lowercase letters and hyphens are allowed';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'description',
      message: 'Project description (optional)',
    },
  ]);

  const spinner = ora(chalk.blue('Creating project...')).start();
  try {
    const result = await project.create({
      name,
      description: description || undefined,
    });
    spinner.stop();
    return result;
  } catch (error) {
    if (
      error instanceof ServiceError &&
      error.code === ServiceErrorCode.ProjectAlreadyExists
    ) {
      spinner.fail(
        chalk.red('Project with this name exists or recently deleted!')
      );
      return createProject({ project });
    }
    spinner.fail(chalk.red('Failed to create project!'));
    logger.error(error);
    process.exit(1);
  }
}

async function selectProject({
  project,
  offset,
}: {
  project: Project;
  offset?: number;
}): Promise<ProjectData | undefined> {
  const { projects, nextOffset } = await project.list({ offset });

  if (projects.length === 0) {
    logger.info(chalk.yellow('Create a new project to get started!'));
    return undefined;
  }

  const choices = [
    ...projects.map(project => ({
      name: project.name,
      value: project.name,
    })),
    ...(nextOffset
      ? [
          {
            name: 'More projects...',
            value: -1,
          },
        ]
      : []),
    {
      name: 'Create new project',
      value: -2,
    },
  ];

  const selection = await enquirer.prompt<{
    value: number | string;
  }>({
    type: 'autocomplete',
    name: 'value',
    message: 'Select a project',
    choices,
  });

  if (selection.value === -1) {
    return selectProject({
      project,
      offset: nextOffset,
    });
  }

  if (selection.value === -2) {
    return undefined;
  }

  const result = projects.find(project => project.name === selection.value);
  if (!result) {
    logger.error(chalk.red('Project not found!'));
    return;
  }

  return result;
}

async function login(account: Account) {
  let requestId: string | undefined;

  {
    const spinner = ora(chalk.blue('Requesting authorization...')).start();
    try {
      const { requestId: id, authorizationUrl } = await account.requestAccess();
      requestId = id;
      spinner.stop();
      logger.info('Open the following URL to authorize CLI:');
      logger.info(chalk.yellow(authorizationUrl));
    } catch {
      spinner.fail(chalk.red('Failed to request authorization!'));
      return;
    }
  }

  {
    const spinner = ora(chalk.blue('Waiting for authorization...')).start();
    try {
      const result = await account.pollAccess(requestId);
      spinner.stop();
      return result;
    } catch {
      spinner.fail(chalk.red('Authorization failed!'));
      return;
    }
  }
}

function printUsageInstructions(directory: string) {
  const projectType = detectProjectType(directory);

  switch (projectType) {
    case ProjectType.ReactNative: {
      logger.info(
        chalk.green(
          '\nYou can now use the Calljmp SDK in your React Native app.\n' +
            'Follow the instructions below to get started:\n'
        )
      );
      logger.info(
        chalk.cyan.bold('1.') +
          chalk.cyan(' Install the Calljmp SDK:\n') +
          chalk.green('   npm install @calljmp/react-native\n') +
          chalk.green('   # or\n') +
          chalk.green('   yarn add @calljmp/react-native\n')
      );
      logger.info(
        chalk.cyan.bold('2.') +
          chalk.cyan(' Import and initialize Calljmp in your app:\n') +
          chalk.yellow(
            "   import { Calljmp } from '@calljmp/react-native';\n"
          ) +
          chalk.yellow('   const calljmp = new Calljmp();\n')
      );
      break;
    }
    case ProjectType.Flutter: {
      logger.info(
        chalk.green(
          '\nYou can now use the Calljmp SDK in your Flutter app.\n' +
            'Follow the instructions below to get started:\n'
        )
      );
      logger.info(
        chalk.cyan.bold('1.') +
          chalk.cyan(' Add the Calljmp SDK to your pubspec.yaml:\n') +
          chalk.green('   dependencies:\n') +
          chalk.green('     calljmp: ^latest\n')
      );
      logger.info(
        chalk.cyan.bold('2.') +
          chalk.cyan(' Install the dependencies:\n') +
          chalk.green('   flutter pub get\n')
      );
      logger.info(
        chalk.cyan.bold('3.') +
          chalk.cyan(' Import and initialize Calljmp in your app:\n') +
          chalk.yellow("   import 'package:calljmp/calljmp.dart';\n") +
          chalk.yellow('   final calljmp = Calljmp();\n')
      );
      break;
    }
    default: {
      logger.info(
        chalk.green('\nYou can now start using Calljmp in your mobile app.\n')
      );
    }
  }
}

const setup = () =>
  new Command('setup')
    .description('Setup environment, account, and project.')
    .addOption(ConfigOptions.ProjectDirectory)
    .action(async args => {
      const cfg = await buildConfig(args);

      const account = new Account(cfg);
      const authorized = await account.authorized();
      if (!authorized) {
        const result = await login(account);
        if (!result) {
          process.exit(1);
        }
        cfg.accessToken = result.accessToken;
      }

      if (!cfg.accessToken) {
        logger.error(chalk.red('No authorization token found!'));
        process.exit(1);
      }

      const project = new Project({
        baseUrl: cfg.baseUrl,
        accessToken: cfg.accessToken,
      });

      let selectedProject = await selectProject({ project });
      if (!selectedProject) {
        selectedProject = await createProject({ project });
        if (!selectedProject) {
          process.exit(1);
        }
      }
      cfg.projectId = selectedProject.id;

      await waitForProjectProvisioning({
        project,
        projectId: cfg.projectId,
      });

      selectedProject = await configureIosProject({
        project,
        selectedProject,
        projectDirectory: cfg.project,
      });

      const { selectedProject: updatedProject, androidProjectInfo } =
        await configureAndroidProject({
          project,
          selectedProject,
          projectDirectory: cfg.project,
        });
      selectedProject = updatedProject;

      if (androidProjectInfo) {
        selectedProject = await configurePlayIntegrity({
          project,
          selectedProject,
          projectDirectory: cfg.project,
          androidProjectInfo,
        });
      }

      const { module, migrations, schema } =
        await configureServiceDirectories(cfg);

      const bindings = await retrieveServiceBindings({
        project,
        projectId: cfg.projectId,
      });

      cfg.module = path.resolve(cfg.project, module);
      cfg.migrations = path.resolve(cfg.project, migrations);
      cfg.schema = path.resolve(cfg.project, schema);
      cfg.bindings = bindings;

      await writeConfig(cfg);

      await configureIgnores({
        directory: cfg.project,
        entries: ['.calljmp', '.service.env', '.env'],
      });

      printUsageInstructions(cfg.project);
    });

export default setup;
