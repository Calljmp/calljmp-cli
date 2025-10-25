export function toKebabCase(str: any): string {
  const s = String(str);
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2') // Handle camelCase
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .toLowerCase();
}

export function toCamelCase(str: any): string {
  const s = String(str);
  return s
    .toLowerCase()
    .replace(/[-_ ]+([a-z])/g, (_, char) => char.toUpperCase());
}

export function toSentenceCase(str: any): string {
  const s = String(str);
  if (!s) return s;
  // Separate words: insert space before capitals, replace -_ with space
  let spaced = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  // Lowercase all and trim
  spaced = spaced.toLowerCase().trim();
  // Capitalize first word
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
