import * as migration_20260703_113148_initial from './20260703_113148_initial';
import * as migration_20260703_131519_add_last_fetch_debug from './20260703_131519_add_last_fetch_debug';
import * as migration_20260704_004812_add_media from './20260704_004812_add_media';
import * as migration_20260704_225935_add_payload_jobs from './20260704_225935_add_payload_jobs';
import * as migration_20260705_010847_add_source_profile_image from './20260705_010847_add_source_profile_image';
import * as migration_20260705_212159_add_user_verification from './20260705_212159_add_user_verification';
import * as migration_20260707_170141_add_request_logs from './20260707_170141_add_request_logs';

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
    name: '20260707_170141_add_request_logs'
  },
];
