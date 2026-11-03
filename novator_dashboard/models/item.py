import logging
from datetime import date, datetime

from babel.dates import format_date

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.osv import expression
from odoo.tools.misc import babel_locale_parse, format_date as format_date_lang, format_datetime
from odoo.tools.safe_eval import datetime as safe_datetime, dateutil as safe_dateutil, safe_eval

from .dates import GRANULARITY, PRESETS, period_end, range_domain, to_date
from .dashboard import PALETTES

_logger = logging.getLogger(__name__)

ITEM_TYPES = [
    ('tile', 'Tile (KPI)'),
    ('bar', 'Bar'),
    ('hbar', 'Horizontal bar'),
    ('stacked', 'Stacked bar'),
    ('line', 'Line'),
    ('area', 'Area'),
    ('pie', 'Pie'),
    ('doughnut', 'Doughnut'),
    ('polar', 'Polar area'),
    ('radar', 'Radar'),
    ('scatter', 'Scatter'),
    ('funnel', 'Funnel'),
    ('gauge', 'Gauge'),
    ('list', 'List'),
]
CHART_TYPES = {'bar', 'hbar', 'stacked', 'line', 'area', 'pie', 'doughnut', 'polar', 'radar', 'scatter', 'funnel'}
AGGREGATES = [('count', 'Count'), ('sum', 'Sum'), ('avg', 'Average'), ('min', 'Minimum'), ('max', 'Maximum'),
              ('count_distinct', 'Count distinct')]
NUMERIC = ('integer', 'float', 'monetary')
GROUPABLE = ('many2one', 'selection', 'char', 'boolean', 'date', 'datetime', 'integer', 'many2many')
DEFAULT_SIZE = {'tile': (3, 2), 'gauge': (3, 3), 'list': (6, 4)}
MAX_GROUPS = 500
MAX_ROWS = 200

DATE_LABEL = {'day': 'd MMM yyyy', 'week': "'W'w YYYY", 'month': 'MMM yyyy', 'quarter': 'QQQ yyyy', 'year': 'yyyy'}


