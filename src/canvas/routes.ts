/** Sample our shared SVG route into native points, including obstacle detours.
 * The same route remains the accessible pointer target above the native canvas. */
export function routePoints(path: string): [number, number][] {
  const tokens = path.match(/[MLCQ]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) ?? []
  const points: [number, number][] = []
  let cursor = 0, current: [number, number] = [0, 0]
  const point = (): [number, number] => [Number(tokens[cursor++]), Number(tokens[cursor++])]
  while (cursor < tokens.length) {
    const command = tokens[cursor++]
    if (command === 'M' || command === 'L') { current = point(); points.push(current); continue }
    const start = current, control = point(), second = command === 'C' ? point() : null, end = point()
    const steps = command === 'C' ? 24 : 8
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, u = 1 - t
      points.push(second
        ? [u ** 3 * start[0] + 3 * u ** 2 * t * control[0] + 3 * u * t ** 2 * second[0] + t ** 3 * end[0],
          u ** 3 * start[1] + 3 * u ** 2 * t * control[1] + 3 * u * t ** 2 * second[1] + t ** 3 * end[1]]
        : [u ** 2 * start[0] + 2 * u * t * control[0] + t ** 2 * end[0],
          u ** 2 * start[1] + 2 * u * t * control[1] + t ** 2 * end[1]])
    }
    current = end
  }
  return points
}
