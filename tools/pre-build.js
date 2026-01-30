import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

fs.mkdirSync(path.join(__dirname, '..', 'src/gen'), { recursive: true });

fs.writeFileSync(
  path.join(__dirname, '..', 'src/gen/version.ts'),
  `export function version() { return '${packageJson.version}'; }\n`
);
