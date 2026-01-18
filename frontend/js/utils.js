/**
 * Simple Geometry & Config Utilities
 */
const CONFIG = {
    GRID_SIZE: 10,
    SNAP: 10,
    PIN_HIT_RADIUS: 8,
    COLORS: {
        WIRE: '#4caf50',
        SELECTED: '#ffeb3b',
        GRID: '#2a2a2a'
    }
};

class Utils {
    static snap(val) {
        return Math.round(val / CONFIG.SNAP) * CONFIG.SNAP;
    }

    static uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Create SVG Element
    static svg(tag, attrs = {}) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (let k in attrs) {
            if (k === 'href') el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', attrs[k]);
            else el.setAttribute(k, attrs[k]);
        }
        return el;
    }
}
