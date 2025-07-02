import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { detectProjectType, ProjectType } from './mobile.js';

interface AndroidManifestAttributes {
  package?: string;
  'android:versionCode'?: string;
  'android:versionName'?: string;
  [key: string]: string | undefined;
}

interface AndroidManifestElement {
  $?: AndroidManifestAttributes;
  [key: string]: unknown;
}

interface ParsedAndroidManifest {
  manifest?: AndroidManifestElement;
}

export interface ProjectInfo {
  packageName: string;
  projectType: ProjectType;
  applicationId: string;
  targetSdkVersion?: string;
  minSdkVersion?: string;
  compileSdkVersion?: string;
}

export async function resolveProjectInfo({
  projectDirectory,
}: {
  projectDirectory: string;
}): Promise<ProjectInfo> {
  const androidProjectPath = findAndroidProject(projectDirectory);
  const projectInfo = await readAndroidProject(
    androidProjectPath,
    projectDirectory
  );
  return projectInfo;
}

function findAndroidProject(directory: string): string {
  const directories = [directory, path.join(directory, 'android')];

  for (const dir of directories) {
    try {
      if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory()) {
        const manifestPaths = [
          path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'),
          path.join(dir, 'src', 'main', 'AndroidManifest.xml'),
        ];

        const gradlePaths = [
          path.join(dir, 'app', 'build.gradle'),
          path.join(dir, 'app', 'build.gradle.kts'),
          path.join(dir, 'build.gradle'),
          path.join(dir, 'build.gradle.kts'),
        ];

        const hasAndroidManifest = manifestPaths.some(manifestPath =>
          fs.existsSync(manifestPath)
        );

        const hasBuildGradle = gradlePaths.some(gradlePath =>
          fs.existsSync(gradlePath)
        );

        if (hasAndroidManifest || hasBuildGradle) {
          return dir;
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    'Android project not found. Make sure you have AndroidManifest.xml or build.gradle files in your project.'
  );
}

async function readAndroidProject(
  projectPath: string,
  rootDirectory: string
): Promise<ProjectInfo> {
  const projectType = detectProjectType(rootDirectory);

  // Try to find AndroidManifest.xml
  const manifestPath = findAndroidManifest(projectPath);
  if (!manifestPath) {
    throw new Error('AndroidManifest.xml not found in Android project.');
  }

  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: false,
    });
    const manifest: ParsedAndroidManifest =
      await parser.parseStringPromise(manifestContent);

    // Try to get additional info from build.gradle first
    const buildGradleInfo = readBuildGradleInfo(projectPath);

    // Try package name from AndroidManifest.xml first, then from build.gradle
    let packageName = extractPackageNameFromManifest(manifest);
    if (!packageName && buildGradleInfo.applicationId) {
      // In modern Android projects, applicationId in build.gradle is the package name
      packageName = buildGradleInfo.applicationId;
    }

    if (!packageName) {
      throw new Error(
        'Package name not found in AndroidManifest.xml or build.gradle. Make sure you have a valid package attribute in AndroidManifest.xml or applicationId in build.gradle.'
      );
    }

    // Validate package name format
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(packageName)
    ) {
      throw new Error(
        `Invalid package name format: ${packageName}. Package names must follow Java package naming conventions.`
      );
    }

    return {
      packageName,
      projectType,
      applicationId: buildGradleInfo.applicationId || packageName,
      targetSdkVersion: buildGradleInfo.targetSdkVersion,
      minSdkVersion: buildGradleInfo.minSdkVersion,
      compileSdkVersion: buildGradleInfo.compileSdkVersion,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse Android project: ${error.message}`);
    }
    throw new Error(`Failed to parse Android project: ${String(error)}`);
  }
}

function findAndroidManifest(projectPath: string): string | null {
  const possiblePaths = [
    path.join(projectPath, 'app', 'src', 'main', 'AndroidManifest.xml'),
    path.join(projectPath, 'src', 'main', 'AndroidManifest.xml'),
    path.join(projectPath, 'AndroidManifest.xml'),
  ];

  for (const manifestPath of possiblePaths) {
    if (fs.existsSync(manifestPath)) {
      return manifestPath;
    }
  }

  return null;
}

function extractPackageNameFromManifest(
  manifest: ParsedAndroidManifest
): string | null {
  try {
    return manifest?.manifest?.$?.package || null;
  } catch {
    return null;
  }
}

interface BuildGradleInfo {
  applicationId?: string;
  targetSdkVersion?: string;
  minSdkVersion?: string;
  compileSdkVersion?: string;
}

function readBuildGradleInfo(projectPath: string): BuildGradleInfo {
  const buildGradlePaths = [
    // Kotlin DSL files (.gradle.kts)
    path.join(projectPath, 'app', 'build.gradle.kts'),
    path.join(projectPath, 'build.gradle.kts'),
    // Groovy files (.gradle)
    path.join(projectPath, 'app', 'build.gradle'),
    path.join(projectPath, 'build.gradle'),
  ];

  for (const gradlePath of buildGradlePaths) {
    if (fs.existsSync(gradlePath)) {
      try {
        const content = fs.readFileSync(gradlePath, 'utf8');
        const isKotlinDsl = gradlePath.endsWith('.gradle.kts');
        return parseBuildGradle(content, isKotlinDsl);
      } catch {
        continue;
      }
    }
  }

  return {};
}

function parseBuildGradle(
  content: string,
  isKotlinDsl = false
): BuildGradleInfo {
  const info: BuildGradleInfo = {};

  // Clean content for better parsing (remove comments)
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // Extract variables for resolution
  const variables = extractVariables(cleanContent, isKotlinDsl);

  // Extract applicationId - handle both Groovy and Kotlin DSL
  const applicationIdPatterns = [
    // Standard patterns: applicationId "com.example" or applicationId = "com.example"
    /applicationId\s*=?\s*["']([^"']+)["']/,
    // Kotlin DSL: applicationId.set("com.example")
    /applicationId\.set\s*\(\s*["']([^"']+)["']\s*\)/,
    // Variable references: applicationId $variableName or applicationId "${variableName}"
    /applicationId\s*=?\s*\$\{?(\w+)\}?/,
  ];

  for (const pattern of applicationIdPatterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      // Resolve variables if present
      info.applicationId = resolveVariables(match[1], variables);
      break;
    }
  }

  // Extract compileSdk/compileSdkVersion - handle multiple variations
  const compileSdkPatterns = [
    // Modern: compileSdk 34 or compileSdk = 34
    /compileSdk\s*=?\s*(\d+)/,
    // Legacy: compileSdkVersion 34
    /compileSdkVersion\s*=?\s*(\d+)/,
    // Kotlin DSL: compileSdk.set(34)
    /compileSdk\.set\s*\(\s*(\d+)\s*\)/,
  ];

  for (const pattern of compileSdkPatterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      info.compileSdkVersion = match[1];
      break;
    }
  }

  // Extract targetSdkVersion
  const targetSdkPatterns = [
    /targetSdkVersion\s*=?\s*(\d+)/,
    /targetSdk\s*=?\s*(\d+)/,
    /targetSdkVersion\.set\s*\(\s*(\d+)\s*\)/,
  ];

  for (const pattern of targetSdkPatterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      info.targetSdkVersion = match[1];
      break;
    }
  }

  // Extract minSdkVersion
  const minSdkPatterns = [
    /minSdkVersion\s*=?\s*(\d+)/,
    /minSdk\s*=?\s*(\d+)/,
    /minSdkVersion\.set\s*\(\s*(\d+)\s*\)/,
  ];

  for (const pattern of minSdkPatterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      info.minSdkVersion = match[1];
      break;
    }
  }

  return info;
}

function extractVariables(
  content: string,
  isKotlinDsl: boolean
): Record<string, string> {
  const variables: Record<string, string> = {};

  if (isKotlinDsl) {
    // Kotlin DSL variable patterns
    // val myVariable = "value" or val myVariable by extra { "value" }
    const kotlinVarPatterns = [
      /val\s+(\w+)\s*=\s*["']([^"']+)["']/g,
      /val\s+(\w+)\s+by\s+extra\s*\{\s*["']([^"']+)["']\s*\}/g,
    ];

    for (const pattern of kotlinVarPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        variables[match[1]] = match[2];
      }
    }
  } else {
    // Groovy variable patterns
    // def myVariable = "value" or ext.myVariable = "value"
    const groovyVarPatterns = [
      /def\s+(\w+)\s*=\s*["']([^"']+)["']/g,
      /ext\.(\w+)\s*=\s*["']([^"']+)["']/g,
      /(\w+)\s*=\s*["']([^"']+)["']/g,
    ];

    for (const pattern of groovyVarPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        variables[match[1]] = match[2];
      }
    }
  }

  return variables;
}

function resolveVariables(
  value: string,
  variables: Record<string, string>
): string {
  let resolved = value;

  // Handle ${variable} interpolation
  resolved = resolved.replace(/\$\{(\w+)\}/g, (match, varName) => {
    return variables[varName] || match;
  });

  // Handle $variable interpolation (Groovy style)
  resolved = resolved.replace(/\$(\w+)/g, (match, varName) => {
    return variables[varName] || match;
  });

  return resolved;
}
