import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`source_activity\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`source_id\` integer NOT NULL,
  	\`day\` text NOT NULL,
  	\`count\` numeric NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`source_id\`) REFERENCES \`sources\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`source_activity_source_idx\` ON \`source_activity\` (\`source_id\`);`)
  await db.run(sql`CREATE INDEX \`source_activity_day_idx\` ON \`source_activity\` (\`day\`);`)
  await db.run(sql`CREATE INDEX \`source_activity_updated_at_idx\` ON \`source_activity\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`source_activity_created_at_idx\` ON \`source_activity\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`source_day_idx\` ON \`source_activity\` (\`source_id\`,\`day\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`source_activity_id\` integer REFERENCES source_activity(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_source_activity_id_idx\` ON \`payload_locked_documents_rels\` (\`source_activity_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`source_activity\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`subscriptions_id\` integer,
  	\`sources_id\` integer,
  	\`feed_items_id\` integer,
  	\`media_id\` integer,
  	\`users_id\` integer,
  	\`request_logs_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`subscriptions_id\`) REFERENCES \`subscriptions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sources_id\`) REFERENCES \`sources\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`feed_items_id\`) REFERENCES \`feed_items\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`request_logs_id\`) REFERENCES \`request_logs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "subscriptions_id", "sources_id", "feed_items_id", "media_id", "users_id", "request_logs_id") SELECT "id", "order", "parent_id", "path", "subscriptions_id", "sources_id", "feed_items_id", "media_id", "users_id", "request_logs_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_subscriptions_id_idx\` ON \`payload_locked_documents_rels\` (\`subscriptions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_sources_id_idx\` ON \`payload_locked_documents_rels\` (\`sources_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_feed_items_id_idx\` ON \`payload_locked_documents_rels\` (\`feed_items_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_request_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`request_logs_id\`);`)
}
