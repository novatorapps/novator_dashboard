{
    'name': 'Dashboard Builder: KPI Tiles, Charts & Lists',
    'summary': 'Build dashboards from any Odoo data: KPI tiles, 13 chart types, lists, date filters, '
               'drag and drop. Free.',
    'version': '20.0.1.0.0',
    'category': 'Productivity',
    'author': 'Novator Technologies',
    'website': 'https://www.novator.co',
    'support': 'support@novator.co',
    'license': 'LGPL-3',
    'depends': ['base_setup', 'web'],
    'data': [
        'security/security.xml',
        'security/ir.access.csv',
        'views/menus.xml',
        'views/dashboard_views.xml',
        'views/item_views.xml',
        'data/sample_dashboard.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'novator_dashboard/static/src/scss/dashboard.scss',
            'novator_dashboard/static/src/js/icons.js',
            'novator_dashboard/static/src/js/engine.js',
            'novator_dashboard/static/src/js/dashboard_action.js',
            'novator_dashboard/static/src/xml/dashboard_action.xml',
        ],
    },
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': True,
}
