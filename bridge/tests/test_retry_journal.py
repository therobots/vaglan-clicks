import tempfile
import unittest
from pathlib import Path

from bridge.camera_bridge import RetryJournal


class RetryJournalTests(unittest.TestCase):
    def test_persists_exponential_backoff_across_restarts(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "retry-journal.json"
            journal = RetryJournal(path)

            self.assertEqual(journal.record_failure("photo.jpg", now=100), 5)
            self.assertTrue(journal.is_waiting("photo.jpg", now=104))
            self.assertEqual(journal.due_paths(now=105), ["photo.jpg"])
            self.assertEqual(journal.record_failure("photo.jpg", now=105), 15)

            restored = RetryJournal(path)
            self.assertEqual(restored.pending_count, 1)
            self.assertEqual(restored.due_paths(now=119), [])
            self.assertEqual(restored.due_paths(now=120), ["photo.jpg"])
            restored.remove("photo.jpg")
            self.assertEqual(RetryJournal(path).pending_count, 0)

    def test_caps_retry_delay_after_five_minutes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            journal = RetryJournal(Path(temporary_directory) / "retry-journal.json")

            delays = [
                journal.record_failure("photo.jpg", now=attempt * 300)
                for attempt in range(1, 7)
            ]

            self.assertEqual(delays, [5, 15, 60, 300, 300, 300])


if __name__ == "__main__":
    unittest.main()
