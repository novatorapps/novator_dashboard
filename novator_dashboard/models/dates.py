"""Date ranges for dashboard filters.

A range is a pair of dates (start inclusive, end exclusive) in the user's time zone.
"""
from datetime import date, datetime, time, timedelta

import pytz
from dateutil.relativedelta import relativedelta

PRESETS = [
    ('none', 'All time'),
    ('today', 'Today'),
    ('yesterday', 'Yesterday'),
    ('tomorrow', 'Tomorrow'),
    ('this_week', 'This week'),
    ('last_week', 'Last week'),
    ('next_week', 'Next week'),
    ('this_month', 'This month'),
    ('last_month', 'Last month'),
    ('next_month', 'Next month'),
    ('this_quarter', 'This quarter'),
    ('last_quarter', 'Last quarter'),
    ('this_year', 'This year'),
    ('last_year', 'Last year'),
    ('mtd', 'Month to date'),
    ('qtd', 'Quarter to date'),
    ('ytd', 'Year to date'),
    ('last_7', 'Last 7 days'),
    ('last_30', 'Last 30 days'),
    ('last_90', 'Last 90 days'),
    ('last_365', 'Last 365 days'),
    ('next_7', 'Next 7 days'),
    ('next_30', 'Next 30 days'),
    ('custom', 'Custom range'),
]

GRANULARITY = [('day', 'Day'), ('week', 'Week'), ('month', 'Month'), ('quarter', 'Quarter'), ('year', 'Year')]


def _quarter_start(d):
    return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)


def preset_range(preset, today, week_start=1, date_from=None, date_to=None):
    """Return (start, end, previous_start, previous_end) or None for 'all time'.

    week_start follows res.lang (1 = Monday ... 7 = Sunday).
    """
    if not preset or preset == 'none':
        return None
    one = timedelta(days=1)
    week_begin = today - timedelta(days=(today.isoweekday() - int(week_start or 1)) % 7)
    month = today.replace(day=1)
    quarter = _quarter_start(today)
    year = today.replace(month=1, day=1)
    shift = None  # how to move to the previous period (relativedelta), default: by length
    if preset == 'today':
        start, end = today, today + one
    elif preset == 'yesterday':
        start, end = today - one, today
    elif preset == 'tomorrow':
        start, end = today + one, today + 2 * one
    elif preset == 'this_week':
        start, end = week_begin, week_begin + 7 * one
    elif preset == 'last_week':
        start, end = week_begin - 7 * one, week_begin
    elif preset == 'next_week':
        start, end = week_begin + 7 * one, week_begin + 14 * one
    elif preset == 'this_month':
        start, end, shift = month, month + relativedelta(months=1), relativedelta(months=1)
    elif preset == 'last_month':
        start, end, shift = month - relativedelta(months=1), month, relativedelta(months=1)
    elif preset == 'next_month':
        start, end, shift = month + relativedelta(months=1), month + relativedelta(months=2), relativedelta(months=1)
    elif preset == 'this_quarter':
        start, end, shift = quarter, quarter + relativedelta(months=3), relativedelta(months=3)
    elif preset == 'last_quarter':
        start, end, shift = quarter - relativedelta(months=3), quarter, relativedelta(months=3)
    elif preset == 'this_year':
        start, end, shift = year, year + relativedelta(years=1), relativedelta(years=1)
    elif preset == 'last_year':
        start, end, shift = year - relativedelta(years=1), year, relativedelta(years=1)
    elif preset == 'mtd':
        start, end, shift = month, today + one, relativedelta(months=1)
    elif preset == 'qtd':
        start, end, shift = quarter, today + one, relativedelta(months=3)
    elif preset == 'ytd':
        start, end, shift = year, today + one, relativedelta(years=1)
    elif preset.startswith('last_') and preset[5:].isdigit():
        days = int(preset[5:])
        start, end = today - (days - 1) * one, today + one
    elif preset.startswith('next_') and preset[5:].isdigit():
        days = int(preset[5:])
        start, end = today, today + days * one
    elif preset == 'custom':
        if not date_from and not date_to:
            return None
        start = to_date(date_from) or date(1900, 1, 1)
        end = (to_date(date_to) or date(2999, 12, 31)) + one
    else:
        return None
    if shift:
        prev_start, prev_end = start - shift, end - shift
    else:
        length = end - start
        prev_start, prev_end = start - length, start
    return start, end, prev_start, prev_end


def to_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def range_domain(field, start, end, tz_name):
    """Domain for start <= field < end. Datetime fields are compared in UTC."""
    if field.ttype == 'datetime':
        tz = pytz.timezone(tz_name or 'UTC')

        def utc(d):
            return tz.localize(datetime.combine(d, time.min)).astimezone(pytz.utc).replace(tzinfo=None)
        return [(field.name, '>=', utc(start).strftime('%Y-%m-%d %H:%M:%S')),
                (field.name, '<', utc(end).strftime('%Y-%m-%d %H:%M:%S'))]
    return [(field.name, '>=', start.isoformat()), (field.name, '<', end.isoformat())]


def period_end(start, granularity):
    """End (exclusive) of the period starting at start for a read_group granularity."""
    start = to_date(start)
    if granularity == 'day':
        return start + timedelta(days=1)
    if granularity == 'week':
        return start + timedelta(days=7)
    if granularity == 'quarter':
        return start + relativedelta(months=3)
    if granularity == 'year':
        return start + relativedelta(years=1)
    return start + relativedelta(months=1)

