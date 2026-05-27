# Rotvollfjæra Frontyard Ultra — Connect IQ Data Field

A full-screen Connect IQ data field for Garmin watches (Fenix 7 / 7X,
Epix 2, FR265, FR955, FR965) that helps you pace a Frontyard Ultra (a
Backyard-style event with shrinking loop times) when the watch firmware
does not expose Workout Step Name, Workout Notes, or "Time to Next
Repeat" to data fields.

It uses only the activity's **elapsed time** and **elapsed distance** to
compute everything.

## What it shows

A green countdown donut around the bezel and, inside it, top to bottom:

- **Green donut** — sweeps clockwise as time in the current loop elapses;
  fully closed at 0:00.
- **Three blue markers on the donut** — placed at the 3 / 2 / 1 minute
  remaining positions of the current loop (skipped if a threshold is
  longer than the loop itself).
- **White runner dot** (black contour) — rides clockwise along the donut.
  One full lap of the dot equals one configured loop distance
  (`loopMeters`). If it leads the green sweep, you're ahead of pace;
  if it trails, you're behind.
- **`n/max`** — current loop / total loops. Coloured **pink** at loop 10,
  **green** at loop 15, **blue** otherwise.
- **`MM:SS`** (red, left) — time remaining in the current loop,
  with a tiny `mm:ss to next` label.
- **`min/km`** (blue, right) — required pace for the loop,
  with a tiny `req pa min/km` label.
- **♥ + BPM** (between the hero columns) — a small pink heart with the
  current heart rate overlaid in black; shows `--` until a sensor
  value is available.
- **`HH:MM:SS`** — current clock time (24h).
- **Bottom row** (red, all on one line):
  - **`br MM:SS`** — projected **break** time you would rest before the
    next loop starts if you run the remaining loop distance at your
    current running-average pace (`br --:--` before there is enough
    data or when projected to miss the cutoff).
  - **`gap ±MM:SS`** — signed time gap to the yellow pacer dot.
  - **`pa MM:SS`** — running average pace in min/km.
- **`HH:MM:SS` + `next loop`** — predicted clock time when the next loop
  starts (hidden until the activity timer is running).

When elapsed time passes the final loop's end the field reads
`DONE <max>` and the dynamic values become dashes.

## Audio + vibration alerts

When 3, 2 and 1 minute remain in the current loop the field plays
escalating bell + vibrate patterns:

- **3 min** — 3 beeps + 3 buzzes
- **2 min** — 2 beeps + 2 buzzes
- **1 min** — 1 beep  + 1 buzz

Tones only sound on watches with a speaker (e.g. fenix 7 Pro, fenix 8,
FR165/265/955/965, Venu series). Watches without a speaker (e.g. plain
fenix 7) will still vibrate.

## Schedule logic

```
loop_minutes(loop) = first_loop_min + 1 − min(loop, hold_loop)
```

Defaults match Rotvollfjæra: `first_loop_min = 30`, `hold_loop = 17`,
`max_loops = 27`, `loop_meters = 3000`.

So loop 1 = 30 min, loop 2 = 29 min, …, loop 16 = 15 min, loops 17–27 = 14 min.

## Settings

In Garmin Connect → Connect IQ Apps → Tage Yard Timer → Settings:

| Key | Default | Meaning |
|-----|---------|---------|
| `firstLoopMin` | 30 | Length of loop 1 in minutes |
| `holdLoop`     | 17 | Loop number at which the pace floor is reached |
| `maxLoops`     | 27 | Total number of loops to plan for |
| `loopMeters`   | 3000 | Length of one loop in meters |

## Build

Requires the [Connect IQ SDK](https://developer.garmin.com/connect-iq/)
(tested with 9.1) and a developer key.

```powershell
# from this folder
$sdk = "$env:APPDATA\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.1.0-2026-03-09-6a872a80b"
& "$sdk\bin\monkeyc.bat" `
    -d fenix7 `
    -f monkey.jungle `
    -o bin\TageYardTimer.prg `
    -y $env:APPDATA\Garmin\ConnectIQ\developer_key.der
```

Replace `fenix7` with the target device id to build for another watch
(`fenix7x`, `epix2`, `fr265`, `fr955`, `fr965`).

## Sideload

1. Connect the watch over USB.
2. Copy `bin/TageYardTimer.prg` to `GARMIN\APPS\` on the watch.
3. Safely eject.
4. On the watch: **START** → activity (e.g. **Run**) → **MENU** →
   **Settings → Data Screens** → pick a screen →
   **Layout → Single field (Connect IQ)** →
   **Edit Fields → Connect IQ → Tage Yard Timer**.

## Simulator

```powershell
& "$sdk\bin\connectiq.bat"
& "$sdk\bin\monkeydo.bat" bin\TageYardTimer.prg fenix7
```

To hear/feel the alerts in the simulator, enable
**Settings → Audible Alerts** and **Settings → Vibration**
in the simulator's menu bar.

The simulator caches app properties in
`%LOCALAPPDATA%\Temp\com.garmin.connectiq\GARMIN\APPS\SETTINGS\`. Delete
that folder to reset to the defaults compiled from
`resources/settings/properties.xml`.
