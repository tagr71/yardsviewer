# Garmin `.fit` workout generator

Generates a Garmin workout file that mimics the Frontyard Ultra format:
one workout step per loop with the required pace + time-limit, plus
3 trailing 1-minute "warning" steps that make the watch beep + vibrate
at −3, −2 and −1 min before each loop ends (and again at the loop
boundary itself when the next loop's first step kicks in).

Two modes:

| Mode        | Main run step target | What the watch shows during a loop                              |
| ----------- | -------------------- | --------------------------------------------------------------- |
| `organizer` (default) | `OPEN`     | Just the step countdown — no speed prompts, no pace nags. Use this when you're timing/observing the race, not running it. |
| `runner`    | Asymmetric `SPEED` band (slow side = required pace +`--upper-pace-band-pct`%, fast side = `--fastest-pace` floor, default `4:00` min/km) | Current speed/pace plus "Speed up" if you drop below the slow bound, "Slow down" if you exceed the absolute fast bound. Warning steps stay OPEN so the alerts fire cleanly on wall-clock time. |

## Install

```powershell
uv add fit-tool          # or: pip install fit-tool
```

## Generate

Organizer build (default):

```powershell
uv run python Garmin/generate_frontyard_workout.py `
    --name "Frontyard Org" `
    --hold-loop 17 --max-loops 27 --loop-km 3.0 `
    --output Garmin/frontyard_organizer.fit
```

Runner build with a +10% slow-side tolerance and a 4:00 min/km fast-side floor:

```powershell
uv run python Garmin/generate_frontyard_workout.py `
    --mode runner --upper-pace-band-pct 10 --fastest-pace 4:00 `
    --name "Frontyard Run" `
    --hold-loop 17 --max-loops 27 --loop-km 3.0 `
    --output Garmin/frontyard_runner.fit
```

Flags (all optional, defaults shown):

| Flag             | Default                | Meaning                                                  |
| ---------------- | ---------------------- | -------------------------------------------------------- |
| `--mode`         | `organizer`            | `organizer` or `runner` (see table above)                |
| `--first-loop-min` | `30`                 | Duration of loop 1 in minutes (lower = faster real-time test) |
| `--upper-pace-band-pct` | `10.0`          | Runner-only: slow-side tolerance above required pace (%) |
| `--fastest-pace` | `4:00`                 | Runner-only: absolute fast-side floor (m:ss per km)      |
| `--hold-loop`    | `17`                   | Loop where the time-limit stops shrinking                |
| `--max-loops`    | `27`                   | Total loops (must be `>= --hold-loop`)                   |
| `--loop-km`      | `3.0`                  | Loop distance in km (drives the required pace)           |
| `--pink-loop`    | `10`                   | Loop to tag with `PINK` jersey label (`0` disables)      |
| `--green-loop`   | `15`                   | Loop to tag with `GREEN` jersey label (`0` disables)     |
| `--enable-loop-timer` | *off*             | **Experimental.** Wraps each loop in a 1-iteration repeat block. Intended for watches whose firmware exposes a *Repeat Timer* / *Time to Next Repeat* data field. **Has no benefit on Fenix 7 firmware ≥ 14.x** (no such field exists there) and only adds a `1/1` banner during the run — leave off unless you have a device that uses it. |
| `--name`         | `Frontyard Ultra`      | Workout name shown on the watch                          |
| `--output`       | `Garmin/frontyard.fit` | Output path                                              |

The script also prints a per-loop summary table so you can sanity-check
the schedule before transferring the file.

**Real-time testing.** The full schedule takes hours (loop 1 = 30 min
by default). To dry-run the entire sequence in minutes, shorten loop 1
with `--first-loop-min`. Loop N is then
`first_loop_min + 1 − min(N, --hold-loop)` minutes.

Test the **organizer** schedule (beeps + step transitions only) — a
5-loop run that finishes in 16 min:

```powershell
uv run python Garmin/generate_frontyard_workout.py `
    --mode organizer `
    --first-loop-min 5 --hold-loop 4 --max-loops 5 --loop-km 0.5 `
    --pink-loop 2 --green-loop 4 `
    --name "Frontyard Test Org" --output Garmin/frontyard_test_org.fit
```

Test the **runner** schedule (same timing, plus the SPEED target band
and "speed up / slow down" prompts):

```powershell
uv run python Garmin/generate_frontyard_workout.py `
    --mode runner --upper-pace-band-pct 10 --fastest-pace 4:00 `
    --first-loop-min 5 --hold-loop 4 --max-loops 5 --loop-km 0.5 `
    --pink-loop 2 --green-loop 4 `
    --name "Frontyard Test Run" --output Garmin/frontyard_test_run.fit
```

Both produce loops of 5, 4, 3, 2, 2 min with full −3/−2/−1 warnings
firing on the right minute boundaries — only the pace prompts differ.

**Jersey labels.** Loops 10 and 15 are tagged `PINK` and `GREEN`
respectively (defaults — override with `--pink-loop N` / `--green-loop N`,
or disable with `0`). The label is prepended to the main step name on
the watch, e.g. `PINK L10/27 21min 7:00/km`, so you can tell at a
glance which loop "decides" each jersey. The label also appears in the
step's notes (long-press on the workout step) prefixed with
`[PINK JERSEY] …`.

**Step notes format.** Long-press on the active step to read the full
note.

*Main run step* — pace (min/km) and speed (km/h):

```
Loop 1: 3 km in 30 min (10:00 min/km, 6.0 km/h)
Loop 17: 3 km in 14 min (4:40 min/km, 12.9 km/h)
```

In runner mode the band info is appended, e.g.
`(4:40 min/km, 12.9 km/h, slow +10% / fast 4:00 min/km)`.

*Warning steps* — countdown info first so it's the most prominent
line on the "Next step" preview screen (where the firmware-rendered
category banner — e.g. Norwegian *Løp 1:00* — sits above):

```
COUNT DOWN 3 min — Loop 1 → next loop 29 min
COUNT DOWN 2 min — Loop 1 → next loop 29 min
COUNT DOWN 1 min — Loop 1 → next loop 29 min
```

On the final loop the suffix changes to `— final loop N`.

## Upload to watch

Garmin Connect (web + mobile) does **not** accept `.fit` *workout*
files — its import feature only takes activity files (recorded runs).
The supported path is direct USB transfer to the watch:

1. Plug the watch into the PC with the USB cable. Windows mounts it
   as a removable drive (typically labelled `GARMIN`). No Garmin
   Express needed — plain mass-storage works.
2. Open the drive in Explorer and navigate to the `GARMIN\NewFiles\`
   folder. (On Fenix / Forerunner / Epix the folder always exists;
   on older devices you may need to create it.)
3. Copy `frontyard_organizer.fit` (or `frontyard_runner.fit`) into
   `GARMIN\NewFiles\`.
4. Safely eject and unplug the watch. On the next boot the watch
   moves the file out of `NewFiles/` and imports it. You'll find it
   under **Training → Workouts → My Workouts** (menu wording varies
   slightly by model).
5. Start the workout the same way you'd start any saved one:
   *Run profile → up-arrow / hold MENU → Training → Workouts →
   pick the workout → Do Workout*.

**Uploading both modes?** Some firmwares dedupe workouts by name, so
only one of the two files shows up under *My Workouts* if they share
the default name. Give each build a distinct `--name` when generating:

```powershell
uv run python Garmin/generate_frontyard_workout.py `
    --name "Frontyard Org" --output Garmin/frontyard_organizer.fit
uv run python Garmin/generate_frontyard_workout.py --mode runner `
    --name "Frontyard Run" --output Garmin/frontyard_runner.fit
```

If you want the workout to also appear in Garmin Connect, you have to
rebuild it manually in *Training & Planning → Workouts → Create a
Workout* using the per-loop summary the script prints. Connect's web
editor accepts time-based steps with pace targets, so the runner-mode
schedule maps 1-to-1; only the import shortcut is missing.

## Other Garmin models

The `.fit` file uses only standard FIT workout fields (sport
`RUNNING`, intensity `ACTIVE`, time-based duration, `OPEN` / `SPEED`
targets, custom step names), so it works on essentially any Garmin
watch that supports structured running workouts. Confirmed-portable
families:

- **Fenix** 5 and newer (5 / 5 Plus / 6 / 7 / 8 series)
- **Forerunner** 235, 245, 255, 265, 645, 745, 935, 945, 955, 965,
  165 (workout-capable variants)
- **Epix** (Gen 2), **Enduro** 1 / 2, **MARQ** Gen 2, **tactix**
- **Instinct** 2 / 2X / Crossover (mono displays; long names truncate)
- **Venu** 2 / 2 Plus / 3, **Vivoactive** 4 / 5

Things that carry over unchanged:

- Step transitions and beep cadence (every workout-capable Garmin
  fires one beep per step boundary, plus a *Step Almost Done* preview
  that you'll want disabled the same way as on Fenix 7X).
- Speed-target (runner mode) steps — universally supported.
- COUNT DOWN / jersey / loop step names — plain strings, always
  shown.

Caveats per device class:

- **Small / mono screens** (Instinct, Vivoactive, FR 55): step names
  truncate at roughly 12–16 characters, so `L1/27 30min 10:00/km` will
  appear as `L1/27 30min` or similar. Consider `--pink-loop 0
  --green-loop 0` to free up character budget on those watches.
- **Long-press notes** (the multi-line note with pace + km/h + band
  info) are not viewable on every model — some show only the step
  name. Functionality is unaffected; only the readable note is.
- **Newer devices using MTP instead of USB Mass Storage** (Fenix 8,
  Forerunner 265 / 965 on recent firmware, Venu 3 in some regions) do
  **not** expose the `GARMIN\NewFiles\` folder over MTP. Sideload the
  exact same `.fit` via **Garmin Express** on desktop (it has a
  "Send to device" option for workout files), or transfer it through
  a Connect IQ companion. The file content itself is unchanged.
- **Devices without workout support** (Vivosmart, Vivofit, older
  fitness bands) will simply reject the file.

## How the beeps work

Garmin watches beep + vibrate on every workout-step transition (with
*Tones / Vibration → Workout step alerts* enabled, which is the
default on Forerunner / Fenix / Epix).

Per loop, the script emits four steps:

| # | Step name              | Duration       | Intensity | Beep at end? |
| - | ---------------------- | -------------- | --------- | ------------ |
| 1 | `L17/27 14min 4:40/km` | `minutes − 3` min | ACTIVE | ✓ (= −3 min warning) |
| 2 | `COUNT DOWN 3 min`     | 1 min          | ACTIVE    | ✓ (= −2 min warning) |
| 3 | `COUNT DOWN 2 min`     | 1 min          | ACTIVE    | ✓ (= −1 min warning) |
| 4 | `COUNT DOWN 1 min`     | 1 min          | ACTIVE    | ✓ (= loop boundary)  |

All four steps use **ACTIVE** intensity on purpose: the watch then
renders the step *name* (e.g. `COUNT DOWN 3 min`) without overlaying a
localized category banner (Norwegian firmware translates `COOLDOWN`
to *Nedvarming*, `REST` to *Hvile*, etc., which clutters the screen).

### Beep, vibrate, or both

Whether each step transition produces an audible tone, a vibration,
or both is **a global watch setting** — it can't be encoded in the
`.fit` workout. Configure it once on the watch:

**Fenix 7X (and 7 / Epix Gen 2):**

1. From the watch face, **hold UP** → the Settings gear menu opens.
2. **System** → **Sound and Vibe** (older firmware: *Tones*).
3. Three toggles affect workout-step alerts:
   - **Alert Tones** → *On / Off* — the beep.
   - **Vibration** → *On / Off* — the wrist vibration.
   - **Tones for Activities** (if present) — gates whether the above
     apply *during* an activity. Make sure this is **On**, otherwise
     the workout-step alerts stay silent even if the global tones
     are enabled.

Pick a combination:

| Want                     | Alert Tones | Vibration |
| ------------------------ | ----------- | --------- |
| Beep only                | On          | Off       |
| Vibrate only (silent)    | Off         | On        |
| Beep + vibrate (default) | On          | On        |
| Nothing                  | Off         | Off       |

Note: even with *Alert Tones = Off*, the watch may still beep on the
top-of-hour or for incoming notifications — those are governed by
*Notifications* and *Smart Notifications* separately.

### Random extra beeps? Disable "Step Almost Done"

Garmin watches fire **two** alerts per step by default:

1. A **"Step Almost Done"** preview alert ~30 s before the step ends
   (configurable on some firmware up to 60 s).
2. The actual **step-transition** alert at the step boundary.

This is the most common source of "it beeps more than it should, kind
of at random" reports during organizer mode. The workout has four
steps per loop — the long main run plus three 1-minute `COUNT DOWN`
steps — and **every one of them** gets a preview beep 30 s before its
end. For a loop, that produces:

```
main run     : … BEEP at −3:30 (preview) … BEEP at −3:00 (transition)
COUNT DOWN 3 : BEEP at 0:00 — BEEP at 0:30 (preview) — BEEP at 1:00 …
COUNT DOWN 2 : BEEP at 0:00 — BEEP at 0:30 (preview) — BEEP at 1:00 …
COUNT DOWN 1 : BEEP at 0:00 — BEEP at 0:30 (preview) — BEEP at 1:00 …
```

i.e. **8 beeps over the last 3:30** instead of the intended 4 sharp
beeps at −3 / −2 / −1 / 0 min. The half-minute previews land
exactly between the per-minute cues, so they feel random unless you
know what they are.

If you only want the four sharp beeps, turn the preview off. The
toggle moves around between firmware versions and is most reliably
reached from the **Garmin Connect mobile app**:

**Garmin Connect (recommended):** Devices → **Fenix 7X** → activity
profile (e.g. **Run**) → **Alerts** → **Smart Alerts** → turn off the
workout step preview entry (often labelled *Step Almost Done*,
*Workout Step Alert Preview*, or simply listed under the activity).
Changes sync to the watch on the next connection.

**On the watch (if exposed by your firmware):** hold **UP** →
**System** → **Sound and Vibe** → **Step Almost Done** → **Off**, or
from the Run pre-start screen hold **MENU** → **Run Settings** →
**Alerts** and look for a *Step Almost Done* / *Workout Alert
Preview* toggle.

After disabling it, the only remaining beeps inside a loop come from
real step transitions: one at the start of `COUNT DOWN 3`, one at
`COUNT DOWN 2`, one at `COUNT DOWN 1`, and one at the loop boundary —
exactly the −3 / −2 / −1 / 0 cadence the workout is designed for.

### Still hearing strays? Silence the activity-profile alerts

If the workout-side previews are off and you *still* hear an
unexpected beep or vibration early in a loop (e.g. around 7:00 and
7:30 of loop 1, well before the −3 min mark), the source is almost
certainly the **Run activity profile itself**, not the workout
steps. Check these in order of likelihood — when the next stray beep
fires, glance at the watch *immediately*; it banners the source for
2–3 s (`Lap 1 — 1.00 km`, `Pace too slow`, `HR Zone 2`,
`Stryd connected`, etc.) and that one observation pins it.

All of these settings live under: Run pre-start → hold **MENU** →
**Run Settings** → **Alerts** / **Laps**.

1. **Auto Lap** (default: every 1 km). At ~7 min/km the first lap
   chirp lands around 7:00. If you set Auto Lap to 0.5 km you'd get
   beeps at 7:00 *and* 7:30 from this alone. → **Laps** → **Auto
   Lap** → **Off** (the workout already lap-marks every step
   transition, so you don't lose splits).
2. **Pace Alert.** A "slow pace" alert beeps every time you drop
   below the threshold and then re-enter it — easy to produce paired
   beeps 30 s apart on an opening jog. → **Alerts** → any **Pace**
   entry → **Off** / delete.
3. **Heart-Rate Zone Alert.** If "Notify when entering / leaving
   zone" is on, the warm-up HR ramp bounces across a zone boundary
   and beeps each crossing. → **Alerts** → **Heart Rate** → **Off**.
4. **Repeat Timer / Time alert.** If you ever enabled the
   workaround #2 in the *Time until next loop* section, the time
   alert keeps firing at its interval. → **Alerts** → any **Time**
   entry with **Repeat = On** → **Off**.
5. **Sensor connect/disconnect.** A flaky pairing (Stryd dropping in
   and out of range, HRM-Pro briefly losing contact) chimes on every
   (re)connect. See the *Stryd / external sensors* section earlier —
   unpair or set Status = Off for sensors you don't need.
6. **Smart Notifications** from the phone — turn on **Do Not
   Disturb** during the run, or disable notifications for the Run
   profile under **Notifications**.

A clean Frontyard organizer-mode loop should produce exactly four
beep/vibrate events: one each at `COUNT DOWN 3`, `COUNT DOWN 2`,
`COUNT DOWN 1`, and the loop boundary. Anything else is one of the
six items above.

## Run the workout (end-to-end)

Once the `.fit` file is on the watch (see *Upload to watch* above):

1. **Find it.** On Fenix 7X, *Workouts* lives under the activity's
   pre-start menu, not under hold-UP (that opens Settings):
   - Press **START** from the watch face.
   - Highlight **Run** (or your cloned "Frontyard" profile) and press
     **START** → you're now on the pre-activity screen (GPS searching,
     HR icon, etc.).
   - Press and hold **MENU** → scroll to **Training** → **START**.
     (Single-tap **UP** also opens a context menu on some firmware
     versions, but hold-MENU is the reliable path on Fenix 7X.)
   - Open **Workouts** → **My Workouts** → highlight *Frontyard Org*
     (or *Frontyard Run*).
2. **Start it.** **START** → **Do Workout**. The watch returns to the
   pre-activity screen with the workout armed (you'll see the workout
   name and first step at the top of the data screen).
3. **Get GPS lock**, then press **START** to begin the timer. The
   watch immediately enters Step 1 — e.g. for loop 1 the countdown
   shows `27:00` and ticks down. At `0:00` it beeps + vibrates and
   advances to `COUNT DOWN 3 min`, then `COUNT DOWN 2 min`, then
   `COUNT DOWN 1 min`, then loop 2's main step. Four transitions =
   four beep clusters per loop boundary.
4. **During the run:**
   - **Do NOT press LAP** — it skips to the next workout step and
     breaks the −3 / −2 / −1 timing.
   - Pause: **STOP** (back-right). Resume: **START**.
   - Bail out: **STOP** → **End Workout** → *Save* or *Discard*.
5. **After the run.** The recorded *activity* `.fit` uploads
   automatically to Garmin Connect via Bluetooth (this is a
   different file from the workout plan — it's your actual run with
   GPS, HR, splits, etc.). The workout plan itself stays on the
   watch under *Training → Workouts* and can be reused for the next
   event.

## Show wall-clock time alongside the countdown

The `.fit` workout only declares the *steps* — which data fields appear
on screen during the workout is configured separately, on the watch's
**run profile** (Garmin calls these "data screens" / "training pages").
Once set up, the same layout is reused for every workout, organizer or
runner mode.

How to set it up:

**Fenix 7X (and 7 / 7S / Epix Gen 2 — same firmware family):**

The reliable path is via the global Settings menu (not the in-activity
hold-MENU shortcut, which on the 7X opens *Run Options* — a shorter
list that doesn't always include Data Screens):

1. From the watch face, **hold UP** (the top-left button — long-press,
   ~2 s) → the gear/Settings menu opens.
2. Scroll to **Activities & Apps** → press **START** to enter.
3. Scroll to **Run** (or your cloned "Frontyard" profile) → **START**.
4. Scroll down to **Data Screens** → **START**.
5. Pick **Screen 1** (or *Add New*) → **Layout** → choose a 2- to
   4-field layout, then assign fields per the table below.

Optional one-time profile clone (keeps your normal Run untouched):
*hold UP → Activities & Apps → Add → Run → rename to "Frontyard"*.
Then do steps 1–5 on the new profile.

If you'd rather not dig through Settings, the in-activity shortcut
also works on most firmware:
*press START → highlight Run → press START to enter the pre-activity
screen → **hold MENU** → look for **Data Screens** (may be one level
under "Run Options" or "Training Page Setup")*.

**Forerunner / older Fenix wording:** the same menu may be called
*Activity & App Settings → Data Screens* or *Training Pages*.

Then for each field slot, scroll to the category and pick:

   | Slot          | Field                                      |
   | ------------- | ------------------------------------------ |
   | 1 (big, top)  | **Timer → Time Remaining in Step** (the `-3:00` / `-2:00` / `-1:00` countdown) |
   | 2             | **Clock → Time of Day** (wall-clock)       |
   | 3             | **Timer → Step Time** (elapsed in current step) |
   | 4             | **Timer → Timer** (total workout elapsed)  |

Back out — changes save automatically. The next workout you start
uses this layout.

Tips:

- Many watches also show the time of day in a thin status bar at the
  very top of every screen. Toggle it via *Settings → System →
  Format → Time → Show on Top* (wording varies). With that on, you
  don't need a dedicated field slot for the clock.
- The setup is **per activity profile**, not per workout — do it once
  on your Frontyard / Run profile and every future `.fit` workout
  (organizer or runner) inherits it.

## "Time until next loop" — the big countdown caveat

The prominent timer on the data screen counts down the **current
step**, not the current loop. So on loop 1 you see four separate
countdowns back-to-back: `27:00 → 0:00` (main run), then `1:00 →
0:00` three times (the −3 / −2 / −1 warnings). There is no built-in
data field on Fenix 7 firmware ≥ 14.x that shows a single
`30:00 → 0:00` timer spanning the whole loop — that would require a
custom Connect IQ data field (see *Custom data field* below).

The workaround is **`Elapsed Time` + a printed lookup card**: the
script prints the per-loop schedule including an *Ends at* column
giving cumulative elapsed time at the end of each loop. Pair that
with the `Elapsed Time` data field on the watch and you always know
which loop you're in and when the next one starts.

### Recommended data screens (Fenix 7X firmware 26.x)

Set them up via *Run pre-start → hold MENU → Run Settings → Data
Screens → pick a screen → Edit → Layout: 4 fields*, then assign:

**Organizer mode (stationary at start/finish):**

| Slot | Field | Category | Shows |
|------|-------|----------|-------|
| 1 | **Step Time Remaining** | Workout / Timers | Countdown of the current step (27:00 → 0:00, then 1:00 × 3) |
| 2 | **Elapsed Time** | Time | Total time since Start — pair with the *Ends at* column on the lookup card to identify the current loop |
| 3 | **Time of Day** | Time | Wall-clock — useful for announcing "next loop starts at 14:30" |
| 4 | **Distance** (or **Heart Rate**) | Distance / HR | Anything you find useful; the watch still records distance for the activity file |

**Runner mode (actually running):**

| Slot | Field | Category | Shows |
|------|-------|----------|-------|
| 1 | **Step Time Remaining** | Workout / Timers | Countdown of the current step |
| 2 | **Lap Pace** | Pace | Your current pace, averaged over the current auto-lap (steadier than instantaneous **Pace**) |
| 3 | **Step Pace** | Workout | Target pace band — shows low / high with ▲ / ▼ arrows when outside it (empty in organizer mode) |
| 4 | **Heart Rate** or **Cadence** or **Distance** | various | Free slot |

Reading time-until-next-loop is then subtraction from Step Time
Remaining:

| You're in step                | Time-to-next-loop |
|-------------------------------|-------------------|
| Main run step                 | **Step Time Remaining + 3:00** |
| `COUNT DOWN 3 min` warning    | **Step Time Remaining + 2:00** |
| `COUNT DOWN 2 min` warning    | **Step Time Remaining + 1:00** |
| `COUNT DOWN 1 min` warning    | **Step Time Remaining** |

The four sharp beeps at −3 / −2 / −1 / 0 min remain the primary
"call out the warning" cue regardless of which data screen you use.

### Why `Step Time Remaining` starts at 27:00 on loop 1, not 30:00

A 30-minute loop is implemented as four workout steps (27 + 1 + 1 +
1 min) because Garmin watches only beep at step transitions. There
is no FIT-spec mechanism for sub-step alerts, so the only way to
produce four sharp beeps at −3 / −2 / −1 / 0 is to split the loop
into four steps. The trade-off is that the per-step timer starts at
27:00, not 30:00. Use `Elapsed Time` + the *Ends at* column for a
true loop-level view.

### Other workarounds

1. **Repeat Timer alert (beep-only, no data field).** Adds an
   *extra* beep every N minutes independent of the workout. Useful
   if you want a beep at wall-clock T + 30, 60, 90 … min that
   doesn't drift if you press Pause. From the Run profile: *hold
   UP → Activities & Apps → Run → Run Settings → Alerts → Add New →
   Time → 30:00 → Repeat → On*. Turn it off again before
   non-Frontyard runs.

2. **Custom Connect IQ data field.** A single per-loop countdown as
   one data field requires a custom Monkey C data field built with
   the Connect IQ SDK. Not provided here. The data field would
   read `Activity.Info.currentWorkoutStep` /
   `workoutStepRemainingTime` and sum across the remaining warning
   steps. Estimated effort: a weekend for someone comfortable with
   a Java/JS-like language.

### About `--enable-loop-timer`

This flag was added in the hope that Fenix 7's Workout category
would expose a *Time to Next Repeat* data field that could consume
the 1-iteration repeat blocks the flag adds. Firmware 26.09
(verified) does **not** expose any such field; turning it on adds a
`1/1` indicator on the active workout screen with no functional
benefit. **Leave it off on Fenix 7.** The flag remains in the
script in case a future firmware reintroduces the field, or you
sideload the same `.fit` onto an older device that still has it.

## Caveats

- **Step name length** — most watches truncate to ~16 chars on the
  active data screen. The full name is visible in the workout list.
  The notes field (long-press) carries the full info.
- **Don't press Lap mid-step** — that advances to the next workout
  step, which throws off the −3 / −2 / −1 timing.
- **Time-only steps** — the watch advances on wall-clock, not on GPS
  distance, regardless of mode. The SPEED target in `runner` mode
  drives the pace prompts but doesn't change *when* the step ends.
- **Short loops (< 4 min)** — the script drops the `-3` (and then `-2`)
  warning step automatically so the main run portion stays ≥ 1 min.
- **`Garmin/frontyard_*.fit`** are generated outputs; add
  `Garmin/*.fit` to `.gitignore` if you don't want to commit them.
