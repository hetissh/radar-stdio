"""Tests for build_data.py: catalogue checks and the generated files."""

import copy
import unittest

import build_data
from build_data import CatalogueError, build_outputs, check_catalogue

COLLECTIONS = [
    {'id': 'tees', 'title': 'Tees', 'copy': 'Plain.'},
    {'id': 'new', 'title': 'New', 'copy': 'Fresh.'},
]


def piece(piece_id, collection='tees', position=0, bearing=0):
    """A minimal valid piece."""
    return {
        'id': piece_id,
        'collection': collection,
        'position': position,
        'bearing': bearing,
        'name': f'Piece {piece_id}',
        'image': 'https://cdn.shopify.com/s/art.png',
        'description': 'Long text.',
        'status': 'Note.',
    }


class CheckCatalogueTest(unittest.TestCase):
    """check_catalogue(): what makes a catalogue valid."""

    def setUp(self):
        self.products = [
            piece('01', position=0, bearing=10),
            piece('02', position=1, bearing=20),
            piece('03', collection='new', position=0, bearing=10),
        ]

    def test_a_valid_catalogue_passes(self):
        check_catalogue(COLLECTIONS, self.products)

    def test_duplicate_ids_fail(self):
        self.products[1]['id'] = '01'
        with self.assertRaisesRegex(CatalogueError, 'duplicate piece ids'):
            check_catalogue(COLLECTIONS, self.products)

    def test_duplicate_bearing_on_a_ring_fails(self):
        self.products[1]['bearing'] = 10
        with self.assertRaisesRegex(CatalogueError, 'tees: duplicate bearing'):
            check_catalogue(COLLECTIONS, self.products)

    def test_the_same_bearing_on_different_rings_is_fine(self):
        self.assertEqual(
            self.products[0]['bearing'], self.products[2]['bearing']
        )
        check_catalogue(COLLECTIONS, self.products)

    def test_unknown_collection_fails(self):
        self.products[0]['collection'] = 'nowhere'
        with self.assertRaisesRegex(CatalogueError, 'unknown collection'):
            check_catalogue(COLLECTIONS, self.products)

    def test_missing_bundled_artwork_fails(self):
        self.products[0]['image'] = 'no-such-file.png'
        with self.assertRaisesRegex(CatalogueError, 'artwork no-such-file.png'):
            check_catalogue(COLLECTIONS, self.products)

    def test_media_items_need_a_label(self):
        self.products[0]['media'] = [{'type': 'garment', 'side': 'front'}]
        with self.assertRaisesRegex(CatalogueError, 'needs a short label'):
            check_catalogue(COLLECTIONS, self.products)

    def test_a_video_needs_a_poster(self):
        self.products[0]['media'] = [
            {'type': 'video', 'label': 'Film', 'alt': 'A film', 'src': 'x.mp4'}
        ]
        with self.assertRaisesRegex(CatalogueError, 'needs a poster'):
            check_catalogue(COLLECTIONS, self.products)

    def test_too_many_media_items_fail(self):
        garment = {'type': 'garment', 'side': 'front', 'label': 'Front'}
        self.products[0]['media'] = [garment] * (build_data.MAX_MEDIA + 1)
        with self.assertRaisesRegex(CatalogueError, '1-8 items'):
            check_catalogue(COLLECTIONS, self.products)


class BuildOutputsTest(unittest.TestCase):
    """build_outputs(): the generated files."""

    def setUp(self):
        self.products = [
            piece(f'{n:02d}', position=n, bearing=n)
            for n in range(build_data.RAIL_LIMIT + 3)
        ]
        self.outputs = build_outputs(COLLECTIONS, copy.deepcopy(self.products))

    def test_one_file_per_listing_collection_and_piece(self):
        expected = 2 + len(COLLECTIONS) + len(self.products)
        self.assertEqual(len(self.outputs), expected)

    def test_home_shows_only_the_first_rail_limit_pieces(self):
        home = self.outputs['data/home.json']['products']
        self.assertEqual(len(home), build_data.RAIL_LIMIT)
        self.assertEqual(home[0]['id'], '00')

    def test_collections_carry_their_piece_count(self):
        counts = {
            c['id']: c['count']
            for c in self.outputs['data/index.json']['collections']
        }
        self.assertEqual(counts, {'tees': len(self.products), 'new': 0})

    def test_summaries_leave_out_the_long_text(self):
        summary = self.outputs['data/index.json']['products'][0]
        for key in build_data.DETAIL_ONLY:
            self.assertNotIn(key, summary)
        self.assertEqual(
            self.outputs['data/pieces/00.json']['description'], 'Long text.'
        )

    def test_pieces_are_in_position_order(self):
        shuffled = list(reversed(self.products))
        outputs = build_outputs(COLLECTIONS, shuffled)
        ids = [
            p['id'] for p in outputs['data/collections/tees.json']['products']
        ]
        self.assertEqual(ids, sorted(ids))


if __name__ == '__main__':
    unittest.main()
