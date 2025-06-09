import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { normalizeSql } from './utils';

export interface MigrationStep {
  type: 'table' | 'index' | 'trigger' | 'view';
  name: string;
  statements: string[];
  deferForeignKeys?: boolean;
}

export class SqliteMigration {
  private _steps: MigrationStep[] = [];
  private _target: Database | null = null;

  get totalSteps(): number {
    return this._steps.length;
  }

  get steps(): MigrationStep[] {
    return [...this._steps];
  }

  private _generate(pretty = false) {
    const lines: string[] = [];

    const deferForeignKeys = this._steps.some(step => step.deferForeignKeys);
    if (deferForeignKeys) {
      lines.push('PRAGMA defer_foreign_keys = ON;');
      if (pretty) {
        lines.push('');
      }
    }

    for (const step of this._steps) {
      if (pretty) {
        lines.push(`-- ${step.type.toUpperCase()}: ${step.name}`);
      }
      for (const statement of step.statements) {
        const normalized = normalizeSql(statement);
        lines.push(normalized.endsWith(';') ? normalized : `${normalized};`);
      }
      if (pretty) {
        lines.push('');
      }
    }

    if (deferForeignKeys) {
      lines.push('PRAGMA defer_foreign_keys = OFF;');
    }

    return lines;
  }

  statements(): string[] {
    return this._generate(false);
  }

  sql(): string {
    return this._generate(true).join('\n');
  }

  async exec(sql: string) {
    const target = await this._acquireTarget();
    await target.exec(sql);
  }

