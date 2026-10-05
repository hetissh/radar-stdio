"""Tests for build_config.py and environment.py."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from build_config import config_js, public_config
from environment import load_env

STORE = {
    'SHOPIFY_STORE_DOMAIN': 'radar-test.myshopify.com',
    'SHOPIFY_API_VERSION': '2026-10',
    'SHOPIFY_STOREFRONT_PUBLIC_TOKEN': 'public',
}


class PublicConfigTest(unittest.TestCase):
    """public_config() and config_js()."""

    def test_no_store_gives_none(self):
        self.assertIsNone(public_config({}))
        self.assertIsNone(public_config({'SHOPIFY_API_VERSION': '2026-10'}))

    def test_a_complete_store_gives_the_public_fields(self):
        self.assertEqual(
            public_config({**STORE, 'SHOPIFY_CLIENT_SECRET': 'secret'}),
            {
                'domain': 'radar-test.myshopify.com',
                'apiVersion': '2026-10',
                'publicToken': 'public',
            },
        )

    def test_partial_settings_fail(self):
        partial = {k: v for k, v in STORE.items() if k != 'SHOPIFY_API_VERSION'}
        with self.assertRaisesRegex(SystemExit, 'missing SHOPIFY_API_VERSION'):
            public_config(partial)

    def test_a_custom_domain_fails(self):
        with self.assertRaisesRegex(SystemExit, 'myshopify.com'):
            public_config({**STORE, 'SHOPIFY_STORE_DOMAIN': 'shop.example.com'})

    def test_an_unreleased_api_version_fails(self):
        with self.assertRaisesRegex(SystemExit, 'look like 2026-10'):
            public_config({**STORE, 'SHOPIFY_API_VERSION': '2026-11'})

    def test_config_js_never_contains_server_keys(self):
        source = config_js(
            public_config({**STORE, 'SHOPIFY_CLIENT_SECRET': 'xyz'})
        )
        self.assertIn('"publicToken": "public"', source)
        self.assertNotIn('xyz', source)
        self.assertEqual(
            config_js(None).splitlines()[1],
            'const radarConfig = Object.freeze({shopify: null});',
        )


class LoadEnvTest(unittest.TestCase):
    """load_env(): .env parsing and the environment overlay."""

    def setUp(self):
        folder = tempfile.mkdtemp()
        self.env_file = Path(folder) / '.env'
        self.env_file.write_text(
            '# a comment\n'
            'SHOPIFY_STORE_DOMAIN="radar-test.myshopify.com"\n'
            "SHOPIFY_API_VERSION='2026-07'\n"
            'SHOPIFY_EMPTY=\n'
            'NOT_A_SETTING\n'
            'OTHER=kept = with equals\n'
        )

    def test_reads_quoted_values_and_skips_comments_and_blanks(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            env = load_env(self.env_file)
        self.assertEqual(
            env['SHOPIFY_STORE_DOMAIN'], 'radar-test.myshopify.com'
        )
        self.assertEqual(env['SHOPIFY_API_VERSION'], '2026-07')
        self.assertEqual(env['OTHER'], 'kept = with equals')
        self.assertNotIn('SHOPIFY_EMPTY', env)
        self.assertNotIn('NOT_A_SETTING', env)

    def test_the_real_environment_wins_for_shopify_settings(self):
        overrides = {'SHOPIFY_API_VERSION': '2026-10', 'PATH_LIKE': 'ignored'}
        with mock.patch.dict(os.environ, overrides, clear=True):
            env = load_env(self.env_file)
        self.assertEqual(env['SHOPIFY_API_VERSION'], '2026-10')
        self.assertNotIn('PATH_LIKE', env)

    def test_a_missing_file_is_fine(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(load_env(self.env_file.with_name('none')), {})


if __name__ == '__main__':
    unittest.main()
