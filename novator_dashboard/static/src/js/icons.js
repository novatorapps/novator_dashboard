/** @odoo-module **/
/**
 * Icons. Font Awesome 4 from 17.0 to 19.0 (Odoo 20.0 uses Material Symbols: this file is replaced there).
 * spec: "fa-name [fa-modifiers] [other classes]"
 */
export function iconNode(spec, extra = "") {
    const node = document.createElement("i");
    node.className = `fa ${spec} ${extra}`.trim();
    node.setAttribute("aria-hidden", "true");
    return node;
}
