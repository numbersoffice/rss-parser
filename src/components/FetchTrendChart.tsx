'use client'

import React, { useLayoutEffect, useRef, useState } from 'react'

/** Chart padding, in real pixels (the SVG is drawn 1:1 with its box). */
const PAD_X = 6
const PAD_TOP = 6
const PAD_BOTTOM = 16 // room for day labels
const DOT_R = 2
/** Floor so the chart is never uselessly short before it's measured / in a
 * short row; it grows past this to fill whatever height the widget has. */
const MIN_H = 72

export type TrendDay = { label: string; rate: number | null }

/**
 * The success-rate sparkline. A client component so it can measure its own box
 * and draw the SVG at true pixel size — the earlier version stretched a fixed
 * viewBox with preserveAspectRatio="none", which squashed the round dots into
 * ovals as the widget's width changed. Here the viewBox equals the measured
 * width × height, so geometry is never distorted, and the plot uses the full
 * height available (the baseline sits at the bottom) so it fills a widget that
 * a taller neighbour has stretched.
 */
export function FetchTrendChart({ days }: { days: TrendDay[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 300, h: MIN_H })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { w, h } = size
  const innerW = w - PAD_X * 2
  const innerH = h - PAD_TOP - PAD_BOTTOM
  const step = days.length > 1 ? innerW / (days.length - 1) : 0

  const points = days.map((d, i) => ({
    label: d.label,
    x: PAD_X + step * i,
    // rate 100% at top, 0% at bottom of the plot area
    y: d.rate === null ? null : PAD_TOP + innerH * (1 - d.rate / 100),
  }))

  // Split into contiguous runs of non-null points so gaps break the line.
  const segments: { x: number; y: number }[][] = []
  let run: { x: number; y: number }[] = []
  for (const p of points) {
    if (p.y === null) {
      if (run.length) segments.push(run)
      run = []
    } else {
      run.push({ x: p.x, y: p.y })
    }
  }
  if (run.length) segments.push(run)

  const baselineY = PAD_TOP + innerH

  return (
    <div className="trend-chart" ref={ref}>
      <svg
        className="trend-chart__svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Daily fetch success rate over the last ${days.length} days`}
      >
        <line
          className="trend-chart__baseline"
          x1={PAD_X}
          y1={baselineY}
          x2={w - PAD_X}
          y2={baselineY}
        />

        {segments.map((seg, i) => (
          <polyline
            key={i}
            className="trend-chart__line"
            points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        ))}

        {points.map((p, i) =>
          p.y === null ? null : (
            <circle key={i} className="trend-chart__dot" cx={p.x} cy={p.y} r={DOT_R} />
          ),
        )}

        {points.map((p, i) => (
          <text key={i} className="trend-chart__label" x={p.x} y={h - 4} textAnchor="middle">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
