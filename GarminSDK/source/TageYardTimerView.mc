using Toybox.Application;
using Toybox.Attention;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Math;
using Toybox.System;
using Toybox.WatchUi;

// Full-screen Connect IQ data field — "Tage Yard Timer".
// Works for both Frontyard-style events (shrinking loop times) and standard
// Backyard ultras (fixed loop time + distance). All values are derived from
// activity elapsed time and elapsed distance.
//
// Layout (top to bottom, all inside a green countdown donut):
//   n/max                       (loop counter; PINK at 10, GREEN at 15,
//                                YELLOW on the final loop, else BLUE)
//   MM:SS  |  min/km            (countdown in RED, target pace in BLUE)
//   MM:SS                    (real-time clock)
//   br MM:SS  +/-Nm  min/km  (projected break, gap to pacer, running-avg pace; XTINY)
//   HH:MM:SS                    (predicted start of next loop, hidden until start)
//   next loop
//
// Around the donut: km labels (0.5, 1, 1.5, ...) mark distance progress;
// the white runner dot rides the band, one full lap per configured
// loop distance, and three blue markers sit at 3/2/1 min remaining.
// A yellow pacer dot tracks the position a runner on perfect target pace
// would have right now (advances with elapsed loop time). The white dot
// is drawn on top of the yellow dot when they overlap.
//
// Alerts (bell + vibrate):
//   * 3 beeps at 3 min remaining, 2 at 2 min, 1 at 1 min
//   * 3 beeps + vibrate at every new-loop boundary and at race finish
class TageYardTimerView extends WatchUi.DataField {

    // --- schedule ---
    private var _endsAtSec;          // Array<Number> cumulative end times in seconds
    private var _firstLoopMin;
    private var _holdLoop;
    private var _maxLoops;
    private var _loopMeters;         // Number; meters per loop

    // --- tracked state ---
    private var _currentLoopIdx;     // 0-based; -1 = done
    private var _distanceAtLoopStart;// meters

    // --- displayed values ---
    private var _timeToNext;         // seconds remaining in current loop
    private var _currentLoopNum;     // 1-based
    private var _targetPaceMinPerKm; // decimal minutes / km, 0 when n/a
    private var _avgPaceMinPerKm;    // running average pace, min/km; 0 when n/a
    private var _avgMps;             // running average speed, m/s; 0 when n/a
    private var _hr;                 // current heart rate, bpm; 0 when n/a
    private var _done;
    private var _prevTimeToNext;       // seconds; used to detect threshold crossings
    private var _loopDurSec;           // seconds; duration of current loop
    private var _loopDistanceM;        // meters covered in the current loop
    private var _started;              // true once the activity timer has run

