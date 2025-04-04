const fs = require('fs');
const path = require('path');

const mainPath = path.join(process.cwd(), 'main.js');

const shebang = '#!/usr/bin/env node\n';
const mainContent = fs.readFileSync(mainPath, 'utf-8');
if (!mainContent.startsWith(shebang)) {
  fs.writeFileSync(mainPath, shebang + mainContent, 'utf-8');
}

fs.chmodSync(mainPath, 0o755);

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const binPath = path.relative(process.cwd(), mainPath);

packageJson.bin = {
  calljmp: `./${binPath}`,
};

fs.writeFileSync(
  packageJsonPath,
  JSON.stringify(packageJson, null, 2),
  'utf-8'
);
