# Rotvollfjæra Frontyard Ultra — Connect IQ Data Field

A full-screen Connect IQ data field for Garmin watches (Fenix 7 family,
Epix 2 family, FR955/965) that helps you pace a Frontyard Ultra (Backyard
with shrinking loop times) when the watch firmware does not expose Workout
Step Name, Workout Notes, or "Time to Next Repeat" to data fields.

It uses only the activity's **elapsed time** and **elapsed distance** to
compute everything.

## What it shows

Full screen, around an outer red countdown ring with a green runner dot:

- **Outer red ring** — sweeps clockwise as time in the current loop elapses;
  fully closed at 0:00.
- **Green unfilled circle on the ring** — the "runner" dot. One full lap of
  the dot equals one configured loop distance (`loopMeters`). If it leads
  the red sweep, you are ahead of pace; if it trails, you are behind.
- **`n/max`** (top) — current loop / total loops. Colored **pink** at loop 10,
  **green** at loop 15, **blue** otherwise.
- **3 / 2 / 1 dots** — three blue filled circles labeled `3`, `2`, `1` from
  left to right. All three are filled at loop start; one empties (left to
  right) as remaining time crosses 3:00, 2:00, and 1:00.
- **`MM:SS`** (red, left) — time remaining in the current loop, with
  `min to next` label.
- **`min/km`** (green, right) — required pace for the loop.
- **`HH:MM:SS`** — current clock time (24h).
- **Tiny row** — running average pace `min/km` (left) and distance covered
  in the current loop `km` (right).
- **`Next HH:MM:SS`** — predicted clock time when the next loop starts
  (hidden until the activity timer is running).

When the elapsed time passes the final loop's end the field reads
`DONE <max>` and the dynamic values become dashes.

## Audio + vibration alerts

When 3, 2, and 1 minute remain in the current loop the field plays
`TONE_LOUD_BEEP` and a short vibrate pulse (where supported by the device
and enabled in the user's profile).

## Schedule logic

```
loop_minutes(loop) = first_loop_min + 1 − min(loop, hold_loop)
```

Defaults match Rotvollfjæra: `first_loop_min = 30`, `hold_loop = 17`,
`max_loops = 27`, `loop_meters = 3000`.

So loop 1 = 30 min, loop 2 = 29 min, …, loop 16 = 15 min, loops 17–27 = 14 min.

## Settings

In Garmin Connect → Connect IQ Apps → Frontyard Loop Timer → Settings:

| Key | Default | Meaning |
|-----|---------|---------|
| `firstLoopMin` | 30 | Length of loop 1 in minutes |
| `holdLoop`     | 17 | Loop number at which the pace floor is reached |
| `maxLoops`     | 27 | Total number of loops to plan for |
| `loopMeters`   | 3000 | Length of one loop in meters |

## Build

Requires the [Connect IQ SDK](https://developer.garmin.com/connect-iq/) (tested
with 9.1) and a developer key.

```powershell
# from this folder
$sdk = "$env:APPDATA\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.1.0-2026-03-09-6a872a80b"
& "$sdk\bin\monkeyc.bat" `
    -d fenix7x `
    -f monkey.jungle `
    -o bin\FrontyardLoopTimer.prg `
    -y $env:APPDATA\Garmin\ConnectIQ\developer_key.der
```

## Sideload

1. Connect the watch over USB.
2. Copy `bin/FrontyardLoopTimer.prg` to `GARMIN\APPS\` on the watch.
3. Safely eject.
4. On the watch: **START** → activity (e.g. **Run**) → **MENU** → **Settings →
   Data Screens** → pick a screen → **Layout → Single field (Connect IQ)** →
   **Edit Fields → Connect IQ → Frontyard Loop Timer**.

## Simulator

```powershell
& "$sdk\bin\simulator.exe"
& "$sdk\bin\monkeydo.bat" bin\FrontyardLoopTimer.prg fenix7x
```

The simulator caches app properties in
`%LOCALAPPDATA%\Temp\com.garmin.connectiq\GARMIN\APPS\SETTINGS\`. Delete that
folder to reset to the defaults compiled from `resources/settings/properties.xml`.
