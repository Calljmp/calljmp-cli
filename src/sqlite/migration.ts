import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export class SqliteMigration {
  private _numberOfChanges = 0;
  private _executedStatements: string[] = [];

  constructor(private _db: Database) {}

  get numberOfChanges(): number {
    return this._numberOfChanges;
  }

  get statements(): string[] {
    return [...this._executedStatements];
  }

  async migrate(schema: string) {
    const pristine = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });
    await pristine.exec(schema);

    await this._exec('PRAGMA foreign_keys = OFF', false);
    // await this._db.exec('BEGIN');
    try {
      // await this._db.exec('PRAGMA defer_foreign_keys = TRUE');

      await this._migrateTables(pristine);
      await this._migrateIndexes(pristine);
      await this._migrateTriggers(pristine);
      await this._migrateViews(pristine);

      await this._migratePragma(pristine, 'user_version');
      const [fkRes] = await pristine.all('PRAGMA foreign_keys');
      if (fkRes?.foreign_keys) {
        const fkViolations = await this._db.all('PRAGMA foreign_key_check');
        if (fkViolations.length) throw new Error('Foreign key check failed');
      }

      // await this._db.exec('COMMIT');
      await this._exec('PRAGMA foreign_keys = ON', false);

      // if (this._numberOfChanges > 0) {
      //   await this._db.exec('VACUUM');
      // }
    } catch (error) {
      // await this._db.exec('ROLLBACK');
      await this._exec('PRAGMA foreign_keys = ON', false);
      throw error;
    }
  }

  private async _migrateIndexes(pristine: Database) {
    const indexes = await this._indexes(this._db);
    const pristineIndexes = await this._indexes(pristine);

    const removedIndexes = [...indexes.keys()].filter(
      k => !pristineIndexes.has(k)
    );
    const newIndexes = [...pristineIndexes.keys()].filter(k => !indexes.has(k));
    const modifiedIndexes = [...pristineIndexes.keys()]
      .filter(k => indexes.has(k))
      .filter(
        k =>
          normalizeSql(pristineIndexes.get(k)!) !==
          normalizeSql(indexes.get(k)!)
      );

    for (const idx of newIndexes) {
      await this._exec(pristineIndexes.get(idx)!);
    }

    for (const idx of removedIndexes) {
      await this._exec(`DROP INDEX ${idx}`);
    }

    for (const idx of modifiedIndexes) {
      await this._exec(`DROP INDEX ${idx}`);
      await this._exec(pristineIndexes.get(idx)!);
    }
  }

  private async _migrateTables(pristine: Database) {
    const tables = await this._tables(this._db);
    const pristineTables = await this._tables(pristine);

    const removedTables = [...tables.keys()].filter(
      k => !pristineTables.has(k)
    );
    const newTables = [...pristineTables.keys()].filter(k => !tables.has(k));
    const modifiedTables = [...pristineTables.keys()]
      .filter(k => tables.has(k))
      .filter(
        k =>
          normalizeSql(pristineTables.get(k)!) !==
          normalizeSql(tables.get(k) || '')
      );

    for (const tbl of newTables) {
      await this._exec(pristineTables.get(tbl)!);
    }

    for (const tbl of removedTables) {
      await this._exec(`DROP TABLE ${tbl}`);
    }

    for (const tbl of modifiedTables) {
      const createTable = pristineTables
        .get(tbl)!
        .replace(new RegExp(`\\b${tbl}\\b`, 'g'), `${tbl}_migration_new`);
      await this._exec(createTable);

      const columns = await this._columns(this._db, tbl);
      const pristineColumns = await this._columns(pristine, tbl);
      const commonColumns = columns.filter(c => pristineColumns.includes(c));

      await this._exec(
        `INSERT INTO ${tbl}_migration_new (${commonColumns.join(', ')}) SELECT ${commonColumns.join(', ')} FROM ${tbl}`
      );
      await this._exec(`DROP TABLE ${tbl}`);
      await this._exec(`ALTER TABLE ${tbl}_migration_new RENAME TO ${tbl}`);
    }
  }

  private async _migrateTriggers(pristine: Database) {
    const triggers = await this._triggers(this._db);
    const pristineTriggers = await this._triggers(pristine);

    const removedTriggers = [...triggers.keys()].filter(
      k => !pristineTriggers.has(k)
    );
    const newTriggers = [...pristineTriggers.keys()].filter(
      k => !triggers.has(k)
    );
    const modifiedTriggers = [...pristineTriggers.keys()]
      .filter(k => triggers.has(k))
      .filter(
        k =>
          normalizeSql(pristineTriggers.get(k)!) !==
          normalizeSql(triggers.get(k)!)
      );

    for (const trg of newTriggers) {
      await this._exec(pristineTriggers.get(trg)!);
    }

    for (const trg of removedTriggers) {
      await this._exec(`DROP TRIGGER ${trg}`);
    }

    for (const trg of modifiedTriggers) {
      await this._exec(`DROP TRIGGER ${trg}`);
      await this._exec(pristineTriggers.get(trg)!);
    }
  }

  private async _migrateViews(pristine: Database) {
    const views = await this._views(this._db);
    const pristineViews = await this._views(pristine);

    const removedViews = [...views.keys()].filter(k => !pristineViews.has(k));
    const newViews = [...pristineViews.keys()].filter(k => !views.has(k));
    const modifiedViews = [...pristineViews.keys()]
      .filter(k => views.has(k))
      .filter(
        k => normalizeSql(pristineViews.get(k)!) !== normalizeSql(views.get(k)!)
      );

    for (const v of newViews) {
      await this._exec(pristineViews.get(v)!);
    }

    for (const v of removedViews) {
      await this._exec(`DROP VIEW ${v}`);
    }

    for (const v of modifiedViews) {
      await this._exec(`DROP VIEW ${v}`);
      await this._exec(pristineViews.get(v)!);
    }
  }

  private async _exec(sql: string, change = true) {
    await this._db.exec(sql);
    this._executedStatements.push(sql);
    if (change) {
      this._numberOfChanges++;
    }
  }

  private async _objects(
    db: Database,
    type: 'table' | 'index' | 'trigger' | 'view'
  ): Promise<Map<string, string>> {
    const sql =
      'SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL AND name NOT LIKE "sqlite_%" AND name NOT LIKE "_cf_%" AND name NOT LIKE "%_calljmp_%"';
    const rows = await db.all<
      {
        name: string;
        sql: string;
      }[]
    >(sql, type);
    return new Map(rows.map(r => [r.name, r.sql]));
  }

  private async _tables(db: Database): Promise<Map<string, string>> {
    return this._objects(db, 'table');
  }

  private async _indexes(db: Database): Promise<Map<string, string>> {
    return this._objects(db, 'index');
  }

  private async _triggers(db: Database): Promise<Map<string, string>> {
    return this._objects(db, 'trigger');
  }

  private async _views(db: Database): Promise<Map<string, string>> {
    return this._objects(db, 'view');
  }

  private async _columns(db: Database, table: string): Promise<string[]> {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    return rows.map((r: any) => r.name);
  }

  private async _migratePragma(
    pristine: Database,
    pragma: string
  ): Promise<void> {
    const [pVal] = await pristine.all(`PRAGMA ${pragma}`);
    const [cVal] = await this._db.all(`PRAGMA ${pragma}`);
    if (pVal?.[pragma] !== cVal?.[pragma]) {
      await this._exec(`PRAGMA ${pragma} = ${pVal?.[pragma]}`);
    }
  }
}

export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*\n/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ *([(),]) */g, '$1')
    .replace(/"(\w+)"/g, '$1')
    .trim();
}
