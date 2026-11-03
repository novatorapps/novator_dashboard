/**
 * Icons. Odoo 20.0 uses Material Symbols: Font Awesome names are translated.
 * spec: "fa-name [fa-modifiers] [other classes]" or a Material Symbols name.
 */
const MAP = {
    "fa-address-book": "contact_page",
    "fa-align-left": "format_align_left",
    "fa-angle-down": "keyboard_arrow_down",
    "fa-area-chart": "area_chart",
    "fa-arrow-right": "arrow_forward",
    "fa-arrows": "open_with",
    "fa-asterisk": "star_half",
    "fa-balance-scale": "balance",
    "fa-bar-chart": "bar_chart",
    "fa-barcode": "barcode",
    "fa-bolt": "flash_on",
    "fa-braille": "grid_view",
    "fa-briefcase": "work",
    "fa-building": "business",
    "fa-bullseye": "radio_button_checked",
    "fa-calendar": "calendar_today",
    "fa-calendar-check-o": "event_available",
    "fa-caret-down": "arrow_drop_down",
    "fa-caret-up": "arrow_drop_up",
    "fa-check": "check",
    "fa-check-circle": "check_circle",
    "fa-check-square-o": "check_box",
    "fa-circle-o-notch": "circle",
    "fa-clock-o": "schedule",
    "fa-clone": "content_copy",
    "fa-cog": "settings",
    "fa-copy": "content_copy",
    "fa-credit-card": "credit_card",
    "fa-cubes": "inventory_2",
    "fa-dollar": "attach_money",
    "fa-download": "download",
    "fa-ellipsis-v": "more_vert",
    "fa-envelope": "mail",
    "fa-envelope-o": "mail",
    "fa-exclamation-triangle": "warning",
    "fa-external-link": "open_in_new",
    "fa-eye": "visibility",
    "fa-file-image-o": "image",
    "fa-file-text": "article",
    "fa-file-text-o": "description",
    "fa-filter": "filter_alt",
    "fa-flag": "flag",
    "fa-folder-open": "folder_open",
    "fa-forward": "skip_next",
    "fa-globe": "public",
    "fa-handshake-o": "handshake",
    "fa-heart": "favorite",
    "fa-home": "home",
    "fa-hourglass-half": "hourglass_top",
    "fa-id-card": "badge",
    "fa-inbox": "inbox",
    "fa-industry": "factory",
    "fa-info-circle": "info",
    "fa-key": "key",
    "fa-level-down": "subdirectory_arrow_right",
    "fa-lightbulb-o": "lightbulb",
    "fa-line-chart": "show_chart",
    "fa-line-chart-o": "show_chart",
    "fa-list": "format_list_bulleted",
    "fa-lock": "lock",
    "fa-magic": "wand_stars",
    "fa-map-marker": "location_on",
    "fa-money": "payments",
    "fa-pencil": "edit",
    "fa-percent": "percent",
    "fa-pie-chart": "pie_chart",
    "fa-plus": "add",
    "fa-plus-square-o": "add_box",
    "fa-print": "print",
    "fa-puzzle-piece": "extension",
    "fa-question-circle": "help",
    "fa-receipt": "receipt_long",
    "fa-refresh": "refresh",
    "fa-search": "search",
    "fa-share": "arrow_forward",
    "fa-shopping-bag": "shopping_bag",
    "fa-shopping-basket": "shopping_basket",
    "fa-shopping-cart": "shopping_cart",
    "fa-sitemap": "account_tree",
    "fa-spinner": "progress_activity",
    "fa-square": "square",
    "fa-star": "star",
    "fa-store": "storefront",
    "fa-table": "table",
    "fa-tachometer": "speed",
    "fa-tag": "sell",
    "fa-tags": "sell",
    "fa-tasks": "table_chart",
    "fa-television": "tv",
    "fa-th": "apps",
    "fa-th-large": "grid_view",
    "fa-thumbs-up": "thumb_up",
    "fa-ticket": "confirmation_number",
    "fa-times": "close",
    "fa-trash": "delete",
    "fa-trophy": "trophy",
    "fa-truck": "local_shipping",
    "fa-upload": "upload",
    "fa-usd": "attach_money",
    "fa-user": "person",
    "fa-user-plus": "person_add",
    "fa-users": "group",
    "fa-wrench": "build"
};
const MODIFIERS = { "fa-fw": "oi-fw", "fa-spin": "oi-spin", "fa-2x": "oi-2x", "fa-3x": "oi-3x", "fa-lg": "oi-lg" };

export function iconNode(spec, extra = "") {
    const node = document.createElement("i");
    const classes = ["oi"];
    let name = "";
    for (const token of `${spec || ""} ${extra || ""}`.split(/\s+/).filter(Boolean)) {
        if (MODIFIERS[token]) {
            classes.push(MODIFIERS[token]);
        } else if (token.startsWith("fa-") && !name) {
            name = MAP[token] || "bar_chart";
        } else if (!token.startsWith("fa-") && !name && !token.includes("-") && /^[a-z0-9_]+$/.test(token)) {
            name = token;
        } else if (!token.startsWith("fa-") && token !== "fa") {
            classes.push(token);
        }
    }
    node.className = classes.join(" ");
    node.setAttribute("data-icon", name || "bar_chart");
    node.setAttribute("aria-hidden", "true");
    return node;
}
