from odoo import _, api, fields, models, release
from odoo.exceptions import AccessError, UserError
from odoo.tools.misc import get_lang

from .dates import PRESETS, preset_range

PALETTES = [
    ('novator', 'Novator'),
    ('ocean', 'Ocean'),
    ('sunset', 'Sunset'),
    ('forest', 'Forest'),
    ('berry', 'Berry'),
    ('mono', 'Monochrome'),
    ('pastel', 'Pastel'),
]

REFRESH = [('0', 'Off'), ('30', 'Every 30 seconds'), ('60', 'Every minute'), ('300', 'Every 5 minutes'),
           ('900', 'Every 15 minutes'), ('3600', 'Every hour')]


class NdashDashboard(models.Model):
    _name = 'ndash.dashboard'
    _description = 'Dashboard'
    _order = 'sequence, id'

    name = fields.Char(required=True, translate=True)
    active = fields.Boolean(default=True)
    sequence = fields.Integer(default=10)
    description = fields.Text(translate=True)
    item_ids = fields.One2many('ndash.item', 'dashboard_id', string='Items', copy=True)
    item_count = fields.Integer(compute='_compute_item_count', string='Number of items')
    group_ids = fields.Many2many('res.groups', 'ndash_dashboard_group_rel', 'dashboard_id', 'group_id',
                                 string='Groups', help='Users of these groups can open the dashboard. '
                                 'Leave Groups and Users empty to share it with every dashboard user.')
    user_ids = fields.Many2many('res.users', 'ndash_dashboard_user_rel', 'dashboard_id', 'user_id',
                                string='Users', help='These users can open the dashboard.')
    date_preset = fields.Selection(PRESETS, string='Default period', default='none', required=True)
    refresh_interval = fields.Selection(REFRESH, string='Auto refresh', default='0', required=True)
    palette = fields.Selection(PALETTES, default='novator', required=True)
    show_in_menu = fields.Boolean(string='Show in menu', help='Add a menu entry that opens this dashboard.')
    menu_parent_id = fields.Many2one('ir.ui.menu', string='Under menu',
                                     help='Where the menu entry goes. Empty: in the Dashboards app.')
    menu_id = fields.Many2one('ir.ui.menu', string='Menu entry', readonly=True, copy=False)
    action_id = fields.Many2one('ir.actions.client', string='Action', readonly=True, copy=False)

    @api.depends('item_ids')
    def _compute_item_count(self):
        for dashboard in self:
            dashboard.item_count = len(dashboard.item_ids)

    # ------------------------------------------------------------------ menus and actions
    @api.model_create_multi
    def create(self, vals_list):
        dashboards = super().create(vals_list)
        dashboards._ndash_sync_menu()
        return dashboards

    def write(self, vals):
        res = super().write(vals)
        if {'name', 'show_in_menu', 'menu_parent_id', 'group_ids', 'active', 'sequence'} & set(vals):
            self._ndash_sync_menu()
        return res

    def unlink(self):
        menus = self.sudo().mapped('menu_id')
        actions = self.sudo().mapped('action_id')
        res = super().unlink()
        menus.unlink()
        actions.unlink()
        return res

    def copy_data(self, default=None):
        vals_list = super().copy_data(default)
        if not (default or {}).get('name'):
            for dashboard, vals in zip(self, vals_list):
                vals['name'] = _('%s (copy)', dashboard.name)
        return vals_list

    def _ndash_sync_menu(self):
        root = self.env.ref('novator_dashboard.menu_ndash_root', raise_if_not_found=False)
        user_group = self.env.ref('novator_dashboard.group_ndash_user')
        for dashboard in self.sudo():
            action_vals = {'name': dashboard.name, 'tag': 'ndash_dashboard',
                           'params': {'dashboard_id': dashboard.id}}
            if dashboard.action_id:
                dashboard.action_id.write(action_vals)
            else:
                dashboard.action_id = self.env['ir.actions.client'].create(action_vals)
            if dashboard.show_in_menu and dashboard.active:
                menu_vals = {
                    'name': dashboard.name,
                    'parent_id': (dashboard.menu_parent_id or root).id,
                    'action': 'ir.actions.client,%d' % dashboard.action_id.id,
                    'sequence': dashboard.sequence,
                    'groups_id': [(6, 0, (dashboard.group_ids or user_group).ids)],
                }
                if dashboard.menu_id:
                    dashboard.menu_id.write(menu_vals)
                else:
                    dashboard.menu_id = self.env['ir.ui.menu'].create(menu_vals)
            elif dashboard.menu_id:
                menu = dashboard.menu_id
                dashboard.menu_id = False
                menu.unlink()

    def _ndash_action(self):
        self.ensure_one()
        if not self.action_id:
            self._ndash_sync_menu()
        return {
            'type': 'ir.actions.client',
            'tag': 'ndash_dashboard',
            'name': self.name,
            'params': {'dashboard_id': self.id},
        }

    def action_open(self):
        return self._ndash_action()

    def action_set_home(self):
        """Make this dashboard the current user's home page."""
        self.ensure_one()
        self.check_access('read')
        if not self.action_id:
            self._ndash_sync_menu()
        self.env.user.sudo().action_id = self.sudo().action_id.id
        return True

    # ------------------------------------------------------------------ data for the web client
    @api.model
    def _ndash_can_manage(self):
        return self.env.user.has_group('novator_dashboard.group_ndash_manager')

    @api.model
    def ndash_list(self):
        return [{'id': d.id, 'name': d.name} for d in self.search([])]

    @api.model
    def ndash_home(self):
        """First dashboard of the current user, for the Dashboards app."""
        dashboards = self.ndash_list()
        return {'dashboards': dashboards, 'first_id': dashboards and dashboards[0]['id'] or False,
                'can_manage': self._ndash_can_manage()}

    def _ndash_range(self, filters):
        """(start, end, prev_start, prev_end) for the filters sent by the web client, or None."""
        filters = filters or {}
        preset = filters.get('preset') or self.date_preset or 'none'
        today = fields.Date.context_today(self)
        week_start = getattr(get_lang(self.env), 'week_start', '1') or '1'
        return preset, preset_range(preset, today, int(week_start), filters.get('date_from'), filters.get('date_to'))

    def ndash_load(self, filters=None):
        self.ensure_one()
        preset, date_range = self._ndash_range(filters)
        items = self.item_ids
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description or '',
            'palette': self.palette,
            'refresh': int(self.refresh_interval or 0),
            'preset': preset,
            'presets': [list(o) for o in self.fields_get(['date_preset'])['date_preset']['selection']],
            'range': date_range and [date_range[0].isoformat(), (date_range[1]).isoformat()] or False,
            'can_manage': self._ndash_can_manage(),
            'dashboards': self.ndash_list(),
            'currency': self._ndash_currency(),
            'items': [item._ndash_payload(date_range, filters) for item in items],
            'pro': self._ndash_pro_installed(),
            'pro_url': 'https://apps.odoo.com/apps/modules/%d.0/novator_dashboard_pro' % release.version_info[0],
        }

    @api.model
    def _ndash_pro_installed(self):
        return bool(self.env['ir.module.module'].sudo().search_count(
            [('name', '=', 'novator_dashboard_pro'), ('state', '=', 'installed')]))

    def ndash_item_data(self, item_ids, filters=None):
        """Data of some items (refresh of one item, drill-down)."""
        self.ensure_one()
        _preset, date_range = self._ndash_range(filters)
        items = self.item_ids.filtered(lambda i: i.id in item_ids)
        return [item._ndash_payload(date_range, filters) for item in items]

    def _ndash_currency(self):
        currency = self.env.company.currency_id
        return {'symbol': currency.symbol, 'position': currency.position, 'decimals': currency.decimal_places}

    def ndash_save_layout(self, layout):
        """layout: {item_id: [x, y, w, h]}"""
        self.ensure_one()
        if not self._ndash_can_manage():
            raise AccessError(_('Only dashboard managers can change the layout.'))
        for item in self.item_ids:
            pos = layout.get(str(item.id)) or layout.get(item.id)
            if pos:
                x, y, w, h = (int(v) for v in pos)
                vals = {'x': max(0, min(x, 11)), 'y': max(0, y), 'w': max(1, min(w, 12)), 'h': max(1, min(h, 20))}
                if any(item[k] != v for k, v in vals.items()):
                    item.write(vals)
        return True

    def ndash_new_item_y(self):
        self.ensure_one()
        return max([i.y + i.h for i in self.item_ids] or [0])

    def action_view_items(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Items'),
            'res_model': 'ndash.item',
            'view_mode': 'list,form',
            'domain': [('dashboard_id', '=', self.id)],
            'context': {'default_dashboard_id': self.id},
        }

    @api.constrains('menu_parent_id')
    def _check_menu_parent(self):
        for dashboard in self:
            if dashboard.menu_parent_id and dashboard.menu_parent_id == dashboard.menu_id:
                raise UserError(_('A dashboard menu cannot be its own parent.'))
