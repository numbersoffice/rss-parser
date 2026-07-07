import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`request_logs\` ADD \`fetch_id\` text;`)
  await db.run(sql`CREATE INDEX \`request_logs_fetch_id_idx\` ON \`request_logs\` (\`fetch_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`request_logs_fetch_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`request_logs\` DROP COLUMN \`fetch_id\`;`)
}
