#!/bin/sh
set -e

# Applies any migration in prisma/migrations that this database has not seen.
# Safe to run on every boot: it is a no-op once the DB is up to date.
echo "Running database migrations..."
pnpm exec prisma migrate deploy

# The RAG store (@langchain/pgvector) and mem0 both need the vector extension.
# CREATE EXTENSION is idempotent and needs superuser, which the compose
# postgres user has.
echo "Ensuring pgvector extension..."
node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query('CREATE EXTENSION IF NOT EXISTS vector'))
  .then(() => c.end())
  .then(() => console.log('pgvector ready'))
  .catch((e) => { console.error(e); process.exit(1); });
"

exec "$@"
