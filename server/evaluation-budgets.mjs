import {createEvaluationBudgetMethods} from '../worker/evaluation-budgets.mjs';

export class SqliteEvaluationBudgets {
  constructor(db, options = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') throw new TypeError('SQLite database required');
    db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL); INSERT OR IGNORE INTO metadata(key,value) VALUES ('revision',0);");
    const transaction = operation => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };
    const adapter = {
      read: async key => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value ?? null,
      create: async (key, raw, limit) => transaction(() => {
        const result = db.prepare(`INSERT INTO metadata(key,value) SELECT ?,? WHERE
          (SELECT COUNT(*) FROM metadata WHERE key GLOB 'evaluation_budget:*') < ?
          ON CONFLICT(key) DO NOTHING`).run(key, raw, limit);
        if (result.changes) db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();
        return result.changes === 1;
      }),
      compareAndSwap: async (key, prior, next) => transaction(() => {
        const result = db.prepare('UPDATE metadata SET value=? WHERE key=? AND value=?').run(next, key, prior);
        if (result.changes) db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();
        return result.changes === 1;
      }),
    };
    Object.assign(this, createEvaluationBudgetMethods(adapter, options));
  }
}
