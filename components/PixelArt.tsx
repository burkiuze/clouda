/**
 * Chunky pixel-grid artwork used as the decorative motif across the site.
 * A bitmap string is rendered as SVG squares, with an offset copy underneath
 * acting as a hard "sticker" outline.
 */

const CLOUD = [
  "..............######........",
  "...........############.....",
  ".........###############....",
  "........#################...",
  "......###################...",
  "....#####################...",
  "..#######################...",
  ".##########################.",
  "############################",
  "############################",
  ".##########################.",
];

const BOLT = [
  ".......####...",
  "......#####...",
  ".....#####....",
  "....#####.....",
  "...##########.",
  "......#####...",
  ".....#####....",
  "....#####.....",
  "...####.......",
];

const bitmaps = { cloud: CLOUD, bolt: BOLT };

export function PixelArt({
  shape = "cloud",
  fill = "#7C3AED",
  outline = "#DCFF57",
  cell = 12,
  className = "",
}: {
  shape?: keyof typeof bitmaps;
  fill?: string;
  outline?: string;
  cell?: number;
  className?: string;
}) {
  const map = bitmaps[shape];
  const cols = map[0].length;
  const rows = map.length;
  const offset = Math.round(cell / 2);

  const cells: { x: number; y: number }[] = [];
  map.forEach((row, y) => {
    row.split("").forEach((char, x) => {
      if (char === "#") cells.push({ x, y });
    });
  });

  return (
    <svg
      viewBox={`0 0 ${cols * cell + offset} ${rows * cell + offset}`}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      role="presentation"
    >
      <g transform={`translate(${offset}, ${offset})`}>
        {cells.map((c) => (
          <rect
            key={`o-${c.x}-${c.y}`}
            x={c.x * cell}
            y={c.y * cell}
            width={cell}
            height={cell}
            fill={outline}
          />
        ))}
      </g>
      <g>
        {cells.map((c) => (
          <rect
            key={`f-${c.x}-${c.y}`}
            x={c.x * cell}
            y={c.y * cell}
            width={cell}
            height={cell}
            fill={fill}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Scattered loose pixels, the confetti that frames the hero and section
 * corners.
 */
export function PixelScatter({
  className = "",
  color = "#7C3AED",
  count = 26,
  seed = 7,
}: {
  className?: string;
  color?: string;
  count?: number;
  seed?: number;
}) {
  // Deterministic pseudo-random layout so server and client markup match.
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const squares = Array.from({ length: count }, () => {
    const size = [6, 8, 10, 14][Math.floor(rand() * 4)];
    return {
      x: Math.round(rand() * 92),
      y: Math.round(rand() * 92),
      size,
      opacity: 0.25 + rand() * 0.75,
    };
  });

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      role="presentation"
    >
      {squares.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={s.size / 2}
          height={s.size / 2}
          fill={color}
          opacity={s.opacity}
        />
      ))}
    </svg>
  );
}
