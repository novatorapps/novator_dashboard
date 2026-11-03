/**
 * Dashboard Builder engine.
 *
 * Plain JavaScript (DOM + Chart.js) so the same file runs on every Odoo version;
 * the OWL client action only mounts it. Extensions (Dashboard Builder Pro) plug in
 * through `ndashHooks`.
 */
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { iconNode } from "./icons";

export const ndashHooks = {
    /** fn(engine) -> [{label, icon, onClick, manager, primary}] buttons in the header */
    headerButtons: [],
    /** fn(engine) -> [{label, icon, onClick, manager}] entries in the header "more" menu */
    moreMenu: [],
    /** fn(engine, item) -> [{label, icon, onClick, manager}] entries in an item menu */
    itemMenu: [],
    /** fn(engine, item, datasetIndex, index) -> true when handled (drill-down) */
    segmentClick: [],
    /** fn(engine, item, card) after an item is drawn */
    afterItem: [],
    /** fn(engine) after the dashboard is drawn */
    afterRender: [],
    /** type -> fn(engine, item, body) custom item renderers */
    renderers: {},
};

export const PALETTES = {
    novator: ["#b07d0b", "#1f56b3", "#14a38b", "#c2255c", "#4b3fc4", "#e8590c", "#0f7a4a", "#9c36b5", "#3a5068", "#d6336c"],
    ocean: ["#0b4f6c", "#01baef", "#20bf55", "#0b7a75", "#7ea8be", "#1d3557", "#457b9d", "#a8dadc", "#2a9d8f", "#264653"],
    sunset: ["#f94144", "#f3722c", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#e76f51", "#d62828", "#fcbf49"],
    forest: ["#2d6a4f", "#40916c", "#52b788", "#74c69d", "#1b4332", "#95d5b2", "#6a994e", "#a7c957", "#386641", "#bc4749"],
    berry: ["#7b2cbf", "#c77dff", "#e0aaff", "#9d4edd", "#5a189a", "#ff006e", "#fb5607", "#8338ec", "#3a0ca3", "#f72585"],
    mono: ["#212529", "#495057", "#6c757d", "#868e96", "#adb5bd", "#343a40", "#5c636a", "#7d8790", "#9aa3ab", "#ced4da"],
    pastel: ["#8ecae6", "#ffb703", "#a2d2ff", "#ffafcc", "#bde0fe", "#cdb4db", "#b5e48c", "#ffc8dd", "#99d98c", "#fcd5ce"],
};

export const ITEM_TYPES = [
    ["tile", _t("Tile"), "fa-square"],
    ["bar", _t("Bar"), "fa-bar-chart"],
    ["hbar", _t("Horizontal bar"), "fa-align-left"],
    ["stacked", _t("Stacked bar"), "fa-tasks"],
    ["line", _t("Line"), "fa-line-chart"],
    ["area", _t("Area"), "fa-area-chart"],
    ["pie", _t("Pie"), "fa-pie-chart"],
    ["doughnut", _t("Doughnut"), "fa-circle-o-notch"],
    ["polar", _t("Polar area"), "fa-bullseye"],
    ["radar", _t("Radar"), "fa-asterisk"],
    ["scatter", _t("Scatter"), "fa-braille"],
    ["funnel", _t("Funnel"), "fa-filter"],
    ["gauge", _t("Gauge"), "fa-tachometer"],
    ["list", _t("List"), "fa-list"],
];
const CHART_SWITCH = ["bar", "hbar", "stacked", "line", "area", "pie", "doughnut", "polar", "radar", "funnel", "list"];
const CJS_TYPE = {
    bar: "bar", hbar: "bar", stacked: "bar", line: "line", area: "line", pie: "pie", doughnut: "doughnut",
    polar: "polarArea", radar: "radar", scatter: "scatter",
};
const ROUND = new Set(["pie", "doughnut", "polar"]);
const ROW = 70;
const GAP = 16;
const COLS = 12;

export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) {
            continue;
        }
        if (key === "class") {
            node.className = value;
        } else if (key === "text") {
            node.textContent = value;
        } else if (key === "style" && typeof value === "object") {
            Object.assign(node.style, value);
        } else if (key.startsWith("on") && typeof value === "function") {
            node.addEventListener(key.slice(2), value);
        } else {
            node.setAttribute(key, value === true ? "" : value);
        }
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) {
            continue;
        }
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

function icon(name, extra = "") {
    return iconNode(name, extra);
}

function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) {
        return hex;
    }
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function download(name, href) {
    const a = el("a", { href, download: name, style: { display: "none" } });
    document.body.append(a);
    a.click();
    a.remove();
}

