/**
 * @module
 * This code is inspired by that of https://www.atdatabases.org/docs/split-sql-query, which is published under MIT license,
 * and is Copyright (c) 2019 Forbes Lindesay.
 *
 * See https://github.com/ForbesLindesay/atdatabases/blob/103c1e7/packages/split-sql-query/src/index.ts
 * for the original code.
 */

/**
 * A function to remove transaction statements from the start and end of SQL files, as the D1 API already does it for us.
 * @param sql a potentially large string of SQL statements
 * @returns the initial input, without `BEGIN TRANSACTION`/`COMMIT`
 */
export function trimSqlQuery(sql: string): string {
  if (!mayContainTransaction(sql)) {
    return sql;
  }

  //note that we are intentionally not using greedy replace here, as we're targeting sqlite's dump command
  const trimmedSql = sql
    .replace('BEGIN TRANSACTION;', '')
    .replace('COMMIT;', '');
  //if the trimmed output STILL contains transactions, we should just tell them to remove them and try again.
  if (mayContainTransaction(trimmedSql)) {
    throw new Error(
      'Calljmp could not process the provided SQL file, as it contains several transactions.\nD1 runs your SQL in a transaction for you.\nPlease export an SQL file from your SQLite database and try again.'
    );
  }

  return trimmedSql;
}

// sqlite may start an sql dump file with pragmas,
// so we can't just use sql.startsWith here.
export function mayContainTransaction(sql: string): boolean {
  return sql.includes('BEGIN TRANSACTION');
}

/**
 * Is the given `sql` string likely to contain multiple statements.
 *
 * If `mayContainMultipleStatements()` returns `false` you can be confident that the sql
 * does not contain multiple statements. Otherwise you have to check further.
 */
export function mayContainMultipleStatements(sql: string): boolean {
  const trimmed = sql.trimEnd();
  const semiColonIndex = trimmed.indexOf(';');
  return semiColonIndex !== -1 && semiColonIndex !== trimmed.length - 1;
}

/**
 * Split an SQLQuery into an array of statements
 */
export default function splitSqlQuery(sql: string): string[] {
  const trimmedSql = trimSqlQuery(sql);
  if (!mayContainMultipleStatements(trimmedSql)) {
    return [trimmedSql];
  }
  const split = splitSqlIntoStatements(trimmedSql);
  if (split.length === 0) {
    return [trimmedSql];
  } else {
    return split;
  }
}

function splitSqlIntoStatements(sql: string): string[] {
  const statements: string[] = [];
  let str = '';
  const compoundStatementStack: ((s: string) => boolean)[] = [];

  const iterator = sql[Symbol.iterator]();
  let next = iterator.next();
  while (!next.done) {
    const char = next.value;

    if (compoundStatementStack[0]?.(str + char)) {
      compoundStatementStack.shift();
    }

    switch (char) {
      case "'":
      case '"':
      case '`':
        str += char + consumeUntilMarker(iterator, char);
        break;
      case '$': {
        const dollarQuote =
          '$' + consumeWhile(iterator, isDollarQuoteIdentifier);
        str += dollarQuote;
        if (dollarQuote.endsWith('$')) {
          str += consumeUntilMarker(iterator, dollarQuote);
        }
        break;
      }
      case '-':
        next = iterator.next();
        if (!next.done && next.value === '-') {
          // Skip to the end of the comment
          consumeUntilMarker(iterator, '\n');
          // Maintain the newline character
          str += '\n';
          break;
        } else {
          str += char;
          continue;
        }
      case '/':
        next = iterator.next();
        if (!next.done && next.value === '*') {
          // Skip to the end of the comment
          consumeUntilMarker(iterator, '*/');
          break;
        } else {
          str += char;
          continue;
        }
      case ';':
        if (compoundStatementStack.length === 0) {
          statements.push(str);
          str = '';
        } else {
          str += char;
        }
        break;
      default:
        str += char;
        break;
    }

    if (isCompoundStatementStart(str)) {
      compoundStatementStack.unshift(isCompoundStatementEnd);
    }

    next = iterator.next();
  }
  statements.push(str);

  return statements
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

/**
 * Pulls characters from the string iterator while the predicate remains true.
 */
function consumeWhile(
  iterator: Iterator<string>,
  predicate: (str: string) => boolean
) {
  let next = iterator.next();
  let str = '';
  while (!next.done) {
    str += next.value;
    if (!predicate(str)) {
      break;
    }
    next = iterator.next();
  }
  return str;
}

/**
 * Pulls characters from the string iterator until the `endMarker` is found.
 */
function consumeUntilMarker(iterator: Iterator<string>, endMarker: string) {
  return consumeWhile(iterator, str => !str.endsWith(endMarker));
}

/**
 * Returns true if the `str` ends with a dollar-quoted string marker.
 * See https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-DOLLAR-QUOTING.
 */
function isDollarQuoteIdentifier(str: string) {
  const lastChar = str.slice(-1);
  return (
    // The $ marks the end of the identifier
    lastChar !== '$' &&
    // we allow numbers, underscore and letters with diacritical marks
    (/[0-9_]/i.test(lastChar) ||
      lastChar.toLowerCase() !== lastChar.toUpperCase())
  );
}

/**
 * Returns true if the `str` ends with a compound statement `BEGIN` or `CASE` marker.
 */
function isCompoundStatementStart(str: string) {
  return /\s(BEGIN|CASE)\s$/i.test(str);
}

/**
 * Returns true if the `str` ends with a compound statement `END` marker.
 */
function isCompoundStatementEnd(str: string) {
  return /\sEND[;\s]$/.test(str);
}
