import * as migration_20260703_113148_initial from './20260703_113148_initial';

export const migrations = [
  {
    up: migration_20260703_113148_initial.up,
    down: migration_20260703_113148_initial.down,
    name: '20260703_113148_initial'
  },
];
