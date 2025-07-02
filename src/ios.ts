import * as fs from 'fs';
import * as path from 'path';
import { XcodeProject, XCBuildConfiguration } from '@bacons/xcode';
import { detectProjectType, ProjectType } from './mobile';

export interface ProjectInfo {
  bundleId: string;
  teamId?: string;
  projectType: ProjectType;
  productName?: string;
  targetName?: string;
}

export async function resolveProjectInfo({
  projectDirectory,
}: {
  projectDirectory: string;
}): Promise<ProjectInfo> {
  const xcodeProjectPath = findXcodeProject(projectDirectory);
  const projectInfo = readXcodeProject(xcodeProjectPath, projectDirectory);
  return projectInfo;
}

function findXcodeProject(directory: string): string {
  const directories = [directory, path.join(directory, 'ios')];

  for (const dir of directories) {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory()) {
      const files = fs.readdirSync(dir);
      const xcodeproj = files.find(f => f.endsWith('.xcodeproj'));
      if (xcodeproj) {
        return path.join(dir, xcodeproj);
      }
    }
  }

  throw new Error('Xcode project not found.');
}

function readXcodeProject(
  projectPath: string,
  rootDirectory: string
): ProjectInfo {
  const pbxprojPath = path.join(projectPath, 'project.pbxproj');

  if (!fs.existsSync(pbxprojPath)) {
    throw new Error('project.pbxproj not found in Xcode project.');
  }

  try {
    const project = XcodeProject.open(pbxprojPath);

    const projectType = detectProjectType(rootDirectory);
    const bundleId = extractBundleIdFromProject(project);
    const teamId = extractTeamIdFromProject(project);
    const { productName, targetName } = extractProjectNames(project);

    return {
      bundleId,
      teamId,
      projectType,
      productName,
      targetName,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse Xcode project: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

function extractBundleIdFromProject(project: XcodeProject): string {
  const targets = project.rootObject.props.targets;

  const mainTarget = findMainAppTarget(targets);
  if (!mainTarget) {
    throw new Error('Could not find main app target in Xcode project');
  }

  const buildConfigList = mainTarget.props.buildConfigurationList;
  if (!buildConfigList?.props?.buildConfigurations) {
    throw new Error('No build configurations found for main target');
  }

  const buildConfigs = buildConfigList.props.buildConfigurations;

  let bundleId: string | undefined;
  let releaseConfig: XCBuildConfiguration | undefined;
  let debugConfig: XCBuildConfiguration | undefined;

  for (const config of buildConfigs) {
    const buildSettings = config.props.buildSettings;
    if (!buildSettings) continue;

    const iosSpecificBundleId =
      buildSettings['PRODUCT_BUNDLE_IDENTIFIER[sdk=iphoneos*]'];
    if (iosSpecificBundleId) {
      return iosSpecificBundleId;
    }

    if (config.props.name?.toLowerCase().includes('release')) {
      releaseConfig = config;
    } else if (config.props.name?.toLowerCase().includes('debug')) {
      debugConfig = config;
    }
  }

  const configsToTry = [releaseConfig, debugConfig, ...buildConfigs].filter(
    (config): config is XCBuildConfiguration => config !== undefined
  );
  for (const config of configsToTry) {
    if (!config.props?.buildSettings) continue;

    const configBundleId = config.props.buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
    if (configBundleId) {
      bundleId = configBundleId;
      break;
    }
  }

  if (!bundleId) {
    throw new Error(
      'PRODUCT_BUNDLE_IDENTIFIER not found in any build configuration'
    );
  }

  return resolveBundleId(bundleId, project, mainTarget);
}

function findMainAppTarget(targets: any): any | null {
  if (!Array.isArray(targets)) {
    return null;
  }

  for (const target of targets) {
    if (!target.props?.name) continue;
    const targetName = target.props.name.toLowerCase();
    if (targetName.includes('test') || targetName.includes('uitest')) {
      continue;
    }
    if (
      targetName.includes('app') ||
      target.props.productType === 'com.apple.product-type.application'
    ) {
      return target;
    }
  }

  return (
    targets.find(target => {
      const name = target.props?.name?.toLowerCase() || '';
      return !name.includes('test') && !name.includes('uitest');
    }) || null
  );
}

function extractTeamIdFromProject(project: XcodeProject): string | undefined {
  const targets = project.rootObject.props.targets;

  for (const target of targets) {
    const buildConfigList = target.props?.buildConfigurationList;
    if (!buildConfigList?.props?.buildConfigurations) continue;

    for (const config of buildConfigList.props.buildConfigurations) {
      const buildSettings = config.props?.buildSettings;
      if (buildSettings?.DEVELOPMENT_TEAM) {
        return buildSettings.DEVELOPMENT_TEAM;
      }
    }
  }

  return undefined;
}

function extractProjectNames(project: XcodeProject): {
  productName?: string;
  targetName?: string;
} {
  const targets = project.rootObject.props.targets;
  const mainTarget = findMainAppTarget(targets);

  if (!mainTarget) {
    return {};
  }

  const targetName = mainTarget.props.name;
  const buildConfigList = mainTarget.props.buildConfigurationList;
  let productName: string | undefined;

  if (buildConfigList?.props?.buildConfigurations) {
    for (const config of buildConfigList.props.buildConfigurations) {
      const buildSettings = config.props.buildSettings;
      if (buildSettings?.PRODUCT_NAME) {
        productName = buildSettings.PRODUCT_NAME;
        break;
      }
    }
  }

  return { productName, targetName };
}

function resolveBundleId(
  bundleId: string,
  project: XcodeProject,
  target: any
): string {
  let resolved = bundleId;

  if (resolved.includes('$(PRODUCT_NAME:rfc1034identifier)')) {
    const productName = getProductName(target);
    const rfc1034Name = toRFC1034Identifier(productName);
    resolved = resolved.replace(
      /\$\(PRODUCT_NAME:rfc1034identifier\)/g,
      rfc1034Name
    );
  }

  if (resolved.includes('$(PRODUCT_NAME)')) {
    const productName = getProductName(target);
    resolved = resolved.replace(/\$\(PRODUCT_NAME\)/g, productName);
  }

  if (resolved.includes('$(TARGET_NAME)')) {
    const targetName = target.props.name || 'UnknownTarget';
    resolved = resolved.replace(/\$\(TARGET_NAME\)/g, targetName);
  }

  return resolved;
}

function getProductName(target: any): string {
  const buildConfigList = target.props.buildConfigurationList;
  if (buildConfigList?.props?.buildConfigurations) {
    for (const config of buildConfigList.props.buildConfigurations) {
      const buildSettings = config.props.buildSettings;
      if (buildSettings?.PRODUCT_NAME) {
        return buildSettings.PRODUCT_NAME;
      }
    }
  }

  return target.props.name || 'UnknownProduct';
}

function toRFC1034Identifier(name: string): string {
  // Convert to RFC1034 identifier format (used in bundle IDs)
  // Replace non-alphanumeric characters with hyphens, remove consecutive hyphens
  return name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
