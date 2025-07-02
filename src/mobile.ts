import * as fs from 'fs';
import * as path from 'path';

export enum ProjectType {
  ReactNative = 'react-native',
  Flutter = 'flutter',
  Native = 'native',
}

export function detectProjectType(rootDirectory: string): ProjectType {
  // Check for React Native
  const packageJsonPath = path.join(rootDirectory, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (
        packageJson.dependencies?.['react-native'] ||
        packageJson.devDependencies?.['react-native']
      ) {
        return ProjectType.ReactNative;
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Check for Flutter
  const pubspecPath = path.join(rootDirectory, 'pubspec.yaml');
  if (fs.existsSync(pubspecPath)) {
    return ProjectType.Flutter;
  }

  return ProjectType.Native;
}
