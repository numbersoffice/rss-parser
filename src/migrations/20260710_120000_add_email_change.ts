import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Backing columns for the verified email-change flow: the address awaiting
  // confirmation and the single-use token + expiry behind its link. See
  // src/collections/Users.ts and src/app/(frontend)/verify-email-change.
  await db.run(sql`ALTER TABLE \`users\` ADD \`pending_email\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`email_change_token\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`email_change_token_expiry\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`pending_email\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`email_change_token\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`email_change_token_expiry\`;`)
}
