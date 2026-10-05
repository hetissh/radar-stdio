"""Tests for export.py's inlining."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import export
from export import ExportError, inline_scripts, inline_stylesheets


class InlineTest(unittest.TestCase):
    """Inlining scripts and stylesheets into the export."""

    def setUp(self):
        self.public = Path(tempfile.mkdtemp())
        (self.public / 'js' / 'core').mkdir(parents=True)
        (self.public / 'css').mkdir()
        (self.public / 'js' / 'core' / 'a.js').write_text('A();')
        (self.public / 'js' / 'core' / 'b.js').write_text('B();')
        (self.public / 'css' / 'shared.css').write_text('body{}')
        patcher = mock.patch.object(export, 'PUBLIC', self.public)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_scripts_are_inlined_in_order_with_the_data_first(self):
        html = (
            '<script src="js/core/a.js?v=1"></script>'
            '<script src="js/core/b.js"></script>'
        )
        self.assertEqual(
            inline_scripts(html, '<script>DATA</script>'),
            '<script>DATA</script><script>A();</script><script>B();</script>',
        )

    def test_a_script_that_would_end_the_block_early_fails(self):
        (self.public / 'js' / 'core' / 'a.js').write_text('"</script>"')
        with self.assertRaisesRegex(ExportError, 'would end the inline'):
            inline_scripts('<script src="js/core/a.js"></script>', '')

    def test_a_page_without_scripts_fails(self):
        with self.assertRaisesRegex(ExportError, 'no scripts'):
            inline_scripts('<p>no scripts</p>', '')

    def test_stylesheets_are_inlined(self):
        html = '<link rel="stylesheet" href="css/shared.css?v=2">'
        self.assertEqual(inline_stylesheets(html), '<style>body{}</style>')


if __name__ == '__main__':
    unittest.main()