  async prepare(schema: string) {
    const pristine = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });
    await pristine.exec(schema);

    const target = await this._acquireTarget();
    const recreatedTables = new Set<string>();
    await this._migrateTables(pristine, target, recreatedTables);
    await this._migrateObjects('index', pristine, target, recreatedTables);
    await this._migrateObjects('trigger', pristine, target, recreatedTables);
    await this._migrateObjects('view', pristine, target, recreatedTables);
  }

  private async _acquireTarget() {
    if (!this._target) {
      this._target = await open({
        filename: ':memory:',
        driver: sqlite3.Database,
      });
    }
    return this._target;
  }

  private async _isAddOnlyColumns(
    pristine: Database,
    current: Database,
    table: string
  ) {
    const newCols = await this._columns(pristine, table);
    const oldCols = await this._columns(current, table);
    const removed = oldCols.filter(
      col => !newCols.some(newCol => newCol.name === col.name)
    );
    const added = newCols.filter(
      col => !oldCols.some(oldCol => oldCol.name === col.name)
    );
    const safe =
      removed.length === 0 &&
      added.every(col => col.dflt_value !== null || col.notnull === 0);
    return { addOnly: safe, added };
  }

  private async _migrateTables(
    pristine: Database,
    target: Database,
    recreatedTables: Set<string>
  ) {
    const foreignKeyGraph = await this._buildForeignKeyGraph(pristine);
    const reverseForeignKeyGraph = this._reverseGraph(foreignKeyGraph);
    const currentTables = await this._objects(target, 'table');
    const newTables = await this._objects(pristine, 'table');

    const removed = [...currentTables.keys()].filter(k => !newTables.has(k));
    const added = [...newTables.keys()].filter(k => !currentTables.has(k));
    const modified = [...newTables.keys()].filter(
      k =>
        currentTables.has(k) &&
        normalizeSql(currentTables.get(k)!) !== normalizeSql(newTables.get(k)!)
    );

    const sorted = this._topologicalSort(
      [...new Set([...modified, ...removed, ...added])],
      foreignKeyGraph
    );

    for (const table of sorted) {
      if (removed.includes(table)) {
        this._steps.push({
          type: 'table',
          name: table,
          statements: [`DROP TABLE ${table}`],
        });
      }
    }

    for (const table of sorted) {
      if (added.includes(table)) {
        const definition = newTables.get(table);
        if (!definition) {
          throw new Error(`Table ${table} not found in schema definitions.`);
        }
        this._steps.push({
          type: 'table',
          name: table,
          statements: [definition],
        });
      }
    }

    for (const table of sorted) {
      if (modified.includes(table)) {
        const { addOnly, added: addedCols } = await this._isAddOnlyColumns(
          pristine,
          target,
          table
        );
        if (addOnly) {
          const stmts = addedCols.map(col =>
            `ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type || ''}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value !== null ? ` DEFAULT ${col.dflt_value}` : ''}`.trim()
          );
          this._steps.push({ type: 'table', name: table, statements: stmts });
        } else {
          this._findDependentTables(table, reverseForeignKeyGraph, recreatedTables);
        }
      }
    }

    const recreationOrder = this._topologicalSort([...recreatedTables], foreignKeyGraph);
    if (recreationOrder.length > 0) {
      for (const table of recreationOrder) {
        this._steps.push({
          type: 'table',
          name: `migrating ${table} to new schema`,
          deferForeignKeys: true,
          statements: [`ALTER TABLE ${table} RENAME TO ${table}_old`],
        });
      }

      for (const table of recreationOrder) {
        const definition = newTables.get(table);
        if (!definition) {
          throw new Error(`Table ${table} not found in schema definitions.`);
        }
        this._steps.push({
          type: 'table',
          name: `preparing new ${table}`,
          statements: [definition],
        });
      }

      for (const table of recreationOrder) {
        const currentCols = await this._columns(target, table);
        const pristineCols = await this._columns(pristine, table);

        const commonCols = currentCols.filter(oldCol =>
          pristineCols.some(newCol => newCol.name === oldCol.name)
        );

        if (commonCols.length > 0) {
          this._steps.push({
            type: 'table',
            name: `copying data back to ${table}`,
            statements: [
              `INSERT INTO ${table} (${commonCols.map(c => c.name).join(', ')}) SELECT ${commonCols.map(c => c.name).join(', ')} FROM ${table}_old`,
            ],
          });
        }
      }

      const dropOrder = [...recreationOrder].reverse();
      for (const table of dropOrder) {
        this._steps.push({
          type: 'table',
          name: `dropping old ${table}`,
          statements: [`DROP TABLE ${table}_old`],
        });
      }
    }
  }

  private async _migrateObjects(
    type: 'index' | 'trigger' | 'view',
    pristine: Database,
    target: Database,
    recreatedTables: Set<string>
  ) {
    const extractTable = (sql: string): string => {
      const patterns = {
        index: /INDEX\s+\w+\s+ON\s+["`]?(\w+)["`]?/i,
        trigger: /ON\s+["`]?(\w+)["`]?/i,
        view: /CREATE\s+VIEW\s+\w+\s+AS\s+SELECT.*?\sFROM\s+["`]?(\w+)["`]?/is,
      };
      const match = sql.trim().toUpperCase().match(patterns[type]);
      return match?.[1]?.toLowerCase() ?? '';
    };

    const current = await this._objects(target, type);
    const fresh = await this._objects(pristine, type);

    const getDefinition = (name: string): string => {
      const definition = fresh.get(name);
      if (!definition) {
        throw new Error(`Object ${name} not found in schema definitions.`);
      }
      return definition;
    };

    const dropped = [...current.keys()].filter(k => !fresh.has(k));
    const added = [...fresh.keys()].filter(k => !current.has(k));
    const modified = [...fresh.keys()].filter(
      k =>
        current.has(k) &&
        (normalizeSql(current.get(k)!) !== normalizeSql(getDefinition(k)) ||
          recreatedTables.has(extractTable(getDefinition(k))))
    );

    for (const k of dropped) {
      this._steps.push({
        type,
        name: k,
        statements: [`DROP ${type.toUpperCase()} ${k}`],
      });
    }

    for (const k of added) {
      this._steps.push({ type, name: k, statements: [getDefinition(k)] });
    }

    for (const k of modified) {
      if (
        type === 'view' ||
        !recreatedTables.has(extractTable(getDefinition(k)))
      ) {
        this._steps.push({
          type,
          name: k,
          statements: [`DROP ${type.toUpperCase()} ${k}`],
        });
      }
      this._steps.push({ type, name: k, statements: [getDefinition(k)] });
    }
  }

  private async _buildForeignKeyGraph(db: Database) {
    const graph = new Map<string, Set<string>>();
    const tables = await this._objects(db, 'table');
    for (const tbl of tables.keys()) {
      const fks = await this._foreignKeys(db, tbl);
      for (const fk of fks) {
        if (!graph.has(fk.table.toLowerCase())) {
          graph.set(fk.table.toLowerCase(), new Set());
        }
        graph.get(fk.table.toLowerCase())!.add(tbl.toLowerCase());
      }
    }
    return graph;
  }

  private _reverseGraph(graph: Map<string, Set<string>>): Map<string, Set<string>> {
    const reversed = new Map<string, Set<string>>();
    for (const [node, dependencies] of graph) {
      for (const dependency of dependencies) {
        if (!reversed.has(dependency)) {
          reversed.set(dependency, new Set());
        }
        reversed.get(dependency)!.add(node);
      }
    }
    return reversed;
  }

  private _findDependentTables(
    table: string,
    reverseForeignKeyGraph: Map<string, Set<string>>,
    dependentTables: Set<string>
  ) {
    const visit = (currentTable: string) => {
      if (dependentTables.has(currentTable)) {
        return;
      }
      dependentTables.add(currentTable);
      for (const [childTable, referencedTables] of reverseForeignKeyGraph) {
        if (referencedTables.has(currentTable)) {
          visit(childTable);
        }
      }
    };
    visit(table.toLowerCase());
  }

  private _topologicalSort(
    tables: string[],
    foreignKeyGraph: Map<string, Set<string>>
  ): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const visit = (node: string) => {
      if (visited.has(node)) {
        return;
      }
      visited.add(node);
      for (const child of foreignKeyGraph.get(node) || []) {
        visit(child);
      }
      result.push(node);
    };
    for (const node of tables) {
      visit(node);
    }
    return result.reverse();
  }

  private async _objects(
    db: Database,
    type: 'index' | 'trigger' | 'view' | 'table'
  ) {
    const rows = await db.all<{ name: string; sql: string }[]>(
      'SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL AND name NOT LIKE "sqlite_%"',
      type
    );
    return new Map(rows.map(r => [r.name.toLowerCase(), r.sql]));
  }

  private async _foreignKeys(db: Database, table: string) {
    return db.all<
      {
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }[]
    >(`PRAGMA foreign_key_list(${table})`);
  }

  private async _columns(db: Database, table: string) {
    return db.all<
      {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: any;
        pk: number;
      }[]
    >(`PRAGMA table_info(${table})`);
  }
}