function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export class DashboardEngine {
    constructor(root, services, action) {
        this.root = root;
        this.orm = services.orm;
        this.actionService = services.action;
        this.notification = services.notification;
        this.dialog = services.dialog;
        this.action = action || {};
        const params = this.action.params || {};
        const context = this.action.context || {};
        this.dashboardId = params.dashboard_id || context.ndash_dashboard_id || false;
        this.data = null;
        this.editing = false;
        this.charts = new Map();
        this.cards = new Map();
        this.timer = null;
        this.lang = (document.documentElement.getAttribute("lang") || "en-US").replace("_", "-");
        this.closeMenus = this.closeMenus.bind(this);
        this.onResize = this.onResize.bind(this);
        document.addEventListener("click", this.closeMenus);
        window.addEventListener("resize", this.onResize);
        this.state = {};
    }

    // ------------------------------------------------------------------ lifecycle
    async start() {
        this.root.classList.add("o_ndash");
        if (!this.dashboardId) {
            const home = await this.orm.call("ndash.dashboard", "ndash_home", []);
            this.home = home;
            if (!home.first_id) {
                this.renderEmpty(home.can_manage);
                return;
            }
            this.dashboardId = home.first_id;
        }
        this.restoreFilters();
        await this.load();
    }

    destroy() {
        this.destroyed = true;
        this.stopTimer();
        this.destroyCharts();
        document.removeEventListener("click", this.closeMenus);
        window.removeEventListener("resize", this.onResize);
    }

    restoreFilters() {
        try {
            this.filters = JSON.parse(sessionStorage.getItem(`ndash_filters_${this.dashboardId}`) || "null") || {};
        } catch {
            this.filters = {};
        }
    }

    saveFilters() {
        try {
            sessionStorage.setItem(`ndash_filters_${this.dashboardId}`, JSON.stringify(this.filters));
        } catch {
            // private mode: filters are simply not remembered
        }
    }

    async load() {
        try {
            this.data = await this.orm.call("ndash.dashboard", "ndash_load", [[this.dashboardId], this.filters]);
        } catch (error) {
            if (this.home || !this.dashboardId) {
                throw error;
            }
            // dashboard removed or no longer shared: fall back to the first one
            this.dashboardId = false;
            this.home = null;
            return this.start();
        }
        if (this.destroyed) {
            return;
        }
        if (!this.filters.preset) {
            this.filters.preset = this.data.preset;
        }
        this.render();
        this.startTimer();
    }

    async refresh() {
        if (this.editing || this.busy) {
            return;
        }
        this.busy = true;
        try {
            const data = await this.orm.call("ndash.dashboard", "ndash_load", [[this.dashboardId], this.filters]);
            if (this.destroyed) {
                return;
            }
            this.data = data;
            const sameItems = data.items.length === this.cards.size && data.items.every((i) => this.cards.has(i.id));
            if (!sameItems) {
                this.render();
            } else {
                for (const item of data.items) {
                    this.drawItem(item);
                }
            }
        } finally {
            this.busy = false;
        }
    }

    async reloadItem(item) {
        const [fresh] = await this.orm.call("ndash.dashboard", "ndash_item_data", [[this.dashboardId], [item.id], this.filters]);
        if (fresh) {
            Object.assign(item, fresh);
            this.drawItem(item);
        }
    }

    startTimer() {
        this.stopTimer();
        if (this.data && this.data.refresh) {
            this.timer = setInterval(() => this.refresh(), this.data.refresh * 1000);
        }
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    onResize() {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
            for (const chart of this.charts.values()) {
                chart.resize();
            }
        }, 150);
    }

    destroyCharts() {
        for (const chart of this.charts.values()) {
            chart.destroy();
        }
        this.charts.clear();
    }

    get canManage() {
        return Boolean(this.data && this.data.can_manage);
    }

    // ------------------------------------------------------------------ helpers
    colors(item, count) {
        const palette = PALETTES[item.palette || (this.data && this.data.palette)] || PALETTES.novator;
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(palette[i % palette.length]);
        }
        if (item.color && count === 1) {
            out[0] = item.color;
        }
        return out;
    }

    mainColor(item) {
        return item.color || this.colors(item, 1)[0];
    }

    format(value, item, { short = item.short, decimals = item.decimals, plain = false } = {}) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        if (typeof value !== "number") {
            return String(value);
        }
        let number = value;
        let unit = "";
        if (short && Math.abs(number) >= 1000) {
            const units = [["T", 1e12], ["B", 1e9], ["M", 1e6], ["K", 1e3]];
            for (const [u, size] of units) {
                if (Math.abs(number) >= size) {
                    number = number / size;
                    unit = u;
                    break;
                }
            }
        }
        const digits = unit ? Math.max(decimals || 0, Math.abs(number) < 10 ? 1 : 0) : decimals || 0;
        let text;
        try {
            text = number.toLocaleString(this.lang, { minimumFractionDigits: unit ? 0 : digits, maximumFractionDigits: digits });
        } catch {
            text = number.toFixed(digits);
        }
        text += unit;
        if (plain) {
            return text;
        }
        if (item.currency && this.data && this.data.currency) {
            const c = this.data.currency;
            text = c.position === "before" ? `${c.symbol} ${text}` : `${text} ${c.symbol}`;
        }
        return `${item.prefix || ""}${text}${item.suffix || ""}`;
    }

    openRecords(item, domain, label) {
        if (!item.model || !domain) {
            return;
        }
        this.actionService.doAction({
            type: "ir.actions.act_window",
            name: label ? `${item.name}: ${label}` : item.name,
            res_model: item.model,
            domain,
            views: [[false, "list"], [false, "form"]],
            target: "current",
        });
    }

    openRecord(item, resId) {
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: item.model,
            res_id: resId,
            views: [[false, "form"]],
            target: "current",
        });
    }

    segmentClick(item, datasetIndex, index) {
        for (const hook of ndashHooks.segmentClick) {
            if (hook(this, item, datasetIndex, index)) {
                return;
            }
        }
        if (!item.clickable || !item.data || !item.data.domains) {
            return;
        }
        const domains = item.data.domains[datasetIndex] || item.data.domains[0];
        const domain = domains && domains[index];
        const label = item.data.labels ? item.data.labels[index] : "";
        const datasets = item.data.datasets || [];
        this.openRecords(item, domain, datasets.length > 1 && !datasets[datasetIndex].line
            ? `${label} / ${datasets[datasetIndex].label}` : label);
    }

    // ------------------------------------------------------------------ dialogs and actions
    openForm(resModel, resId, context = {}, onClose = () => this.load()) {
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: resModel,
            res_id: resId || false,
            views: [[false, "form"]],
            target: "new",
            context,
        }, { onClose });
    }

    editItem(item) {
        this.openForm("ndash.item", item.id);
    }

    addItem(type = "bar") {
        this.openForm("ndash.item", false, { default_dashboard_id: this.dashboardId, default_type: type });
    }

    editDashboard() {
        this.openForm("ndash.dashboard", this.dashboardId);
    }

    async newDashboard() {
        const before = new Set((await this.orm.call("ndash.dashboard", "ndash_list", [])).map((d) => d.id));
        this.openForm("ndash.dashboard", false, {}, async () => {
            const after = await this.orm.call("ndash.dashboard", "ndash_list", []);
            const created = after.find((d) => !before.has(d.id));
            if (created) {
                this.switchTo(created.id);
            } else {
                this.load();
            }
        });
    }

    switchTo(dashboardId) {
        this.dashboardId = dashboardId;
        this.editing = false;
        this.restoreFilters();
        this.load();
    }

    confirm(body, onConfirm) {
        this.dialog.add(ConfirmationDialog, {
            body,
            confirm: onConfirm,
            cancel: () => {},
        });
    }

    async duplicateItem(item) {
        await this.orm.call("ndash.item", "ndash_duplicate", [[item.id]]);
        await this.load();
    }

    deleteItem(item) {
        this.confirm(_t("Delete the item \"%s\"?").replace("%s", item.name), async () => {
            await this.orm.unlink("ndash.item", [item.id]);
            await this.load();
        });
    }

    async setType(item, type) {
        await this.orm.call("ndash.item", "ndash_set_type", [[item.id], type]);
        await this.reloadItem(Object.assign(item, { type }));
    }

    async copyTo(item, dashboardId, move) {
        await this.orm.call("ndash.item", "ndash_copy_to", [[item.id], dashboardId, move]);
        this.notification.add(move ? _t("Item moved.") : _t("Item copied."), { type: "success" });
        if (move) {
            await this.load();
        }
    }

    async setHome() {
        await this.orm.call("ndash.dashboard", "action_set_home", [[this.dashboardId]]);
        this.notification.add(_t("This dashboard now opens when you sign in."), { type: "success" });
    }

    exportCsv(item) {
        const data = item.data || {};
        const rows = [];
        if (data.columns) {
            rows.push(data.columns);
            for (const row of data.rows) {
                rows.push(row.cells);
            }
        } else if (data.labels) {
            rows.push([""].concat(data.datasets.map((d) => d.label)));
            data.labels.forEach((label, i) => rows.push([label].concat(data.datasets.map((d) => d.data[i]))));
        } else if (data.value !== undefined) {
            rows.push([item.name, data.value]);
        }
        const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n");
        const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
        download(`${item.name}.csv`, url);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    exportPng(item) {
        const chart = this.charts.get(item.id);
        if (!chart) {
            return;
        }
        const canvas = chart.canvas;
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, copy.width, copy.height);
        ctx.drawImage(canvas, 0, 0);
        download(`${item.name}.png`, copy.toDataURL("image/png"));
    }

    // ------------------------------------------------------------------ menus
    closeMenus(ev) {
        for (const menu of this.root.querySelectorAll(".o_ndash_menu.show")) {
            if (!ev || !menu.parentElement.contains(ev.target)) {
                menu.classList.remove("show");
            }
        }
    }

    dropdown(toggle, entries, { align = "end" } = {}) {
        const menu = el("div", { class: `o_ndash_menu dropdown-menu ${align === "end" ? "dropdown-menu-end" : ""}` });
        const wrap = el("div", { class: "o_ndash_dropdown position-relative d-inline-block" }, [toggle, menu]);
        toggle.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const open = menu.classList.contains("show");
            this.closeMenus();
            if (!open) {
                menu.replaceChildren(...this.menuEntries(typeof entries === "function" ? entries() : entries));
                menu.classList.add("show");
            }
        });
        return wrap;
    }

    menuEntries(entries) {
        const out = [];
        for (const entry of entries) {
            if (!entry) {
                continue;
            }
            if (entry.manager && !this.canManage) {
                continue;
            }
            if (entry.divider) {
                out.push(el("div", { class: "dropdown-divider" }));
            } else if (entry.header) {
                out.push(el("h6", { class: "dropdown-header", text: entry.header }));
            } else if (entry.node) {
                out.push(entry.node);
            } else {
                const link = el("a", { class: `dropdown-item ${entry.active ? "active" : ""}`, href: entry.href || "#",
                    target: entry.href ? "_blank" : undefined, role: "menuitem" },
                [entry.icon ? icon(entry.icon, "fa-fw me-2") : null, entry.label]);
                if (!entry.href) {
                    link.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        this.closeMenus();
                        entry.onClick();
                    });
                }
                out.push(link);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ rendering
    renderEmpty(canManage) {
        this.root.replaceChildren(el("div", { class: "o_ndash_empty" }, [
            icon("fa-th-large fa-3x mb-3 text-muted"),
            el("h3", { text: _t("No dashboard yet") }),
            el("p", { class: "text-muted", text: canManage
                ? _t("Create a dashboard and add KPI tiles, charts and lists from any Odoo data.")
                : _t("No dashboard is shared with you yet. Ask your administrator.") }),
            canManage ? el("button", { class: "btn btn-primary", text: _t("Create a dashboard"),
                onclick: () => this.newDashboard() }) : null,
        ]));
    }

    render() {
        this.destroyCharts();
        this.cards.clear();
        const data = this.data;
        this.root.replaceChildren(this.renderHeader(), this.renderGrid());
        for (const item of data.items) {
            this.drawItem(item);
        }
        for (const hook of ndashHooks.afterRender) {
            hook(this);
        }
    }

    renderHeader() {
        const data = this.data;
        const switcher = this.dropdown(
            el("button", { class: "btn btn-link o_ndash_title p-0 text-reset text-decoration-none", type: "button",
                title: _t("Switch dashboard") }, [el("span", { text: data.name }), icon("fa-angle-down ms-2 small")]),
            () => [{ header: _t("Dashboards") }].concat(data.dashboards.map((d) => ({
                label: d.name, active: d.id === this.dashboardId, onClick: () => this.switchTo(d.id),
            })), [{ divider: true, manager: true }, { label: _t("New dashboard"), icon: "fa-plus", manager: true,
                onClick: () => this.newDashboard() }]),
            { align: "start" }
        );

        const period = el("select", { class: "form-select form-select-sm o_ndash_period", "aria-label": _t("Period") },
            data.presets.map(([key, label]) => el("option", { value: key, text: label })));
        period.value = this.filters.preset || data.preset;
        const from = el("input", { type: "date", class: "form-control form-control-sm", value: this.filters.date_from || "",
            "aria-label": _t("From") });
        const to = el("input", { type: "date", class: "form-control form-control-sm", value: this.filters.date_to || "",
            "aria-label": _t("To") });
        const custom = el("div", { class: `o_ndash_custom d-flex gap-1 align-items-center ${period.value === "custom" ? "" : "d-none"}` },
            [from, el("span", { class: "text-muted", text: "-" }), to]);
        const apply = () => {
            this.filters = { preset: period.value, date_from: from.value || false, date_to: to.value || false };
            this.saveFilters();
            this.load();
        };
        period.addEventListener("change", () => {
            custom.classList.toggle("d-none", period.value !== "custom");
            if (period.value !== "custom") {
                apply();
            }
        });
        from.addEventListener("change", apply);
        to.addEventListener("change", apply);

        const buttons = [];
        for (const hook of ndashHooks.headerButtons) {
            for (const b of hook(this) || []) {
                if (b && (!b.manager || this.canManage)) {
                    buttons.push(el("button", { class: `btn btn-sm ${b.primary ? "btn-primary" : "btn-light border"}`,
                        type: "button", title: b.title || b.label, onclick: b.onClick },
                    [b.icon ? icon(b.icon, b.label ? "me-1" : "") : null, b.label || null]));
                }
            }
        }
        const refresh = el("button", { class: "btn btn-sm btn-light border", type: "button", title: _t("Refresh"),
            onclick: () => this.refresh() }, [icon("fa-refresh")]);
        if (this.canManage) {
            buttons.push(el("button", { class: `btn btn-sm ${this.editing ? "btn-primary" : "btn-light border"} o_ndash_edit_toggle`,
                type: "button", onclick: () => this.toggleEdit() },
            [icon(this.editing ? "fa-check" : "fa-arrows", "me-1"), this.editing ? _t("Done") : _t("Edit layout")]));
            buttons.push(this.dropdown(el("button", { class: "btn btn-sm btn-primary", type: "button" },
                [icon("fa-plus", "me-1"), _t("Add")]), () => [{ header: _t("Add an item") }].concat(
                ITEM_TYPES.map(([type, label, ic]) => ({ label, icon: ic, onClick: () => this.addItem(type) })))));
        }
        const more = this.dropdown(el("button", { class: "btn btn-sm btn-light border", type: "button", title: _t("More") },
            [icon("fa-ellipsis-v")]), () => {
            const entries = [
                { label: _t("Set as my home page"), icon: "fa-home", onClick: () => this.setHome() },
                { label: _t("Print"), icon: "fa-print", onClick: () => window.print() },
                { divider: true, manager: true },
                { label: _t("Dashboard settings"), icon: "fa-cog", manager: true, onClick: () => this.editDashboard() },
                { label: _t("New dashboard"), icon: "fa-plus", manager: true, onClick: () => this.newDashboard() },
            ];
            for (const hook of ndashHooks.moreMenu) {
                entries.push(...(hook(this) || []));
            }
            if (!data.pro && this.canManage) {
                entries.push({ divider: true }, { label: _t("Get Pro: AI, drill-down, TV mode"), icon: "fa-star text-warning",
                    href: data.pro_url });
            }
            return entries;
        });

        return el("div", { class: "o_ndash_header d-flex flex-wrap align-items-center gap-2" }, [
            el("div", { class: "d-flex align-items-center gap-2 me-auto min-w-0" }, [
                switcher,
                data.description ? el("span", { class: "text-muted small d-none d-lg-inline text-truncate",
                    text: data.description }) : null,
            ]),
            el("div", { class: "d-flex flex-wrap align-items-center gap-2" }, [
                el("div", { class: "d-flex align-items-center gap-1" }, [icon("fa-calendar text-muted"), period]),
                custom, refresh, ...buttons, more,
            ]),
        ]);
    }

    renderGrid() {
        this.grid = el("div", { class: `o_ndash_grid ${this.editing ? "o_ndash_editing" : ""}` });
        if (!this.data.items.length) {
            this.grid.append(el("div", { class: "o_ndash_noitems" }, [
                icon("fa-plus-square-o fa-2x text-muted mb-2"),
                el("p", { class: "mb-2", text: _t("This dashboard is empty.") }),
                this.canManage ? el("button", { class: "btn btn-primary btn-sm", text: _t("Add your first item"),
                    onclick: () => this.addItem("tile") }) : null,
            ]));
        }
        for (const item of this.data.items) {
            const card = el("div", { class: `o_ndash_item o_ndash_type_${item.type}`, "data-id": item.id });
            this.cards.set(item.id, card);
            this.place(card, item);
            this.grid.append(card);
        }
        return this.grid;
    }

    place(card, item) {
        card.style.gridColumn = `${item.x + 1} / span ${Math.min(item.w, COLS - item.x)}`;
        card.style.gridRow = `${item.y + 1} / span ${item.h}`;
        card.style.setProperty("--ndash-h", item.h);
    }

    drawItem(item) {
        const card = this.cards.get(item.id);
        if (!card) {
            return;
        }
        const old = this.charts.get(item.id);
        if (old) {
            old.destroy();
            this.charts.delete(item.id);
        }
        card.className = `o_ndash_item o_ndash_type_${item.type}`;
        const body = el("div", { class: "o_ndash_body" });
        const children = [];
        if (item.type !== "tile") {
            children.push(el("div", { class: "o_ndash_item_header" }, [
                el("div", { class: "o_ndash_item_title text-truncate", title: item.description || item.name, text: item.name }),
                this.itemMenu(item),
            ]));
        } else {
            children.push(el("div", { class: "o_ndash_tile_menu" }, [this.itemMenu(item)]));
        }
        children.push(body);
        if (this.editing) {
            children.push(el("div", { class: "o_ndash_resize", title: _t("Resize") }));
        }
        card.replaceChildren(...children);
        if (this.editing) {
            this.bindEdit(card, item);
        }
        try {
            if (item.error) {
                body.append(el("div", { class: "o_ndash_error" }, [icon("fa-exclamation-triangle me-2"), item.error]));
            } else if (ndashHooks.renderers[item.type]) {
                ndashHooks.renderers[item.type](this, item, body, card);
            } else if (item.type === "tile") {
                this.drawTile(item, body, card);
            } else if (item.type === "list") {
                this.drawList(item, body);
            } else if (item.type === "funnel") {
                this.drawFunnel(item, body);
            } else if (item.type === "gauge") {
                this.drawGauge(item, body);
            } else {
                this.drawChart(item, body);
            }
        } catch (error) {
            body.replaceChildren(el("div", { class: "o_ndash_error" }, [icon("fa-exclamation-triangle me-2"), String(error)]));
        }
        for (const hook of ndashHooks.afterItem) {
            hook(this, item, card);
        }
    }

    itemMenu(item) {
        const toggle = el("button", { class: "btn btn-link btn-sm o_ndash_item_menu text-muted p-0 px-1", type: "button",
            title: _t("Options") }, [icon("fa-ellipsis-v")]);
        return this.dropdown(toggle, () => {
            const others = this.data.dashboards.filter((d) => d.id !== this.dashboardId);
            const entries = [
                { label: _t("Edit"), icon: "fa-pencil", manager: true, onClick: () => this.editItem(item) },
                { label: _t("Duplicate"), icon: "fa-clone", manager: true, onClick: () => this.duplicateItem(item) },
            ];
            if (this.canManage && CHART_SWITCH.includes(item.type)) {
                entries.push({ node: el("div", { class: "o_ndash_switch px-3 py-1" }, CHART_SWITCH.filter((t) => t !== item.type).map((type) => {
                    const [, label, ic] = ITEM_TYPES.find((t) => t[0] === type);
                    return el("button", { class: "btn btn-light btn-sm border", type: "button", title: label,
                        onclick: (ev) => { ev.stopPropagation(); this.closeMenus(); this.setType(item, type); } }, [icon(ic)]);
                })) });
            }
            for (const hook of ndashHooks.itemMenu) {
                entries.push(...(hook(this, item) || []));
            }
            if (item.model && item.data && !item.error) {
                const domain = item.data.domain || (item.data.domains && item.data.domains[0] && null);
                entries.push({ divider: true });
                if (domain) {
                    entries.push({ label: _t("Open records"), icon: "fa-external-link", onClick: () => this.openRecords(item, domain) });
                }
                entries.push({ label: _t("Export CSV"), icon: "fa-file-text-o", onClick: () => this.exportCsv(item) });
                if (this.charts.has(item.id)) {
                    entries.push({ label: _t("Export image"), icon: "fa-file-image-o", onClick: () => this.exportPng(item) });
                }
            }
            if (this.canManage && others.length) {
                entries.push({ divider: true }, { header: _t("Copy to") });
                for (const d of others) {
                    entries.push({ label: d.name, icon: "fa-copy", onClick: () => this.copyTo(item, d.id, false) });
                }
                entries.push({ header: _t("Move to") });
                for (const d of others) {
                    entries.push({ label: d.name, icon: "fa-share", onClick: () => this.copyTo(item, d.id, true) });
                }
            }
            if (this.canManage) {
                entries.push({ divider: true }, { label: _t("Delete"), icon: "fa-trash text-danger", onClick: () => this.deleteItem(item) });
            }
            return entries;
        });
    }

    // tiles -------------------------------------------------------------
    drawTile(item, body, card) {
        const d = item.data;
        const color = this.mainColor(item);
        card.style.setProperty("--ndash-color", color);
        const parts = [
            el("div", { class: "o_ndash_tile_icon", style: { background: hexToRgba(color, 0.12), color } }, [icon(item.icon)]),
            el("div", { class: "o_ndash_tile_text min-w-0" }, [
                el("div", { class: "o_ndash_tile_label text-truncate", title: item.description || item.name, text: item.name }),
                el("div", { class: "o_ndash_tile_value", text: this.format(d.value, item), title: this.format(d.value, item, { short: false }) }),
                this.tileFoot(item, d),
            ]),
        ];
        body.append(el("div", { class: "o_ndash_tile" }, parts));
        if (item.target) {
            const pct = Math.max(0, Math.min(100, d.progress || 0));
            body.append(el("div", { class: "o_ndash_progress", title: `${Math.round(d.progress || 0)}% ${_t("of")} ${this.format(item.target, item)}` },
                [el("div", { style: { width: `${pct}%`, background: color } })]));
        }
        if (item.clickable && d.domain) {
            body.classList.add("o_ndash_clickable");
            body.addEventListener("click", () => this.openRecords(item, d.domain));
        }
    }

    tileFoot(item, d) {
        if (d.change === undefined && !item.target) {
            return null;
        }
        const parts = [];
        if (d.change !== undefined) {
            if (d.change === null) {
                if (!item.target) {
                    return null;
                }
                parts.push(el("span", { class: "text-muted", text: `${Math.round(d.progress || 0)}% ${_t("of goal")}` }));
            } else {
                const up = d.change >= 0;
                parts.push(el("span", { class: `o_ndash_change ${up ? "o_ndash_up" : "o_ndash_down"}` },
                    [icon(up ? "fa-caret-up" : "fa-caret-down", "me-1"), `${Math.abs(d.change).toFixed(1)}%`]));
                parts.push(el("span", { class: "text-muted ms-1", text: _t("vs previous period") }));
            }
        } else if (item.target) {
            parts.push(el("span", { class: "text-muted", text: `${Math.round(d.progress || 0)}% ${_t("of goal")}` }));
        }
        return el("div", { class: "o_ndash_tile_foot small text-truncate" }, parts);
    }

    // lists -------------------------------------------------------------
    drawList(item, body) {
        const d = item.data;
        const table = el("table", { class: "table table-sm table-hover o_ndash_table mb-0" });
        table.append(el("thead", {}, [el("tr", {}, d.columns.map((c, i) => el("th", { class: d.numeric[i] ? "text-end" : "", text: c })))]));
        const tbody = el("tbody");
        for (const row of d.rows) {
            const tr = el("tr", {}, row.cells.map((cell, i) => el("td", {
                class: d.numeric[i] ? "text-end text-nowrap" : "text-truncate",
                text: d.numeric[i] && typeof cell === "number" ? this.format(cell, item) : cell,
            })));
            if (item.clickable && (row.res_id || row.domain)) {
                tr.classList.add("o_ndash_clickable");
                tr.addEventListener("click", () => row.res_id ? this.openRecord(item, row.res_id)
                    : this.segmentClick(item, 0, row.index));
            }
            tbody.append(tr);
        }
        table.append(tbody);
        if (!d.rows.length) {
            body.append(this.noData());
            return;
        }
        body.append(el("div", { class: "o_ndash_table_wrap" }, [table]));
        if (d.count !== undefined && d.count > d.rows.length) {
            body.append(el("div", { class: "o_ndash_more small text-muted" }, [
                `${d.rows.length} / ${d.count}`,
                item.clickable ? el("a", { href: "#", class: "ms-2", text: _t("See all"), onclick: (ev) => {
                    ev.preventDefault();
                    this.openRecords(item, d.domain || []);
                } }) : null,
            ]));
        }
    }

    noData() {
        return el("div", { class: "o_ndash_nodata text-muted" }, [icon("fa-bar-chart me-2"), _t("No data for this period")]);
    }

    // funnel ------------------------------------------------------------
    drawFunnel(item, body) {
        const d = item.data;
        const values = d.datasets[0].data;
        if (!values.length) {
            body.append(this.noData());
            return;
        }
        const max = Math.max(...values.map((v) => Math.abs(v)), 1);
        const colors = this.colors(Object.assign({}, item, { color: false }), values.length);
        const wrap = el("div", { class: "o_ndash_funnel" });
        values.forEach((value, i) => {
            const pct = Math.max(8, (Math.abs(value) / max) * 100);
            const first = values[0] || 0;
            const conv = i && first && value <= first ? ` (${Math.round((value / first) * 100)}%)` : "";
            const bar = el("div", { class: "o_ndash_funnel_bar", style: { width: `${pct}%`, background: item.color ? hexToRgba(item.color, 1 - i * (0.6 / values.length)) : colors[i] },
                title: `${d.labels[i]}: ${this.format(value, item, { short: false })}` },
            [el("span", { text: this.format(value, item) })]);
            const row = el("div", { class: "o_ndash_funnel_row" }, [
                el("div", { class: "o_ndash_funnel_label text-truncate", text: d.labels[i] + conv }),
                el("div", { class: "o_ndash_funnel_track" }, [bar]),
            ]);
            if (item.clickable) {
                row.classList.add("o_ndash_clickable");
                row.addEventListener("click", () => this.segmentClick(item, 0, i));
            }
            wrap.append(row);
        });
        body.append(wrap);
    }

    // charts ------------------------------------------------------------
    textColors(body) {
        const style = getComputedStyle(body);
        const text = style.color || "#374151";
        return { text, grid: text.startsWith("rgb(") ? text.replace("rgb(", "rgba(").replace(")", ", 0.12)") : "rgba(0,0,0,0.1)" };
    }

    drawGauge(item, body) {
        const d = item.data;
        const max = d.max || Math.max(d.value * 1.25, 1);
        const value = Math.max(0, Math.min(d.value, max));
        const color = this.mainColor(item);
        const canvas = el("canvas");
        const holder = el("div", { class: "o_ndash_canvas o_ndash_gauge" }, [canvas,
            el("div", { class: "o_ndash_gauge_text" }, [
                el("div", { class: "o_ndash_gauge_value", text: this.format(d.value, item) }),
                el("div", { class: "small text-muted", text: d.max ? `${_t("of")} ${this.format(d.max, item)}` : "" }),
            ])]);
        body.append(holder);
        const { grid } = this.textColors(body);
        const chart = new window.Chart(canvas, {
            type: "doughnut",
            data: { labels: [item.name, ""], datasets: [{ data: [value, max - value], backgroundColor: [color, grid], borderWidth: 0 }] },
            options: {
                responsive: true, maintainAspectRatio: false, rotation: -90, circumference: 180, cutout: "72%",
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                onClick: () => item.clickable && d.domain && this.openRecords(item, d.domain),
            },
        });
        this.charts.set(item.id, chart);
    }

    drawChart(item, body) {
        const d = item.data;
        if (!d.labels || !d.labels.length) {
            body.append(this.noData());
            return;
        }
        const canvas = el("canvas", { role: "img", "aria-label": item.name });
        body.append(el("div", { class: "o_ndash_canvas" }, [canvas]));
        const config = this.chartConfig(item, d, this.textColors(body));
        const chart = new window.Chart(canvas, config);
        this.charts.set(item.id, chart);
    }

    chartConfig(item, d, theme) {
        const type = item.type;
        const round = ROUND.has(type);
        const series = d.datasets.filter((s) => !s.line).length;
        const palette = this.colors(Object.assign({}, item, { color: series === 1 && !round ? item.color : false }),
            round ? d.labels.length : Math.max(series, 1));
        const datasets = d.datasets.map((s, i) => {
            const color = s.line ? (this.colors(Object.assign({}, item, { color: false }), 2)[1]) : palette[i % palette.length];
            const base = { label: s.label, data: s.data, ndashPlain: Boolean(s.line && s.plain) };
            if (round) {
                return Object.assign(base, {
                    backgroundColor: type === "polar" ? palette.map((c) => hexToRgba(c, 0.75)) : palette,
                    borderColor: "rgba(255,255,255,0.9)", borderWidth: d.labels.length > 1 ? 2 : 0, hoverOffset: 6,
                });
            }
            if (s.line && ["bar", "hbar", "stacked"].includes(type)) {
                return Object.assign(base, { type: "line", borderColor: color, backgroundColor: color, yAxisID: type === "hbar" ? undefined : "y1",
                    xAxisID: type === "hbar" ? "x1" : undefined, tension: 0.3, pointRadius: 3, order: 0 });
            }
            if (type === "line" || type === "area" || s.line) {
                return Object.assign(base, { borderColor: color, backgroundColor: hexToRgba(color, type === "area" ? 0.18 : 0.9),
                    fill: type === "area" && !s.line, tension: 0.3, pointRadius: d.labels.length > 40 ? 0 : 3, pointHoverRadius: 5,
                    borderWidth: 2, yAxisID: s.line && type !== "line" && type !== "area" ? "y1" : undefined });
            }
            if (type === "radar") {
                return Object.assign(base, { borderColor: color, backgroundColor: hexToRgba(color, 0.2), pointBackgroundColor: color });
            }
            if (type === "scatter") {
                return base;
            }
            return Object.assign(base, { backgroundColor: color, borderRadius: 4, maxBarThickness: 48, order: 1 });
        });
        let chartData = { labels: d.labels, datasets };
        if (type === "scatter") {
            const color = this.mainColor(item);
            chartData = { datasets: [{ label: item.name, data: d.points || [], backgroundColor: hexToRgba(color, 0.7),
                borderColor: color, pointRadius: 5, pointHoverRadius: 7 }] };
        }
        const fmt = (v) => this.format(typeof v === "object" && v !== null ? v.y : v, item);
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            color: theme.text,
            plugins: {
                legend: { display: item.legend && (round || datasets.length > 1), position: round ? "right" : "top",
                    labels: { color: theme.text, boxWidth: 12, usePointStyle: true } },
                tooltip: { callbacks: { label: (ctx) => {
                    if (type === "scatter") {
                        const p = ctx.raw || {};
                        return `${p.label || ""}: ${this.format(p.x, item)} / ${this.format(p.y, item)}`;
                    }
                    const value = ctx.raw;
                    const label = round ? ctx.label : ctx.dataset.label;
                    return `${label}: ${this.format(value, item, { short: false, plain: Boolean(ctx.dataset.ndashPlain) })}`;
                } } },
            },
            onClick: (evt, elements) => {
                if (elements && elements.length) {
                    this.segmentClick(item, elements[0].datasetIndex, elements[0].index);
                }
            },
            onHover: (evt, elements) => {
                const target = evt.native && evt.native.target;
                if (target) {
                    target.style.cursor = elements && elements.length && item.clickable ? "pointer" : "default";
                }
            },
        };
        if (!round && type !== "radar") {
            const valueAxis = { beginAtZero: true, grid: { color: theme.grid }, ticks: { color: theme.text, callback: (v) => this.format(v, item, { short: true }) },
                stacked: type === "stacked" };
            const labelAxis = { grid: { display: false }, ticks: { color: theme.text, autoSkip: true, maxRotation: 45 }, stacked: type === "stacked" };
            if (type === "hbar") {
                options.indexAxis = "y";
                options.scales = { x: valueAxis, y: labelAxis };
            } else if (type === "scatter") {
                options.scales = {
                    x: Object.assign({}, valueAxis, { title: { display: Boolean(d.x_label), text: d.x_label, color: theme.text } }),
                    y: Object.assign({}, valueAxis, { title: { display: Boolean(d.y_label), text: d.y_label, color: theme.text } }),
                };
            } else {
                options.scales = { x: labelAxis, y: valueAxis };
            }
            if (d.datasets.some((s) => s.line) && type !== "line" && type !== "area" && type !== "scatter") {
                const second = Object.assign({}, valueAxis, { position: type === "hbar" ? "top" : "right", grid: { drawOnChartArea: false }, stacked: false,
                    ticks: { color: theme.text, callback: (v) => this.format(v, item,
                        { short: true, plain: d.datasets.some((x) => x.line && x.plain) }) } });
                options.scales[type === "hbar" ? "x1" : "y1"] = second;
            }
        } else if (type === "radar") {
            options.scales = { r: { grid: { color: theme.grid }, angleLines: { color: theme.grid }, pointLabels: { color: theme.text },
                ticks: { display: false } } };
        } else if (type === "polar") {
            options.scales = { r: { grid: { color: theme.grid }, ticks: { display: false } } };
        }
        if (type === "doughnut") {
            options.cutout = "62%";
        }
        const config = { type: CJS_TYPE[type] || "bar", data: chartData, options, plugins: [] };
        if (item.show_values) {
            config.plugins.push(this.valueLabels(item, theme));
        }
        return config;
    }

    valueLabels(item, theme) {
        const engine = this;
        return {
            id: "ndashValues",
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                ctx.save();
                ctx.font = "600 11px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                chart.data.datasets.forEach((dataset, di) => {
                    const meta = chart.getDatasetMeta(di);
                    if (meta.hidden) {
                        return;
                    }
                    meta.data.forEach((element, index) => {
                        const raw = dataset.data[index];
                        const value = typeof raw === "object" && raw !== null ? raw.y : raw;
                        if (!value) {
                            return;
                        }
                        const text = engine.format(value, item, { short: true, plain: Boolean(dataset.ndashPlain) });
                        let { x, y } = element.tooltipPosition ? element.tooltipPosition() : element;
                        if (meta.type === "bar") {
                            if (chart.options.indexAxis === "y") {
                                ctx.textAlign = "left";
                                x += 6;
                            } else {
                                ctx.textAlign = "center";
                                y -= 9;
                            }
                            ctx.fillStyle = theme.text;
                        } else if (["pie", "doughnut", "polarArea"].includes(meta.type)) {
                            ctx.textAlign = "center";
                            ctx.fillStyle = "#ffffff";
                        } else {
                            ctx.textAlign = "center";
                            y -= 10;
                            ctx.fillStyle = theme.text;
                        }
                        ctx.fillText(text, x, y);
                    });
                });
                ctx.restore();
            },
        };
    }

    // ------------------------------------------------------------------ edit mode (drag and resize)
    toggleEdit() {
        this.editing = !this.editing;
        if (this.editing) {
            this.stopTimer();
        } else {
            this.startTimer();
        }
        this.render();
    }

    bindEdit(card, item) {
        const header = card.querySelector(".o_ndash_item_header") || card;
        header.classList.add("o_ndash_drag");
        header.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0 || ev.target.closest(".o_ndash_dropdown")) {
                return;
            }
            this.startDrag(ev, card, item, "move");
        });
        const handle = card.querySelector(".o_ndash_resize");
        handle.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0) {
                return;
            }
            ev.stopPropagation();
            this.startDrag(ev, card, item, "resize");
        });
    }

    gridMetrics() {
        const rect = this.grid.getBoundingClientRect();
        const col = (rect.width - GAP * (COLS - 1)) / COLS;
        return { col: col + GAP, row: ROW + GAP };
    }

    startDrag(ev, card, item, mode) {
        ev.preventDefault();
        const metrics = this.gridMetrics();
        const start = { x: ev.clientX, y: ev.clientY, ix: item.x, iy: item.y, iw: item.w, ih: item.h };
        const before = JSON.stringify(this.data.items.map((i) => [i.id, i.x, i.y, i.w, i.h]));
        card.classList.add("o_ndash_dragging");
        card.setPointerCapture && card.setPointerCapture(ev.pointerId);
        const move = (e) => {
            const dx = Math.round((e.clientX - start.x) / metrics.col);
            const dy = Math.round((e.clientY - start.y) / metrics.row);
            if (mode === "move") {
                item.x = Math.max(0, Math.min(COLS - item.w, start.ix + dx));
                item.y = Math.max(0, start.iy + dy);
            } else {
                item.w = Math.max(1, Math.min(COLS - item.x, start.iw + dx));
                item.h = Math.max(1, Math.min(20, start.ih + dy));
            }
            this.resolve(item);
            for (const other of this.data.items) {
                this.place(this.cards.get(other.id), other);
            }
            if (mode === "resize") {
                const chart = this.charts.get(item.id);
                chart && chart.resize();
            }
        };
        const up = async () => {
            card.removeEventListener("pointermove", move);
            card.removeEventListener("pointerup", up);
            card.removeEventListener("pointercancel", up);
            card.classList.remove("o_ndash_dragging");
            this.compact();
            for (const other of this.data.items) {
                this.place(this.cards.get(other.id), other);
            }
            for (const chart of this.charts.values()) {
                chart.resize();
            }
            const after = JSON.stringify(this.data.items.map((i) => [i.id, i.x, i.y, i.w, i.h]));
            if (after !== before) {
                await this.saveLayout();
            }
        };
        card.addEventListener("pointermove", move);
        card.addEventListener("pointerup", up);
        card.addEventListener("pointercancel", up);
    }

    overlap(a, b) {
        return a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    /** Push items that overlap `moved` down, recursively. */
    resolve(moved, depth = 0) {
        if (depth > 50) {
            return;
        }
        for (const other of this.data.items) {
            if (this.overlap(moved, other)) {
                other.y = moved.y + moved.h;
                this.resolve(other, depth + 1);
            }
        }
    }

    /** Move every item up as far as it can go. */
    compact() {
        const items = [...this.data.items].sort((a, b) => a.y - b.y || a.x - b.x);
        const placed = [];
        for (const item of items) {
            while (item.y > 0 && !placed.some((p) => this.overlap(Object.assign({}, item, { y: item.y - 1 }), p))) {
                item.y -= 1;
            }
            placed.push(item);
        }
    }

    async saveLayout() {
        const layout = {};
        for (const item of this.data.items) {
            layout[item.id] = [item.x, item.y, item.w, item.h];
        }
        await this.orm.call("ndash.dashboard", "ndash_save_layout", [[this.dashboardId], layout]);
    }
}
