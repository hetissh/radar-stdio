"""Tests for the Shopify scripts, with a fake Admin session (no network)."""

import json
import unittest
from email.message import Message
from unittest import mock

import shopify_api
from shopify_api import (
    Admin,
    Reply,
    ShopifyError,
    metafields,
    multipart_body,
    price_to_int,
    raise_user_errors,
)
from shopify_import import product_metafields, read_back, slug, variant_inputs
from sync_shopify import CatalogueReader, WriteBack, free_bearing


def reply(data, status=200):
    """A fake JSON reply."""
    return Reply(status, Message(), json.dumps(data).encode(), status < 400)


class HelpersTest(unittest.TestCase):
    """Small Shopify helpers."""

    def test_price_to_int_rounds_shopify_money(self):
        self.assertEqual(price_to_int('2400.0'), 2400)
        self.assertEqual(price_to_int('1999.5'), 2000)

    def test_metafields_by_key(self):
        node = {'metafields': {'nodes': [{'key': 'id', 'value': '07'}]}}
        self.assertEqual(metafields(node), {'id': '07'})

    def test_user_errors_raise_with_the_mutation_name(self):
        data = {
            'productSet': {
                'userErrors': [
                    {'field': ['input', 'title'], 'message': 'is blank'}
                ]
            }
        }
        with self.assertRaisesRegex(
            ShopifyError, 'productSet: input.title is blank'
        ):
            raise_user_errors(data)
        raise_user_errors({'productSet': {'userErrors': []}})

    def test_multipart_body_has_fields_then_the_file(self):
        body = multipart_body(
            'B', [{'name': 'key', 'value': 'k'}], ('a.png', 'image/png', b'PNG')
        )
        self.assertEqual(
            body,
            b'--B\r\nContent-Disposition: form-data; name="key"\r\n\r\nk\r\n'
            b'--B\r\nContent-Disposition: form-data; name="file"; '
            b'filename="a.png"\r\nContent-Type: image/png\r\n\r\nPNG\r\n'
            b'--B--\r\n',
        )

    def test_slug(self):
        self.assertEqual(slug('Signal 21 Tee!'), 'signal-21-tee')


class AdminTest(unittest.TestCase):
    """The Admin client, with send() faked."""

    ENV = {
        'SHOPIFY_STORE_DOMAIN': 'radar-test.myshopify.com',
        'SHOPIFY_API_VERSION': '2026-10',
        'SHOPIFY_CLIENT_ID': 'id',
        'SHOPIFY_CLIENT_SECRET': 'secret',
    }

    def admin(self, replies):
        responses = iter([reply({'access_token': 't'}), *replies])
        self.send = mock.patch.object(
            shopify_api, 'send', side_effect=lambda *a: next(responses)
        ).start()
        mock.patch.object(shopify_api.time, 'sleep').start()
        self.addCleanup(mock.patch.stopall)
        return Admin(self.ENV)

    def test_missing_settings_stop_before_any_request(self):
        with self.assertRaisesRegex(SystemExit, 'SHOPIFY_CLIENT_SECRET'):
            Admin(
                {
                    k: v
                    for k, v in self.ENV.items()
                    if k != 'SHOPIFY_CLIENT_SECRET'
                }
            )

    def test_throttled_requests_are_retried(self):
        throttled = reply(
            {
                'errors': [
                    {
                        'message': 'Throttled',
                        'extensions': {'code': 'THROTTLED'},
                    }
                ]
            }
        )
        admin = self.admin(
            [throttled, throttled, reply({'data': {'shop': {'name': 'S'}}})]
        )
        self.assertEqual(
            admin.graphql('{ shop { name } }'), {'shop': {'name': 'S'}}
        )
        self.assertEqual(self.send.call_count, 4)  # token + three tries

    def test_graphql_errors_raise(self):
        admin = self.admin([reply({'errors': [{'message': 'Bad field'}]})])
        with self.assertRaisesRegex(ShopifyError, 'HTTP 200: Bad field'):
            admin.graphql('{ nope }')

    def test_pages_follow_cursors(self):
        first = {
            'items': {
                'nodes': [1, 2],
                'pageInfo': {'hasNextPage': True, 'endCursor': 'c'},
            }
        }
        second = {
            'items': {
                'nodes': [3],
                'pageInfo': {'hasNextPage': False, 'endCursor': None},
            }
        }
        admin = self.admin([reply({'data': first}), reply({'data': second})])
        self.assertEqual(list(admin.pages('query', ['items'])), [1, 2, 3])
        last_payload = json.loads(self.send.call_args.args[0].data)
        self.assertEqual(last_payload['variables'], {'after': 'c'})


class FreeBearingTest(unittest.TestCase):
    """free_bearing(): where a new piece goes on a ring."""

    def test_an_empty_ring_starts_at_zero(self):
        self.assertEqual(free_bearing([]), 0)

    def test_the_middle_of_the_widest_gap(self):
        self.assertEqual(free_bearing([0, 90, 200]), 280)

    def test_rounding_never_lands_on_a_taken_degree(self):
        taken = list(range(360))
        taken.remove(359)
        self.assertEqual(free_bearing(taken), 359)


