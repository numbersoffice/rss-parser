/**
 * `next/og`'s `ImageResponse` rasterizes PNGs through a CPU- and memory-heavy
 * WASM renderer, and each concurrent render gets its own heap. A burst of
 * crawler / link-preview requests for social images can therefore stack to
 * gigabytes and peg the CPU (the container spikes then frees). Cap how many
 * rasterizations run at once — extra ones queue instead of allocating in
 * parallel. The work is short, so a small limit keeps latency fine while
 * removing the spike.
 */
const MAX_CONCURRENT_RENDERS = 2

let active = 0
const waiters: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_RENDERS) {
    active++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => waiters.push(resolve))
}

function release(): void {
  const next = waiters.shift()
  // Hand the slot straight to the next waiter (keep `active`); only drop the
  // count when nobody is waiting. Keeps `active <= MAX_CONCURRENT_RENDERS`.
  if (next) next()
  else active--
}

/** Run `render` with at most {@link MAX_CONCURRENT_RENDERS} others in flight. */
export async function withRenderLimit<T>(render: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await render()
  } finally {
    release()
  }
}
