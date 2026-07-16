import * as migration_20260703_113148_initial from './20260703_113148_initial';
import * as migration_20260703_131519_add_last_fetch_debug from './20260703_131519_add_last_fetch_debug';
import * as migration_20260704_004812_add_media from './20260704_004812_add_media';
import * as migration_20260704_225935_add_payload_jobs from './20260704_225935_add_payload_jobs';
import * as migration_20260705_010847_add_source_profile_image from './20260705_010847_add_source_profile_image';
import * as migration_20260705_212159_add_user_verification from './20260705_212159_add_user_verification';
import * as migration_20260707_170141_add_request_logs from './20260707_170141_add_request_logs';
import * as migration_20260707_175302_add_max_fetch_attempts from './20260707_175302_add_max_fetch_attempts';
import * as migration_20260707_190000_add_request_log_fetch_id from './20260707_190000_add_request_log_fetch_id';
import * as migration_20260710_120000_add_email_change from './20260710_120000_add_email_change';
import * as migration_20260712_120000_add_max_items_per_feed from './20260712_120000_add_max_items_per_feed';
import * as migration_20260712_212939_add_source_activity from './20260712_212939_add_source_activity';
import * as migration_20260716_105754_add_news from './20260716_105754_add_news';

export const migrations = [
  {
    up: migration_20260703_113148_initial.up,
    down: migration_20260703_113148_initial.down,
    name: '20260703_113148_initial',
  },
  {
    up: migration_20260703_131519_add_last_fetch_debug.up,
    down: migration_20260703_131519_add_last_fetch_debug.down,
    name: '20260703_131519_add_last_fetch_debug',
  },
  {
    up: migration_20260704_004812_add_media.up,
    down: migration_20260704_004812_add_media.down,
    name: '20260704_004812_add_media',
  },
  {
    up: migration_20260704_225935_add_payload_jobs.up,
    down: migration_20260704_225935_add_payload_jobs.down,
    name: '20260704_225935_add_payload_jobs',
  },
  {
    up: migration_20260705_010847_add_source_profile_image.up,
    down: migration_20260705_010847_add_source_profile_image.down,
    name: '20260705_010847_add_source_profile_image',
  },
  {
    up: migration_20260705_212159_add_user_verification.up,
    down: migration_20260705_212159_add_user_verification.down,
    name: '20260705_212159_add_user_verification',
  },
  {
    up: migration_20260707_170141_add_request_logs.up,
    down: migration_20260707_170141_add_request_logs.down,
    name: '20260707_170141_add_request_logs',
  },
  {
    up: migration_20260707_175302_add_max_fetch_attempts.up,
    down: migration_20260707_175302_add_max_fetch_attempts.down,
    name: '20260707_175302_add_max_fetch_attempts',
  },
  {
    up: migration_20260707_190000_add_request_log_fetch_id.up,
    down: migration_20260707_190000_add_request_log_fetch_id.down,
    name: '20260707_190000_add_request_log_fetch_id',
  },
  {
    up: migration_20260710_120000_add_email_change.up,
    down: migration_20260710_120000_add_email_change.down,
    name: '20260710_120000_add_email_change',
  },
  {
    up: migration_20260712_120000_add_max_items_per_feed.up,
    down: migration_20260712_120000_add_max_items_per_feed.down,
    name: '20260712_120000_add_max_items_per_feed',
  },
  {
    up: migration_20260712_212939_add_source_activity.up,
    down: migration_20260712_212939_add_source_activity.down,
    name: '20260712_212939_add_source_activity',
  },
  {
    up: migration_20260716_105754_add_news.up,
    down: migration_20260716_105754_add_news.down,
    name: '20260716_105754_add_news'
  },
];
