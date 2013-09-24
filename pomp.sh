#!/bin/bash
# POMP (postgres one-way migration process)

set -e
NAME=$0
POMP_WD=${POMP_WD:="$(pwd)/migrations"}

function exec_help {
  echo "Usage: pomp [-d <path>] <command> [<args>]"

  cat << HERE_EOF

OPTIONS
  -h       Display this help message
  -d<path> Specifies sql migration folder

COMMANDS
  new      Open a new migration with supplied name
  run      Executes pending migrations
  verify   Detect invalid migration files
  version  Prints current database version
  skip     Skip a specific version

ENVIRONMENT
  POMP_WD   Folder path with sql migrations

HERE_EOF
}

# new      Open a new migration with supplied name
function exec_new {
  mkdir -p "$POMP_WD" && cd "$POMP_WD"
  TIMESTAMP=$(date +"%Y%m%d%H%M%S")
  NAME=$(echo "$@" | sed -e 's/[^a-zA-Z0-9]/-/g')
  [ ! "$NAME" == "" ] && TIMESTAMP+="-$NAME"
  exec ${EDITOR:=vi} "$TIMESTAMP.sql"
}

# run      Executes pending migrations
function exec_run {
  [ $# -gt 0 ] && { FORCE=1 run_sql_files "$@"; exit 0; }
  local IFS=$'\n'
  VERSION=$(get_version)
  FILE_NAMES=($(wd_names | awk -F'[^0-9]' -v V="$VERSION" -v D="$POMP_WD" '{ if($1>V) print D"/"$0 }' | sort))
  run_sql_files "${FILE_NAMES[@]}" || exit 8
  echo "All done!"
  exit 0
}

function exec_skip {
  for V in $@
  do
    SKIP=$(echo $V | to_number | sed -e "s/'/''/g" -e 's/\\/\\\\/g')
    echo "Skipping: $SKIP"
    echo 'INSERT INTO pomp.versions SELECT :version' | sql --quiet -v version="$SKIP" || exit 8
  done
}

# verify   Detect invalid migration files
function exec_verify {
  create_pomp_tables

  ## File version numbers should be unique
  VERSION=$(get_version)
  LOCAL_DUPES=$(wd_names | awk -F'[^0-9]' "{ print \$1 }" | uniq -d)
  if [ "$LOCAL_DUPES" != "" ]
  then
    err "Error - local duplicates"
    err "You have duplicate versions of these migrations:"
    for MIGRATION in $LOCAL_DUPES
    do
      err "- $LOCAL_DUPES"
    done
    exit 2
  fi

  ## All local files older than the database version should exist in the database
  OLD_LOCAL_VERSIONS=($(wd_names | to_number | awk -v V="$VERSION" '{ if ($1<=V) print $1 }'))

  PG_ARRAY=$(IFS=','; (echo "${OLD_LOCAL_VERSIONS[*]}"))
  DIFF_VERSIONS=$(sql --quiet -tv locals="'{$PG_ARRAY}'" << HERE_DOC
    SELECT unnest(:locals::bigint[]) AS v INTO TEMP TABLE _local;
    SELECT v FROM _local WHERE V NOT IN (SELECT version FROM pomp.versions);
HERE_DOC
)
  
  if [ "$DIFF_VERSIONS" != "" ]
  then
    err "Error - incorrect version state"
    err "You have new migrations older than the database version"
    err "Latest database version:"
    err "- $VERSION"
    err "Local-only migrations:"
    for MIGRATION in $DIFF_VERSIONS
    do
      err "- $MIGRATION"
    done
    exit 3
  fi
}

function get_version {
  sql -tc "SELECT COALESCE(MAX(version), 0) FROM pomp.versions" | sed -e "s/[^0-9]*//g"
}

function sql { psql --single-transaction -xv ON_ERROR_STOP=1 "$@"; }
function wd_names { find "$POMP_WD" -name "*.sql" -type f | awk -F'/' '{ print $NF }'; }
function to_number { awk -F'/' '{ print $NF }' | awk -F'[^0-9]' '{ print $1 }'; }
function err { echo -e "\033[31m*\033[0m $@" >&2; }

function create_pomp_tables {
  sql 1>/dev/null <<_DOC
  SET client_min_messages TO WARNING;
  CREATE SCHEMA IF NOT EXISTS pomp;
  CREATE TABLE IF NOT EXISTS pomp.versions
  (
     version bigint, 
     CONSTRAINT _pomp_version_pk PRIMARY KEY (version)
  ) 
  WITH (
    OIDS = FALSE
  );
_DOC
}

function run_sql_files {
  for FN in "$@"
  do
    export NR="$(echo "$FN" | to_number)"
    echo "Running: $FN"
    SQL="$(
      echo 'DO LANGUAGE 'plpgsql' $$'
      echo 'BEGIN'
      echo "-- POMP -- VERSION $NR"

      echo "INSERT INTO pomp.versions SELECT $NR"
      [ ! $FORCE == "" ] && echo "WHERE NOT EXISTS(SELECT 1 FROM pomp.versions WHERE version = $NR)"
      echo ";"
      cat "$FN"
      echo 'END$$;'
    )"
    sql -c "$SQL" 1>/dev/null || exit 8
  done
}

# Make sure sql exists..
command -v psql >/dev/null 2>&1 || {
  echo "$NAME: psql not found in path." 1>&2
  exit 9;
}

# process command line arguments
while getopts "d:h" OPTCHAR
do
  case "$OPTCHAR" in
    h) exec_help; exit 0 ;;
    d) POMP_WD=$OPTARG ;;
    *) exec_help 1 1>&2; exit 1 ;;
  esac
done

[ $# -eq 0 ] && { exec_help >&2; exit 1; }
CMD="$1";shift
case "$CMD" in
  new) exec_new "$@" && exit ;;
  run) exec_verify && exec_run "$@" && exit ;;
  version) exec_verify && get_version && exit ;;
  verify) exec_verify && exit ;;
  skip) exec_skip "$@" && exit ;;
  init-pomp) create_pomp_tables && "$@" && exit ;;
  *) echo "$NAME: illegal command -- $CMD" 1>&2; exec_help 1>&2; exit 1 ;;
esac

