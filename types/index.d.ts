/**
 * @typedef {Object} PompOptions
 * @property {(text: string) => Promise<any[]>} runSqlQuery - Execute an SQL query as text, return any results as an array of rows
 * @property {() => Promise<string[]>} listLocalMigrations - Return a list of local migration file names
 */
/** Portable One-Way Migrations for Postgres */
export class Pomp {
    /**
     * @param {PompOptions} options
     */
    constructor(options: PompOptions);
    options: PompOptions;
    /**
     * List all local migrations.
     *
     * @returns {Promise<Array<{ version: number, name: string }>>} List of migrations with their parsed version number.
     */
    listLocalMigrations(): Promise<Array<{
        version: number;
        name: string;
    }>>;
    /**
     * Run a single migration and mark it as completed.
     *
     * @param {number} version - Migration version number
     * @param {string} queryText - Migration SQL body
     * @returns {Promise}
     */
    runMigration(version: number, queryText: string): Promise<any>;
    /**
     * Run all pending migrations.
     *
     * @param {(name: string) => Promise<string>} readFile - Takes a migration name and returns the SQL body of that migration
     * @returns {Promise}
     */
    runMigrations(readFile: (name: string) => Promise<string>): Promise<any>;
    /**
     * Find the latest local and remote version numbers.
     *
     * @returns {Promise<{ localVersion: number, remoteVersion: number }>}
     */
    latestVersions(): Promise<{
        localVersion: number;
        remoteVersion: number;
    }>;
    /**
     * Make a list of all local migrations that have not been run yet.
     *
     * @returns {Promise<Array<{ version: number, name: string }>>}
     */
    pendingMigrations(): Promise<Array<{
        version: number;
        name: string;
    }>>;
    /**
     * Skip a single migration version, marking it as complete without running it.
     *
     * @param {number} version - The migration version number to skip
     * @returns {Promise}
     */
    skipMigration(version: number): Promise<any>;
    /**
     * Ensure the table structure for Pomp exists in the database.
     *
     * @returns {Promise}
     */
    createTables(): Promise<any>;
    /**
     * List all migration versions that exist in the database
     *
     * @returns {Promise<Array<{ version: number }>>}
     */
    listRemoteMigrations(): Promise<Array<{
        version: number;
    }>>;
}
export type PompOptions = {
    /**
     * - Execute an SQL query as text, return any results as an array of rows
     */
    runSqlQuery: (text: string) => Promise<any[]>;
    /**
     * - Return a list of local migration file names
     */
    listLocalMigrations: () => Promise<string[]>;
};
