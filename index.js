async function runSqlQuery(text) {
    const pg = await import('postgres');
    const client = pg.default(process.env.POSTGRES_URL);
    try {
        const result = await client.unsafe(text);
        return result;
    } finally {
        await client.end();
    }
}

export class Pomp {
    constructor(options) {
        if (!options) throw new Error('Missing required argument "options"');
        if (!options.listLocalMigrations) {
            throw new Error('Missing option "listLocalMigrations"');
        }
        if (!options.runSqlQuery) {
            options.runSqlQuery = runSqlQuery;
        }
        this.options = options;
    }

    async listLocalMigrations() {
        const versions = await this.options.listLocalMigrations();
        versions.sort((a, b) => a.version - b.version);
        let duplicates = [];
        for (let i = 1; i < versions.length; ++i) {
            if (versions[i].version === versions[i - 1].version) {
                duplicates.push(versions[i].version);
            }
        }
        if (duplicates.length) {
            const err = new Error(`Duplicate local migration versions found`);
            err.duplicates = err;
            throw err;
        }
        return versions;
    }

    async runMigration(version, queryText) {
        const query = `DO LANGUAGE 'plpgsql' $$BEGIN
${queryText.trim().replace(/;$/, '')};
END$$`;
        await this.options.runSqlQuery(query);
        await this.options.runSqlQuery(`INSERT INTO pomp.versions (version, created_at) VALUES(${Number(version)}, NOW()) ON CONFLICT (version) DO NOTHING`);
    }

    async runMigrations(readFile) {
        const pending = await this.pendingMigrations();
        for (const p of pending) {
            const data = await readFile(p.name);
            await this.runMigration(p.version, data);
        }
    }
    
    async latestVersions() {
        const localVersion = (await this.listLocalMigrations()).pop();
        const remoteVersion = (await this.listRemoteMigrations()).pop();
        return {
            localVersion: localVersion?.version,
            remoteVersion: remoteVersion?.version
        };
    }

    async pendingMigrations() {
        const local = await this.listLocalMigrations();
        const remote = await this.listRemoteMigrations();
        let j = 0;
        let pending = [];
        for (let i = 0; i < local.length;) {
            if (local[i].version === remote[j]?.version) {
                i += 1;
                j += 1;
                continue;
            } else if (local[i].version > remote[j]?.version) {
                j += 1;
                continue;
            } else {
                pending.push(local[i]);
                i += 1;
            }
        }
        return pending;
    }

    async skipMigration(version) {
        await runSqlQuery(`insert into pomp.versions (version,created_at) values (${Number(version)},NOW()) on conflict do nothing`)
    }

    async createTables() {
        await this.options.runSqlQuery(`CREATE SCHEMA IF NOT EXISTS pomp;`);
        await this.options.runSqlQuery(`CREATE TABLE IF NOT EXISTS pomp.versions
        (
            version bigint, 
            created_at timestamp,
            CONSTRAINT _pomp_version_pk PRIMARY KEY (version)
        ) WITH (OIDS = FALSE);
        `);
    }

    async listRemoteMigrations() {
        await this.createTables();
        const result = await this.options.runSqlQuery('select version from pomp.versions order by version');
        return result.map(r => ({ version: Number(r.version) }));
    }
}
