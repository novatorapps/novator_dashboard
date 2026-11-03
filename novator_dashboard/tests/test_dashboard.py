from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import HttpCase, TransactionCase, tagged

from odoo.addons.novator_dashboard.models.dates import preset_range


@tagged('post_install', '-at_install')
class TestDashboard(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Partner = cls.env['res.partner']
        cls.country_a = cls.env.ref('base.be')
        cls.country_b = cls.env.ref('base.fr')
        cls.partners = cls.Partner.create([
            {'name': 'NDash A1', 'country_id': cls.country_a.id, 'ref': 'NDASH'},
            {'name': 'NDash A2', 'country_id': cls.country_a.id, 'ref': 'NDASH'},
            {'name': 'NDash A3', 'country_id': cls.country_a.id, 'ref': 'NDASH'},
            {'name': 'NDash B1', 'country_id': cls.country_b.id, 'ref': 'NDASH'},
            {'name': 'NDash N1', 'ref': 'NDASH'},
        ])
        cls.dashboard = cls.env['ndash.dashboard'].create({'name': 'Test board'})
        cls.model = cls.env.ref('base.model_res_partner')

        def field(name):
            return cls.env['ir.model.fields']._get('res.partner', name)
        cls.field = staticmethod(field)
        cls.user = cls.env['res.users'].create({
            'name': 'NDash User', 'login': 'ndash_user', 'email': 'ndash_user@example.com',
            'group_ids': [(6, 0, [cls.env.ref('base.group_user').id])],
        })

    def _item(self, **vals):
        base = {'dashboard_id': self.dashboard.id, 'name': 'Item', 'model_id': self.model.id,
                'domain': "[('ref', '=', 'NDASH')]", 'aggregate': 'count', 'date_mode': 'none'}
        base.update(vals)
        return self.env['ndash.item'].create(base)

    def _data(self, item, filters=None):
        payload = self.dashboard.ndash_item_data([item.id], filters or {'preset': 'none'})[0]
        self.assertFalse(payload.get('error'), payload.get('error'))
        return payload['data']

    def test_ranges(self):
        today = date(2026, 5, 20)  # a Wednesday
        start, end, prev_start, prev_end = preset_range('this_month', today)
        self.assertEqual((start, end, prev_start, prev_end),
                         (date(2026, 5, 1), date(2026, 6, 1), date(2026, 4, 1), date(2026, 5, 1)))
        start, end, prev_start, _prev_end = preset_range('last_quarter', today)
        self.assertEqual((start, end, prev_start), (date(2026, 1, 1), date(2026, 4, 1), date(2025, 10, 1)))
        start, end, _a, _b = preset_range('this_week', today, week_start=1)
        self.assertEqual((start, end), (date(2026, 5, 18), date(2026, 5, 25)))
        start, end, _a, _b = preset_range('this_week', today, week_start=7)
        self.assertEqual(start, date(2026, 5, 17))
        start, end, prev_start, prev_end = preset_range('last_7', today)
        self.assertEqual((start, end, prev_start, prev_end),
                         (date(2026, 5, 14), date(2026, 5, 21), date(2026, 5, 7), date(2026, 5, 14)))
        start, end, _a, _b = preset_range('custom', today, date_from='2026-02-01', date_to='2026-02-10')
        self.assertEqual((start, end), (date(2026, 2, 1), date(2026, 2, 11)))
        self.assertIsNone(preset_range('none', today))
        self.assertIsNone(preset_range('custom', today))

    def test_tile_and_compare(self):
        item = self._item(type='tile')
        self.assertEqual(self._data(item)['value'], 5)
        # two partners created "last month": the tile compares this month with last month
        self.env.cr.execute("UPDATE res_partner SET create_date = create_date - interval '40 days' WHERE id IN %s",
                            [tuple(self.partners[:2].ids)])
        self.partners.invalidate_recordset(['create_date'])
        item.write({'date_field_id': self.field('create_date').id, 'date_mode': 'dashboard', 'compare': True,
                    'target': 6})
        data = self._data(item, {'preset': 'last_30'})
        self.assertEqual(data['value'], 3)
        self.assertEqual(data['previous'], 2)
        self.assertAlmostEqual(data['change'], 50.0)
        self.assertAlmostEqual(data['progress'], 50.0)

    def test_chart_groups(self):
        item = self._item(type='bar', groupby_field_id=self.field('country_id').id, order='value_desc')
        data = self._data(item)
        self.assertEqual(data['labels'][0], self.country_a.display_name)
        self.assertEqual(data['datasets'][0]['data'], [3, 1, 1])
        # clicking the first bar opens exactly its records
        domain = data['domains'][0][0]
        self.assertEqual(self.Partner.search_count(domain), 3)
        # limit and Others
        item.write({'limit': 1, 'others': True})
        data = self._data(item)
        self.assertEqual(data['labels'][1], 'Others')
        self.assertEqual(data['datasets'][0]['data'], [3, 2])
        self.assertEqual(self.Partner.search_count(data['domains'][0][1]), 2)
        # running total
        item.write({'limit': 0, 'others': False, 'cumulative': True})
        self.assertEqual(self._data(item)['datasets'][0]['data'], [3, 4, 5])

    def test_series_and_boolean(self):
        item = self._item(type='stacked', groupby_field_id=self.field('country_id').id,
                          groupby2_field_id=self.field('is_company').id)
        data = self._data(item)
        self.assertEqual(len(data['datasets']), 1)
        self.assertEqual(data['datasets'][0]['label'], 'No')
        self.assertEqual(sum(data['datasets'][0]['data']), 5)

    def test_lists(self):
        item = self._item(type='list', list_mode='records', list_order='name desc', list_limit=2, column_ids=[
            (0, 0, {'sequence': 2, 'field_id': self.field('country_id').id}),
            (0, 0, {'sequence': 1, 'field_id': self.field('name').id, 'label': 'Who'}),
        ])
        data = self._data(item)
        self.assertEqual(data['columns'][0], 'Who')
        self.assertEqual(data['rows'][0]['cells'][0], 'NDash N1')
        self.assertEqual(data['count'], 5)
        self.assertEqual(len(data['rows']), 2)
        item.write({'list_mode': 'grouped', 'groupby_field_id': self.field('country_id').id, 'order': 'value_desc'})
        data = self._data(item)
        self.assertEqual(data['rows'][0]['cells'][1], 3)

    def test_placeholders(self):
        self.partners[0].user_id = self.env.user
        item = self._item(type='tile', domain="[('ref', '=', 'NDASH'), ('user_id', '=', %UID)]")
        self.assertEqual(self._data(item)['value'], 1)
        item.domain = "[('ref', '=', 'NDASH'), ('user_id', '=', '%UID'), ('company_id', 'in', [%MYCOMPANY, False])]"
        self.assertEqual(self._data(item)['value'], 1)

    def test_broken_item_does_not_break_dashboard(self):
        self._item(type='tile')
        bad = self._item(type='bar')  # no group by
        payload = self.dashboard.ndash_load({'preset': 'none'})
        errors = {i['id']: i.get('error') for i in payload['items']}
        self.assertTrue(errors[bad.id])
        self.assertEqual(len([e for e in errors.values() if not e]), 1)

    def test_access_and_user_data(self):
        board = self.dashboard.with_user(self.user)
        self.assertTrue(board.ndash_load({'preset': 'none'}))  # shared with everyone
        self.dashboard.group_ids = self.env.ref('base.group_system')
        self.assertNotIn(self.dashboard.id, [d['id'] for d in self.env['ndash.dashboard'].with_user(self.user).ndash_list()])
        self.dashboard.user_ids = self.user
        self.assertIn(self.dashboard.id, [d['id'] for d in self.env['ndash.dashboard'].with_user(self.user).ndash_list()])
        # items on data the user cannot read show an error, the rest still works
        secret = self._item(type='tile', model_id=self.env.ref('base.model_ir_config_parameter').id, domain='[]')
        payload = board.ndash_item_data([secret.id], {})[0]
        self.assertTrue(payload.get('error'))
        # only managers change the layout
        with self.assertRaises(AccessError):
            board.ndash_save_layout({str(secret.id): [0, 0, 3, 2]})
        self.dashboard.ndash_save_layout({str(secret.id): [2, 1, 4, 3]})
        self.assertEqual((secret.x, secret.y, secret.w, secret.h), (2, 1, 4, 3))

    def test_menu_and_home(self):
        self.dashboard.write({'show_in_menu': True})
        menu = self.dashboard.menu_id
        self.assertTrue(menu)
        self.assertEqual(menu.parent_id, self.env.ref('novator_dashboard.menu_ndash_root'))
        self.dashboard.with_user(self.user).action_set_home()
        self.assertEqual(self.user.action_id.id, self.dashboard.action_id.id)
        action = self.dashboard.action_id
        self.dashboard.unlink()
        self.assertFalse(menu.exists())
        self.assertFalse(action.exists())

    def test_copy_move_type(self):
        item = self._item(type='bar', groupby_field_id=self.field('country_id').id)
        other = self.env['ndash.dashboard'].create({'name': 'Other'})
        new_id = item.ndash_copy_to(other.id)
        self.assertEqual(self.env['ndash.item'].browse(new_id).dashboard_id, other)
        item.ndash_set_type('pie')
        self.assertEqual(item.type, 'pie')
        item.ndash_copy_to(other.id, move=True)
        self.assertEqual(item.dashboard_id, other)
        dup = self.env['ndash.item'].browse(item.ndash_duplicate())
        self.assertEqual(dup.dashboard_id, other)

    def test_sample_dashboard(self):
        sample = self.env.ref('novator_dashboard.dashboard_contacts')
        payload = sample.ndash_load({'preset': 'this_year'})
        self.assertEqual(len(payload['items']), 8)
        self.assertFalse([i['error'] for i in payload['items'] if i.get('error')])


@tagged('post_install', '-at_install')
class TestDashboardRpc(HttpCase):

    def test_web_client_call(self):
        """The web client calls ndash_load and ndash_home through JSON-RPC."""
        self.authenticate('admin', 'admin')
        sample = self.env.ref('novator_dashboard.dashboard_contacts')
        result = self.make_jsonrpc_request('/web/dataset/call_kw/ndash.dashboard/ndash_load', {
            'model': 'ndash.dashboard', 'method': 'ndash_load', 'args': [[sample.id], {'preset': 'none'}], 'kwargs': {},
        })
        self.assertEqual(result['id'], sample.id)
        home = self.make_jsonrpc_request('/web/dataset/call_kw/ndash.dashboard/ndash_home', {
            'model': 'ndash.dashboard', 'method': 'ndash_home', 'args': [], 'kwargs': {},
        })
        self.assertTrue(home['first_id'])
