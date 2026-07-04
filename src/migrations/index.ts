import * as migration_20260703_113148_initial from './20260703_113148_initial';
import * as migration_20260703_131519_add_last_fetch_debug from './20260703_131519_add_last_fetch_debug';
import * as migration_20260704_004812_add_media from './20260704_004812_add_media';

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
    name: '20260704_004812_add_media'
  },
];