def product_node(
    gid, meta=None, variants=None, image='https://cdn.shopify.com/a.png'
):
    """A product node as the sync query returns it."""
    return {
        'id': gid,
        'title': 'Admin Tee',
        'description': 'From the admin.',
        'productType': '',
        'tags': ['Graphics'],
        'featuredMedia': {'image': {'url': image}} if image else None,
        'variants': {
            'nodes': variants
            if variants is not None
            else [{'price': '1000.0', 'compareAtPrice': '1500.0'}]
        },
        'metafields': {
            'nodes': [{'key': k, 'value': v} for k, v in (meta or {}).items()]
        },
    }


class CatalogueReaderTest(unittest.TestCase):
    """Turning product nodes into pieces."""

    def setUp(self):
        self.reader = CatalogueReader(
            {'tees': ['p1', 'p2'], 'new': ['p2']},
            {'p1': ['tees'], 'p2': ['tees', 'new']},
        )

    def test_a_new_product_gets_an_id_a_ring_and_defaults(self):
        nodes = [product_node('p1', {'id': '07'}), product_node('p2')]
        self.reader.reserve_ids(nodes)
        piece = self.reader.piece(nodes[1])
        self.assertEqual(
            (piece['id'], piece['collection'], piece['position']),
            ('08', 'tees', 1),
        )
        self.assertEqual((piece['price'], piece['original']), (1000, 1500))
        self.assertEqual(piece['title'], 'Admin Tee')
        self.assertEqual(piece['category'], 'Graphics')
        self.assertIsNone(piece['bearing'])
        self.assertEqual(
            self.reader.write_backs,
            [
                WriteBack('p2', 'ring', 'single_line_text_field', 'tees'),
                WriteBack('p2', 'id', 'id', '08'),
            ],
        )

    def test_a_valid_ring_is_kept_without_a_write_back(self):
        self.reader.reserve_ids([])
        piece = self.reader.piece(
            product_node('p2', {'id': '02', 'ring': 'new', 'bearing': '45'})
        )
        self.assertEqual((piece['collection'], piece['bearing']), ('new', 45))
        self.assertEqual(self.reader.write_backs, [])

    def test_products_without_artwork_or_variants_are_skipped(self):
        self.reader.reserve_ids([])
        with mock.patch('sys.stderr'):
            self.assertIsNone(self.reader.piece(product_node('p1', image=None)))
            self.assertIsNone(
                self.reader.piece(product_node('p1', variants=[]))
            )


class ImportMappingTest(unittest.TestCase):
    """How a piece maps onto Shopify fields."""

    PIECE = {
        'id': '27',
        'collection': 'tees',
        'bearing': 90,
        'title': 'Artwork',
        'category': 'Graphics',
        'discipline': '',
        'year': '2026',
        'image': 'reference-27.png',
        'dark': True,
        'price': 1600,
        'original': 2400,
        'name': 'Tee',
        'position': 0,
    }

    def test_metafields_leave_out_empty_values(self):
        fields = {f['key']: f['value'] for f in product_metafields(self.PIECE)}
        self.assertEqual(fields['dark'], 'true')
        self.assertEqual(fields['bearing'], '90')
        self.assertNotIn('discipline', fields)
        self.assertNotIn('media', fields)

    def test_variants_carry_a_compare_at_price_only_when_reduced(self):
        variants = variant_inputs(self.PIECE, None)
        self.assertEqual([v['compareAtPrice'] for v in variants], ['2400'] * 5)
        full_price = variant_inputs({**self.PIECE, 'original': 1600}, None)
        self.assertEqual({v['compareAtPrice'] for v in full_price}, {None})

    def test_stock_is_set_only_with_a_location_and_respects_sold_out(self):
        self.assertNotIn(
            'inventoryQuantities', variant_inputs(self.PIECE, None)[0]
        )
        stock = {
            v['inventoryItem']['sku']: v['inventoryQuantities'][0]['quantity']
            for v in variant_inputs(self.PIECE, 'gid://shopify/Location/1')
        }
        self.assertEqual(stock['RADAR-27-M'], 0)  # sold-out test data
        self.assertEqual(stock['RADAR-27-XS'], 10)

    def test_read_back_mirrors_the_products_json_shape(self):
        node = {
            'title': 'Tee',
            'descriptionHtml': '<p>A &amp; B</p>',
            'variants': {
                'nodes': [{'price': '1600.0', 'compareAtPrice': '2400.0'}] * 5
            },
        }
        got = read_back(node, {'ring': 'tees', 'bearing': '90', 'dark': 'true'})
        self.assertEqual(got['description'], 'A & B')
        self.assertEqual(
            (got['price'], got['original'], got['bearing']), (1600, 2400, 90)
        )
        self.assertIs(got['dark'], True)


if __name__ == '__main__':
    unittest.main()