class NdashItem(models.Model):
    _name = 'ndash.item'
    _description = 'Dashboard item'
    _order = 'dashboard_id, y, x, id'

    name = fields.Char(required=True, translate=True)
    dashboard_id = fields.Many2one('ndash.dashboard', required=True, ondelete='cascade', index=True)
    type = fields.Selection(ITEM_TYPES, required=True, default='bar')
    description = fields.Char(translate=True, help='Shown as a tooltip on the item title.')
    source = fields.Selection([('model', 'Odoo data')], default='model', required=True,
                              help='Where the data comes from.')

    # data
    model_id = fields.Many2one('ir.model', string='Model', ondelete='cascade',
                               domain=[('transient', '=', False)])
    model_name = fields.Char(related='model_id.model', string='Model name')
    domain = fields.Char(default='[]', help='Records to include. %UID is the current user and %MYCOMPANY '
                                            'the current company.')
    date_field_id = fields.Many2one('ir.model.fields', string='Date field', ondelete='set null',
                                    domain="[('model_id', '=', model_id), ('ttype', 'in', ('date', 'datetime')), "
                                           "('store', '=', True)]")
    date_mode = fields.Selection([('dashboard', 'Follow the dashboard period'), ('own', 'Own period'),
                                  ('none', 'All time')], default='dashboard', required=True, string='Period')
    date_preset = fields.Selection(PRESETS, string='Own period preset', default='this_year')
    measure_field_id = fields.Many2one('ir.model.fields', string='Measure', ondelete='set null',
                                       domain="[('model_id', '=', model_id), ('ttype', 'in', %r), "
                                              "('store', '=', True)]" % (NUMERIC,),
                                       help='Empty: count the records.')
    aggregate = fields.Selection(AGGREGATES, default='sum', required=True)
    measure2_field_id = fields.Many2one('ir.model.fields', string='Second measure', ondelete='set null',
                                        domain="[('model_id', '=', model_id), ('ttype', 'in', %r), "
                                               "('store', '=', True)]" % (NUMERIC,),
                                        help='Shown as a line on bar charts, or as the Y axis of a scatter chart.')
    aggregate2 = fields.Selection(AGGREGATES, default='sum', required=True, string='Second aggregate')
    count2 = fields.Boolean(string='Second measure: count', help='Use the number of records as second measure.')
    groupby_field_id = fields.Many2one('ir.model.fields', string='Group by', ondelete='set null',
                                       domain="[('model_id', '=', model_id), ('ttype', 'in', %r), "
                                              "('store', '=', True)]" % (GROUPABLE,))
    granularity = fields.Selection(GRANULARITY, default='month', required=True)
    groupby2_field_id = fields.Many2one('ir.model.fields', string='Then by (series)', ondelete='set null',
                                        domain="[('model_id', '=', model_id), ('ttype', 'in', %r), "
                                               "('store', '=', True)]" % (GROUPABLE,))
    granularity2 = fields.Selection(GRANULARITY, default='month', required=True, string='Series granularity')
    groupby_is_date = fields.Boolean(compute='_compute_groupby_is_date')
    groupby2_is_date = fields.Boolean(compute='_compute_groupby_is_date')
    order = fields.Selection([('natural', 'Natural order'), ('value_desc', 'Largest first'),
                              ('value_asc', 'Smallest first'), ('label_asc', 'Label A-Z'),
                              ('label_desc', 'Label Z-A')], default='natural', required=True, string='Sort')
    limit = fields.Integer(default=0, help='Show only this many groups (0: all).')
    others = fields.Boolean(string='Group the rest as Others')
    cumulative = fields.Boolean(help='Each point adds the previous ones (running total).')

    # list
    list_mode = fields.Selection([('grouped', 'Grouped totals'), ('records', 'Records')], default='records',
                                 required=True, string='List shows')
    column_ids = fields.One2many('ndash.item.column', 'item_id', string='Columns', copy=True)
    list_order = fields.Char(string='Order', help='For example: create_date desc')
    list_limit = fields.Integer(default=10, string='Rows')

    # tile and gauge
    icon = fields.Char(default='fa-bar-chart', help='Font Awesome icon, for example fa-money')
    compare = fields.Boolean(string='Compare with previous period', default=True)
    target = fields.Float(help='Goal for tiles (progress bar) and gauges (maximum).')

    # look
    color = fields.Char(help='Main color, for example #b07d0b. Empty: dashboard palette.')
    palette = fields.Selection(PALETTES, help='Empty: dashboard palette.')
    prefix = fields.Char()
    suffix = fields.Char()
    currency = fields.Boolean(string='Show currency', help='Show the company currency symbol.')
    short_numbers = fields.Boolean(default=True, help='1.2K, 3.4M')
    decimals = fields.Integer(default=0)
    show_values = fields.Boolean(string='Show values on the chart')
    show_legend = fields.Boolean(default=True)
    click_action = fields.Selection([('records', 'Open the records'), ('none', 'Nothing')], default='records',
                                    required=True, string='On click')

    # layout (12 column grid)
    x = fields.Integer(default=0)
    y = fields.Integer(default=0)
    w = fields.Integer(default=6)
    h = fields.Integer(default=4)

    @api.depends('groupby_field_id', 'groupby2_field_id')
    def _compute_groupby_is_date(self):
        for item in self:
            item.groupby_is_date = item.groupby_field_id.ttype in ('date', 'datetime')
            item.groupby2_is_date = item.groupby2_field_id.ttype in ('date', 'datetime')

    @api.onchange('model_id')
    def _onchange_model_id(self):
        for item in self:
            fields_ = (item.date_field_id | item.measure_field_id | item.measure2_field_id | item.groupby_field_id
                       | item.groupby2_field_id)
            if any(f.model_id != item.model_id for f in fields_):
                item.date_field_id = item.measure_field_id = item.measure2_field_id = False
                item.groupby_field_id = item.groupby2_field_id = False
                item.column_ids = [(5, 0, 0)]
            if item.model_id and not item.date_field_id:
                names = item.model_id.field_id.filtered(lambda f: f.ttype in ('date', 'datetime') and f.store)
                for preferred in ('date_order', 'date', 'invoice_date', 'create_date'):
                    match = names.filtered(lambda f: f.name == preferred)
                    if match:
                        item.date_field_id = match[:1]
                        break

    @api.onchange('type')
    def _onchange_type(self):
        for item in self:
            if not item.id or isinstance(item.id, models.NewId) and not item._origin:
                w, h = DEFAULT_SIZE.get(item.type, (6, 4))
                item.w, item.h = w, h

    @api.constrains('domain')
    def _check_domain(self):
        for item in self:
            try:
                item._ndash_domain()
            except Exception as e:  # noqa: BLE001 - show any parsing problem to the user
                raise ValidationError(_('The filter of "%(name)s" is not valid: %(error)s', name=item.name, error=e))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if 'y' not in vals and vals.get('dashboard_id'):
                dashboard = self.env['ndash.dashboard'].browse(vals['dashboard_id'])
                vals['y'] = dashboard.ndash_new_item_y()
            if vals.get('type') and 'w' not in vals:
                vals['w'], vals['h'] = DEFAULT_SIZE.get(vals['type'], (6, 4))
        return super().create(vals_list)

    # ------------------------------------------------------------------ actions from the web client
    def ndash_duplicate(self):
        self.ensure_one()
        copy = self.copy({'y': self.dashboard_id.ndash_new_item_y(), 'name': _('%s (copy)', self.name)})
        return copy.id

    def ndash_copy_to(self, dashboard_id, move=False):
        self.ensure_one()
        target = self.env['ndash.dashboard'].browse(dashboard_id)
        target.check_access('write')
        y = target.ndash_new_item_y()
        if move:
            self.write({'dashboard_id': target.id, 'y': y})
            return self.id
        return self.copy({'dashboard_id': target.id, 'y': y}).id

    def ndash_set_type(self, item_type):
        self.ensure_one()
        if item_type not in dict(ITEM_TYPES):
            raise UserError(_('Unknown item type.'))
        self.type = item_type
        return True

    # ------------------------------------------------------------------ data
    def _ndash_eval_context(self):
        ctx = self.env['ir.rule']._eval_context()
        today = fields.Date.context_today(self)
        ctx.update({
            'uid': self.env.uid,
            'context_today': lambda: today,
            'today': today.isoformat(),
            'datetime': safe_datetime,
            'relativedelta': safe_dateutil.relativedelta.relativedelta,
        })
        return ctx

    def _ndash_domain(self):
        self.ensure_one()
        text = (self.domain or '[]').strip() or '[]'
        text = text.replace('"%UID"', str(self.env.uid)).replace("'%UID'", str(self.env.uid))
        text = text.replace('%UID', str(self.env.uid))
        company = str(self.env.company.id)
        text = text.replace('"%MYCOMPANY"', company).replace("'%MYCOMPANY'", company).replace('%MYCOMPANY', company)
        domain = safe_eval(text, self._ndash_eval_context())
        if not isinstance(domain, (list, tuple)):
            raise ValueError(_('a filter must be a list'))
        return list(domain)

    def _ndash_date_domain(self, date_range, previous=False):
        """Domain on the item's date field for the dashboard range (or the item's own period)."""
        self.ensure_one()
        if not self.date_field_id or self.date_mode == 'none':
            return []
        if self.date_mode == 'own':
            date_range = self.dashboard_id._ndash_range({'preset': self.date_preset})[1]
        if not date_range:
            return []
        start, end = (date_range[2], date_range[3]) if previous else (date_range[0], date_range[1])
        return range_domain(self.date_field_id, start, end, self.env.user.tz or self.env.context.get('tz'))

    def _ndash_check_model(self, Model):
        if not Model.has_access('read'):
            raise AccessError(_('You cannot read %s.', self.model_id.name))
        names = [f.name for f in (self.measure_field_id | self.measure2_field_id | self.groupby_field_id
                                  | self.groupby2_field_id | self.date_field_id)]
        allowed = Model.fields_get(names, ['type'])
        missing = [n for n in names if n not in allowed]
        if missing:
            raise AccessError(_('You cannot read the field(s) %s.', ', '.join(missing)))

    def _ndash_payload(self, date_range, filters=None):
        """Everything the web client needs to draw the item."""
        self.ensure_one()
        payload = {
            'id': self.id, 'name': self.name, 'type': self.type, 'description': self.description or '',
            'x': self.x, 'y': self.y, 'w': self.w, 'h': self.h,
            'model': self.model_name or False, 'model_label': self.model_id.name or '',
            'icon': self.icon or 'fa-bar-chart', 'color': self.color or False, 'palette': self.palette or False,
            'prefix': self.prefix or '', 'suffix': self.suffix or '', 'currency': self.currency,
            'short': self.short_numbers, 'decimals': self.decimals, 'show_values': self.show_values,
            'legend': self.show_legend, 'clickable': self.click_action == 'records', 'target': self.target,
            'cumulative': self.cumulative, 'measure_label': self._ndash_measure_label(),
        }
        try:
            payload['data'] = self._ndash_data(date_range, filters or {})
        except (AccessError, UserError, ValidationError, ValueError, SyntaxError, NameError, KeyError) as e:
            payload['error'] = str(e.args[0] if getattr(e, 'args', None) else e)
        except Exception as e:  # noqa: BLE001 - one broken item must not break the dashboard
            _logger.exception('Dashboard item %s failed', self.id)
            payload['error'] = _('This item could not be computed: %s', e)
        return payload

    def _ndash_measure_label(self):
        if self.measure_field_id and self.aggregate != 'count':
            return self.measure_field_id.field_description
        return _('Count')

    def _ndash_data(self, date_range, filters):
        """Return the item's data. Hook for other data sources (SQL, files, drill-down)."""
        if not self.model_id:
            raise UserError(_('Choose a model.'))
        Model = self.env[self.model_id.model]
        self._ndash_check_model(Model)
        domain = expression.AND([self._ndash_domain(), self._ndash_date_domain(date_range)])
        if self.type == 'tile':
            data = self._ndash_tile(Model, domain, date_range)
        elif self.type == 'gauge':
            data = {'value': self._ndash_total(Model, domain), 'max': self.target or 0}
        elif self.type == 'list' and self.list_mode == 'records':
            data = self._ndash_records(Model, domain)
        elif self.type == 'list':
            data = self._ndash_grouped_table(Model, domain)
        else:
            data = self._ndash_chart(Model, domain, filters)
        data.setdefault('domain', domain)
        return data

    # aggregates ---------------------------------------------------------
    def _ndash_spec(self, field, aggregate):
        if not field or aggregate == 'count':
            return '__count'
        return '%s:%s' % (field.name, aggregate)

    def _ndash_total(self, Model, domain, second=False):
        field = self.measure2_field_id if second else self.measure_field_id
        aggregate = 'count' if (second and self.count2) else (self.aggregate2 if second else self.aggregate)
        spec = self._ndash_spec(field, aggregate)
        [(value,)] = Model._read_group(domain, [], [spec])
        return value or 0

    def _ndash_tile(self, Model, domain, date_range):
        value = self._ndash_total(Model, domain)
        data = {'value': value, 'domain': domain}
        if self.compare and date_range and self.date_field_id and self.date_mode == 'dashboard':
            prev_domain = expression.AND([self._ndash_domain(), self._ndash_date_domain(date_range, previous=True)])
            previous = self._ndash_total(Model, prev_domain)
            data['previous'] = previous
            data['change'] = ((value - previous) / abs(previous) * 100.0) if previous else None
        if self.target:
            data['progress'] = value / self.target * 100.0
        return data

    # groups -------------------------------------------------------------
    def _ndash_groupby_spec(self, field, granularity):
        if field.ttype in ('date', 'datetime'):
            return '%s:%s' % (field.name, granularity)
        return field.name

    def _ndash_group_key(self, field, value, granularity):
        """(key, label, domain) for one group value."""
        name = field.name
        if field.ttype == 'boolean':
            return bool(value), _('Yes') if value else _('No'), [(name, '=', bool(value))]
        if value is False or value is None or (isinstance(value, models.BaseModel) and not value):
            return 'false', _('None'), [(name, '=', False)]
        if isinstance(value, models.BaseModel):
            return value.id, value.display_name, [(name, '=', value.id)]
        if field.ttype in ('date', 'datetime'):
            start = to_date(value)
            end = period_end(start, granularity)
            locale = babel_locale_parse(self.env.lang or 'en_US')
            label = format_date(start, DATE_LABEL.get(granularity, 'MMM yyyy'), locale=locale)
            if field.ttype == 'datetime':
                dom = range_domain(field, start, end, self.env.user.tz)
            else:
                dom = [(name, '>=', start.isoformat()), (name, '<', end.isoformat())]
            return start.isoformat(), label, dom
        if field.ttype == 'selection':
            info = self.env[field.model].fields_get([name], ['selection']).get(name) or {}
            selection = dict(info.get('selection') or [])
            return value, selection.get(value, value), [(name, '=', value)]
        if field.ttype == 'boolean':
            return bool(value), _('Yes') if value else _('No'), [(name, '=', bool(value))]
        return value, str(value), [(name, '=', value)]

    def _ndash_order_groups(self, groups, limit=None, others=None):
        """groups: list of dicts with key, label, value. Sort, limit, Others."""
        limit = self.limit if limit is None else limit
        others = self.others if others is None else others
        if self.order == 'value_desc':
            groups.sort(key=lambda g: g['value'] or 0, reverse=True)
        elif self.order == 'value_asc':
            groups.sort(key=lambda g: g['value'] or 0)
        elif self.order == 'label_asc':
            groups.sort(key=lambda g: str(g['label']).lower())
        elif self.order == 'label_desc':
            groups.sort(key=lambda g: str(g['label']).lower(), reverse=True)
        if limit and len(groups) > limit:
            rest = groups[limit:]
            groups = groups[:limit]
            if others and (not self.measure_field_id or self.aggregate in ('count', 'sum')):
                small = len(rest) < 80
                groups.append({'key': '__others', 'label': _('Others'), 'value': sum(g['value'] or 0 for g in rest),
                               'domain': expression.OR([g['domain'] for g in rest]) if small else False,
                               'gdomain': expression.OR([g['gdomain'] for g in rest]) if small else False,
                               'value2': sum(g.get('value2') or 0 for g in rest)})
        return groups

    def _ndash_groupby1(self):
        """(field, granularity, series field, series granularity) used to group the item."""
        return self.groupby_field_id, self.granularity, self.groupby2_field_id, self.granularity2

    def _ndash_chart(self, Model, domain, filters):
        gb_field, granularity, gb2_field, _granularity2 = self._ndash_groupby1()
        if not gb_field:
            raise UserError(_('Choose a field to group by.'))
        spec1 = self._ndash_spec(self.measure_field_id, self.aggregate)
        has2 = self.measure2_field_id or self.count2
        spec2 = has2 and self._ndash_spec(self.measure2_field_id, 'count' if self.count2 else self.aggregate2)
        gb1 = self._ndash_groupby_spec(gb_field, granularity)
        aggregates = [spec1] + ([spec2] if spec2 and spec2 != spec1 else [])

        if gb2_field and self.type != 'scatter':
            return self._ndash_chart_series(Model, domain, gb1, spec1)

        rows = Model._read_group(domain, [gb1], aggregates, limit=MAX_GROUPS)
        groups = []
        for row in rows:
            key, label, dom = self._ndash_group_key(gb_field, row[0], granularity)
            value = row[1] or 0
            value2 = (row[2] if len(aggregates) > 1 else row[1]) if spec2 else None
            groups.append({'key': key, 'label': label, 'value': value, 'value2': value2,
                           'domain': expression.AND([domain, dom]), 'gdomain': dom})
        groups = self._ndash_order_groups(groups)
        values = [g['value'] for g in groups]
        if self.cumulative:
            values = _running(values)
        data = {
            'labels': [g['label'] for g in groups],
            'keys': [g['key'] for g in groups],
            'datasets': [{'label': self._ndash_measure_label(), 'data': values}],
            'domains': [[g['domain'] for g in groups]],
            'gdomains': [g['gdomain'] for g in groups],
            'groupby': gb_field.name,
        }
        if spec2:
            label2 = _('Count') if self.count2 else self.measure2_field_id.field_description
            values2 = [g['value2'] or 0 for g in groups]
            if self.type == 'scatter':
                data['points'] = [{'x': g['value'], 'y': g['value2'] or 0, 'label': g['label']} for g in groups]
                data['x_label'], data['y_label'] = self._ndash_measure_label(), label2
            else:
                data['datasets'].append({'label': label2, 'data': _running(values2) if self.cumulative else values2,
                                         'line': True,
                                         'plain': bool(self.count2 or self.measure2_field_id.ttype != 'monetary')})
                data['domains'].append([g['domain'] for g in groups])
        return data

    def _ndash_chart_series(self, Model, domain, gb1, spec1):
        gb_field, granularity, gb2_field, granularity2 = self._ndash_groupby1()
        gb2 = self._ndash_groupby_spec(gb2_field, granularity2)
        rows = Model._read_group(domain, [gb1, gb2], [spec1], limit=MAX_GROUPS * 4)
        labels, keys, label_domains = [], [], {}
        series, series_labels, series_domains, totals = {}, {}, {}, {}
        for v1, v2, value in rows:
            k1, l1, d1 = self._ndash_group_key(gb_field, v1, granularity)
            k2, l2, d2 = self._ndash_group_key(gb2_field, v2, granularity2)
            if k1 not in label_domains:
                keys.append(k1)
                labels.append(l1)
                label_domains[k1] = d1
            series_labels[k2] = l2
            series_domains[k2] = d2
            series.setdefault(k2, {})[k1] = value or 0
            totals[k1] = totals.get(k1, 0) + (value or 0)
        groups = [{'key': k, 'label': l, 'value': totals.get(k, 0), 'domain': label_domains[k],
                   'gdomain': label_domains[k]} for k, l in zip(keys, labels)]
        groups = self._ndash_order_groups(groups, others=False)
        datasets, domains = [], []
        for k2, values in series.items():
            data = [values.get(g['key'], 0) for g in groups]
            datasets.append({'label': series_labels[k2], 'data': _running(data) if self.cumulative else data})
            domains.append([expression.AND([domain, g['domain'], series_domains[k2]]) for g in groups])
        return {'labels': [g['label'] for g in groups], 'keys': [g['key'] for g in groups],
                'datasets': datasets, 'domains': domains, 'gdomains': [g['gdomain'] for g in groups],
                'groupby': gb_field.name, 'series_by': gb2_field.name}

    def _ndash_grouped_table(self, Model, domain):
        gb_field = self._ndash_groupby1()[0]
        if not gb_field:
            raise UserError(_('Choose a field to group by.'))
        data = self._ndash_chart(Model, domain, {})
        columns = [gb_field.field_description] + [d['label'] for d in data['datasets']]
        rows = []
        for index, label in enumerate(data['labels']):
            rows.append({'cells': [label] + [d['data'][index] for d in data['datasets']],
                         'domain': data['domains'][0][index], 'index': index})
        numeric = [False] + [True] * len(data['datasets'])
        return {'columns': columns, 'numeric': numeric, 'rows': rows, 'gdomains': data['gdomains'],
                'labels': data['labels'], 'domains': data['domains'][:1]}

    def _ndash_records(self, Model, domain):
        columns = self.column_ids.sorted(lambda c: (c.sequence, c.id)).filtered(
            lambda c: c.field_id.ttype not in ('binary', 'one2many', 'html'))
        names = [c.field_id.name for c in columns] or ['display_name']
        labels = {c.field_id.name: c.label for c in columns if c.label}
        allowed = Model.fields_get(names, ['type', 'string', 'selection'])
        names = [n for n in names if n in allowed]
        order = (self.list_order or '').strip() or None
        if order:
            for part in order.split(','):
                field_name = part.strip().split(' ')[0]
                if field_name not in Model._fields or not Model._fields[field_name].store:
                    raise UserError(_('The order "%s" is not valid.', order))
        limit = max(1, min(self.list_limit or 10, MAX_ROWS))
        records = Model.search(domain, order=order, limit=limit)
        rows = []
        for record, vals in zip(records, records.read([n for n in names if n != 'display_name'] or ['id'])):
            cells = []
            for name in names:
                if name == 'display_name':
                    cells.append(record.display_name)
                    continue
                cells.append(_cell(self.env, allowed[name], vals.get(name)))
            rows.append({'cells': cells, 'res_id': record.id})
        return {
            'columns': [labels.get(n) or allowed[n]['string'] for n in names],
            'numeric': [allowed[n]['type'] in NUMERIC for n in names],
            'rows': rows,
            'count': Model.search_count(domain),
        }


