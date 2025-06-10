#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readdir, mkdir, readFile } from 'node:fs/promises';
import path, { resolve } from 'node:path';
import { Pomp } from './index.js';
import pg from 'postgres';

const EDITOR = process.env.EDITOR || 'vi';
const WD = process.env.POMP_WD || './migrations';

async function runSqlQuery(text) {
    const client = pg(process.env.POSTGRES_URL, {
        onnotice: () => {}
    });
    try {
        const result = await client.unsafe(text);
        return result;
    } catch (ex) {
        if (!ex.routine) throw ex;
        console.error(`${ex.severity} ${ex.code}: ${ex.message}`);
        if (ex.where) console.error(`\n${ex.where}`);
        if (ex.hint) console.error(`\n${ex.hint}`);
        console.error('');
        process.exit(2);
    } finally {
        await client.end();
    }
}

const pomp = new Pomp({
    runSqlQuery,
    listLocalMigrations
});

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

async function listLocalMigrations() {
    try {
        return await readdir(WD);
    } catch(ex) {
        if (ex.code === 'ENOENT') {
            return [];
        }
        throw ex;
    }
}

async function runOperation(args) {
    const pending = await pomp.pendingMigrations();
    for (const migration of pending) {
        console.log(`Running migration file ${migration.name}`);
        const file = await readFile(path.resolve(WD, migration.name), 'utf-8');
        await pomp.runMigration(migration.version, file);
    }
    console.log(`All local migrations exist on remote`);
}

async function pendingOperation(args) {
    const versions = await pomp.pendingMigrations();
    if (!versions.length) {
        console.log('All migrations have been run');
        return;
    }
    for (const version of versions) {
        console.log(`${version.name}`);
    }
    console.log('');
    process.exit(1);
}

async function skipOperation(args) {
    for (let i=0; i<args.length; ++i) {
        const version = args[i];
        if (!version || isNaN(version)) {
            return helpOperation(false, []);
        }
    }
    for (let i=0; i<args.length; ++i) {
        const version = args[i];
        await pomp.skipMigration(version);
    }
}

async function versionOperation(args) {
    const versions = await pomp.latestVersions();
    if (versions.localVersion && versions.localVersion === versions.remoteVersion) {
        console.log(`Latest version on local and remote are ${versions.localVersion}`);
        return;
    }
    if (versions.localVersion) {
        console.log(`Latest local version is ${versions.localVersion}`);
    } else {
        console.log(`There are no local migration files`);
    }
    if (versions.remoteVersion) {
        console.log(`Latest remote version is ${versions.remoteVersion}`);
    } else {
        console.log(`There are no remote migrations`);
    }
}

async function helpOperation(isHelpCommand, args) {
    const output = isHelpCommand ? console.log : console.error;
    output(`Usage: pomp <command> [<args>]

COMMANDS
  new [name]     Create a new migration with supplied name
  run            Apply pending migrations
  version        Prints current database and local version
  pending        Prints the local migrations that do not exist in the databse
  skip [..v]     Skip specific migration versions
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
    case 'pending':
        await pendingOperation(process.argv.slice(3));
        break;
    default:
        await helpOperation(operation === 'help', process.argv.slice(3));
        break;
}
console.log('');
