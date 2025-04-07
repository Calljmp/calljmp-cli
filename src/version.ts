import fs from 'fs/promises';
import path from 'path';

export async function version() {
  const packageJsonPath = path.join(__dirname, '../../../package.json');
  const packageJson = await fs.readFile(packageJsonPath, 'utf8');
  const { version } = JSON.parse(packageJson);
  return version;
}
