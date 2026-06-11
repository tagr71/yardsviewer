using Toybox.Application;
using Toybox.Attention;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Math;
using Toybox.System;
using Toybox.WatchUi;

// Fictive runner paces (sec/km): GREEN fastest, RED slowest.
// The yellow pacer was removed from the display but its pace is kept
// as YELLOW_SEC_PER_KM for (a) auto-advancing the simulated blue
// runner in support sim mode and (b) the silent every-loop crew vibe.
var FICTIVE_PACES_SEC_PER_KM = [245, 275];
var FICTIVE_PACE_LABELS      = ["4:05", "4:35"];
const YELLOW_SEC_PER_KM = 260;

// Full-screen Connect IQ data field for fixed-duration "timed" ultras
// (6 / 12 / 24 hour events) on a fixed loop course.
//
// Two modes (settings toggle):
//   support  - crew view (default). Distance is derived from a manual
//              loop count (the support presses the lap button on each
//              completed loop) times the configured loop length.
//              Displays a sliding window of _loopsPerCircle loop ticks
//              with two fictive pacers (green/red), the blue
//              actual runner dot, lap-pace stats and a finish projection.
//   runner   - silent runner view. Distance comes from GPS
//              (info.elapsedDistance). Shows a single blue dot sliding
//              around the same _loopsPerCircle window plus a text
//              stack: small countdown at the top, small distance at
//              the bottom, and three large center rows (avg pace /km,
//              live loop /lp, avg loop /lp - the avg loop in blue).
//
// Lap-press correction (support mode only - runner mode ignores laps):
//   1 press                 -> +1 loop  (3-bell alert)
//   2 presses within window -> +2 loops (caught a missed lap; 2 bells)
//   3+ presses              -> -1 loop  (undo last lap; 1 bell)
//
// Alerts (support mode only):
//   * lap-press feedback (see above)
//   * 1 beep at 1 minute remaining
//   * 3 beeps at race finish
//   * gentle vibe every simulated yellow-pace (4:20/km) loop
class UltraLoopTimerView extends WatchUi.DataField {

    // --- config ---
    private var _supportMode;        // true = support/crew view (no HR/pace)
    private var _raceSec;            // total race duration in seconds
    private var _loopMeters;         // Float; meters per loop
    private var _loopsPerCircle;     // how many fastest-runner loops fill one ring revolution
    private var _correctionWindowSec;// max seconds between lap presses in a correction burst

    // --- displayed values ---
    private var _timeToFinish;       // seconds remaining in the race
    private var _elapsedSec;         // race elapsed time in seconds
    private var _totalDistanceM;     // meters covered so far
    private var _completedLoops;     // manually incremented on lap press (support); derived from distance (runner)
    private var _lastLoopElapsedSec; // elapsedSec value at the last lap press
    private var _prevLoopElapsedSec; // elapsedSec value at the previous lap press (for undo)
    private var _lastLoopSec;        // duration of the most recently completed loop
    private var _avgLoopSec;         // average seconds per loop so far; 0 when n/a
    private var _avgPaceMinPerKm;    // min/km; 0 when n/a
    private var _projectedKm;        // projected total distance at finish, km (support mode)
    private var _done;
    private var _prevTimeToFinish;   // for 1-minute threshold detection
    private var _burstStartSec;      // elapsedSec at first press of current burst (-1 if none)
    private var _burstCount;         // number of lap presses in the current burst
    private var _yellowLoopsDone;    // integer loops the yellow fictive runner has finished
    private var _liveLoopSec;        // current loop's instantaneous duration (sec); 0 when n/a

    function initialize() {
        DataField.initialize();
        _supportMode        = true;
        _timeToFinish       = 0;
        _elapsedSec         = 0;
        _totalDistanceM     = 0.0;
        _completedLoops     = 0;
        _lastLoopElapsedSec = 0;
        _prevLoopElapsedSec = 0;
        _lastLoopSec        = 0;
        _avgLoopSec         = 0;
        _avgPaceMinPerKm    = 0.0;
        _projectedKm        = 0.0;
        _done               = false;
        _prevTimeToFinish   = -1;
        _burstStartSec      = -1;
        _burstCount         = 0;
        _yellowLoopsDone    = 0;
        _liveLoopSec        = 0;
        rebuildSchedule();
    }

