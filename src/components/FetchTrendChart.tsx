'use client'

import React, { useLayoutEffect, useRef, useState } from 'react'

/** Chart padding, in real pixels (the SVG is drawn 1:1 with its box). */
const PAD_X = 6
const PAD_TOP = 6
const PAD_BOTTOM = 16 // room for day labels
const DOT_R = 2

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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Until we've measured the box we can't place anything without distorting it,
  // so render just the (sized) container and fade the SVG in once we can.
  const geometry = size ? computeGeometry(days, size) : null

  return (
    <div className="trend-chart" ref={ref}>
      {size && geometry && (
        <svg
          className="trend-chart__svg trend-chart__svg--ready"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          role="img"
          aria-label={`Daily fetch success rate over the last ${days.length} days`}
        >
          <line
            className="trend-chart__baseline"
            x1={PAD_X}
            y1={geometry.baselineY}
            x2={size.w - PAD_X}
            y2={geometry.baselineY}
          />

          {geometry.segments.map((seg, i) => (
            <polyline
              key={i}
              className="trend-chart__line"
              points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          ))}

          {geometry.points.map((p, i) =>
            p.y === null ? null : (
              <circle key={i} className="trend-chart__dot" cx={p.x} cy={p.y} r={DOT_R} />
            ),
          )}

          {geometry.points.map((p, i) => (
            <text
              key={i}
              className="trend-chart__label"
              x={p.x}
              y={size.h - 4}
              textAnchor="middle"
            >
              {p.label}
            </text>
          ))}
        </svg>
      )}
    </div>
  )
}

type Point = { label: string; x: number; y: number | null }

/** Turn the measured box + daily rates into plot coordinates: one point per
 * day (100% at top, 0% at the baseline) and contiguous line segments so days
 * with no attempts break the line. */
function computeGeometry(days: TrendDay[], { w, h }: { w: number; h: number }) {
  const innerW = w - PAD_X * 2
  const innerH = h - PAD_TOP - PAD_BOTTOM
  const step = days.length > 1 ? innerW / (days.length - 1) : 0

  const points: Point[] = days.map((d, i) => ({
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

  return { points, segments, baselineY: PAD_TOP + innerH }
}
