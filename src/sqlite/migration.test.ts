import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { SqliteMigration } from './migration';

async function migrateSchemas(fromSchema: string, toSchema: string) {
  const migration = new SqliteMigration();
  await migration.exec(fromSchema);
  await migration.prepare(toSchema);
  return migration;
}

async function evaluateSchema(...schemas: string[]) {
  const migration = new SqliteMigration();
  for (const schema of schemas) {
    await migration.exec(schema);
  }
  return migration;
}

describe('end-to-end', () => {
  let fromSchema: string;
  let toSchema: string;
  let sql: string;

  afterEach(async () => {
    await evaluateSchema(fromSchema, sql);
  });

  it('adds column without recreating table', async () => {
    fromSchema = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL
        );
      `;

    toSchema = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          username TEXT DEFAULT NULL
        );
      `;

    const migrator = await migrateSchemas(fromSchema, toSchema);

    sql = migrator.sql();
    expect(sql).toContain(
      'ALTER TABLE users ADD COLUMN username TEXT DEFAULT NULL'
    );
  });

  it('recreates table when adding NOT NULL column without default', async () => {
    fromSchema = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY
        );
      `;

    toSchema = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
      `;

    const migration = await migrateSchemas(fromSchema, toSchema);

    sql = migration.sql();
    expect(sql).toContain('PRAGMA defer_foreign_keys = ON;');
    expect(sql).toContain('PRAGMA defer_foreign_keys = OFF;');
    expect(sql).toContain('RENAME TO users_old');
    expect(sql).toContain('INSERT INTO users');
    expect(sql).toContain('DROP TABLE users_old');
  });

  it('recreates index when table is recreated', async () => {
    fromSchema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT,
        info TEXT
      );
      CREATE INDEX idx_users_email ON users(email);
    `;

    toSchema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      );
      CREATE INDEX idx_users_email ON users(email);
    `;

    const migration = await migrateSchemas(fromSchema, toSchema);
    sql = migration.sql();

    expect(sql).toContain('PRAGMA defer_foreign_keys = ON;');
    expect(sql).toContain('PRAGMA defer_foreign_keys = OFF;');
    expect(sql).not.toContain('DROP INDEX idx_users_email');
    expect(sql).toContain('CREATE INDEX idx_users_email ON users(email)');
  });

  it('recreates trigger when table is recreated', async () => {
    fromSchema = `
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY,
        created_at TEXT,
        source TEXT
      );

      CREATE TRIGGER trg_logs_insert AFTER INSERT ON logs
      BEGIN
        UPDATE logs SET created_at = datetime('now') WHERE id = NEW.id;
      END;
    `;

    toSchema = `
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY,
        created_at TEXT
      );

      CREATE TRIGGER trg_logs_insert AFTER INSERT ON logs
      BEGIN
        UPDATE logs SET created_at = datetime('now') WHERE id = NEW.id;
      END;
    `;

    const migration = await migrateSchemas(fromSchema, toSchema);
    sql = migration.sql();

    expect(sql).toContain('PRAGMA defer_foreign_keys = ON;');
    expect(sql).toContain('PRAGMA defer_foreign_keys = OFF;');
    expect(sql).not.toContain('DROP TRIGGER trg_logs_insert');
    expect(sql).toContain('CREATE TRIGGER trg_logs_insert');
  });

  it('recreates view when table is recreated', async () => {
    fromSchema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT,
        username TEXT
      );

      CREATE VIEW user_emails AS SELECT email FROM users;
    `;

    toSchema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      );

      CREATE VIEW user_emails AS SELECT email FROM users;
    `;

    const migration = await migrateSchemas(fromSchema, toSchema);
    sql = migration.sql();

    expect(sql).toContain('PRAGMA defer_foreign_keys = ON;');
    expect(sql).toContain('PRAGMA defer_foreign_keys = OFF;');
    expect(sql).toContain('DROP VIEW user_emails');
    expect(sql).toContain('CREATE VIEW user_emails AS SELECT email FROM users');
  });

  it('adds new index without drop', async () => {
    fromSchema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      );
    `;

    toSchema = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      );
      CREATE INDEX idx_users_email ON users(email);
    `;

    const migration = await migrateSchemas(fromSchema, toSchema);
    sql = migration.sql();

    expect(sql).not.toContain('PRAGMA defer_foreign_keys');
    expect(sql).not.toContain('DROP INDEX idx_users_email');
    expect(sql).toContain('CREATE INDEX idx_users_email ON users(email)');
  });

  it('adds new trigger without drop', async () => {
    fromSchema = `
      CREATE TABLE audit (
        id INTEGER PRIMARY KEY,
        action TEXT
      );
    `;

    toSchema = `
      CREATE TABLE audit (
        id INTEGER PRIMARY KEY,
        action TEXT
      );

      CREATE TRIGGER trg_audit_insert AFTER INSERT ON audit
      BEGIN
        UPDATE audit SET action = 'created' WHERE id = NEW.id;
      END;
    `;

    const migration = await migrateSchemas(fromSchema, toSchema);
    sql = migration.sql();

    expect(sql).not.toContain('PRAGMA defer_foreign_keys');
    expect(sql).not.toContain('DROP TRIGGER trg_audit_insert');
    expect(sql).toContain('CREATE TRIGGER trg_audit_insert');
  });

  it('adds new view without drop', async () => {
    fromSchema = `
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
    `;

    toSchema = `
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT
      );

      CREATE VIEW product_names AS SELECT name FROM products;
    `;

    const migration = await migrateSchemas(fromSchema, toSchema);
    sql = migration.sql();

    expect(sql).not.toContain('PRAGMA defer_foreign_keys');
    expect(sql).not.toContain('DROP VIEW product_names');
    expect(sql).toContain(
      'CREATE VIEW product_names AS SELECT name FROM products'
    );
  });

  describe('runtime', async () => {
    let db: Database;

    beforeEach(async () => {
      db = await open({ filename: ':memory:', driver: sqlite3.Database });
      await db.exec('PRAGMA foreign_keys = ON;');
    });

    it('should not drop child data when renaming parent table', async () => {
      fromSchema = `
      CREATE TABLE parent (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT
      );

      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
      );

      CREATE TABLE child2 (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        type TEXT,
        FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
      );

      CREATE TABLE child3 (
        id INTEGER PRIMARY KEY,
        child_id INTEGER,
        description TEXT,
        FOREIGN KEY (child_id) REFERENCES child(id) ON DELETE CASCADE
      );
    `;

      toSchema = `
      CREATE TABLE parent (
        id INTEGER PRIMARY KEY,
        status TEXT
      );

      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
      );

      CREATE TABLE child2 (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER,
        type TEXT,
        FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
      );

      CREATE TABLE child3 (
        id INTEGER PRIMARY KEY,
        child_id INTEGER,
        description TEXT,
        FOREIGN KEY (child_id) REFERENCES child(id) ON DELETE CASCADE
      );
    `;

      const migration = await migrateSchemas(fromSchema, toSchema);
      sql = migration.sql();

      expect(sql).toContain('PRAGMA defer_foreign_keys = ON;');
      expect(sql).toContain('PRAGMA defer_foreign_keys = OFF;');
      expect(sql).toContain('RENAME TO parent_old');
      expect(sql).toContain('INSERT INTO parent');
      expect(sql).toContain('DROP TABLE parent_old');

      await db.exec(fromSchema);

      await db.exec(`
      INSERT INTO parent (id, name, status) VALUES (1, 'Parent 1', 'active');
      INSERT INTO parent (id, name, status) VALUES (2, 'Parent 2', 'inactive');
      INSERT INTO parent (id, name, status) VALUES (3, 'Parent 3', 'active');
      INSERT INTO child (id, parent_id) VALUES (1, 1);
      INSERT INTO child (id, parent_id) VALUES (2, 1);
      INSERT INTO child (id, parent_id) VALUES (3, 2);
      INSERT INTO child (id, parent_id) VALUES (4, 3);
      INSERT INTO child (id, parent_id) VALUES (5, 3);
      INSERT INTO child2 (id, parent_id, type) VALUES (1, 1, 'type_a');
      INSERT INTO child2 (id, parent_id, type) VALUES (2, 2, 'type_b');
      INSERT INTO child2 (id, parent_id, type) VALUES (3, 2, 'type_a');
      INSERT INTO child2 (id, parent_id, type) VALUES (4, 3, 'type_c');
      INSERT INTO child3 (id, child_id, description) VALUES (1, 1, 'desc_1');
      INSERT INTO child3 (id, child_id, description) VALUES (2, 2, 'desc_2');
      INSERT INTO child3 (id, child_id, description) VALUES (3, 4, 'desc_3');
      INSERT INTO child3 (id, child_id, description) VALUES (4, 5, 'desc_4');
      `);

      await db.exec(sql);

      const rows = await db.all('SELECT * FROM parent');
      expect(rows).toEqual([
        { id: 1, status: 'active' },
        { id: 2, status: 'inactive' },
        { id: 3, status: 'active' },
      ]);

      const childRows = await db.all('SELECT * FROM child');
      expect(childRows).toEqual([
        { id: 1, parent_id: 1 },
        { id: 2, parent_id: 1 },
        { id: 3, parent_id: 2 },
        { id: 4, parent_id: 3 },
        { id: 5, parent_id: 3 },
      ]);

      const child2Rows = await db.all('SELECT * FROM child2');
      expect(child2Rows).toEqual([
        { id: 1, parent_id: 1, type: 'type_a' },
        { id: 2, parent_id: 2, type: 'type_b' },
        { id: 3, parent_id: 2, type: 'type_a' },
        { id: 4, parent_id: 3, type: 'type_c' },
      ]);

      const child3Rows = await db.all('SELECT * FROM child3');
      expect(child3Rows).toEqual([
        { id: 1, child_id: 1, description: 'desc_1' },
        { id: 2, child_id: 2, description: 'desc_2' },
        { id: 3, child_id: 4, description: 'desc_3' },
        { id: 4, child_id: 5, description: 'desc_4' },
      ]);
    });
  });
});