    // Called by the system when the user presses the lap button.
    // Support mode only - in runner mode the press is ignored.
    // Each press joins a short burst (window = _correctionWindowSec)
    // and the burst is finalized in compute() once the window expires:
    //   1 press   -> +1 loop  (normal lap; 3-bell alert)
    //   2 presses -> +2 loops (missed lap caught; 2-bell alert)
    //   3+ presses-> -1 loop  (undo last lap; 1-bell alert + restore prev lap timestamp)
    function onTimerLap() {
        if (!_supportMode) { return; }
        var now = _elapsedSec;
        if (_burstStartSec >= 0 && (now - _burstStartSec) <= _correctionWindowSec) {
            _burstCount += 1;
        } else {
            _burstStartSec = now;
            _burstCount    = 1;
        }
        // Brief click so support knows the press was registered.
        ringBell(1);
        WatchUi.requestUpdate();
    }

    // Reset loop count when a new activity / lap session begins.
    function onTimerReset() {
        _completedLoops     = 0;
        _lastLoopElapsedSec = 0;
        _prevLoopElapsedSec = 0;
        _lastLoopSec        = 0;
        _burstStartSec      = -1;
        _burstCount         = 0;
        _yellowLoopsDone    = 0;
    }

    // Apply the accumulated burst once its window has expired.
    function finalizeBurst() {
        var n        = _burstCount;
        var startSec = _burstStartSec;
        _burstStartSec = -1;
        _burstCount    = 0;
        if (n <= 0) { return; }

        if (n <= 2) {
            // Positive correction: 1 = normal lap, 2 = +1 missed lap caught.
            var loopSec = startSec - _lastLoopElapsedSec;
            if (loopSec < 0) { loopSec = 0; }
            _prevLoopElapsedSec = _lastLoopElapsedSec;
            _lastLoopSec        = loopSec;
            _lastLoopElapsedSec = startSec;
            _completedLoops    += n;
            ringBell(n == 1 ? 3 : 2);
        } else {
            // 3+ presses within window = undo last lap (1-level deep).
            if (_completedLoops > 0) {
                _completedLoops    -= 1;
                _lastLoopElapsedSec = _prevLoopElapsedSec;
                _lastLoopSec        = 0;
            }
            ringBell(1);
        }
    }

    function readNumber(key, fallback) {
        var v = null;
        try {
            v = Application.getApp().getProperty(key);
        } catch (ex) {
            return fallback;
        }
        if (v == null) { return fallback; }
        if (v instanceof Lang.Number) { return v; }
        if (v instanceof Lang.Float) { return v.toNumber(); }
        if (v instanceof Lang.String) {
            try { return v.toNumber(); } catch (ex2) { return fallback; }
        }
        return fallback;
    }

    function readFloat(key, fallback) {
        var v = null;
        try {
            v = Application.getApp().getProperty(key);
        } catch (ex) {
            return fallback;
        }
        if (v == null) { return fallback; }
        if (v instanceof Lang.Float)  { return v; }
        if (v instanceof Lang.Number) { return v.toFloat(); }
        if (v instanceof Lang.String) {
            try { return v.toFloat(); } catch (ex2) { return fallback; }
        }
        return fallback;
    }

    function readString(key, fallback) {
        var v = null;
        try {
            v = Application.getApp().getProperty(key);
        } catch (ex) {
            return fallback;
        }
        if (v == null) { return fallback; }
        if (v instanceof Lang.String) { return v; }
        return v.toString();
    }

    function readBool(key, fallback) {
        var v = null;
        try {
            v = Application.getApp().getProperty(key);
        } catch (ex) {
            return fallback;
        }
        if (v == null) { return fallback; }
        if (v instanceof Lang.Boolean) { return v; }
        if (v instanceof Lang.Number)  { return v != 0; }
        if (v instanceof Lang.String)  { return v.equals("true") || v.equals("1"); }
        return fallback;
    }

