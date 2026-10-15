import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import httpx
from backend.app import main


class LapDetailsTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_participant_requests_are_not_expanded_to_large_fields(self) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            self.assertFalse(request.url.path.endswith("/view"))
            return httpx.Response(200, json={
                "key": "test-key", "server": "example.test",
                "TabConfig": {"Lists": [{"Name": "Results", "Details": "details1"}]},
            })

        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(respond)
        with patch(
            "backend.app.main.httpx.AsyncClient",
            side_effect=lambda **kwargs: client_type(transport=transport),
        ):
            payload = await main._fetch_details_list(
                "123456", "results", bibs=[str(bib) for bib in range(16)]
            )
        self.assertIsNone(payload)

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


if __name__ == "__main__":
    unittest.main()
