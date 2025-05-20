import { describe, it, expect, beforeEach } from 'vitest';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { normalizeSql, SqliteMigration } from './migration';

async function migrate(db: Database, schema: string): Promise<boolean> {
  const migrator = new SqliteMigration(db);
  await migrator.migrate(schema);
  return migrator.numberOfChanges > 0;
}

describe('SQLite migration', () => {
  describe('normalise sql', () => {
    it('should remove comments and normalize spacing', () => {
      const raw = `
      CREATE TABLE "Test" ( -- comment here
        id INTEGER PRIMARY KEY, name TEXT -- another
      );
    `;
      const expected = 'CREATE TABLE Test(id INTEGER PRIMARY KEY,name TEXT);';
      expect(normalizeSql(raw)).toBe(expected);
    });
  });

  describe('migrate', () => {
    let db: Database;

    beforeEach(async () => {
      db = await open({ filename: ':memory:', driver: sqlite3.Database });
      await db.exec('PRAGMA foreign_keys = ON');
    });

    it('creates new table from schema', async () => {
      const schema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
    `;
      const changed = await migrate(db, schema);
      const rows = await db.all(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      expect(rows.some(r => r.name === 'users')).toBe(true);
      expect(changed).toBe(true);
    });

    it('does nothing if schema is identical', async () => {
      const schema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
    `;
      await migrate(db, schema);
      const changed = await migrate(db, schema);
      expect(changed).toBe(false);
    });

    it('adds a column when modified', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY
      );
    `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT DEFAULT NULL
      );
    `;
      await migrate(db, schemaV1);
      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);

      const cols = await db.all('PRAGMA table_info(users)');
      expect(cols.map(c => c.name)).toContain('name');
    });

    it('changes column type and default', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        age INTEGER DEFAULT 18
      );
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        age TEXT DEFAULT 'unknown'
      );
      `;
      await migrate(db, schemaV1);
      await db.run('INSERT INTO users (id) VALUES (1)');
      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);

      const cols = await db.all('PRAGMA table_info(users)');
      const ageCol = cols.find(c => c.name === 'age');
      expect(ageCol.type).toBe('TEXT');
      expect(ageCol.dflt_value).toBe("'unknown'");
    });

    it('adds and removes indexes', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE INDEX idx_name ON users(name);
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      -- index removed
      `;
      await migrate(db, schemaV1);
      let idxs = await db.all('PRAGMA index_list(users)');
      expect(idxs.some(i => i.name === 'idx_name')).toBe(true);

      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);
      idxs = await db.all('PRAGMA index_list(users)');
      expect(idxs.some(i => i.name === 'idx_name')).toBe(false);
    });

    it('drops and recreates a table', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY
      );
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      );
      `;
      await migrate(db, schemaV1);
      await db.run('INSERT INTO users (id) VALUES (1)');
      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);

      const cols = await db.all('PRAGMA table_info(users)');
      expect(cols.map(c => c.name)).toContain('email');
    });

    it('renames a table', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY
      );
      `;
      const schemaV2 = `
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY
      );
      `;
      await migrate(db, schemaV1);
      const changed = await migrate(db, schemaV2);
      const tables = await db.all(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      expect(tables.some(t => t.name === 'customers')).toBe(true);
      expect(tables.some(t => t.name === 'users')).toBe(false);
      expect(changed).toBe(true);
    });

    it('foreign key cascade: parent table altered, child data remains after migration', async () => {
      const schemaV1 = `
      CREATE TABLE parent (
        id INTEGER PRIMARY KEY
      );
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        FOREIGN KEY(parent_id) REFERENCES parent(id) ON DELETE CASCADE
      );
      `;
      await migrate(db, schemaV1);
      await db.run('INSERT INTO parent (id) VALUES (1)');
      await db.run('INSERT INTO child (id, parent_id) VALUES (10, 1)');
      // parent table gets a new column
      const schemaV2 = `
      CREATE TABLE parent (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        FOREIGN KEY(parent_id) REFERENCES parent(id) ON DELETE CASCADE
      );
      `;
      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);
      const childRows = await db.all('SELECT * FROM child');
      expect(childRows.length).toBe(1);
      expect(childRows[0].id).toBe(10);
      expect(childRows[0].parent_id).toBe(1);
      const parentRows = await db.all('SELECT * FROM parent');
      expect(parentRows.length).toBe(1);
      expect(parentRows[0].id).toBe(1);
      expect(parentRows[0].name).toBe(null);
    });

    it('tracks executed statements', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY
      );
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE INDEX idx_name ON users(name);
      `;
      const migrator = new SqliteMigration(db);
      await migrator.migrate(schemaV1);
      expect(
        migrator.statements.some(s => s.includes('CREATE TABLE users'))
      ).toBe(true);

      await migrator.migrate(schemaV2);
      expect(
        migrator.statements.some(s =>
          s.includes('ALTER TABLE users_migration_new RENAME TO users')
        )
      ).toBe(true);
      expect(
        migrator.statements.some(s => s.includes('CREATE INDEX idx_name'))
      ).toBe(true);
    });

    it('creates, drops, and modifies a view', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE VIEW user_names AS SELECT name FROM users;
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE VIEW user_names AS SELECT id, name FROM users;
      `;
      await migrate(db, schemaV1);
      let views = await db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='view'"
      );
      expect(views.some(v => v.name === 'user_names')).toBe(true);
      expect(views[0].sql.includes('SELECT name')).toBe(true);

      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);
      views = await db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='view'"
      );
      expect(views[0].sql.includes('SELECT id, name')).toBe(true);

      // Remove the view
      const schemaV3 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      `;
      const changed2 = await migrate(db, schemaV3);
      expect(changed2).toBe(true);
      views = await db.all("SELECT name FROM sqlite_master WHERE type='view'");
      expect(views.length).toBe(0);
    });

    it('creates, drops, and modifies a trigger', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE log (
        id INTEGER PRIMARY KEY,
        msg TEXT
      );
      CREATE TRIGGER trg AFTER INSERT ON users BEGIN
        INSERT INTO log (msg) VALUES ('inserted');
      END;
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE log (
        id INTEGER PRIMARY KEY,
        msg TEXT
      );
      CREATE TRIGGER trg AFTER INSERT ON users BEGIN
        INSERT INTO log (msg) VALUES ('added');
      END;
      `;
      await migrate(db, schemaV1);
      let triggers = await db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='trigger'"
      );
      expect(triggers.some(t => t.name === 'trg')).toBe(true);
      expect(triggers[0].sql.includes('inserted')).toBe(true);

      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);
      triggers = await db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='trigger'"
      );
      expect(triggers[0].sql.includes('added')).toBe(true);

      // Remove the trigger
      const schemaV3 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE log (
        id INTEGER PRIMARY KEY,
        msg TEXT
      );
      `;
      const changed2 = await migrate(db, schemaV3);
      expect(changed2).toBe(true);
      triggers = await db.all(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
      );
      expect(triggers.length).toBe(0);
    });

    it('creates, drops, and modifies an index', async () => {
      const schemaV1 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE INDEX idx_name ON users(name);
      `;
      const schemaV2 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE INDEX idx_name ON users(id, name);
      `;
      await migrate(db, schemaV1);
      let idxs = await db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='index'"
      );
      expect(idxs.some(i => i.name === 'idx_name')).toBe(true);
      expect(idxs[0].sql.includes('name)')).toBe(true);

      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);
      idxs = await db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='index'"
      );
      expect(idxs[0].sql.includes('id, name')).toBe(true);

      // Remove the index
      const schemaV3 = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      `;
      const changed2 = await migrate(db, schemaV3);
      expect(changed2).toBe(true);
      idxs = await db.all(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_name'"
      );
      expect(idxs.length).toBe(0);
    });

    it('no-op migration for unchanged view, trigger, and index', async () => {
      const schema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE VIEW user_names AS SELECT name FROM users;
      CREATE TRIGGER trg AFTER INSERT ON users BEGIN
        SELECT 1;
      END;
      CREATE INDEX idx_name ON users(name);
      `;
      await migrate(db, schema);
      const changed = await migrate(db, schema);
      expect(changed).toBe(false);
    });

    it('handles dropping all tables, views, triggers, and indexes', async () => {
      const schemaV1 = `
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE VIEW v AS SELECT id FROM users;
      CREATE TRIGGER trg AFTER INSERT ON users BEGIN SELECT 1; END;
      CREATE INDEX idx_name ON users(id);
      `;
      const schemaV2 = '';
      await migrate(db, schemaV1);
      const changed = await migrate(db, schemaV2);
      expect(changed).toBe(true);
      const tables = await db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence'"
      );
      const views = await db.all(
        "SELECT name FROM sqlite_master WHERE type='view'"
      );
      const triggers = await db.all(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
      );
      const idxs = await db.all(
        "SELECT name FROM sqlite_master WHERE type='index' AND name!='sqlite_autoindex_users_1'"
      );
      expect(tables.length).toBe(0);
      expect(views.length).toBe(0);
      expect(triggers.length).toBe(0);
      expect(idxs.length).toBe(0);
    });
  });
});