    public function rebuildSchedule() {
        _supportMode = readBool("supportMode", true);

        var hours = readNumber("raceHours", 6);
        if (hours < 1)  { hours = 1; }
        if (hours > 72) { hours = 72; }
        _raceSec = hours * 3600;

        _loopMeters = readFloat("loopMeters", 1185.6);
        if (_loopMeters < 1.0) { _loopMeters = 1.0; }

        _loopsPerCircle = readNumber("loopsPerCircle", 8);
        if (_loopsPerCircle < 1)  { _loopsPerCircle = 1; }
        if (_loopsPerCircle > 50) { _loopsPerCircle = 50; }

        _correctionWindowSec = readNumber("correctionWindowSec", 5);
        if (_correctionWindowSec < 1)  { _correctionWindowSec = 1; }
        if (_correctionWindowSec > 10) { _correctionWindowSec = 10; }

        _done = false;
    }

    function onLayout(dc) {
        // Custom drawing in onUpdate; no precomputed layout.
    }

    function compute(info) {
        if (info == null) { return; }

        var elapsedMs = info.elapsedTime;
        var elapsed   = elapsedMs != null ? (elapsedMs / 1000).toNumber() : 0;
        _elapsedSec = elapsed;

        // Finalize any pending lap-press burst whose window has expired.
        if (_burstStartSec >= 0 && (_elapsedSec - _burstStartSec) > _correctionWindowSec) {
            finalizeBurst();
        }

        // Vibrate once every time a simulated yellow-pace (4:20/km)
        // loop completes. Silent (no tone) so it does not compete with
        // the manual lap-press feedback.
        if (_supportMode && _loopMeters > 0 && _elapsedSec > 0) {
            var yellowLoopSec = YELLOW_SEC_PER_KM.toFloat()
                              * (_loopMeters.toFloat() / 1000.0);
            if (yellowLoopSec > 0) {
                var yellowLoops = (_elapsedSec.toFloat() / yellowLoopSec).toNumber();
                if (yellowLoops > _yellowLoopsDone) {
                    _yellowLoopsDone = yellowLoops;
                    vibrateOnly(1);
                }
            }
        }

        // Mode-split simulation:
        //   support : assume blue (actual) runner runs at YELLOW pace.
        //             Auto-advance _completedLoops and stamp _lastLoopSec
        //             on each simulated lap so loop / avg pace update.
        //   runner  : distance comes from GPS (info.elapsedDistance).
        //             Falls back to a dev-time 4:20/km simulation when
        //             no GPS distance is available. Loop count is derived
        //             from distance.
        if (_supportMode) {
            if (_loopMeters > 0 && _elapsedSec > 0) {
                var simLoopSec = YELLOW_SEC_PER_KM.toFloat()
                               * (_loopMeters.toFloat() / 1000.0);
                if (simLoopSec > 0) {
                    var simLoops = (_elapsedSec.toFloat() / simLoopSec).toNumber();
                    while (_completedLoops < simLoops) {
                        _completedLoops    += 1;
                        _prevLoopElapsedSec = _lastLoopElapsedSec;
                        _lastLoopElapsedSec = (_completedLoops.toFloat() * simLoopSec).toNumber();
                        _lastLoopSec        = simLoopSec.toNumber();
                    }
                }
            }
            _totalDistanceM = _completedLoops * _loopMeters;
        } else {
            // Runner mode: strictly GPS-driven. When the watch is not
            // moving (no elapsedDistance / no currentSpeed) distance,
            // live loop and avg loop all stay at 0.
            var distM = 0.0;
            var d     = info.elapsedDistance;
            if (d != null && d > 0) {
                distM = d.toFloat();
            }
            _totalDistanceM = distM;
            if (_loopMeters > 0) {
                _completedLoops = (distM / _loopMeters).toNumber();
                var sp = info.currentSpeed;
                if (sp != null && sp > 0.1) {
                    _liveLoopSec = (_loopMeters.toFloat() / sp.toFloat()).toNumber();
                } else {
                    _liveLoopSec = 0;
                }
            }
        }

        // Race time remaining.
        var remaining = _raceSec - elapsed;
        if (remaining < 0) { remaining = 0; }

        // 1-minute warning + race-finish alerts (support mode only;
        // runner mode is fully silent).
        if (!_done) {
            if (_supportMode) {
                if (_prevTimeToFinish > 60 && remaining <= 60 && remaining > 0) {
                    ringBell(1);
                }
                if (_prevTimeToFinish > 0 && remaining <= 0) {
                    ringBell(3);
                    _done = true;
                }
            } else {
                if (_prevTimeToFinish > 0 && remaining <= 0) {
                    _done = true;
                }
            }
        }
        _prevTimeToFinish = remaining;
        _timeToFinish     = remaining;

        // Average loop time + derived avg pace + projected total distance.
        // Projection = distance already covered + extrapolation over the
        // REMAINING race time at the *current* loop pace. Current pace
        // prefers the most recent completed loop (_lastLoopSec) so the
        // projection reacts to slowing/speeding up; falls back to the
        // running average when a fresh lap time is not yet available.
        if (_completedLoops > 0 && elapsed > 0) {
            _avgLoopSec      = (elapsed.toFloat() / _completedLoops.toFloat()).toNumber();
            _avgPaceMinPerKm = loopSecToPaceMinPerKm(_avgLoopSec);
            var curLoopSec   = _lastLoopSec > 0 ? _lastLoopSec : _avgLoopSec;
            var doneKm       = _totalDistanceM.toFloat() / 1000.0;
            var futureLoops  = curLoopSec > 0
                             ? (remaining.toFloat() / curLoopSec.toFloat())
                             : 0.0;
            _projectedKm     = doneKm + (futureLoops * _loopMeters.toFloat()) / 1000.0;
        } else {
            _avgLoopSec      = 0;
            _avgPaceMinPerKm = 0.0;
            _projectedKm     = 0.0;
        }

        // Runner mode: refine the avg from continuous distance so it is
        // available before the first full loop completes.
        if (!_supportMode && _totalDistanceM > 0 && elapsed > 0) {
            _avgLoopSec      = (elapsed.toFloat() * _loopMeters.toFloat()
                              / _totalDistanceM.toFloat()).toNumber();
            _avgPaceMinPerKm = loopSecToPaceMinPerKm(_avgLoopSec);
        }
    }

