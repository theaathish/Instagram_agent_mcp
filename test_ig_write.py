#!/usr/bin/env python3
"""Stdlib unit tests for ig-write (no network calls)."""
import importlib.machinery
import importlib.util
import os
import subprocess
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_loader = importlib.machinery.SourceFileLoader(
    "ig_write_core", os.path.join(HERE, "ig-write"))
_spec = importlib.util.spec_from_loader("ig_write_core", _loader)
igw = importlib.util.module_from_spec(_spec)
_loader.exec_module(igw)


class TestErrors(unittest.TestCase):
    def test_publish_hint(self):
        msg = igw.friendly_error(
            {"error": {"code": 200, "message": "Requires content publishing permission"}})
        self.assertIn("instagram_business_content_publish", msg)

    def test_engagement_hint(self):
        msg = igw.friendly_error(
            {"error": {"code": 100, "message": "Like failed: missing engagement permission"}})
        self.assertIn("instagram_manage_engagement", msg)

    def test_delete_hint(self):
        msg = igw.friendly_error(
            {"error": {"code": 100, "error_subcode": 33,
                       "message": "Unsupported delete request, manage scope needed"}})
        self.assertIn("instagram_manage_contents", msg)


class TestConfig(unittest.TestCase):
    def test_paths_nonempty(self):
        paths = igw.default_config_paths()
        self.assertTrue(len(paths) >= 2)
        self.assertTrue(all(os.path.isabs(p) for p in paths))

    def test_require_scope_missing(self):
        acct = {"username": "x", "granted_scopes": ["instagram_business_basic"]}
        with self.assertRaises(SystemExit):
            igw.require_scope(acct, "instagram_manage_contents")

    def test_require_scope_present(self):
        acct = {"username": "x", "granted_scopes": ["instagram_manage_contents"]}
        igw.require_scope(acct, "instagram_manage_contents")  # no raise

    def test_require_scope_unknown_grant(self):
        acct = {"username": "x"}  # env-token style: no metadata
        igw.require_scope(acct, "instagram_manage_contents")  # no raise

    def test_expired_token(self):
        with self.assertRaises(SystemExit):
            igw.check_token_freshness({"token_expires_at": time.time() - 10})

    def test_fresh_token(self):
        igw.check_token_freshness(
            {"token_expires_at": time.time() + 60 * 86400})  # no raise


class TestCLI(unittest.TestCase):
    def test_help(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "ig-write"),
                            "--help"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0)
        self.assertIn("reel", r.stdout)

    def test_version(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "ig-write"),
                            "--version"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0)
        self.assertIn(igw.VERSION, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
