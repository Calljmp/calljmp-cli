import fs from 'fs';
import path from 'path';

export function version() {
  const packageJsonPath = path.join(__dirname, '../../../package.json');
  const packageJson = fs.readFileSync(packageJsonPath, 'utf8');
  const { version } = JSON.parse(packageJson);
  return version;
}