    function onUpdate(dc) {
        var bg = getBackgroundColor();
        var fg = bg == Graphics.COLOR_BLACK ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        dc.setColor(bg, bg);
        dc.clear();
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        var w  = dc.getWidth();
        var h  = dc.getHeight();
        var cx = w / 2;
        var ringPen = 44;
        var ringCx  = (w - 1) / 2.0;
        var ringCy  = (h - 1) / 2.0;

        if (_supportMode) {
            drawFictiveRunners(dc, w, h, ringPen, ringCx, ringCy, fg);
            drawLapMarkers(dc, w, h, ringPen, ringCx, ringCy, fg);
            drawActualRunnerDot(dc, w, h, ringPen, ringCx, ringCy, fg);
        } else {
            // Minimal runner-mode view: blue runner dot sliding around
            // the loop window, loop-number labels, and a hero text stack.
            drawRunnerDot(dc, w, h, ringPen, ringCx, ringCy, fg);
            drawLoopNumberLabels(dc, w, h, ringPen, ringCx, ringCy, fg);
            renderRunnerHero(dc, w, h, ringPen, fg);
            return;
        }

        // Hero strings.
        var loopsStr;
        var timeStr;
        var projStr;
        if (_done) {
            loopsStr = "DONE";
            timeStr  = "00:00:00";
        } else {
            var doneKm = (_completedLoops * _loopMeters).toFloat() / 1000.0;
            loopsStr = _completedLoops.toString() + " loops ("
                     + doneKm.format("%.1f") + " km)";
            timeStr  = fmtHmsAlways(_timeToFinish);
        }
        projStr = "proj " + (_projectedKm > 0.0 ? _projectedKm.format("%.1f") : "--.-") + " km";

        var clock    = System.getClockTime();
        var clockStr = clock.hour.format("%02d") + ":"
                     + clock.min.format("%02d")  + ":"
                     + clock.sec.format("%02d");

        // Font sizes.
        var fSmall   = Graphics.FONT_TINY;
        var fLoops   = Graphics.FONT_SMALL;   // smaller than the rest for the loops row
        var fClock   = Graphics.FONT_SMALL;
        var fHero    = Graphics.FONT_MEDIUM;  // countdown clock; smaller, plain text font
        var fProj    = Graphics.FONT_LARGE;   // bigger black proj km row (plain text font)

        var hLoops   = Graphics.getFontHeight(fLoops);
        var hClock   = Graphics.getFontHeight(fClock);
        var hHero    = Graphics.getFontHeight(fHero);
        var hProj    = Graphics.getFontHeight(fProj);
        var hStat    = Graphics.getFontHeight(fSmall);

        var donutInset = ringPen / 2 + 6;
        var sumRows = hLoops + hHero + hStat + hProj + hClock;
        var avail   = h - 2 * donutInset;
        var gap     = (avail - sumRows) / 4;
        if (gap < 0) { gap = 0; }

        var yTop   = donutInset;
        var yHero  = yTop  + hLoops + gap;
        var yStat  = yHero + hHero  + gap;
        var yProj  = yStat + hStat  + gap;
        var yClock = yProj + hProj  + gap;

        // Row 1: loops completed (blue; increases on each manual lap press).
        var loopsColor = (!_done && _completedLoops > 0 && _completedLoops % 10 == 0)
                       ? Graphics.COLOR_GREEN : Graphics.COLOR_BLUE;
        dc.setColor(loopsColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, yTop, fLoops, loopsStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Row 2: race time remaining (countdown; uses fg so it adapts to bg).
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, yHero, fHero, timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Row 3: loop pace + avg pace (support mode).
        drawStatRow(dc, w, yStat, fSmall, fg);

        // Row 4: projected km (uses fg so it adapts to bg).
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, yProj, fProj, projStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Row 5: real-time clock.
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, yClock, fClock, clockStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Loop-number labels around the ring, drawn LAST so they sit on
        // top of any dots.
        drawLoopNumberLabels(dc, w, h, ringPen, ringCx, ringCy, fg);
    }

    // Fictive runners chase the loop at fixed paces (see
    // FICTIVE_PACES_SEC_PER_KM). The full ring represents _loopsPerCircle
    // loops by the FASTEST runner, so the green dot completes one full
    // revolution after that many of its own loops. Slower runners share
    // the same angular scale (so they visibly lag green), each advancing
    // by 1 / (loopsPerCircle * loopSec_self) of a revolution per second.
    // Each dot is rendered as a small colored badge with the runner's
    // current completed-loop count drawn in black on top.
    function drawFictiveRunners(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_loopMeters <= 0 || _loopsPerCircle <= 0) { return; }
        var colors   = [Graphics.COLOR_GREEN,
                        Graphics.COLOR_RED];
        var loopKm   = _loopMeters.toFloat() / 1000.0;
        var screenR  = (w < h ? w : h) / 2;
        var dotRad   = ringPen / 3;                          // big enough for a 1-2 digit number
        var runnerR  = screenR - ringPen / 4;                // dot band (on ring)
        var labelR   = screenR - ringPen - 4;                // just inside donut
        var fLabel   = Graphics.FONT_XTINY;
        var hLabel   = Graphics.getFontHeight(fLabel);
        var fCount   = Graphics.FONT_XTINY;
        var hCount   = Graphics.getFontHeight(fCount);

        for (var i = 0; i < FICTIVE_PACES_SEC_PER_KM.size(); i += 1) {
            var loopSec = FICTIVE_PACES_SEC_PER_KM[i] * loopKm;
            if (loopSec <= 0) { continue; }
            var revPerSec = 1.0 / (_loopsPerCircle.toFloat() * loopSec);
            var frac      = _elapsedSec.toFloat() * revPerSec;
            frac          = frac - Math.floor(frac);
            var theta     = (90.0 - 360.0 * frac) * Math.PI / 180.0;
            var cosT      = Math.cos(theta);
            var sinT      = Math.sin(theta);
            var gx        = ringCx + (runnerR * cosT).toNumber();
            var gy        = ringCy - (runnerR * sinT).toNumber();

            // Dot with black outline.
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(gx, gy, dotRad + 2);
            dc.setColor(colors[i], Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(gx, gy, dotRad);

            // Completed loop count on top of the dot.
            var doneLoops = (_elapsedSec.toFloat() / loopSec).toNumber();
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.drawText(gx, gy - hCount / 2, fCount, doneLoops.toString(),
                        Graphics.TEXT_JUSTIFY_CENTER);

            // Pace label inside the ring, on the same radial as the dot.
            var lx = ringCx + (labelR * cosT).toNumber();
            var ly = ringCy - (labelR * sinT).toNumber();
            dc.setColor(colors[i], Graphics.COLOR_TRANSPARENT);
            dc.drawText(lx, ly - hLabel / 2, fLabel, FICTIVE_PACE_LABELS[i],
                        Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Blue dot for the *actual* runner in support mode. Position is
    // discrete: it sits exactly on the tick of the most recently lapped
    // loop (_completedLoops mod _loopsPerCircle) and only moves when the
    // support presses the lap button. Lapped loop count is drawn in
    // black on top of the dot.
    function drawActualRunnerDot(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_loopsPerCircle <= 0) { return; }
        var frac = _completedLoops.toFloat() / _loopsPerCircle.toFloat();
        frac = frac - Math.floor(frac);
        var theta   = (90.0 - 360.0 * frac) * Math.PI / 180.0;
        var dotRad  = ringPen / 3;
        var runnerR = (w < h ? w : h) / 2 - ringPen / 4;
        var gx      = ringCx + (runnerR * Math.cos(theta)).toNumber();
        var gy      = ringCy - (runnerR * Math.sin(theta)).toNumber();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(gx, gy, dotRad + 2);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(gx, gy, dotRad);

        var fCount = Graphics.FONT_XTINY;
        var hCount = Graphics.getFontHeight(fCount);
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.drawText(gx, gy - hCount / 2, fCount, _completedLoops.toString(),
                    Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Small blue markers on the ring at each completed lap boundary
    // (support mode). One marker per loop completed *within the current
    // _loopsPerCircle-loop window*. The window is driven by the fastest
    // of {blue actual runner, green fictive runner} - same rule as the
    // loop number labels - so when blue or green crosses the next
    // multiple of _loopsPerCircle the window advances and the markers
    // reset.
    function drawLapMarkers(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_loopsPerCircle <= 0 || _completedLoops <= 0) { return; }
        var loopKm   = _loopMeters.toFloat() / 1000.0;
        var maxLoops = _completedLoops;
        if (loopKm > 0 && _elapsedSec > 0) {
            var greenLoopSec = FICTIVE_PACES_SEC_PER_KM[0] * loopKm;
            if (greenLoopSec > 0) {
                var greenLoops = (_elapsedSec.toFloat() / greenLoopSec).toNumber();
                if (greenLoops > maxLoops) { maxLoops = greenLoops; }
            }
        }
        var window  = maxLoops / _loopsPerCircle;          // integer division
        var base    = window * _loopsPerCircle;
        var n       = _completedLoops - base;              // loops into current window
        if (n < 0) { n = 0; }
        if (n > _loopsPerCircle) { n = _loopsPerCircle; }
        if (n == 0) { return; }
        var screenR = (w < h ? w : h) / 2;
        var bandR   = screenR - ringPen / 4;
        var mkR     = 4;
        for (var i = 1; i <= n; i += 1) {
            var frac   = i.toFloat() / _loopsPerCircle.toFloat();
            var degCcw = 90.0 - 360.0 * frac;
            var tTheta = degCcw * Math.PI / 180.0;
            var mx     = ringCx + (bandR * Math.cos(tTheta)).toNumber();
            var my     = ringCy - (bandR * Math.sin(tTheta)).toNumber();
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(mx, my, mkR + 1);
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(mx, my, mkR);
        }
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Blue runner dot (runner mode). Slides smoothly around the ring
    // based on actual distance covered within the current
    // _loopsPerCircle-loop window: position fraction =
    // (totalDistanceM mod (loopsPerCircle * loopMeters))
    //   / (loopsPerCircle * loopMeters).
    // The completed-loop count is drawn in black on top of the dot.
    function drawRunnerDot(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_done || _loopMeters <= 0 || _loopsPerCircle <= 0) { return; }
        var windowM = _loopsPerCircle.toFloat() * _loopMeters.toFloat();
        if (windowM <= 0) { return; }
        var distInWindow = _totalDistanceM.toFloat();
        while (distInWindow >= windowM) { distInWindow -= windowM; }
        if (distInWindow < 0) { distInWindow = 0; }
        var frac    = distInWindow / windowM;
        var theta   = (90.0 - 360.0 * frac) * Math.PI / 180.0;
        var dotRad  = ringPen / 3;
        var runnerR = (w < h ? w : h) / 2 - ringPen / 4;
        var gx      = ringCx + (runnerR * Math.cos(theta)).toNumber();
        var gy      = ringCy - (runnerR * Math.sin(theta)).toNumber();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(gx, gy, dotRad + 2);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(gx, gy, dotRad);
        var fCount = Graphics.FONT_XTINY;
        var hCount = Graphics.getFontHeight(fCount);
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.drawText(gx, gy - hCount / 2, fCount, _completedLoops.toString(),
                    Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Stat row: loop pa MM:SS   avg pa MM:SS   (both blue).
    // Support-mode only - runner mode renders its own hero stack.
    function drawStatRow(dc, w, yRow, fStat, fg) {
        var loopPaceStr = "loop pa " + (_lastLoopSec > 0
                          ? formatPace(loopSecToPaceMinPerKm(_lastLoopSec))
                          : "--:--");
        var avgPaceStr  = "avg pa " + (_avgLoopSec > 0
                          ? formatPace(loopSecToPaceMinPerKm(_avgLoopSec))
                          : "--:--");
        var gap   = 14;
        var wL    = dc.getTextWidthInPixels(loopPaceStr, fStat);
        var wA    = dc.getTextWidthInPixels(avgPaceStr,  fStat);
        var total = wL + gap + wA;
        var x0    = (w - total) / 2;
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x0,           yRow, fStat, loopPaceStr, Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(x0 + wL + gap, yRow, fStat, avgPaceStr,  Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Convert a per-loop duration (sec) to running pace in min/km.
    function loopSecToPaceMinPerKm(loopSec) {
        if (_loopMeters <= 0 || loopSec <= 0) { return 0.0; }
        var secPerKm = loopSec.toFloat() * 1000.0 / _loopMeters.toFloat();
        return secPerKm / 60.0;
    }

    // Loop-number labels around the ring. The ring shows a sliding
    // window of _loopsPerCircle consecutive loops. In support mode the
    // window shifts when the FASTEST of {blue actual runner, green
    // fictive runner} reaches the next multiple of _loopsPerCircle
    // (yellow / red are ignored). In runner mode only the blue runner
    // exists so the window is driven by _completedLoops alone.
    function drawLoopNumberLabels(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_loopsPerCircle <= 0) { return; }
        var maxLoops = _completedLoops;
        if (_supportMode) {
            var loopKm = _loopMeters.toFloat() / 1000.0;
            if (loopKm > 0 && _elapsedSec > 0) {
                var greenLoopSec = FICTIVE_PACES_SEC_PER_KM[0] * loopKm;
                if (greenLoopSec > 0) {
                    var greenLoops = (_elapsedSec.toFloat() / greenLoopSec).toNumber();
                    if (greenLoops > maxLoops) { maxLoops = greenLoops; }
                }
            }
        }
        if (maxLoops < 0) { maxLoops = 0; }
        var window = maxLoops / _loopsPerCircle;        // integer division
        var base   = window * _loopsPerCircle;          // first label = base + 1

        var screenR = (w < h ? w : h) / 2;
        var labelR  = screenR - ringPen / 2;
        var fLabel  = Graphics.FONT_XTINY;
        var hLabel  = Graphics.getFontHeight(fLabel);
        for (var i = 1; i <= _loopsPerCircle; i += 1) {
            var frac   = i.toFloat() / _loopsPerCircle.toFloat();
            var degCcw = 90.0 - 360.0 * frac;
            var tTheta = degCcw * Math.PI / 180.0;
            var lx     = ringCx + (labelR * Math.cos(tTheta)).toNumber();
            var ly     = ringCy - (labelR * Math.sin(tTheta)).toNumber();
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(lx, ly - hLabel / 2, fLabel, (base + i).toString(),
                        Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    function ringBell(count) {
        if (count < 1) { count = 1; }
        if (Toybox has :Attention) {
            if (Attention has :playTone) {
                try {
                    for (var i = 0; i < count; i += 1) {
                        Attention.playTone(Attention.TONE_LOUD_BEEP);
                    }
                } catch (e) {}
            }
            if (Attention has :vibrate) {
                try {
                    var pattern = new [count * 2 - 1];
                    for (var j = 0; j < count; j += 1) {
                        pattern[j * 2] = new Attention.VibeProfile(100, 400);
                        if (j * 2 + 1 < pattern.size()) {
                            pattern[j * 2 + 1] = new Attention.VibeProfile(0, 200);
                        }
                    }
                    Attention.vibrate(pattern);
                } catch (e) {}
            }
        }
    }

    // Silent vibration only (no tone). Used for passive notifications
    // such as the yellow fictive runner completing a loop. Short, gentle
    // pulses so it doesn't feel like an alarm.
    function vibrateOnly(count) {
        if (count < 1) { count = 1; }
        if (Toybox has :Attention && (Attention has :vibrate)) {
            try {
                var pattern = new [count * 2 - 1];
                for (var j = 0; j < count; j += 1) {
                    pattern[j * 2] = new Attention.VibeProfile(50, 150);
                    if (j * 2 + 1 < pattern.size()) {
                        pattern[j * 2 + 1] = new Attention.VibeProfile(0, 120);
                    }
                }
                Attention.vibrate(pattern);
            } catch (e) {}
        }
    }

    // Always renders as HH:MM:SS (race timer is always hours).
    function fmtHmsAlways(secondsArg) {
        var s = (secondsArg == null) ? 0 : secondsArg;
        if (!(s instanceof Lang.Number)) { s = s.toNumber(); }
        if (s < 0) { s = 0; }
        var hh = s / 3600;
        var mm = (s / 60) % 60;
        var ss = s % 60;
        return hh.format("%02d") + ":" + mm.format("%02d") + ":" + ss.format("%02d");
    }

    function formatPace(decimalMinutes) {
        if (decimalMinutes <= 0 || decimalMinutes >= 99) {
            return "--:--";
        }
        var totalSec = (decimalMinutes * 60.0 + 0.5).toNumber();  // round to nearest second
        var m = totalSec / 60;
        var s = totalSec % 60;
        return m.format("%d") + ":" + s.format("%02d");
    }

    // Format a duration in seconds as M:SS.
    function fmtMmSs(secs) {
        var s = (secs == null) ? 0 : secs;
        if (!(s instanceof Lang.Number)) { s = s.toNumber(); }
        if (s < 0) { s = 0; }
        var m  = s / 60;
        var ss = s % 60;
        return m.format("%d") + ":" + ss.format("%02d");
    }

    // Runner-mode hero stack. Layout:
    //   - top:    race time remaining HH:MM:SS    (small,  black)
    // Runner-mode hero stack. Layout:
    //   - top:    race time remaining HH:MM:SS    (small,  fg)
    //   - bottom: total distance "NN.NN km"       (small,  fg)
    //   - center group, three large rows:
    //       avg  pace  "M:SS /km"                 (large,  fg)
    //       loop pace  "M:SS /lp"                 (large,  fg;   live current loop)
    //       avg loop   "avg M:SS /lp"             (large,  blue; running average)
    // fg auto-adapts to background (black on light face, white on dark face).
    function renderRunnerHero(dc, w, h, ringPen, fg) {
        var cx         = w / 2;
        var timeStr    = _done ? "DONE" : fmtHmsAlways(_timeToFinish);
        var distKm     = _totalDistanceM.toFloat() / 1000.0;
        var distStr    = distKm.format("%.2f") + " km";
        var avgPaceStr = (_avgPaceMinPerKm > 0.0 ? formatPace(_avgPaceMinPerKm) : "0:00") + " /km";
        var loopStr    = (_liveLoopSec > 0 ? fmtMmSs(_liveLoopSec) : "0:00") + " /lp";
        var avgLoopStr = "avg " + (_avgLoopSec > 0 ? fmtMmSs(_avgLoopSec) : "0:00") + " /lp";

        var fSmall = Graphics.FONT_SMALL;
        var fBig   = Graphics.FONT_LARGE;
        var hS     = Graphics.getFontHeight(fSmall);
        var hB     = Graphics.getFontHeight(fBig);

        var tightGap = 2;
        var inset    = ringPen / 2 + 6;

        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, inset, fSmall, timeStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h - inset - hS, fSmall, distStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Centre the three large rows on the watch face.
        var groupH   = 3 * hB + 2 * tightGap;
        var yPace    = (h - groupH) / 2;
        var yLoop    = yPace + hB + tightGap;
        var yAvgLoop = yLoop + hB + tightGap;
        dc.drawText(cx, yPace,    fBig, avgPaceStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, yLoop,    fBig, loopStr,    Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, yAvgLoop, fBig, avgLoopStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }
}
