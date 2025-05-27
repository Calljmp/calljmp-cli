/**
 * Normalizes SQL strings by removing comments, collapsing whitespace, and cleaning up formatting.
 *
 * This function performs the following transformations:
 * - Removes single-line SQL comments (-- comments)
 * - Collapses multiple whitespace characters into single spaces
 * - Removes spaces around parentheses and commas for cleaner formatting
 * - Removes unnecessary double quotes around word identifiers
 * - Trims leading and trailing whitespace
 *
 * @param sql - The SQL string to normalize
 * @returns The normalized SQL string with cleaned formatting
 *
 * @example
 * ```typescript
 * const sql = `
 *   SELECT "name", "age" -- get user data
 *   FROM   users
 *   WHERE  id = 1
 * `;
 * const normalized = normalizeSql(sql);
 * // Result: "SELECT name,age FROM users WHERE id=1"
 * ```
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*\n/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ *([(),]) */g, '$1')
    .replace(/"(\w+)"/g, '$1')
    .trim();
}
