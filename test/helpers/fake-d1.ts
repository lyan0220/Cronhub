// 测试用内存 D1：只支持本项目用到的 SQL 语句（正则匹配）。
type Row = Record<string, unknown>;

export class FakeD1 {
  jobs: Row[] = [];
  accounts: Row[] = [];
  runs: Row[] = [];
  lastRowId = 0;

  prepare(sql: string) {
    return new FakeStmt(this, sql);
  }
}

class FakeStmt {
  private params: unknown[] = [];
  constructor(private db: FakeD1, private sql: string) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    const rows = this.exec() as Row[]; // first() 只用于 SELECT，exec 必返回数组
    return (rows.length ? (rows[0] as T) : null);
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.exec() as T[] };
  }
  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const r = this.exec();
    const changes = typeof r === "number" ? r : r.length;
    return { meta: { changes, last_row_id: this.db.lastRowId } };
  }

  private exec(): Row[] | number {
    const s = this.sql.replace(/\s+/g, " ").trim();
    const p = this.params as Array<Record<string, unknown> & number>;
    const db = this.db;

    // ---- scheduler ----
    if (/SELECT \* FROM jobs WHERE enabled=1 AND next_run_at<=\?/.test(s))
      return db.jobs
        .filter((j) => j.enabled === 1 && (j.next_run_at as number) <= p[0])
        .sort((a, b) => (a.next_run_at as number) - (b.next_run_at as number))
        .slice(0, 50);
    if (/SELECT \* FROM jobs WHERE id=\?/.test(s))
      return db.jobs.filter((j) => j.id === p[0]);
    if (/SELECT \* FROM accounts WHERE id=\?/.test(s))
      return db.accounts.filter((a) => a.id === p[0]);
    if (/INSERT INTO runs /.test(s)) {
      db.lastRowId = db.runs.length + 1;
      db.runs.push({
        id: db.lastRowId, job_id: p[0], triggered_at: p[1], source: p[2],
        status: p[3], http_status: p[4], error_message: p[5],
      });
      return 1;
    }
    if (/UPDATE jobs SET next_run_at=\?, updated_at=\? WHERE id=\? AND next_run_at=\? AND enabled=1/.test(s)) {
      let changes = 0;
      for (const j of db.jobs)
        if (j.id === p[2] && j.next_run_at === p[3] && j.enabled === 1) {
          j.next_run_at = p[0]; j.updated_at = p[1]; changes++;
        }
      return changes;
    }
    if (/UPDATE jobs SET last_run_at=\? WHERE id=\?/.test(s)) {
      for (const j of db.jobs) if (j.id === p[1]) j.last_run_at = p[0];
      return 1;
    }
    if (/UPDATE accounts SET status='invalid', updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[1]) { a.status = "invalid"; a.updated_at = p[0]; }
      return 1;
    }
    if (/DELETE FROM runs WHERE triggered_at < \?/.test(s)) {
      const before = db.runs.length;
      db.runs = db.runs.filter((r) => (r.triggered_at as number) >= p[0]);
      return before - db.runs.length;
    }

    // ---- accounts 路由 ----
    if (/SELECT \* FROM accounts ORDER BY id/.test(s)) return [...db.accounts].sort((a, b) => (a.id as number) - (b.id as number));
    if (/INSERT INTO accounts/.test(s)) {
      db.lastRowId = db.accounts.length + 1;
      db.accounts.push({
        id: db.lastRowId, name: p[0], github_login: p[1], token_encrypted: p[2],
        token_fingerprint: p[3], status: p[4], last_verified_at: p[5], created_at: p[6], updated_at: p[7],
      });
      return 1;
    }
    if (/UPDATE accounts SET name=\?, token_encrypted=\?, token_fingerprint=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[4]) {
        a.name = p[0]; a.token_encrypted = p[1]; a.token_fingerprint = p[2]; a.updated_at = p[3];
      }
      return 1;
    }
    if (/UPDATE accounts SET github_login=\?, status=\?, last_verified_at=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[4]) {
        a.github_login = p[0]; a.status = p[1]; a.last_verified_at = p[2]; a.updated_at = p[3];
      }
      return 1;
    }
    if (/UPDATE accounts SET name=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[2]) { a.name = p[0]; a.updated_at = p[1]; }
      return 1;
    }
    if (/DELETE FROM runs WHERE job_id IN \(SELECT id FROM jobs WHERE account_id=\?\)/.test(s)) {
      const jobIds = db.jobs.filter((j) => j.account_id === p[0]).map((j) => j.id);
      const before = db.runs.length;
      db.runs = db.runs.filter((r) => !jobIds.includes(r.job_id));
      return before - db.runs.length;
    }
    if (/DELETE FROM jobs WHERE account_id=\?/.test(s)) {
      const before = db.jobs.length;
      db.jobs = db.jobs.filter((j) => j.account_id !== p[0]);
      return before - db.jobs.length;
    }
    if (/DELETE FROM accounts WHERE id=\?/.test(s)) {
      const before = db.accounts.length;
      db.accounts = db.accounts.filter((a) => a.id !== p[0]);
      return before - db.accounts.length;
    }

    // ---- jobs 路由 ----
    if (/SELECT j\.\*, a\.name AS account_name FROM jobs j LEFT JOIN accounts a/.test(s))
      return [...db.jobs]
        .sort((a, b) => (b.id as number) - (a.id as number))
        .map((j) => ({ ...j, account_name: db.accounts.find((a) => a.id === j.account_id)?.name ?? null }));
    if (/INSERT INTO jobs/.test(s)) {
      db.lastRowId = db.jobs.length + 1;
      db.jobs.push({
        id: db.lastRowId, name: p[0], account_id: p[1], repo: p[2], trigger_type: p[3],
        workflow_id: p[4], event_type: p[5], ref: p[6], inputs_json: p[7], schedule_json: p[8],
        enabled: p[9], next_run_at: p[10], created_at: p[11], updated_at: p[12], last_run_at: null,
      });
      return 1;
    }
    if (/UPDATE jobs SET name=\?, account_id=\?, repo=\?, trigger_type=\?, workflow_id=\?, event_type=\?, ref=\?, inputs_json=\?, schedule_json=\?, enabled=\?, next_run_at=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const j of db.jobs) if (j.id === p[12]) {
        [j.name, j.account_id, j.repo, j.trigger_type, j.workflow_id, j.event_type, j.ref,
         j.inputs_json, j.schedule_json, j.enabled, j.next_run_at, j.updated_at] = p;
      }
      return 1;
    }
    if (/UPDATE jobs SET enabled=\?, next_run_at=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const j of db.jobs) if (j.id === p[3]) { j.enabled = p[0]; j.next_run_at = p[1]; j.updated_at = p[2]; }
      return 1;
    }
    if (/DELETE FROM runs WHERE job_id=\?/.test(s)) {
      const before = db.runs.length;
      db.runs = db.runs.filter((r) => r.job_id !== p[0]);
      return before - db.runs.length;
    }
    if (/DELETE FROM jobs WHERE id=\?/.test(s)) {
      const before = db.jobs.length;
      db.jobs = db.jobs.filter((j) => j.id !== p[0]);
      return before - db.jobs.length;
    }
    if (/SELECT id FROM accounts WHERE id=\?/.test(s)) return db.accounts.filter((a) => a.id === p[0]).map((a) => ({ id: a.id }));

    // ---- runs 路由 ----
    if (/SELECT COUNT\(\*\) AS cnt FROM runs/.test(s)) {
      const rows = this.filterRuns();
      return [{ cnt: rows.length }];
    }
    if (/SELECT r\.\*, j\.name AS job_name FROM runs r/.test(s)) {
      const rows = this.filterRuns()
        .sort((a, b) => (b.triggered_at as number) - (a.triggered_at as number))
        .slice(p[p.length - 2] as number, (p[p.length - 2] as number) + (p[p.length - 1] as number));
      return rows.map((r) => ({ ...r, job_name: db.jobs.find((j) => j.id === r.job_id)?.name ?? null }));
    }

    // ---- stats ----
    if (/SELECT \(SELECT COUNT\(\*\) FROM accounts\) AS accounts/.test(s)) {
      // 绑定顺序 [dayStart, now-24h]
      return [{
        accounts: db.accounts.length,
        total_jobs: db.jobs.length,
        enabled_jobs: db.jobs.filter((j) => j.enabled === 1).length,
        today_runs: db.runs.filter((r) => (r.triggered_at as number) >= p[0]).length,
        failed_24h: db.runs.filter((r) => (r.triggered_at as number) >= p[1] && r.status === "failed").length,
      }];
    }

    throw new Error(`FakeD1 不支持的 SQL: ${s}`);
  }

  private filterRuns(): Row[] {
    const s = this.sql.replace(/\s+/g, " ").trim();
    const db = this.db;
    if (/WHERE r\.job_id=\?/.test(s)) return db.runs.filter((r) => r.job_id === this.params[0]);
    return [...db.runs];
  }
}
