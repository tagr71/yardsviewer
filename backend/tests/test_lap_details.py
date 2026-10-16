import unittest
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

import httpx
from backend.app import main
from fastapi import HTTPException


class LapDetailsTests(unittest.IsolatedAsyncioTestCase):
    def test_missing_lap_rows_do_not_shift_later_loop_numbers(self) -> None:
        rows = [
            ["1", "40:00", "40:00"],
            ["1", "", ""],
            ["1", "42:00", "2:02:00"],
            ["1", "DNF", ""],
            ["1", "44:00", "3:28:00"],
        ]
        for data in (rows, {"runner": rows}, {"contest": {"runner": rows}}):
            with self.subTest(data=data):
                laps = main._parse_lap_times({
                    "DataFields": ["BIB", "[Lap{n}]", "[Total{n}]"], "data": data,
                })
                self.assertEqual([lap["loop"] for lap in laps["1"]], [1, 3, 5])
                self.assertEqual([lap["lapSec"] for lap in laps["1"]], [2400, 2520, 2640])

    async def test_reads_all_runners_and_laps_from_published_details_api(self) -> None:
        requests: list[httpx.Request] = []
        payload = {
            "DataFields": ["BIB", "[Lap{n}]", "[Total{n}]"],
            "data": {
                "runner-one": [["1", "20:00", "20:00"], ["1", "21:00", "41:00"]],
                "runner-two": [["2", "22:00", "22:00"], ["2", "23:00", "45:00"]],
            },
        }

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/config"):
                return httpx.Response(200, json={
                    "key": "test-key", "server": "example.test",
                    "TabConfig": {"Lists": [{
                        "Name": "Results|Details-API", "Contest": "1", "Details": "details0",
                    }]},
                })
            return httpx.Response(200, json=payload)

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch("backend.app.main.httpx.AsyncClient", return_value=client):
            result = await main._fetch_details_list("374847", "results")

        self.assertEqual(result, payload)
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[1].url.path, "/374847/results/list")
        self.assertEqual(requests[1].url.params["listname"], "Results|Details-API")
        self.assertEqual(requests[1].url.params["contest"], "1")
        self.assertEqual(requests[1].url.params["r"], "all")
        splits = main._parse_lap_times(result)
        self.assertEqual([lap["lapSec"] for lap in splits["1"]], [1200, 1260])
        self.assertEqual([lap["loop"] for lap in splits["2"]], [1, 2])

    async def test_reads_both_laps_from_current_participant_view(self) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/config"):
                return httpx.Response(200, json={
                    "key": "test-key", "server": "example.test",
                    "TabConfig": {"Lists": [{"Name": "Results", "Details": "details1"}]},
                })
            self.assertEqual(request.url.path, "/123456/details1/view")
            bib = request.url.params["bib"]
            return httpx.Response(200, json={"Data": {"Lists": {"Lap Details": {
                "DataFields": ["BIB", "ID", "[Lap{n}]", "[Total{n}]"],
                "Data": [[bib, "18", "32:38", "32:38"], [bib, "18", "32:13", "1:04:50"]],
            }}}})

        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(respond)
        with patch(
            "backend.app.main.httpx.AsyncClient",
            side_effect=lambda **kwargs: client_type(transport=transport),
        ):
            payload = await main._fetch_details_list("123456", "results", bibs=["3", "12"])

        splits = main._parse_lap_times(payload)
        self.assertEqual(len(requests), 3)
        self.assertEqual(set(splits), {"3", "12"})
        for history in splits.values():
            self.assertEqual([lap["loop"] for lap in history], [1, 2])
            self.assertEqual([lap["lapSec"] for lap in history], [1958, 1933])

    async def test_one_unavailable_participant_keeps_other_history(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/config"):
                return httpx.Response(200, json={
                    "key": "test-key", "server": "example.test",
                    "TabConfig": {"Lists": [{"Name": "Results", "Details": "details1"}]},
                })
            if request.url.params["bib"] == "12":
                return httpx.Response(503)
            return httpx.Response(200, json={"Data": {"Lists": {"Lap Details": {
                "DataFields": ["BIB", "[Lap{n}]", "[Total{n}]"],
                "Data": [["3", "32:38", "32:38"], ["3", "32:13", "1:04:50"]],
            }}}})

        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(respond)
        with patch(
            "backend.app.main.httpx.AsyncClient",
            side_effect=lambda **kwargs: client_type(transport=transport),
        ):
            payload = await main._fetch_details_list("123456", "results", bibs=["3", "12"])
        self.assertEqual(set(main._parse_lap_times(payload)), {"3"})

    async def test_large_fields_fetch_at_most_fifteen_participant_histories(self) -> None:
        requested_bibs: list[str] = []

        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/config"):
                return httpx.Response(200, json={
                    "key": "test-key", "server": "example.test",
                    "TabConfig": {"Lists": [{"Name": "Results", "Details": "details1"}]},
                })
            bib = request.url.params["bib"]
            requested_bibs.append(bib)
            return httpx.Response(200, json={"Data": {"Lists": {"Lap Details": {
                "DataFields": ["BIB", "[Lap{n}]", "[Total{n}]"],
                "Data": [[bib, "45:00", "45:00"]],
            }}}})

        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(respond)
        with patch(
            "backend.app.main.httpx.AsyncClient",
            side_effect=lambda **kwargs: client_type(transport=transport),
        ):
            payload = await main._fetch_details_list(
                "123456", "results", bibs=[str(bib) for bib in range(16)]
            )
        self.assertEqual(set(requested_bibs), {str(bib) for bib in range(15)})
        self.assertEqual(set(main._parse_lap_times(payload)), set(requested_bibs))

    async def test_results_restore_last_laps_from_published_history(self) -> None:
        runners = [
            {"bib": "1", "status": "", "lapsCompleted": 2, "lastLap": ""},
            {"bib": "2", "status": "DNF", "lapsCompleted": 1, "lastLap": ""},
            {"bib": "3", "status": "DNF", "lapsCompleted": 2, "lastLap": ""},
            {"bib": "4", "status": "DNF", "lapsCompleted": 1, "lastLap": "40:00"},
        ]
        payload = {
            "DataFields": ["BIB", "[Lap{n}]", "[Total{n}]"],
            "data": {
                "one": [["1", "44:00", "44:00"], ["1", "46:00", "1:30:00"]],
                "two": [["2", "48:00", "48:00"]],
                "three": [["3", "47:00", "47:00"]],
                "four": [["4", "40:00", "40:00"]],
            },
        }
        with (
            patch.object(main, "_fetch_list", new=AsyncMock(return_value=(
                {}, "Finished Backyard", "", "2025-07-01", "09:00"
            ))),
            patch.object(main, "_flatten_results", return_value=runners),
            patch.object(main, "_fetch_details_list", new=AsyncMock(return_value=payload)),
        ):
            response = await main.results(event_id="123456")
        response_rows = response["rows"]
        assert isinstance(response_rows, list)
        self.assertEqual(
            [row["lastLap"] for row in response_rows], ["46:00", "48:00", "", "40:00"]
        )
        self.assertEqual(len(response_rows[0]["perLoop"]), 2)

    async def test_results_prioritize_active_runners_then_deepest_histories(self) -> None:
        runners = [
            {"bib": "1", "status": "DNF", "lapsCompleted": 1, "totalRank": 1},
            {"bib": "2", "status": "DNF", "lapsCompleted": 3, "totalRank": 2},
            {"bib": "3", "status": "", "lapsCompleted": 2, "totalRank": 3},
        ]
        with (
            patch.object(main, "_fetch_list", new=AsyncMock(return_value=(
                {}, "Started Backyard", "", "2025-07-01", "09:00"
            ))),
            patch.object(main, "_flatten_results", return_value=runners),
            patch.object(main, "_fetch_details_list", new=AsyncMock(return_value=None)) as details,
        ):
            await main.results(event_id="123456")
        details.assert_awaited_once_with("123456", "results", bibs=["3", "2", "1"])

    async def test_unavailable_published_history_keeps_the_optional_fallback(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/config"):
                return httpx.Response(200, json={
                    "key": "test-key", "server": "example.test",
                    "TabConfig": {"Lists": [{"Name": "Details-API"}]},
                })
            return httpx.Response(404)

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch("backend.app.main.httpx.AsyncClient", return_value=client):
            self.assertIsNone(await main._fetch_details_list("374847", "results"))


class PayloadParsingTests(unittest.TestCase):
    def test_empty_published_lists_have_zero_participants(self) -> None:
        empty_groups: tuple[object, ...] = ([], {}, {"contest": []}, {"contest": {"group": []}})
        for data in empty_groups:
            with self.subTest(data=data):
                self.assertEqual(main._count_rows({"data": data}), 0)

    def test_times_validate_clock_components_and_support_duration_minutes(self) -> None:
        cases = {
            "": None, "DNF": None, "2:99": None, "1:60:00": None, "1:00:60": None,
            "25": 25, "45:00.5": 2700, "125:00": 7500, "1:02:03,9": 3723,
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(main._parse_hms(text), expected)

    def test_nonfinite_point_cells_are_ignored(self) -> None:
        for text in ("inf", "-inf", "nan", "DNF", ""):
            with self.subTest(text=text):
                self.assertEqual(main._safe_int(text), 0)


class UpstreamResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_config_is_reported_as_bad_gateway(self) -> None:
        for content in (b"not json", b"[]", b"null"):
            with self.subTest(content=content):
                client = httpx.AsyncClient(transport=httpx.MockTransport(
                    lambda request, body=content: httpx.Response(200, content=body)
                ))
                with (
                    patch("backend.app.main.httpx.AsyncClient", return_value=client),
                    self.assertRaises(HTTPException) as raised,
                ):
                    await main._fetch_list("123456", "results")
                self.assertEqual(raised.exception.status_code, 502)

    async def test_invalid_optional_details_do_not_hide_participant_history(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/config"):
                return httpx.Response(200, json={
                    "key": "test-key", "server": "example.test",
                    "TabConfig": {"Lists": [{"Name": "Details-API", "Details": "details1"}]},
                })
            if request.url.path.endswith("/list"):
                return httpx.Response(200, content=b"not json")
            return httpx.Response(200, json={"Data": {"Lists": {"Laps": {
                "DataFields": ["BIB", "[Lap{n}]", "[Total{n}]"],
                "Data": [["1", "45:00", "45:00"]],
            }}}})

        client_type = httpx.AsyncClient
        with patch(
            "backend.app.main.httpx.AsyncClient",
            side_effect=lambda **kwargs: client_type(transport=httpx.MockTransport(respond)),
        ):
            payload = await main._fetch_details_list("123456", "results", bibs=["1"])
        self.assertEqual(main._parse_lap_times(payload)["1"][0]["lapSec"], 2700)


class UpcomingRaceTests(unittest.IsolatedAsyncioTestCase):
    def test_uses_oslo_time_and_opens_exactly_at_the_scheduled_start(self) -> None:
        start = "2026-10-17T09:00:00"
        self.assertFalse(main._event_has_started(
            start, datetime(2026, 10, 17, 6, 59, 59, tzinfo=UTC)
        ))
        self.assertTrue(main._event_has_started(start, datetime(2026, 10, 17, 7, tzinfo=UTC)))
        self.assertFalse(main._event_has_started(
            "2026-01-17T09:00:00", datetime(2026, 1, 17, 7, 59, 59, tzinfo=UTC)
        ))
        self.assertTrue(main._event_has_started(
            "2026-01-17T09:00:00", datetime(2026, 1, 17, 8, tzinfo=UTC)
        ))
        self.assertTrue(main._event_has_started(""))
        self.assertTrue(main._event_has_started("unknown"))

    async def test_hides_prestart_test_results_but_keeps_entrants(self) -> None:
        runner = {
            "bib": "1", "name": "Runner One", "country": "NOR", "status": "DNF",
            "place": 1, "totalRank": 1, "lapsCompleted": 2, "lastLap": "20:00",
            "fastestLap": "19:00", "slowestLap": "20:00", "averageLap": "19:30",
            "total": "39:00", "totalSec": 2340, "gap": "-", "lapsBehind": 0,
            "perLoop": [{"loop": 1, "time": "19:00"}, {"loop": 2, "time": "20:00"}],
        }
        runners = [runner, {**runner, "bib": "2", "status": "DNS"}]
        with (
            patch.object(main, "_fetch_list", new=AsyncMock(return_value=(
                {}, "Upcoming Backyard", "", "2026-10-17", "09:00"
            ))) as fetch_list,
            patch.object(main, "_flatten_results", return_value=runners),
            patch.object(main, "_fetch_details_list", new=AsyncMock(return_value=None)) as details,
            patch.object(main, "_event_has_started", return_value=False),
        ):
            result = await main.results(event_id="123456")
        expected = {
            **runner, "place": None, "totalRank": None, "lapsCompleted": 0,
            "lastLap": "", "fastestLap": "", "slowestLap": "", "averageLap": "",
            "total": "", "totalSec": 0, "gap": "", "lapsBehind": 0, "perLoop": [],
            "status": "",
        }
        self.assertEqual(result["rows"], [expected, {**expected, "bib": "2", "status": "DNS"}])
        self.assertFalse(result["raceFinished"])
        self.assertEqual(result["eventStartTime"], "2026-10-17T09:00:00")
        self.assertEqual(runner["lapsCompleted"], 2)
        fetch_list.assert_awaited_once()
        details.assert_not_awaited()

    async def test_live_results_are_unchanged_after_the_start(self) -> None:
        runners = [{"bib": "1", "status": "", "lapsCompleted": 2, "lastLap": "20:00"}]
        with (
            patch.object(main, "_fetch_list", new=AsyncMock(return_value=(
                {}, "Started Backyard", "", "2026-10-17", "09:00"
            ))),
            patch.object(main, "_flatten_results", return_value=runners),
            patch.object(main, "_fetch_details_list", new=AsyncMock(return_value=None)),
            patch.object(main, "_event_has_started", return_value=True),
        ):
            result = await main.results(event_id="123456")
        self.assertEqual(result["rows"], runners)


class StaticFileTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_paths_outside_the_frontend_directory(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            public.mkdir()
            private = root / "private.txt"
            private.write_text("private", encoding="utf-8")
            with patch.object(main, "_DIST", public):
                paths = ("../private.txt", "..\\private.txt", str(private), "api", "api/missing")
                for path in paths:
                    with self.subTest(path=path):
                        with self.assertRaises(HTTPException) as raised:
                            await main._spa_fallback(path)
                        self.assertEqual(raised.exception.status_code, 404)

    async def test_serves_public_files_and_dashboard_routes(self) -> None:
        with TemporaryDirectory() as directory:
            public = Path(directory)
            logo = public / "logo.png"
            logo.write_bytes(b"image")
            with patch.object(main, "_DIST", public):
                asset = await main._spa_fallback("logo.png")
                dashboard = await main._spa_fallback("leaderboard/352401")
            self.assertEqual(Path(asset.path), logo.resolve())
            self.assertEqual(Path(dashboard.path), public / "index.html")


if __name__ == "__main__":
    unittest.main()
