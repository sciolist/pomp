
/**
 * @typedef {Object} PompOptions
 * @property {(text: string) => Promise<any[]>} runSqlQuery - Execute an SQL query as text, return any results as an array of rows
 * @property {() => Promise<string>} listLocalMigrations - Return a list of local migration file names
 */

/** Portable One-Way Migrations for Postgres */
export class Pomp {
    /**
     * @param {PompOptions} options
     */
    constructor(options) {
        if (!options) throw new Error('Missing required argument "options"');
        if (!options.listLocalMigrations) {
            throw new Error('Missing option "listLocalMigrations"');
        }
        if (!options.runSqlQuery) {
            throw new Error('Missing option "runSqlQuery"');
        }
        this.options = options;
    }

    /**
     * List all local migrations.
     * 
     * @returns {Promise<Array<{ version: number, name: string }>>} List of migrations with their parsed version number.
     */
    async listLocalMigrations() {
        const versions = await this.options.listLocalMigrations();
        const results = [];
        const seen = new Set();
        for (const pathName of versions) {
            const name = pathName.split(/\//).at(-1);
            const version = name.match(/^[0-9]+/);
            if (!version) continue;
            if (seen.has(Number(version))) {
                throw new Error(`Duplicate local migration versions found - ${versions[i].version}`);
            }
            seen.add(Number(version));
            results.push({ version: Number(version), name: pathName });
        }
        results.sort((a, b) => a.version - b.version);
        return results;
    }

    /**
     * Run a single migration and mark it as completed.
     * 
     * @param {number} version - Migration version number
     * @param {string} queryText - Migration SQL body
     * @returns {Promise}
     */
    async runMigration(version, queryText) {
        const query = `DO LANGUAGE 'plpgsql' $$BEGIN
${queryText.trim().replace(/;$/, '') || 'perform 1'};
END$$`;
        await this.options.runSqlQuery(query);
        await this.options.runSqlQuery(`INSERT INTO pomp.versions (version, created_at) VALUES(${Number(version)}, NOW()) ON CONFLICT (version) DO NOTHING`);
    }

    /**
     * Run all pending migrations.
     * 
     * @param {(name: string) => Promise<string>} readFile - Takes a migration name and returns the SQL body of that migration
     * @returns {Promise}
     */
    async runMigrations(readFile) {
        const pending = await this.pendingMigrations();
        for (const p of pending) {
            const data = await readFile(p.name);
            await this.runMigration(p.version, data);
        }
    }
    
    /**
     * Find the latest local and remote version numbers.
     * 
     * @returns {Promise<{ localVersion: number, remoteVersion: number }>}
     */
    async latestVersions() {
        const localVersion = (await this.listLocalMigrations()).pop();
        const remoteVersion = (await this.listRemoteMigrations()).pop();
        return {
            localVersion: localVersion?.version,
            remoteVersion: remoteVersion?.version
        };
    }

    /**
     * Make a list of all local migrations that have not been run yet.
     * 
     * @returns {Promise<Array<{ version: number, name: string }>>}
     */
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

    /**
     * Skip a single migration version, marking it as complete without running it.
     * 
     * @param {number} version - The migration version number to skip
     * @returns {Promise}
     */
    async skipMigration(version) {
        await this.options.runSqlQuery(`insert into pomp.versions (version,created_at) values (${Number(version)},NOW()) on conflict do nothing`)
    }

    /**
     * Ensure the table structure for Pomp exists in the database.
     * 
     * @returns {Promise}
     */
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

    /**
     * List all migration versions that exist in the database
     * 
     * @returns {Promise<Array<{ version: number }>>}
     */
    async listRemoteMigrations() {
        await this.createTables();
        const result = await this.options.runSqlQuery('select version from pomp.versions order by version');
        return result.map(r => ({ version: Number(r.version) }));
    }
}
