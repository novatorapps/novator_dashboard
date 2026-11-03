/** @odoo-module **/
import { Component, onMounted, onWillStart, onWillUnmount, useRef } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { DashboardEngine } from "./engine";

export class NdashAction extends Component {
    static template = "novator_dashboard.Action";
    static props = ["*"];

    setup() {
        this.root = useRef("root");
        const services = {
            orm: useService("orm"),
            action: useService("action"),
            notification: useService("notification"),
            dialog: useService("dialog"),
        };
        onWillStart(() => loadBundle("web.chartjs_lib"));
        onMounted(() => {
            this.engine = new DashboardEngine(this.root.el, services, this.props.action);
            this.engine.start();
        });
        onWillUnmount(() => this.engine && this.engine.destroy());
    }
}

registry.category("actions").add("ndash_dashboard", NdashAction);
