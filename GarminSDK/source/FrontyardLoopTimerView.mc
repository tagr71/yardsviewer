using Toybox.Application;
using Toybox.Attention;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.Math;
using Toybox.System;
using Toybox.WatchUi;

// Full-screen Connect IQ data field for Rotvollfjæra Frontyard Ultra.
// Layout (top to bottom):
//   L n/max                           (PINK at loop 10, GREEN at loop 15)
//   countdown MM:SS  |  target pace min/km
//   clock HH:MM:SS
//   Next HH:MM                        (predicted start of next loop)
// Plays a bell + short vibrate when 3, 2, and 1 minute remain in each loop.
class FrontyardLoopTimerView extends WatchUi.DataField {

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
        _done                 = false;
        _prevTimeToNext       = -1;
        _loopDurSec           = 0;
        _loopDistanceM        = 0.0;
        _started              = false;
        rebuildSchedule();
    }

    private function readNumber(key, fallback) {
        var v = Application.Properties.getValue(key);
        if (v == null) { return fallback; }
        if (v instanceof Lang.Number) { return v; }
        if (v instanceof Lang.Float || v instanceof Lang.Double) { return v.toNumber(); }
        if (v instanceof Lang.String) {
            try { return v.toNumber(); } catch (e) { return fallback; }
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
                ringBell();
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
            _avgPaceMinPerKm = (1000.0 / avgMps) / 60.0;
        } else {
            _avgPaceMinPerKm = 0.0;
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

        // Outer progress donut: red arc that grows as the countdown shrinks;
        // fully red when _timeToNext reaches 0. The stroke is drawn so that
        // its outer half extends past the screen edge (and is clipped),
        // leaving roughly 5 visible pixels flush with the bezel.
        var ringPen = 12;
        // For an even screen width like 260px, the geometric center sits at
        // 129.5, not 130. Using a Float center keeps the ring perfectly
        // concentric with the bezel and equally thick on every side.
        var ringCx  = (w - 1) / 2.0;
        var ringCy  = (h - 1) / 2.0;
        var ringR   = (w < h ? w : h) / 2 + 1;
        dc.setPenWidth(ringPen);
        if (!_done && _loopDurSec > 0 && _timeToNext < _loopDurSec) {
            var elapsedInLoop = _loopDurSec - _timeToNext;
            if (elapsedInLoop < 0) { elapsedInLoop = 0; }
            var sweep = (elapsedInLoop.toFloat() / _loopDurSec.toFloat()) * 360.0;
            if (sweep > 360.0) { sweep = 360.0; }
            if (sweep >= 359.5) {
                dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
                dc.drawCircle(ringCx, ringCy, ringR);
            } else if (sweep > 0.5) {
                dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
                var startDeg = 90;
                var endDeg   = 90 - sweep;
                dc.drawArc(ringCx, ringCy, ringR, Graphics.ARC_CLOCKWISE, startDeg, endDeg);
            }
        }
        dc.setPenWidth(1);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Green runner dot: rides clockwise around the donut, starting at the
        // top (North). One full lap of the dot == one full loop distance
        // (_loopMeters). If the dot is ahead of the red fill, the runner is
        // on pace / safe.
        if (!_done && _loopMeters > 0) {
            var lapFrac = _loopDistanceM / _loopMeters.toFloat();
            lapFrac = lapFrac - Math.floor(lapFrac);
            var theta = (90.0 - 360.0 * lapFrac) * Math.PI / 180.0;
            var runnerR = (w < h ? w : h) / 2 - 3;
            var gx    = ringCx + (runnerR * Math.cos(theta)).toNumber();
            var gy    = ringCy - (runnerR * Math.sin(theta)).toNumber();
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            dc.drawCircle(gx, gy, 8);
            dc.setPenWidth(1);
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        }

        var loopStr;
        var timeStr;
        var paceStr;
        var distStr;
        if (_done) {
            loopStr = "DONE " + _maxLoops.toString();
            timeStr = "--:--";
            paceStr = "--:--";
            distStr = "--";
        } else {
            loopStr = _currentLoopNum.toString() + "/" + _maxLoops.toString();
            timeStr = formatMmSs(_timeToNext);
            paceStr = formatPace(_targetPaceMinPerKm);
            distStr = (_loopDistanceM / 1000.0).format("%.2f");
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
        var fSmall   = Graphics.FONT_MEDIUM;        // Next time
        var fBig     = Graphics.FONT_LARGE;         // loop counter (n/max)
        var fClock   = Graphics.FONT_NUMBER_MILD;   // clock
        var fHero    = Graphics.FONT_LARGE;         // countdown + pace

        var hTiny   = Graphics.getFontHeight(fTiny);
        var hSmall  = Graphics.getFontHeight(fSmall);
        var hBig    = Graphics.getFontHeight(fBig);
        var hClock  = Graphics.getFontHeight(fClock);
        var hHero   = Graphics.getFontHeight(fHero);

        // Vertical stack: loop / countdown+clock / pace / Next.
        var gapLoop  = 22; // gap below loop row (room for PINK/GREEN + 3-dot indicator)
        var gapHero  = 16; // gap below countdown/clock row
        var gapNext  = 4;  // gap above Next row
        var contentH =
              hBig                         // loop row
            + gapLoop + hHero              // countdown + pace (with unit overlap)
            + gapHero + hClock + hTiny     // clock + tiny avg pace
            + gapNext + hSmall + hTiny;    // next time + "next loop" label

        var yTop = (h - contentH) / 2;
        if (yTop < 2) { yTop = 2; }

        // Color the loop counter: PINK at loop 10, GREEN at loop 15,
        // BLUE otherwise.
        var loopColor = Graphics.COLOR_BLUE;
        if (!_done) {
            if (_currentLoopNum == 10) {
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

        // Three-dot warning indicator centered between loop row and countdown.
        // All three dots are filled at loop start; one dot empties (left to
        // right) as remaining time crosses 3:00, 2:00, 1:00. Each dot is
        // labeled with the remaining-minutes threshold (3 / 2 / 1).
        var filled = 0;
        if (!_done && _timeToNext > 0) {
            if (_timeToNext > 180)      { filled = 3; }
            else if (_timeToNext > 120) { filled = 2; }
            else if (_timeToNext > 60)  { filled = 1; }
            else                         { filled = 0; }
        }
        var dotR     = 8;
        var dotGap   = 10;
        var dotsY    = yTop + hBig + (gapLoop / 2);
        var labels   = ["3", "2", "1"];
        var labelGap = 4;
        // Measure label width using the smallest available font so the
        // 3-dot indicator stays compact.
        var wLbl     = dc.getTextWidthInPixels("3", fTiny);
        var groupW   = 2 * dotR + labelGap + wLbl;
        var dotsTotW = 3 * groupW + 2 * dotGap;
        var startGX  = (w - dotsTotW) / 2;
        for (var di = 0; di < 3; di += 1) {
            var groupX = startGX + di * (groupW + dotGap);
            var lblX   = groupX + wLbl / 2;
            var cxd    = groupX + wLbl + labelGap + dotR;
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(lblX, dotsY - Graphics.getFontHeight(fTiny) / 2,
                        fTiny, labels[di], Graphics.TEXT_JUSTIFY_CENTER);
            if (di >= 3 - filled) {
                dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(cxd, dotsY, dotR);
                dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            } else {
                dc.setPenWidth(2);
                dc.drawCircle(cxd, dotsY, dotR);
                dc.setPenWidth(1);
            }
        }
        var col1X = w * 0.30;  // countdown
        var col2X = w * 0.70;  // pace
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(col1X, yTime,             fHero, timeStr,       Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col1X, yTime + hHero - 3, fTiny, "min to next", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(col2X, yTime,             fHero, paceStr,       Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col2X, yTime + hHero - 3, fTiny, "min/km",      Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Real-time clock (centered) below.
        var yClock = yTime + hHero + gapHero;
        dc.drawText(cx, yClock, fClock, clockStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Tiny line below the clock: running-average pace on the left,
        // distance covered in the current loop on the right. The two values
        // are centered as a group so the left/right whitespace is equal.
        var avgValueStr = _avgPaceMinPerKm > 0.0 ? formatPace(_avgPaceMinPerKm) : "--:--";
        var avgFullStr  = avgValueStr + " min/km";
        var distFullStr = distStr + " km";
        var gapMid      = 12;
        var wAvg        = dc.getTextWidthInPixels(avgFullStr,  fTiny);
        var wDist       = dc.getTextWidthInPixels(distFullStr, fTiny);
        var totalW      = wAvg + gapMid + wDist;
        var startX      = (w - totalW) / 2;
        var yTinyLine   = yClock + hClock;
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(startX,             yTinyLine, fTiny, avgFullStr,  Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(startX + wAvg + gapMid, yTinyLine, fTiny, distFullStr, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Predicted start time of next loop (hidden until the activity has
        // actually been started).
        if (_started) {
            var yNext = yClock + hClock + hTiny + gapNext;
            dc.drawText(cx, yNext, fSmall, nextStr, Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, yNext + hSmall - 3, fTiny, "next loop", Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    private function ringBell() {
        if (Toybox has :Attention) {
            if (Attention has :playTone) {
                try { Attention.playTone(Attention.TONE_LOUD_BEEP); } catch (e) {}
            }
            if (Attention has :vibrate) {
                try {
                    var pattern = [ new Attention.VibeProfile(75, 400) ];
                    Attention.vibrate(pattern);
                } catch (e) {}
            }
        }
    }

    private function formatMmSs(seconds) {
        if (seconds < 0) { seconds = 0; }
        var hh = seconds / 3600;
        var mm = (seconds / 60) % 60;
        var ss = seconds % 60;
        if (hh > 0) {
            return hh.format("%d") + ":" + mm.format("%02d") + ":" + ss.format("%02d");
        }
        return mm.format("%02d") + ":" + ss.format("%02d");
    }

    private function formatPace(decimalMinutes) {
        if (decimalMinutes <= 0 || decimalMinutes >= 99) {
            return "--:--";
        }
        var m = decimalMinutes.toNumber();
        var s = ((decimalMinutes - m) * 60).toNumber();
        if (s >= 60) { m += 1; s = 0; }
        return m.format("%d") + ":" + s.format("%02d");
    }
}
