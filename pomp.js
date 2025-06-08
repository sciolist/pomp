#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readdir, mkdir, readFile } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { Client } from 'pg';

const EDITOR = process.env.EDITOR || 'vi';
const WD = process.env.POMP_WD || './migrations';

async function newOperation(args) {
  await mkdir(WD, { recursive: true });
  let date = new Date();
  let fmt = String(date.getFullYear())
    + String(date.getMonth()).padStart(2, '0')
    + String(date.getDate()).padStart(2, '0')
    + String(date.getHours()).padStart(2, '0')
    + String(date.getMinutes()).padStart(2, '0')
    + String(date.getSeconds()).padStart(2, '0');
  const name = (args || []).join(' ').replace(/[^a-zA-Z0-9]/g, '-');
  if (name) {
    fmt += '-' + name;
  }
  const fullpath = resolve(WD, fmt) + '.sql';
  console.log(`created file ${fullpath}`);
  spawnSync(EDITOR, [fullpath], { stdio: 'inherit' });
}

async function runQuery(text) {
    const client = new Client({
        connectionString: process.env.POSTGRES_URL
    });
    await client.connect();
    try {
        //console.error(text);
        return await client.query(text);
    } catch(ex) {
        if (!ex.routine) throw ex;
        console.error(`${ex.severity} ${ex.code}: ${ex.message}`);
        console.error('');
        console.error(ex.where);
        process.exit(2);
    } finally {
        await client.end();
    }
}

async function ensurePompTables() {
    await runQuery(`
    SET client_min_messages TO WARNING;
    CREATE SCHEMA IF NOT EXISTS pomp;
    CREATE TABLE IF NOT EXISTS pomp.versions
    (
        version bigint, 
        created_at timestamp,
        CONSTRAINT _pomp_version_pk PRIMARY KEY (version)
    ) WITH (OIDS = FALSE);
    `);
}

async function listRemoteMigrations() {
    await ensurePompTables();
    const result = await runQuery('select version from pomp.versions order by version');
    return result.rows.map(r => Number(r.version));
}

async function listLocalMigrations() {
    let files = [];
    const versions = [];
    try {
        files = await readdir(WD);
    } catch(ex) {
        if (ex.code === 'ENOENT') {
            return files;
        }
        throw ex;
    }
    for (const file of files) {
        if (extname(file) !== '.sql') continue;
        const name = basename(file, '.sql');
        const version = name.match(/^[0-9]+/);
        if (!version) continue;
        versions.push([Number(version[0]), resolve(WD, file)]);
    }
    versions.sort((a, b) => a[0] - b[0]);
    for (let i=1; i<versions.length; ++i) {
        if (versions[i][0] === versions[i - 1][0]) {
            console.error(`Error - These migrations have the same version number:`);
            console.error(`${versions[i - 1][1]}`);
            console.error(`${versions[i][1]}`);
            process.exit(1);
        }
    }
    return versions;
}

async function pendingMigrations() {
    const local = await listLocalMigrations();
    const remote = await listRemoteMigrations();
    let j = 0;
    let pending = [];
    for (let i=0; i<local.length;) {
        if (local[i][0] === remote[j]) {
            i += 1;
            j += 1;
            continue;
        } else if (local[i][0] > remote[j]) {
            console.error(`Warning - migration ${remote[j]} not found locally`);
            j += 1;
            continue;
        } else {
            pending.push(local[i]);
            i += 1;
        }
    }
    return pending;
}

async function runMigration(number, fileName) {
    const fileData = await readFile(fileName, 'utf-8');
    const query = `DO LANGUAGE 'plpgsql' $$BEGIN
${fileData}
;
END$$
    `;
    await runQuery(query);
    await runQuery(`INSERT INTO pomp.versions (version, created_at) VALUES(${Number(number)}, NOW()) ON CONFLICT (version) DO NOTHING`);
}

async function runOperation(args) {
    const pending = await pendingMigrations();
    for (const migration of pending) {
        console.log(`Running migration file ${migration[1]}`);
        await runMigration(migration[0], migration[1]);
    }
    console.log(`All local migrations exist on remote`);
}

async function versionOperation() {
    const localVersion = (await listLocalMigrations()).pop();
    const remoteVersion = (await listRemoteMigrations()).pop();
    if (localVersion && localVersion[0] === remoteVersion) {
        console.log(`Latest local and remote version is ${localVersion[0]}`);
        return;
    }
    if (localVersion) {
        console.log(`Latest local version is ${localVersion[0]}`);
    } else {
        console.log(`No local version files found`);
    }
    if (remoteVersion) {
        console.log(`Latest remote version is ${remoteVersion}`);
    } else {
        console.log(`No remote version found`);
    }
}

async function skipOperation(args) {
    const count = Number(args[0] ?? 1);
    const pending = await pendingMigrations();
    if (pending.length < count) {
        console.error(`Error - not enough pending migrations left to skip, max ${pending.length}, requested ${count}`);
        process.exit(1);
    }

    for (let i=0; i<count; ++i) {
        const version = (pending.shift())[0];
        console.log(`Skipping migration ${version}`);
        await runQuery(`insert into pomp.versions (version,created_at) values (${Number(version)},NOW()) on conflict do nothing`)
    }
}

async function helpOperation(isHelpCommand, args) {
    const output = isHelpCommand ? console.log : console.error;
    output(`Usage: pomp <command> [<args>]

COMMANDS
  new [name]     Create a new migration with supplied name
  run            Apply pending migrations
  version        Prints current database and local version
  skip [n]       Skip a specific number of migrations
  help           Show this version text

ENVIRONMENT
  POMP_WD        Folder path with sql migrations
  POSTGRES_URL   Database connection string, also supports default psql environment variables
`);
    process.exit(isHelpCommand ? 0 : 1);
}

const operation = String(process.argv[2]).toLowerCase();
switch (operation) {
    case 'new':
        await newOperation(process.argv.slice(3));
        break;
    case 'run':
        await runOperation(process.argv.slice(3));
        break;
    case 'skip':
        await skipOperation(process.argv.slice(3));
        break;
    case 'version':
        await versionOperation(process.argv.slice(3));
        break;
    default:
        await helpOperation(operation === 'help', process.argv.slice(3));
        break;
}
console.log('');
