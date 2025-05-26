import fs from 'fs/promises';
import path from 'path';

function readEnvEntry(entry: string) {
  // Trim any extra spaces from the entry.
  const trimmedEntry = entry.trim();

  // Find the first `=` and split the entry only on the first occurrence.
  const equalIndex = trimmedEntry.indexOf('=');
  if (equalIndex === -1) {
    // If no '=' is found, return the key with an empty value.
    return { key: trimmedEntry, value: '' };
  }

  // Split only at the first '='
  const key = trimmedEntry.substring(0, equalIndex).trim();
  let value = trimmedEntry.substring(equalIndex + 1).trim();

  // Check if the value is quoted (either single or double quotes).
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1); // Remove the surrounding double quotes.
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1); // Remove the surrounding single quotes.
  }

  return { key, value };
}

export async function readEnv(files: string | string[]) {
  const readEnv = (file: string) =>
    fs
      .readFile(file, 'utf-8')
      .catch(() => {
        // If the file doesn't exist, return an empty object
        return '';
      })
      .then(content => {
        // Remove any comments and empty lines
        return content
          .split('\n')
          .filter(line => line.trim() && !line.trim().startsWith('#'));
      })
      .then(lines => {
        // Parse the lines into key-value pairs
        return lines.map(line => readEnvEntry(line));
      });

  const entries = await Promise.all([files].flat().map(readEnv));
  return entries.flat();
}

export function resolveEnvFiles(
  directory: string,
  environment: 'development' | 'production'
) {
  return [
    path.join(directory, '.env'),
    path.join(directory, `.env.${environment}`),
    path.join(directory, '.service.env'),
    path.join(directory, `.service.env.${environment}`),
  ];
}

export async function readVariables(
  directory: string,
  environment: 'development' | 'production'
) {
  const variables: Record<string, string> = {};

  const put = (key: string, value: string) => {
    if (key in variables) {
      throw new Error(`Duplicate key found in .env: ${key}`);
    }
    variables[key] = value;
  };

  // Read the .env file with CALLJMP_ prefix
  for (const entry of await readEnv([
    path.join(directory, '.env'),
    path.join(directory, `.env.${environment}`),
  ])) {
    if (entry.key.startsWith('CALLJMP_')) {
      put(entry.key.replace('CALLJMP_', ''), entry.value);
    }
  }

  // Read the .service.env
  for (const entry of await readEnv([
    path.join(directory, '.service.env'),
    path.join(directory, `.service.env.${environment}`),
  ])) {
    put(entry.key, entry.value);
  }

  return variables;
}
