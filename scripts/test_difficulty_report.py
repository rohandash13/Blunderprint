import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
from scripts import difficulty_report


class DifficultyReportCliTest(unittest.TestCase):
    def test_fetches_the_selected_api_and_encodes_the_username(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/"report.json"
            response=Mock()
            response.json.return_value=[{"level":"deep","kind":"positional","tags":["positional"],"winDrop":0.2}]
            with patch("sys.argv",["report","--username","A Name","--base-url","https://example.invalid/","--out",str(out)]),patch.object(difficulty_report.requests,"get",return_value=response) as get,contextlib.redirect_stdout(io.StringIO()):
                difficulty_report.main()
            get.assert_called_once_with("https://example.invalid/players/A%20Name/mistakes",timeout=60)
            response.raise_for_status.assert_called_once()
            self.assertEqual(1,json.loads(out.read_text())["candidates"])

    def test_an_api_failure_does_not_replace_the_previous_report(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/"report.json"
            out.write_text("previous")
            response=Mock()
            response.raise_for_status.side_effect=RuntimeError("API unavailable")
            with patch("sys.argv",["report","--username","alice","--out",str(out)]),patch.object(difficulty_report.requests,"get",return_value=response),self.assertRaisesRegex(RuntimeError,"API unavailable"):
                difficulty_report.main()
            self.assertEqual("previous",out.read_text())


if __name__=="__main__":unittest.main()
