import { config } from '../config.js'
import { lastJobRun, recordJobRun } from '../db.js'
import { formatDuration, log } from '../log.js'
import { describeError } from '../lib/errors.js'

/**
 * The cron replacement: one timer, a static list of jobs, no dependency and no
 * queue table. Each tick asks every job whether it's due; a job that's still
 * running from a previous tick is skipped rather than overlapped.
 *
 * Run times are persisted (see db.job_runs) rather than kept in memory, because
 * with an in-memory timestamp a container that restarts every few hours would
 * run the "daily" jobs every few hours.
 */

export interface JobResult {
  /** Defaults to 'ok'. */
  status?: 'ok' | 'error'
  /** Nothing to do — suppresses the log line entirely. */
  skipped?: boolean
  /** Extra `key=value` detail for the log line. */
  fields?: Record<string, unknown>
}

export interface Job {
  name: string
  everyMs: number
  run(): Promise<JobResult>
}

interface JobState {
  job: Job
  running: boolean
}

export class Scheduler {
  private readonly states: JobState[]
  private timer: NodeJS.Timeout | undefined
  private lastTickAt = 0

  constructor(jobs: Job[]) {
    this.states = jobs.map((job) => ({ job, running: false }))
  }

  start(): void {
    // A short delay so the HTTP server is listening and /healthz is green before
    // any outbound proxy traffic starts.
    setTimeout(() => {
      void this.tick()
      this.timer = setInterval(() => void this.tick(), config.tickIntervalMs)
    }, 5_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** For /healthz: whether the scheduler is actually turning over. */
  get lastTick(): number {
    return this.lastTickAt
  }

  private async tick(): Promise<void> {
    this.lastTickAt = Date.now()
    for (const state of this.states) {
      if (state.running) {
        log.debug('job still running, skipping this tick', { job: state.job.name })
        continue
      }
      const last = lastJobRun(state.job.name) ?? 0
      if (Date.now() - last < state.job.everyMs) continue

      state.running = true
      const startedAt = Date.now()
      try {
        const result = await state.job.run()
        const elapsed = Date.now() - startedAt
        const status = result.status ?? 'ok'
        recordJobRun(state.job.name, result.skipped ? 'skipped' : status, elapsed)
        if (!result.skipped) {
          const line = { job: state.job.name, ...result.fields, took: formatDuration(elapsed) }
          if (status === 'error') log.warn('job finished with errors', line)
          else log.info('job', line)
        }
      } catch (err) {
        // A throwing job must never take the tick loop down with it.
        const elapsed = Date.now() - startedAt
        recordJobRun(state.job.name, 'error', elapsed)
        log.error('job threw', {
          job: state.job.name,
          error: describeError(err),
          took: formatDuration(elapsed),
        })
      } finally {
        state.running = false
      }
    }
  }
}