    function initialize() {
        DataField.initialize();
        _currentLoopIdx       = -1;
        _distanceAtLoopStart  = 0.0;
        _timeToNext           = 0;
        _currentLoopNum       = 1;
        _targetPaceMinPerKm   = 0.0;
        _avgPaceMinPerKm      = 0.0;
        _avgMps               = 0.0;
        _hr                   = 0;
        _done                 = false;
        _prevTimeToNext       = -1;
        _loopDurSec           = 0;
        _loopDistanceM        = 0.0;
        _started              = false;
        rebuildSchedule();
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

    public function rebuildSchedule() {
        _firstLoopMin = readNumber("firstLoopMin", 30);
        _holdLoop     = readNumber("holdLoop", 17);
        _maxLoops     = readNumber("maxLoops", 27);
        _loopMeters   = readNumber("loopMeters", 3000);

        if (_firstLoopMin < 1) { _firstLoopMin = 1; }
        if (_holdLoop < 1)     { _holdLoop = 1; }
        if (_holdLoop > _firstLoopMin) { _holdLoop = _firstLoopMin; }
        if (_maxLoops < _holdLoop)     { _maxLoops = _holdLoop; }
        if (_loopMeters < 1)           { _loopMeters = 1; }

        _endsAtSec = new [_maxLoops];
        var cum = 0;
        for (var i = 0; i < _maxLoops; i += 1) {
            var loop = i + 1;
            var capped = loop < _holdLoop ? loop : _holdLoop;
            var minutes = _firstLoopMin + 1 - capped;
            if (minutes < 1) { minutes = 1; }
            cum += minutes * 60;
            _endsAtSec[i] = cum;
        }

        _currentLoopIdx      = -1;
        _distanceAtLoopStart = 0.0;
        _done                = false;
    }

    function onLayout(dc) {
        // Custom drawing in onUpdate; no precomputed layout.
    }

    function compute(info) {
        if (info == null) { return; }

        var elapsedMs = info.elapsedTime;
        var elapsed   = elapsedMs != null ? (elapsedMs / 1000).toNumber() : 0;
        if (elapsed > 0) { _started = true; }

        // Locate current loop index.
        var idx = -1;
        for (var i = 0; i < _endsAtSec.size(); i += 1) {
            if (elapsed < _endsAtSec[i]) {
                idx = i;
                break;
            }
        }

        if (idx == -1) {
            if (!_done) {
                ringBell(3);
            }
            _done               = true;
            _currentLoopNum     = _maxLoops;
            _timeToNext         = 0;
            _targetPaceMinPerKm = 0.0;
            _prevTimeToNext     = -1;
            _loopDistanceM      = 0.0;
            return;
        }

        var totalDist = info.elapsedDistance != null ? info.elapsedDistance : 0.0;
        if (idx != _currentLoopIdx) {
            // New loop has started — alert at the loop boundary (skip initial
            // entry where there is no previous loop yet).
            if (_currentLoopIdx >= 0) {
                ringBell(3);
            }
            _currentLoopIdx      = idx;
            _prevTimeToNext      = -1;
            _distanceAtLoopStart = totalDist;
        }

        _currentLoopNum = idx + 1;
        _timeToNext     = _endsAtSec[idx] - elapsed;
        _loopDistanceM  = totalDist - _distanceAtLoopStart;
        if (_loopDistanceM < 0) { _loopDistanceM = 0.0; }

        // Bell-ring countdown alerts at 3, 2, 1 minutes remaining.
        var thresholds = [180, 120, 60];
        for (var t = 0; t < thresholds.size(); t += 1) {
            var thr = thresholds[t];
            if (_prevTimeToNext > thr && _timeToNext <= thr) {
                ringBell(3 - t); // 3 beeps @3min, 2 @2min, 1 @1min
                break;
            }
        }
        _prevTimeToNext = _timeToNext;

        // Fixed target pace: full loop distance over full loop duration.
        var loopStartSec = idx == 0 ? 0 : _endsAtSec[idx - 1];
        var loopDurSec   = _endsAtSec[idx] - loopStartSec;
        _loopDurSec      = loopDurSec;
        if (loopDurSec > 0 && _loopMeters > 0) {
            var mps = _loopMeters.toFloat() / loopDurSec.toFloat();
            _targetPaceMinPerKm = (1000.0 / mps) / 60.0;
        } else {
            _targetPaceMinPerKm = 0.0;
        }

        // Running average pace from activity averageSpeed (m/s).
        var avgMps = info.averageSpeed;
        if (avgMps != null && avgMps > 0.1) {
            _avgMps          = avgMps;
            _avgPaceMinPerKm = (1000.0 / avgMps) / 60.0;
        } else {
            _avgMps          = 0.0;
            _avgPaceMinPerKm = 0.0;
        }

        // Current heart rate (bpm). 0 when unavailable.
        var hr = info.currentHeartRate;
        _hr = (hr != null && hr instanceof Lang.Number && hr > 0) ? hr : 0;
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
        var ringR   = (w < h ? w : h) / 2 + 1;

        drawRing(dc, ringPen, ringCx, ringCy, ringR);
        drawMinuteMarkers(dc, w, h, ringPen, ringCx, ringCy, fg);
        drawPacerDot(dc, w, h, ringPen, ringCx, ringCy, fg);
        drawRunnerDot(dc, w, h, ringPen, ringCx, ringCy, fg);

        var loopStr;
        var timeStr;
        var paceStr;
        if (_done) {
            loopStr = "DONE " + _maxLoops.toString();
            timeStr = "--:--";
            paceStr = "--:--";
        } else {
            loopStr = _currentLoopNum.toString() + "/" + _maxLoops.toString();
            timeStr = fmtMmSs(_timeToNext);
            paceStr = formatPace(_targetPaceMinPerKm);
        }

        // Real-time clock (HH:MM:SS) and predicted start of next loop (HH:MM).
        var clock    = System.getClockTime();
        var clockStr = clock.hour.format("%02d") + ":"
                     + clock.min.format("%02d")  + ":"
                     + clock.sec.format("%02d");
        var nextStr;
        if (_done || _timeToNext <= 0) {
            nextStr = "--:--:--";
        } else {
            var total = clock.hour * 3600 + clock.min * 60 + clock.sec + _timeToNext;
            var nh = (total / 3600) % 24;
            var nm = (total / 60) % 60;
            var ns = total % 60;
            nextStr = nh.format("%02d") + ":" + nm.format("%02d") + ":" + ns.format("%02d");
        }

        // Use system fonts that scale per-device; pick conservative sizes.
        var fTiny    = Graphics.FONT_XTINY;
        var fSmall   = Graphics.FONT_TINY;          // Next-loop time (smaller)
        var fBig     = Graphics.FONT_LARGE;         // loop counter (n/max)
        var fClock   = Graphics.FONT_NUMBER_MILD;   // clock
        var fHero    = Graphics.FONT_LARGE;         // countdown + pace

        var hTiny   = Graphics.getFontHeight(fTiny);
        var hSmall  = Graphics.getFontHeight(fSmall);
        var hBig    = Graphics.getFontHeight(fBig);
        var hClock  = Graphics.getFontHeight(fClock);
        var hHero   = Graphics.getFontHeight(fHero);
        var hHrRow  = Graphics.getFontHeight(Graphics.FONT_XTINY);

        // Vertical stack with equidistant gaps between five rows:
        //   loop / countdown+pace / clock / hr+avg pace / next loop
        //
        // The top of the loop row and the bottom of the "next loop" label
        // are inset from the screen edges so they stay clear of the donut
        // ring (pen ~ringPen, visible band ~ringPen/2 from each edge).
        var donutInset = ringPen / 2 + 6;  // a few px of breathing room

        // Effective row heights, accounting for sublabels that hang below
        // their primary text on the hero and "next loop" rows.
        var hHeroRow = hHero - 9 + hTiny;        // hero number + tiny sublabel
        if (hHeroRow < hHero) { hHeroRow = hHero; }
        var hNextRow = hSmall - 2 + hTiny;       // "next" number + tiny sublabel
        if (hNextRow < hSmall) { hNextRow = hSmall; }

        var sumRows = hBig + hHeroRow + hClock + hHrRow + hNextRow;
        var avail   = h - 2 * donutInset;
        var gap     = (avail - sumRows) / 4;
        if (gap < 0) { gap = 0; }

        var gapLoop = gap;   // gap below loop row
        var gapHero = gap;   // gap below countdown/pace row
        var gapClk  = gap;   // gap below clock row
        var gapHr   = gap;   // gap below hr/avg-pace row (above "next loop")

        var yTop = donutInset;

        // Color the loop counter: PINK at loop 10, GREEN at loop 15,
        // YELLOW at the final loop, BLUE otherwise.
        var loopColor = Graphics.COLOR_BLUE;
        if (!_done) {
            if (_currentLoopNum == _maxLoops) {
                loopColor = Graphics.COLOR_YELLOW;
            } else if (_currentLoopNum == 10) {
                loopColor = Graphics.COLOR_PINK;
            } else if (_currentLoopNum == 15) {
                loopColor = Graphics.COLOR_GREEN;
            }
        }
        dc.setColor(loopColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, yTop, fBig, loopStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Row: countdown (left) and target pace (right), below loop row.
        var yTime    = yTop + hBig + gapLoop;

        var col1X = w * 0.30;  // countdown
        var col2X = w * 0.70;  // pace
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(col1X, yTime,             fHero, timeStr,         Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col1X, yTime + hHero - 9, fTiny, "mm:ss to next", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(col2X, yTime,             fHero, paceStr,       Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col2X, yTime + hHero - 9, fTiny, "req pa min/km", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Heart symbol with current bpm overlaid in red, centered between
        // the countdown column and the pace column.
        var heartR  = 6;
        var heartCx = cx;
        var heartCy = yTime + hHero / 2 - heartR / 2;
        drawHeart(dc, heartCx, heartCy, heartR, Graphics.COLOR_PINK);
        var bpmStr = _hr > 0 ? _hr.toString() : "--";
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.drawText(heartCx, heartCy + heartR / 2 - hTiny / 2, fTiny, bpmStr, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Real-time clock (centered) below.
        var yClock = yTime + hHero + gapHero;
        dc.drawText(cx, yClock, fClock, clockStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Bottom block: projected break + gap-to-pacer + running-average
        // pace grouped on one XTINY row, then horizontally centered as a
        // single unit.
        //
        // "Break" is the time you would rest between finishing the current
        // loop and the next loop starting, assuming you cover the remaining
        // distance of this loop at your running-average pace:
        //   break = timeToNext - (loopMeters - loopDistanceM) / avgMps
        // Shown as MM:SS in BLUE. "--:--" when no average pace yet or when
        // you are projected to miss the cutoff (break <= 0).
        //
        // The gap is the signed distance (in meters) between the white
        // runner dot (actual position in the current loop) and the yellow
        // pacer dot (position of a runner on the required average pace).
        //   gap > 0  -> ahead of pace (GREEN)
        //   gap < 0  -> behind pace   (RED)
        //   gap == 0 -> on pace
        // Bottom block: projected break + gap-to-pacer + running-average
        // pace grouped on one XTINY row, then horizontally centered as a
        // single unit. See drawBottomRow().
        var fHr     = Graphics.FONT_XTINY;
        var hHr     = Graphics.getFontHeight(fHr);
        var yHrLine = yClock + hClock + gapClk;
        drawBottomRow(dc, w, yHrLine, fHr, fg);

        // Predicted start time of next loop (hidden until the activity has
        // actually been started).
        if (_started) {
            var yNext = yHrLine + hHr + gapHr;
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, yNext, fSmall, nextStr, Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, yNext + hSmall - 2, fTiny, "next loop", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        }

        // Distance km labels drawn LAST so they sit on top of the donut and
        // runner dot. See drawKmLabels().
        drawKmLabels(dc, w, h, ringPen, ringCx, ringCy, fg);
    }

    // Outer progress donut: green arc that grows as the countdown shrinks;
    // fully closed when _timeToNext reaches 0. The stroke is drawn so its
    // outer half extends past the screen edge (and is clipped), leaving
    // roughly 5 visible pixels flush with the bezel.
    function drawRing(dc, ringPen, ringCx, ringCy, ringR) {
        dc.setPenWidth(ringPen);
        if (!_done && _loopDurSec > 0 && _timeToNext < _loopDurSec) {
            var elapsedInLoop = _loopDurSec - _timeToNext;
            if (elapsedInLoop < 0) { elapsedInLoop = 0; }
            var sweep = (elapsedInLoop.toFloat() / _loopDurSec.toFloat()) * 360.0;
            if (sweep > 360.0) { sweep = 360.0; }
            if (sweep >= 359.5) {
                dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
                dc.drawCircle(ringCx, ringCy, ringR);
            } else if (sweep > 0.5) {
                dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
                var startDeg = 90;
                var endDeg   = 90 - sweep;
                dc.drawArc(ringCx, ringCy, ringR, Graphics.ARC_CLOCKWISE, startDeg, endDeg);
            }
        }
        dc.setPenWidth(1);
    }

    // Three warning markers on the donut at the positions corresponding to
    // 3 / 2 / 1 minute remaining in the current loop.
    function drawMinuteMarkers(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_loopDurSec <= 0) { return; }
        var markerBandR = (w < h ? w : h) / 2 - ringPen / 4;
        var thresholds  = [180, 120, 60];
        var mrkR        = 5;
        for (var mi = 0; mi < 3; mi += 1) {
            var rem = thresholds[mi];
            if (rem >= _loopDurSec) { continue; }
            var elapsedAt = _loopDurSec - rem;
            var frac      = elapsedAt.toFloat() / _loopDurSec.toFloat();
            var mtheta    = (90.0 - 360.0 * frac) * Math.PI / 180.0;
            var mx        = ringCx + (markerBandR * Math.cos(mtheta)).toNumber();
            var my        = ringCy - (markerBandR * Math.sin(mtheta)).toNumber();
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(mx, my, mrkR + 2);
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(mx, my, mrkR);
        }
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Yellow pacer dot: a fictive runner moving at exactly the required
    // average pace to finish the current loop right at the deadline. Drawn
    // BEFORE the white runner so the white dot sits on top when overlapping.
    function drawPacerDot(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_done || _loopDurSec <= 0) { return; }
        var elapsedInLoopP = _loopDurSec - _timeToNext;
        if (elapsedInLoopP < 0) { elapsedInLoopP = 0; }
        var paceFrac = elapsedInLoopP.toFloat() / _loopDurSec.toFloat();
        if (paceFrac > 1.0) { paceFrac = 1.0; }
        var pTheta   = (90.0 - 360.0 * paceFrac) * Math.PI / 180.0;
        var pDotRad  = ringPen / 4;
        var pRunnerR = (w < h ? w : h) / 2 - ringPen / 4;
        var px       = ringCx + (pRunnerR * Math.cos(pTheta)).toNumber();
        var py       = ringCy - (pRunnerR * Math.sin(pTheta)).toNumber();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(px, py, pDotRad + 2);
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(px, py, pDotRad);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // White runner dot: rides clockwise around the donut, starting at the
    // top (North). One full lap == one full loop distance (_loopMeters).
    function drawRunnerDot(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_done || _loopMeters <= 0) { return; }
        var lapFrac = _loopDistanceM / _loopMeters.toFloat();
        lapFrac = lapFrac - Math.floor(lapFrac);
        var theta = (90.0 - 360.0 * lapFrac) * Math.PI / 180.0;
        var dotRad = ringPen / 4;
        var runnerR = (w < h ? w : h) / 2 - ringPen / 4;
        var gx    = ringCx + (runnerR * Math.cos(theta)).toNumber();
        var gy    = ringCy - (runnerR * Math.sin(theta)).toNumber();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(gx, gy, dotRad + 2);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(gx, gy, dotRad);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Small filled heart shape centered at (cx, cy). Two lobes of radius r
    // sit slightly closer than r apart so the V notch on top stays shallow,
    // and a downward-pointing triangle whose top edge runs through the lobe
    // centers forms the bottom point below.
    function drawHeart(dc, cx, cy, r, color) {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var off = (r * 3) / 4;
        dc.fillCircle(cx - off, cy, r);
        dc.fillCircle(cx + off, cy, r);
        var pts = [
            [cx - off - r, cy],
            [cx + off + r, cy],
            [cx,           cy + (r * 5) / 2]
        ];
        dc.fillPolygon(pts);
    }

    // "Break" is the time you would rest between finishing the current loop
    // and the next loop starting, assuming you cover the remaining distance
    // at your running-average pace:
    //   break = timeToNext - (loopMeters - loopDistanceM) / avgMps
    // Returned as "br MM:SS" (label first), "br --:--" otherwise.
    function buildBreakStr() {
        if (_done || _avgMps <= 0.0 || _loopMeters <= 0) { return "br --:--"; }
        var remainM   = _loopMeters.toFloat() - _loopDistanceM;
        if (remainM < 0) { remainM = 0; }
        var finishSec = remainM / _avgMps;
        var breakSec  = _timeToNext - finishSec.toNumber();
        if (breakSec <= 0) { return "br --:--"; }
        return "br " + fmtMmSs(breakSec);
    }

    // Signed distance (m) between white runner dot and yellow pacer dot.
    // Returns [haveGap, gapMeters].
    function computeGapMeters() {
        if (_done || _loopDurSec <= 0 || _loopMeters <= 0) {
            return [false, 0];
        }
        if (_loopDistanceM <= 0.0 || _timeToNext <= 1) {
            // Force the gap to exactly 0 m at both ends of the loop.
            return [true, 0];
        }
        var elapsedInLoopG = _loopDurSec - _timeToNext;
        if (elapsedInLoopG < 0) { elapsedInLoopG = 0; }
        var pacerDistM = (elapsedInLoopG.toFloat() / _loopDurSec.toFloat())
                         * _loopMeters.toFloat();
        return [true, (_loopDistanceM - pacerDistM).toNumber()];
    }

    // Bottom block: projected break + gap-to-pacer + running-average pace
    // grouped on one XTINY row, horizontally centered as a single unit.
    function drawBottomRow(dc, w, yHrLine, fHr, fg) {
        var avgValueStr = _avgPaceMinPerKm > 0.0 ? formatPace(_avgPaceMinPerKm) : "--:--";
        var avgFullStr  = "pa " + avgValueStr;
        var breakStr    = buildBreakStr();
        var gapInfo     = computeGapMeters();
        var haveGap     = gapInfo[0];
        var gapMeters   = gapInfo[1];
        // Convert meters gap to a signed MM:SS using the pacer's speed
        // (loopMeters / loopDurSec). Positive = ahead, negative = behind.
        var gapStr;
        if (!haveGap || _loopDurSec <= 0 || _loopMeters <= 0) {
            gapStr = "gap --:--";
        } else {
            var pacerMps = _loopMeters.toFloat() / _loopDurSec.toFloat();
            var gapSec   = pacerMps > 0 ? (gapMeters / pacerMps).toNumber() : 0;
            var sign     = gapSec > 0 ? "+" : (gapSec < 0 ? "-" : "");
            var absSec   = gapSec < 0 ? -gapSec : gapSec;
            gapStr = "gap " + sign + fmtMmSs(absSec);
        }
        var gapHrAvg  = 10;
        var wHrTxt    = dc.getTextWidthInPixels(breakStr,   fHr);
        var wGapTxt   = dc.getTextWidthInPixels(gapStr,     fHr);
        var wAvgTxt   = dc.getTextWidthInPixels(avgFullStr, fHr);
        var totalW    = wHrTxt + gapHrAvg + wGapTxt + gapHrAvg + wAvgTxt;
        var hrStartX  = (w - totalW) / 2;
        var gapStartX = hrStartX + wHrTxt + gapHrAvg;
        var avgStartX = gapStartX + wGapTxt + gapHrAvg;
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(hrStartX,  yHrLine, fHr, breakStr,   Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(gapStartX, yHrLine, fHr, gapStr,     Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(avgStartX, yHrLine, fHr, avgFullStr, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    }

    // Distance km labels around the ring, drawn LAST so they sit on top of
    // the donut and runner dot. Step adapts to loop length.
    function drawKmLabels(dc, w, h, ringPen, ringCx, ringCy, fg) {
        if (_done || _loopMeters <= 0) { return; }
        var stepM;
        if (_loopMeters <= 3500) {
            stepM = 500;
        } else if (_loopMeters <= 12000) {
            stepM = 1000;
        } else {
            stepM = 2000;
        }
        var screenR  = (w < h ? w : h) / 2;
        var bandR    = screenR - ringPen / 4;
        var fLabelFb = Graphics.FONT_XTINY;
        var hLabelFb = Graphics.getFontHeight(fLabelFb);
        var labelR   = bandR;
        for (var dM = stepM; dM < _loopMeters; dM += stepM) {
            var label  = stepM < 1000
                       ? (dM / 1000.0).format("%.1f")
                       : (dM / 1000).toString();
            var tFrac  = dM.toFloat() / _loopMeters.toFloat();
            var degCcw = 90.0 - 360.0 * tFrac;
            var tTheta = degCcw * Math.PI / 180.0;
            var cosT   = Math.cos(tTheta);
            var sinT   = Math.sin(tTheta);
            var lx     = ringCx + (labelR * cosT).toNumber();
            var ly     = ringCy - (labelR * sinT).toNumber();
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.drawText(lx, ly - hLabelFb / 2, fLabelFb, label,
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

    function fmtMmSs(secondsArg) {
        var s = (secondsArg == null) ? 0 : secondsArg;
        if (!(s instanceof Lang.Number)) { s = s.toNumber(); }
        if (s < 0) { s = 0; }
        var hh = s / 3600;
        var mm = (s / 60) % 60;
        var ss = s % 60;
        if (hh > 0) {
            return hh.format("%d") + ":" + mm.format("%02d") + ":" + ss.format("%02d");
        }
        return mm.format("%02d") + ":" + ss.format("%02d");
    }

    function formatPace(decimalMinutes) {
        if (decimalMinutes <= 0 || decimalMinutes >= 99) {
            return "--:--";
        }
        var m = decimalMinutes.toNumber();
        var s = ((decimalMinutes - m) * 60).toNumber();
        if (s >= 60) { m += 1; s = 0; }
        return m.format("%d") + ":" + s.format("%02d");
    }
}
