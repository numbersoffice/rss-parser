import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`sources\` ADD \`profile_image_url\` text;`)
  await db.run(sql`ALTER TABLE \`sources\` ADD \`profile_image_id\` integer REFERENCES media(id);`)
  await db.run(sql`CREATE INDEX \`sources_profile_image_idx\` ON \`sources\` (\`profile_image_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_sources\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`type\` text DEFAULT 'instagram' NOT NULL,
  	\`handle\` text NOT NULL,
  	\`enabled\` integer DEFAULT true,
  	\`refresh_interval_minutes\` numeric DEFAULT 60,
  	\`last_fetched_at\` text,
  	\`last_fetch_status\` text,
  	\`last_fetch_error\` text,
  	\`last_fetch_debug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`INSERT INTO \`__new_sources\`("id", "name", "type", "handle", "enabled", "refresh_interval_minutes", "last_fetched_at", "last_fetch_status", "last_fetch_error", "last_fetch_debug", "updated_at", "created_at") SELECT "id", "name", "type", "handle", "enabled", "refresh_interval_minutes", "last_fetched_at", "last_fetch_status", "last_fetch_error", "last_fetch_debug", "updated_at", "created_at" FROM \`sources\`;`)
  await db.run(sql`DROP TABLE \`sources\`;`)
  await db.run(sql`ALTER TABLE \`__new_sources\` RENAME TO \`sources\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`sources_updated_at_idx\` ON \`sources\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`sources_created_at_idx\` ON \`sources\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`type_handle_idx\` ON \`sources\` (\`type\`,\`handle\`);`)
}
