"""Generate a Garmin ``.fit`` workout file that mimics a Frontyard Ultra.

Each loop becomes 4 workout steps:

    1. Main run portion        - ``loop_minutes - 3`` minutes
    2. ``-3 min`` warning      - 1 minute
    3. ``-2 min`` warning      - 1 minute
    4. ``-1 min`` warning      - 1 minute

(With ``--enable-loop-timer`` a 5th, silent 1-iteration repeat
marker is appended to each loop so the watch's
*Time to Next Repeat* data field counts down to the next loop.)

Garmin watches beep/vibrate on every workout-step transition, so the
three trailing 1-minute steps produce audible warnings at -3, -2 and
-1 min before the next loop. The hand-off from step 4 of loop N to
step 1 of loop N+1 is the loop-boundary beep itself.

Frontyard rules (matching ``Dashboard.tsx`` and the README):

* Loop 1 lasts 30 min, each subsequent loop is 1 min shorter.
* ``--hold-loop`` is the loop from which the time-limit stops
  shrinking — all loops at or beyond that point reuse the same
  length (e.g. ``--hold-loop 17`` keeps loops 17..max at 14 min).
* ``--max-loops`` caps the total number of loops (≤ 27).
* Required pace is ``loop_minutes / loop_km`` (min:ss per km) and
  is embedded in the step name + notes.

Two modes (``--mode``):

* ``organizer`` (default) — every step has ``target_type = OPEN``, so
  the watch just counts down the step time. Useful when you're not
  actually running but using the watch as a race organizer's loop
  timer (no "speed up / slow down" prompts cluttering the screen).
* ``runner`` — the main run step of every loop gets an asymmetric
  ``SPEED`` target band:

    * slow side  — required pace + ``--upper-pace-band-pct``%
      (default +10%); watch prompts "speed up" if you fall below.
    * fast side  — absolute ``--fastest-pace`` floor (default
      ``4:00`` min/km); watch prompts "slow down" if you exceed it.

  The trailing 3/2/1-min warning steps stay OPEN so the alerts still
  fire cleanly on wall-clock time.

Requires::

    pip install fit-tool          # or: uv add fit-tool

Usage::

    python Garmin/generate_frontyard_workout.py \\
        --mode organizer \\
        --hold-loop 17 --max-loops 27 --loop-km 3.0 \\
        --output Garmin/frontyard_organizer.fit

    python Garmin/generate_frontyard_workout.py \\
        --mode runner --upper-pace-band-pct 10 --fastest-pace 4:00 \\
        --hold-loop 17 --max-loops 27 --loop-km 3.0 \\
        --output Garmin/frontyard_runner.fit

Then either:

* Plug the watch in (USB mass-storage), copy the ``.fit`` to
  ``GARMIN/NewFiles/`` and disconnect — the watch will import it on
  the next boot into *Training → Workouts*.
* Garmin Connect import is NOT supported for workout-type ``.fit``
  files (Connect only accepts activity files). To get the workout
  into Connect you have to rebuild it manually in *Training &
  Planning → Workouts → Create a Workout* using the per-loop summary
  the script prints.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path


def loop_minutes(loop: int, hold_loop: int, first_loop_min: int = 30) -> int:
    """Return the duration in minutes of frontyard loop ``loop``.

    Loop 1 = ``first_loop_min`` min (default 30), each subsequent
    loop is 1 min shorter, but the duration is capped at
    ``hold_loop`` -- every loop at or beyond ``hold_loop`` reuses the
    same length (``first_loop_min + 1 - hold_loop`` minutes).
    Useful for real-time testing: e.g. ``first_loop_min=5`` gives a
    full schedule that finishes in minutes instead of hours.
    """
    return first_loop_min + 1 - min(loop, hold_loop)


def format_pace(seconds_per_km: float) -> str:
    """Format a min/km pace as ``m:ss`` (e.g. ``10:00``)."""
    total_seconds = round(seconds_per_km)
    mins, secs = divmod(total_seconds, 60)
    return f"{mins}:{secs:02d}"


def parse_pace(text: str) -> int:
    """Parse a ``m:ss`` (or ``mm:ss``) min/km pace into seconds/km.

    Raises ``ValueError`` if the input is malformed.
    """
    parts = text.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"expected m:ss, got {text!r}")
    mins = int(parts[0])
    secs = int(parts[1])
    if mins < 0 or not (0 <= secs < 60):
        raise ValueError(f"invalid pace {text!r}")
    return mins * 60 + secs


def build_workout_bytes(
    *,
    hold_loop: int,
    max_loops: int,
    loop_km: float,
    workout_name: str,
    first_loop_min: int = 30,
    mode: str = "organizer",
    upper_pace_band_pct: float = 10.0,
    fastest_pace_sec: float = 240.0,
    pink_loop: int | None = 10,
    green_loop: int | None = 15,
    enable_loop_timer: bool = False,
) -> bytes:
    """Return the binary contents of the generated ``.fit`` workout.

    ``mode``:
        ``"organizer"`` -- every step is OPEN-targeted (time-only).
        ``"runner"``    -- main run step uses an asymmetric SPEED
                          target band:
                            * slow side (upper pace, lower speed) =
                              required pace + ``upper_pace_band_pct``%
                              -- "speed up" prompt if you fall below.
                            * fast side (lower pace, upper speed) =
                              absolute ``fastest_pace_sec`` floor
                              -- "slow down" prompt if you go below
                              that pace, regardless of loop.
                          Warning steps stay OPEN.

    ``enable_loop_timer``:
        When True, each loop's 4 steps are wrapped in a 1-iteration
        repeat block so the watch's "Time to Next Repeat" data field
        counts down across all 4 steps to the start of the next loop
        (instead of only the current step). Adds one extra step per
        loop (the repeat marker); has no audible effect.
    """
    try:
        from fit_tool.fit_file_builder import FitFileBuilder
        from fit_tool.profile.messages.file_id_message import FileIdMessage
        from fit_tool.profile.messages.workout_message import WorkoutMessage
        from fit_tool.profile.messages.workout_step_message import (
            WorkoutStepMessage,
        )
        from fit_tool.profile.profile_type import (
            FileType,
            Intensity,
            Manufacturer,
            Sport,
            WorkoutStepDuration,
            WorkoutStepTarget,
        )
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "fit-tool is required. Install with:  pip install fit-tool"
        ) from exc

    file_id = FileIdMessage()
    file_id.type = FileType.WORKOUT
    file_id.manufacturer = Manufacturer.DEVELOPMENT.value
    file_id.product = 0
    file_id.time_created = round(_dt.datetime.now().timestamp() * 1000)
    file_id.serial_number = 0x12345678

    steps: list[object] = []
    step_index = 0

    for loop in range(1, max_loops + 1):
        loop_start_index = step_index
        minutes = loop_minutes(loop, hold_loop, first_loop_min)
        pace_str = format_pace((minutes * 60) / loop_km)

        # Jersey label prefix for the loop that "defines" each jersey.
        # Shown both in the (truncated) data-screen step name and in
        # the long-press notes.
        if loop == pink_loop:
            jersey = "PINK"
        elif loop == green_loop:
            jersey = "GREEN"
        else:
            jersey = None
        jersey_prefix = f"[{jersey} JERSEY] " if jersey else ""

        # We always want at least 1 min of main-run time, so for very
        # short loops we drop trailing warnings starting from -3.
        warnings = [w for w in (3, 2, 1) if minutes - w >= 1]
        main_minutes = minutes - len(warnings)

        # Main run step.
        main_step = WorkoutStepMessage()
        main_step.message_index = step_index
        base_name = f"L{loop}/{max_loops} {minutes}min {pace_str}/km"
        main_step.workout_step_name = (
            f"{jersey} {base_name}" if jersey else base_name
        )[:50]
        main_step.intensity = Intensity.ACTIVE
        main_step.duration_type = WorkoutStepDuration.TIME
        # fit-tool's `duration_value` writes the raw uint32 (ms).
        # Don't use `duration_time = seconds`: that setter writes
        # raw=seconds, which the watch reads as ms (x1000 too short).
        main_step.duration_value = float(main_minutes * 60 * 1000)
        if mode == "runner":
            # Asymmetric SPEED target band:
            #   slow side - % below required pace (lower speed bound).
            #   fast side - absolute pace floor (upper speed bound).
            # Absolute fast side because later loops require faster
            # pace; a symmetric +/-% there would be unreasonably tight.
            req_speed = (loop_km * 1000.0) / (minutes * 60.0)  # m/s
            low_speed = req_speed * (1.0 - upper_pace_band_pct / 100.0)
            high_speed = 1000.0 / fastest_pace_sec  # m/s
            # If the loop already requires faster than fastest_pace,
            # fall back to a symmetric +% upper bound.
            if high_speed <= req_speed:
                high_speed = req_speed * (1.0 + upper_pace_band_pct / 100.0)
            kmh = req_speed * 3.6
            fast_pace_str = format_pace(fastest_pace_sec)
            main_step.target_type = WorkoutStepTarget.SPEED
            main_step.custom_target_speed_low = max(0.0, low_speed)
            main_step.custom_target_speed_high = high_speed
            main_step.notes = (
                f"{jersey_prefix}"
                f"Loop {loop}: {loop_km:g} km in {minutes} min "
                f"({pace_str} min/km, {kmh:.1f} km/h, "
                f"slow +{upper_pace_band_pct:g}% / fast {fast_pace_str} min/km)"
            )
        else:
            kmh = (loop_km * 60.0) / minutes
            main_step.target_type = WorkoutStepTarget.OPEN
            main_step.notes = (
                f"{jersey_prefix}"
                f"Loop {loop}: {loop_km:g} km in {minutes} min "
                f"({pace_str} min/km, {kmh:.1f} km/h)"
            )
        steps.append(main_step)
        step_index += 1

        # 1-minute warning steps. Watches beep + vibrate at every step
        # transition, so each of these acts as a 3/2/1-min countdown
        # alarm before the next loop starts.
        for warn in warnings:
            warning_step = WorkoutStepMessage()
            warning_step.message_index = step_index
            # Clear, language-neutral step name.
            warning_step.workout_step_name = f"COUNT DOWN {warn} min"
            # ACTIVE for every warning step: other intensities
            # (WARMUP/COOLDOWN/REST/INTERVAL) get translated to the
            # watch's UI language (e.g. Norwegian "Nedvarming" for
            # COOLDOWN). ACTIVE shows the step name as-is.
            warning_step.intensity = Intensity.ACTIVE
            warning_step.duration_type = WorkoutStepDuration.TIME
            warning_step.duration_value = 60_000.0  # 60 s in ms
            warning_step.target_type = WorkoutStepTarget.OPEN
            if loop < max_loops:
                next_loop_minutes = loop_minutes(
                    loop + 1, hold_loop, first_loop_min
                )
                warning_step.notes = (
                    f"COUNT DOWN {warn} min - Loop {loop} "
                    f"-> next loop {next_loop_minutes} min"
                )
            else:
                warning_step.notes = (
                    f"COUNT DOWN {warn} min - final loop {loop}"
                )
            steps.append(warning_step)
            step_index += 1

        # Optional 1-iteration repeat marker so the watch's
        # "Time to Next Repeat" data field counts down across all
        # 4 steps to the start of the next loop. The marker itself
        # has no audible/visible effect during the run.
        if enable_loop_timer:
            repeat = WorkoutStepMessage()
            repeat.message_index = step_index
            repeat.intensity = Intensity.ACTIVE
            repeat.duration_type = WorkoutStepDuration.REPEAT_UNTIL_STEPS_CMPLT
            # duration_value = index of the first step in the block.
            repeat.duration_value = float(loop_start_index)
            # target_value = total iterations (1 = run the block once).
            repeat.target_type = WorkoutStepTarget.OPEN
            repeat.target_value = 1
            steps.append(repeat)
            step_index += 1

    workout = WorkoutMessage()
    workout.workout_name = workout_name[:50]
    workout.sport = Sport.RUNNING
    workout.num_valid_steps = len(steps)

    builder = FitFileBuilder(auto_define=True, min_string_size=50)
    builder.add(file_id)
    builder.add(workout)
    builder.add_all(steps)
    fit_file = builder.build()
    return bytes(fit_file.to_bytes())


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a Garmin .fit workout that mimics a Frontyard Ultra "
            "(per-loop countdown with 3/2/1-min warnings)."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--hold-loop",
        type=int,
        default=17,
        help="Loop from which the loop time-limit stops shrinking (>= 1).",
    )
    parser.add_argument(
        "--first-loop-min",
        type=int,
        default=30,
        help=(
            "Duration of loop 1 in minutes (default 30). Each "
            "subsequent loop is 1 min shorter until --hold-loop. "
            "Set this low (e.g. 5) to test the full schedule in "
            "real time without waiting hours."
        ),
    )
    parser.add_argument(
        "--max-loops",
        type=int,
        default=27,
        help="Total number of loops (must be >= --hold-loop).",
    )
    parser.add_argument(
        "--loop-km",
        type=float,
        default=3.0,
        help="Loop distance in kilometres (drives the required pace).",
    )
    parser.add_argument(
        "--mode",
        choices=("organizer", "runner"),
        default="organizer",
        help=(
            "organizer: time-only steps (no speed prompts); "
            "runner: main step has a SPEED target band so the watch "
            "shows current pace and 'speed up / slow down' prompts."
        ),
    )
    parser.add_argument(
        "--upper-pace-band-pct",
        type=float,
        default=10.0,
        help=(
            "Runner mode only: slow-side (upper-pace) tolerance "
            "above the required pace, as a percent. Defines the "
            "lower speed bound - 'speed up' prompt if you drop below."
        ),
    )
    parser.add_argument(
        "--fastest-pace",
        default="4:00",
        help=(
            "Runner mode only: absolute fastest pace allowed "
            "(m:ss per km). Defines the upper speed bound - "
            "'slow down' prompt if you exceed it. Independent of loop."
        ),
    )
    parser.add_argument(
        "--pink-loop",
        type=int,
        default=10,
        help=(
            "Loop number to tag with the PINK jersey label "
            "(prepended to the main step name). Use 0 to disable."
        ),
    )
    parser.add_argument(
        "--green-loop",
        type=int,
        default=15,
        help=(
            "Loop number to tag with the GREEN jersey label "
            "(prepended to the main step name). Use 0 to disable."
        ),
    )
    parser.add_argument(
        "--name",
        default="Frontyard Ultra",
        help="Workout name shown on the watch.",
    )
    parser.add_argument(
        "--enable-loop-timer",
        action="store_true",
        help=(
            "EXPERIMENTAL. Wrap each loop's 4 steps in a 1-iteration "
            "repeat block, intended for watches that expose a "
            "'Repeat Timer' / 'Time to Next Repeat' data field. "
            "Fenix 7 firmware >= 14.x does NOT expose such a field, "
            "so on those watches the flag only adds a '1/1' banner "
            "during the run with no functional benefit. Leave off "
            "unless you have a device that uses the field."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("Garmin/frontyard.fit"),
        help="Output .fit file path.",
    )
    args = parser.parse_args(argv)
    if args.hold_loop < 1:
        parser.error("--hold-loop must be >= 1")
    if args.max_loops < args.hold_loop:
        parser.error("--max-loops must be >= --hold-loop")
    if args.first_loop_min < 1:
        parser.error("--first-loop-min must be >= 1")
    if args.hold_loop > args.first_loop_min:
        parser.error(
            "--hold-loop must be <= --first-loop-min so the shortest "
            "loop is still >= 1 min"
        )
    if args.loop_km <= 0:
        parser.error("--loop-km must be > 0")
    if not (0 < args.upper_pace_band_pct < 100):
        parser.error("--upper-pace-band-pct must be between 0 and 100 (exclusive)")
    try:
        args.fastest_pace_sec = parse_pace(args.fastest_pace)
    except ValueError as exc:
        parser.error(f"--fastest-pace: {exc}")
    if args.fastest_pace_sec <= 0:
        parser.error("--fastest-pace must be > 0:00")
    for flag, val in (("--pink-loop", args.pink_loop),
                       ("--green-loop", args.green_loop)):
        if val != 0 and not (1 <= val <= args.max_loops):
            parser.error(f"{flag} must be 0 (disabled) or in 1..--max-loops")
    if (args.pink_loop != 0 and args.green_loop != 0
            and args.pink_loop == args.green_loop):
        parser.error("--pink-loop and --green-loop must differ")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    data = build_workout_bytes(
        hold_loop=args.hold_loop,
        max_loops=args.max_loops,
        loop_km=args.loop_km,
        workout_name=args.name,
        first_loop_min=args.first_loop_min,
        mode=args.mode,
        upper_pace_band_pct=args.upper_pace_band_pct,
        fastest_pace_sec=args.fastest_pace_sec,
        pink_loop=args.pink_loop or None,
        green_loop=args.green_loop or None,
        enable_loop_timer=args.enable_loop_timer,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)

    # Print a per-loop summary so the user can sanity-check the
    # schedule and use it as an organizer-side lookup card. The
    # "Ends at" column is the cumulative Elapsed Time on the watch
    # at the end of each loop -- pair it with the Elapsed Time data
    # field to identify the current loop without an on-watch step
    # name display.
    print(f"Wrote {len(data)} bytes to {args.output} (mode={args.mode})")
    header = (
        f"{'Loop':>4}  {'Min':>4}  {'Pace':>8}  {'Speed':>8}  "
        f"{'Ends at':>8}  Jersey"
    )
    print(header)
    cumulative_minutes = 0
    for loop in range(1, args.max_loops + 1):
        minutes = loop_minutes(loop, args.hold_loop, args.first_loop_min)
        cumulative_minutes += minutes
        pace_str = format_pace((minutes * 60) / args.loop_km)
        kmh = (args.loop_km * 60.0) / minutes
        ends_h, ends_m = divmod(cumulative_minutes, 60)
        ends_at = f"{ends_h}:{ends_m:02d}:00"
        if loop == args.pink_loop and args.pink_loop != 0:
            jersey = "PINK"
        elif loop == args.green_loop and args.green_loop != 0:
            jersey = "GREEN"
        else:
            jersey = ""
        print(
            f"{loop:>4}  {minutes:>4}  {pace_str:>6}/km  "
            f"{kmh:>5.1f} km/h  {ends_at:>8}  {jersey}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
