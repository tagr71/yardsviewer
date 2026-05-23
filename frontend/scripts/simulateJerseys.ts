/**
 * `simulate:jerseys` — loop-by-loop CLI viewer for the jersey rankings.
 *
 * Drives the same `simulateRace` simulator the unit tests use, then for
 * each loop k = 1..N prints the chosen jersey/sex top-N from the
 * ranking module. When the rank-1 holder changes from one loop to the
 * next the script prints a `→ holder change` line so the evolution is
 * obvious at a glance.
 *
 * Run from the `frontend/` directory:
 *
 *     npm run simulate:jerseys
 *     npm run simulate:jerseys -- --jersey=pink --sex=K --top=5
 *     npm run simulate:jerseys -- --runners=30 --loops=8 --seed=7
 *
 * Flags (all optional):
 *
 *     --runners=N    Number of runners                  (default 20)
 *     --loops=N      Number of loops to simulate        (default 10)
 *     --seed=N       RNG seed (same seed = same race)   (default 42)
 *     --jersey=...   pink | green | yellow | all        (default all)
 *     --sex=...      K | M | both                       (default both)
 *     --top=N        Rows shown per table               (default 5)
 *
 * All race logic lives in the shared `simulateRace` / `jerseyRanking`
 * modules — this file is just argv parsing and tabular formatting.
 */

import {
  rankByPoints,
  rankYellow,
  type DisplayRow,
  type Sex,
} from "../src/dashboards/jerseyRanking";
import { simulateRace } from "../src/dashboards/simulateRace";

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------
type JerseyFilter = "pink" | "green" | "yellow" | "all";
type SexFilter = "K" | "M" | "both";

type CliOptions = {
  numRunners: number;
  numLoops: number;
  seed: number;
  jersey: JerseyFilter;
  sex: SexFilter;
  top: number;
};

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    numRunners: 20,
    numLoops: 10,
    seed: 42,
    jersey: "all",
    sex: "both",
    top: 5,
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [keyRaw, valRaw] = raw.slice(2).split("=", 2);
    const key = (keyRaw ?? "").trim();
    const val = (valRaw ?? "").trim();
    switch (key) {
      case "runners":
        out.numRunners = Math.max(2, Number.parseInt(val, 10));
        break;
      case "loops":
        out.numLoops = Math.max(1, Number.parseInt(val, 10));
        break;
      case "seed":
        out.seed = Number.parseInt(val, 10);
        break;
      case "jersey":
        if (
          val === "pink" ||
          val === "green" ||
          val === "yellow" ||
          val === "all"
        ) {
          out.jersey = val;
        } else {
          throw new Error(
            `--jersey must be pink|green|yellow|all (got "${val}")`,
          );
        }
        break;
      case "sex":
        if (val === "K" || val === "M" || val === "both") {
          out.sex = val;
        } else {
          throw new Error(`--sex must be K|M|both (got "${val}")`);
        }
        break;
      case "top":
        out.top = Math.max(1, Number.parseInt(val, 10));
        break;
      case "help":
      case "h":
        printHelp();
        process.exit(0);
        return out;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: npm run simulate:jerseys -- [flags]",
      "",
      "  --runners=N    Number of runners (default 20)",
      "  --loops=N      Number of loops to simulate (default 10)",
      "  --seed=N       RNG seed (default 42)",
      "  --jersey=...   pink | green | yellow | all (default all)",
      "  --sex=...      K | M | both (default both)",
      "  --top=N        Rows shown per table (default 5)",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
const JERSEY_LABEL: Record<"pink" | "green" | "yellow", string> = {
  pink: "PINK",
  green: "GREEN",
  yellow: "YELLOW",
};
const SEX_LABEL: Record<Sex, string> = { K: "Women (K)", M: "Men (M)" };

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function rpad(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function fmtTable(rows: DisplayRow[], top: number): string {
  const header = `  ${rpad("#", 3)}  ${rpad("Bib", 4)}  ${pad("Name", 14)}  ${pad("Value", 10)}  Notes`;
  const sep = `  ${"-".repeat(3)}  ${"-".repeat(4)}  ${"-".repeat(14)}  ${"-".repeat(10)}  -----`;
  const lines: string[] = [header, sep];
  if (rows.length === 0) {
    lines.push("  (no entries yet)");
    return lines.join("\n");
  }
  rows.slice(0, top).forEach((r) => {
    lines.push(
      `  ${rpad(String(r.rank), 3)}  ${rpad(r.bib, 4)}  ${pad((r.name ?? "").slice(0, 14), 14)}  ${pad(r.value, 10)}  ${r.sub ?? ""}`,
    );
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const race = simulateRace({
    numRunners: opts.numRunners,
    numLoops: opts.numLoops,
    seed: opts.seed,
  });
  const { payload, sexLookup } = race;

  const jerseys: ("pink" | "green" | "yellow")[] =
    opts.jersey === "all" ? ["pink", "green", "yellow"] : [opts.jersey];
  const sexes: Sex[] = opts.sex === "both" ? ["K", "M"] : [opts.sex];

  const banner = `Fictive race — ${opts.numRunners} runners, ${opts.numLoops} loops, seed=${opts.seed}`;
  process.stdout.write(`${banner}\n${"=".repeat(banner.length)}\n`);

  // Track previous-loop rank-1 holder per (jersey, sex) so we can flag
  // leadership changes loop-to-loop.
  const prevHolder = new Map<string, string | undefined>();
  const keyOf = (j: string, s: Sex) => `${j}|${s}`;

  for (let cap = 1; cap <= opts.numLoops; cap += 1) {
    process.stdout.write(`\n── Loop ${cap} of ${opts.numLoops} ──\n`);

    for (const jersey of jerseys) {
      for (const sex of sexes) {
        const rows =
          jersey === "yellow"
            ? rankYellow(payload.yellow, sexLookup, cap)[sex]
            : jersey === "pink"
              ? rankByPoints(payload.pink, sexLookup, cap)[sex]
              : rankByPoints(payload.green, sexLookup, cap)[sex];

        process.stdout.write(
          `\n  [${JERSEY_LABEL[jersey]}] ${SEX_LABEL[sex]}\n`,
        );
        process.stdout.write(fmtTable(rows, opts.top) + "\n");

        const currentHolder = rows[0]?.bib;
        const k = keyOf(jersey, sex);
        const prev = prevHolder.get(k);
        if (prev !== undefined && prev !== currentHolder) {
          process.stdout.write(
            `  → ${JERSEY_LABEL[jersey]} ${sex} holder change: bib ${prev} → bib ${currentHolder ?? "—"}\n`,
          );
        }
        prevHolder.set(k, currentHolder);
      }
    }
  }

  process.stdout.write("\nDone.\n");
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`simulate:jerseys: ${msg}\n`);
  process.exit(1);
}