def _running(values):
    total, out = 0, []
    for value in values:
        total += value or 0
        out.append(total)
    return out


def _cell(env, info, value):
    kind = info['type']
    if value is False or value is None:
        return '' if kind not in NUMERIC and kind != 'boolean' else (0 if kind in NUMERIC else '')
    if kind == 'many2one':
        return value[1] if isinstance(value, (list, tuple)) else value
    if kind in ('many2many',):
        return '%d' % len(value)
    if kind == 'selection':
        return dict(info.get('selection') or []).get(value, value)
    if kind == 'boolean':
        return '✓' if value else ''
    if kind == 'datetime' and isinstance(value, datetime):
        return format_datetime(env, value, dt_format='short')
    if kind == 'date' and isinstance(value, date):
        return format_date_lang(env, value)
    return value


class NdashItemColumn(models.Model):
    _name = 'ndash.item.column'
    _description = 'Dashboard list column'
    _order = 'sequence, id'

    item_id = fields.Many2one('ndash.item', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    model_id = fields.Many2one(related='item_id.model_id')
    field_id = fields.Many2one('ir.model.fields', required=True, ondelete='cascade', string='Field',
                               domain="[('model_id', '=', model_id), ('ttype', 'not in', ('binary', 'one2many', 'html'))]")
    label = fields.Char(translate=True, help='Empty: the field name.')
