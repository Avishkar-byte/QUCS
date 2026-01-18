/**
 * Main Application Logic
 */

class SchematicEditor {
    constructor() {
        this.svg = document.getElementById('schematic-canvas');
        this.layers = {
            grid: document.getElementById('layer-grid'),
            wires: document.getElementById('layer-wires'),
            components: document.getElementById('layer-components'),
            temp: document.getElementById('layer-temp') // Added explicit ref
        };

        this.library = [];
        this.instances = [];
        this.wires = [];

        this.state = {
            tool: 'select', // select, wire_tool
            // Sub-states
            mode: 'idle', // idle, place, drag, wiring
            selected: null,
            dragging: null,
            wiring: null,
            pan: { x: 0, y: 0, zoom: 1 },
            placeType: null
        };

        this.nextId = 1;
        this.init();
    }

    async init() {
        this.setupGrid();
        this.setupEvents();
        await this.loadLibrary();
        this.draw();
        this.setStatus("Ready.");
    }

    // --- Tools ---

    setTool(toolName) {
        this.state.tool = toolName;
        // Update UI buttons
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`btn-${toolName}`);
        if (btn) btn.classList.add('active');

        this.state.mode = 'idle';
        this.state.wiring = null;
        this.state.placeType = null;
        this.drawTempWire(null);

        if (toolName === 'wire_tool') {
            this.setStatus("Wire Mode: Click a pin to start wiring.");
            this.svg.style.cursor = 'crosshair';
        } else {
            this.setStatus("Select Mode");
            this.svg.style.cursor = 'default';
        }
    }

    // --- Events ---

    setupGrid() {
        this.updateView();
    }

    updateView() {
        const g = document.getElementById('viewport');
        g.setAttribute('transform', `translate(${this.state.pan.x}, ${this.state.pan.y}) scale(${this.state.pan.zoom})`);
    }

    setupEvents() {
        this.svg.addEventListener('mousedown', e => this.onMouseDown(e));
        window.addEventListener('mousemove', e => this.onMouseMove(e));
        window.addEventListener('mouseup', e => this.onMouseUp(e));
        this.svg.addEventListener('wheel', e => this.onWheel(e));
        this.svg.addEventListener('contextmenu', e => e.preventDefault());

        window.addEventListener('keydown', e => {
            if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
            if (e.key === 'Escape') this.cancelAction();
        });
    }

    async loadLibrary() {
        try {
            const res = await fetch('/api/components');
            this.library = await res.json();
            this.renderLibraryUI();
        } catch (e) {
            this.setStatus("Error loading library", true);
        }
    }

    renderLibraryUI() {
        const container = document.getElementById('component-list');
        container.innerHTML = '';
        this.library.forEach(comp => {
            const div = document.createElement('div');
            div.className = 'component-icon';
            div.innerHTML = `
                <img src="/components_static/${comp.id}/symbol.svg" />
                <span>${comp.name}</span>
            `;
            div.onmousedown = (e) => this.startPlacing(e, comp);
            container.appendChild(div);
        });
    }

    // --- Action Start ---

    startPlacing(e, comp) {
        e.preventDefault();
        this.setTool('select'); // Switch to select to place
        this.state.mode = 'place';
        this.state.placeType = comp;
        this.setStatus(`Placing ${comp.name} (Click to drop, Esc to cancel)`);
    }

    cancelAction() {
        this.setTool('select');
    }

    deleteSelected() {
        if (!this.state.selected) return;
        if (this.state.selected.type === 'instance') {
            const id = this.state.selected.id;
            this.instances = this.instances.filter(i => i.id !== id);
            this.wires = this.wires.filter(w => w.start.instId !== id && w.end.instId !== id);
        } else if (this.state.selected.type === 'wire') {
            const id = this.state.selected.id;
            this.wires = this.wires.filter(w => w.id !== id);
        }
        this.state.selected = null;
        this.renderProperties();
        this.draw();
    }

    // --- Direct Pin Handlers ---
    onPinDown(e, instId, pinName, absX, absY) {
        console.log("Pin Down:", instId, pinName);

        // Fix for Click-Click Workflow:
        // If we are already wiring, clicking a pin means "Connect Here"
        if (this.state.mode === 'wiring' && this.state.wiring) {
            this.handleWiringCompletion(instId, pinName);
            // Don't start a new wire immediately
            return;
        }

        // Start Wiring
        this.state.mode = 'wiring';
        this.state.wiring = {
            startPin: { instId, pinName, absX, absY },
            pts: [{ x: absX, y: absY }, { x: absX, y: absY }]
        };
        this.setStatus(`Wiring from ${instId}:${pinName}...`);
    }

    onPinUp(e, instId, pinName) {
        console.log("Pin Up:", instId, pinName);
        // Fix for Drag-Drop Workflow:
        // If we released mouse over a pin, complete the wire
        if (this.state.mode === 'wiring' && this.state.wiring) {
            const start = this.state.wiring.startPin;
            // Filter out the "Up" event from the initial "Down-Click" on the starting pin
            if (start.instId === instId && start.pinName === pinName) {
                return;
            }
            this.handleWiringCompletion(instId, pinName);
        }
    }

    handleWiringCompletion(instId, pinName) {
        if (!this.state.wiring) return;
        const start = this.state.wiring.startPin;

        // Validate
        if (start.instId !== instId || start.pinName !== pinName) {
            this.addWire(start, { instId, pinName, absX: 0, absY: 0 }); // abs coords not stored in wire model currently, only identifiers
            this.setStatus(`Connected.`);
            this.finishWiring();
        }
    }

    getMousePos(e) {
        // Robust SVG Coordinate Transformation
        const pt = this.svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;

        // Transform to SVG Schematic Space (inside the viewport group)
        // We need the CTM of the viewport group
        const viewport = document.getElementById('viewport');
        const ctm = viewport.getScreenCTM();

        if (ctm) {
            const res = pt.matrixTransform(ctm.inverse());
            return { x: res.x, y: res.y };
        }

        // Fallback (Simple Math)
        const rect = this.svg.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.state.pan.x) / this.state.pan.zoom,
            y: (e.clientY - rect.top - this.state.pan.y) / this.state.pan.zoom
        };
    }

    onMouseDown(e) {
        if (e.button === 2) {
            // Right Click -> Cancel
            this.cancelAction();
            return;
        }
        if (e.button !== 0) return;

        const pos = this.getMousePos(e);
        const snapPos = { x: Utils.snap(pos.x), y: Utils.snap(pos.y) };
        const target = e.target;

        // Cancel wiring if clicking on void (BG)
        if (this.state.mode === 'wiring' && (target.id === 'schematic-canvas' || target.id === 'bg-rect')) {
            this.finishWiring();
            this.setStatus("Wiring Cancelled");
            return;
        }

        // 1. Placing
        if (this.state.mode === 'place') {
            this.addInstance(this.state.placeType, snapPos.x, snapPos.y);
            this.state.mode = 'idle';
            this.state.placeType = null;
            this.setStatus("Ready");
            return;
        }

        // 2. Wiring Start?
        // Check Pin Hit
        const pinData = this.getPinAt(pos);
        if (pinData) {
            this.state.mode = 'wiring';
            this.state.wiring = {
                startPin: pinData,
                pts: [{ x: pinData.absX, y: pinData.absY }, { x: snapPos.x, y: snapPos.y }]
            };
            this.setStatus("Wiring... Click destination pin.");
            e.stopPropagation();
            return;
        }

        // Wire Tool click on void?
        if (this.state.tool === 'wire_tool' && !pinData) {
            // Optional: Start floating wire?
            // For now, feedback:
            this.setStatus("Click a PIN to start wiring.");
            return;
        }

        // 3. Select / Drag
        const instGrp = target.closest('.comp-group');
        if (instGrp) {
            const instId = instGrp.dataset.id;
            const inst = this.instances.find(i => i.id === instId);
            this.select(inst, 'instance');

            this.state.mode = 'drag';
            this.state.dragging = {
                target: inst,
                startX: pos.x,
                startY: pos.y,
                origX: inst.x,
                origY: inst.y
            };
            e.stopPropagation();
            return;
        }

        // 4. Wire Select
        // (Visual wire hit detection needed, skipping for MVP, select bounding box?)
        if (target.classList.contains('wire')) {
            // Handle in wire onclick
        }

        // 5. Pan
        if (target.id === 'schematic-canvas' || target.id === 'bg-rect') {
            this.state.selected = null;
            this.renderProperties();
            this.draw();

            this.state.mode = 'pan';
            this.state.dragging = {
                startX: e.clientX,
                startY: e.clientY,
                origX: this.state.pan.x,
                origY: this.state.pan.y
            };
        }
    }

    onMouseMove(e) {
        const pos = this.getMousePos(e);
        const snapPos = { x: Utils.snap(pos.x), y: Utils.snap(pos.y) };

        // Debug Coordinates
        if (window.debugCoords) window.debugCoords.innerText = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;

        // Pin Hover Effect (Always check for pins to give feedback)
        const hoveredPin = this.getPinAt(pos);
        document.querySelectorAll('.pin-spot').forEach(p => p.style.stroke = 'white'); // Reset
        if (hoveredPin) {
            this.svg.style.cursor = 'crosshair';
            // Find that specific pin element and highlight it
            // This is a bit inefficient (DOM scan), but reliable
            const groups = this.instances.filter(i => i.id === hoveredPin.instId);
            groups.forEach(inst => {
                const g = document.getElementById(`grp-${inst.id}`);
                if (g) {
                    const pins = g.querySelectorAll('.pin-spot');
                    pins.forEach(p => {
                        if (p.dataset.pin === hoveredPin.pinName) {
                            p.style.stroke = '#ffff00'; // Yellow highlight
                            p.style.strokeWidth = '2px';
                        }
                    });
                }
            });
        } else if (this.state.tool === 'select') {
            this.svg.style.cursor = 'default';
        }

        if (this.state.mode === 'place') {
            this.drawGhost(snapPos);
            return;
        }

        if (this.state.mode === 'wiring' && this.state.wiring) {
            const pts = this.state.wiring.pts;
            pts[pts.length - 1] = snapPos;
            this.drawTempWire();
            return;
        }

        if (this.state.mode === 'drag') {
            const dx = snapPos.x - Utils.snap(this.state.dragging.startX);
            const dy = snapPos.y - Utils.snap(this.state.dragging.startY);
            this.state.dragging.target.x = this.state.dragging.target.origX + dx;
            this.state.dragging.target.y = this.state.dragging.target.origY + dy;
            this.drawInstance(this.state.dragging.target);
            // Also need to redraw wires connected to this?
            // Expensive full redraw for MVP safety
            this.drawWiresOnly();
            return;
        }

        if (this.state.mode === 'pan') {
            const dx = e.clientX - this.state.dragging.startX;
            const dy = e.clientY - this.state.dragging.startY;
            this.state.pan.x = this.state.dragging.origX + dx;
            this.state.pan.y = this.state.dragging.origY + dy;
            this.updateView();
        }
    }

    onMouseUp(e) {
        if (this.state.mode === 'drag' || this.state.mode === 'pan') {
            this.state.mode = 'idle';
            this.state.dragging = null;
        }

        // Removed global finishWiring() to allow Click-Click workflow.
        // If user clicks void, we could cancel, but handle that in onMouseDown on BG.
        // This allows 'wiring' state to persist after MouseUp on the start pin.
    }

    finishWiring() {
        this.state.mode = 'idle'; // Or revert to tool
        this.state.wiring = null;
        this.drawTempWire(null);
        this.drawWiresOnly();
    }

    onWheel(e) {
        e.preventDefault();
        const scaleBy = 1.1;
        const oldZoom = this.state.pan.zoom;
        const newZoom = e.deltaY < 0 ? oldZoom * scaleBy : oldZoom / scaleBy;
        const rect = this.svg.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const wx = (cx - this.state.pan.x) / oldZoom;
        const wy = (cy - this.state.pan.y) / oldZoom;
        this.state.pan.x = cx - wx * newZoom;
        this.state.pan.y = cy - wy * newZoom;
        this.state.pan.zoom = newZoom;
        this.updateView();
    }

    // --- Helpers ---

    getPinAt(pos) {
        for (let inst of this.instances) {
            const comp = this.library.find(c => c.id === inst.compId);
            if (!comp || !comp.pins) continue;
            for (let pin of comp.pins) {
                const px = inst.x + pin.x;
                const py = inst.y + pin.y;
                const d = Math.hypot(px - pos.x, py - pos.y);
                if (d < CONFIG.PIN_HIT_RADIUS) {
                    return { instId: inst.id, pinName: pin.name, absX: px, absY: py };
                }
            }
        }
        return null;
    }

    addInstance(comp, x, y) {
        const inst = {
            id: `${comp.id}_${this.nextId++}`,
            compId: comp.id,
            x: x,
            y: y,
            rotation: 0,
            params: {}
        };
        for (let pid in comp.parameters) {
            inst.params[pid] = comp.parameters[pid].default;
        }
        this.instances.push(inst);
        this.drawInstance(inst);
        this.select(inst, 'instance');
    }

    addWire(startPin, endPin) {
        this.wires.push({
            id: `w_${this.nextId++}`,
            start: startPin,
            end: endPin
        });
    }

    select(obj, type) {
        this.state.selected = { ...obj, type };
        const allGrps = document.querySelectorAll('.comp-group');
        allGrps.forEach(g => g.classList.remove('selected'));
        if (type === 'instance') {
            const g = document.getElementById(`grp-${obj.id}`);
            if (g) g.classList.add('selected');
        }
        this.renderProperties();
    }

    // --- Rendering ---

    draw() {
        this.drawWiresOnly();
        this.layers.components.innerHTML = '';
        this.instances.forEach(i => this.drawInstance(i));
    }

    drawWiresOnly() {
        this.layers.wires.innerHTML = '';
        this.wires.forEach(w => {
            const p1 = this.getPinAbs(w.start);
            const p2 = this.getPinAbs(w.end);
            if (!p1 || !p2) return;
            const line = Utils.svg('line', {
                x1: p1.x, y1: p1.y,
                x2: p2.x, y2: p2.y,
                class: 'wire'
            });
            line.onclick = (e) => { e.stopPropagation(); this.select(w, 'wire'); };
            this.layers.wires.appendChild(line);
        });
    }

    getPinAbs(pinDesc) {
        const inst = this.instances.find(i => i.id === pinDesc.instId);
        if (!inst) return null;
        const comp = this.library.find(c => c.id === inst.compId);
        const pinDef = comp.pins.find(p => p.name === pinDesc.pinName);
        return { x: inst.x + pinDef.x, y: inst.y + pinDef.y };
    }

    drawInstance(inst) {
        let g = document.getElementById(`grp-${inst.id}`);
        if (!g) {
            g = Utils.svg('g', {
                class: 'comp-group',
                id: `grp-${inst.id}`,
                'data-id': inst.id
            });
            const img = Utils.svg('image', {
                href: `/components_static/${inst.compId}/symbol.svg`,
                width: 60, height: 40
            });
            const box = Utils.svg('rect', {
                x: -5, y: -5, width: 70, height: 50,
                class: 'selection-box'
            });
            const txt = Utils.svg('text', {
                x: 0, y: 50, fill: '#888', 'font-size': 10
            });
            txt.textContent = inst.id;
            g.appendChild(box);
            g.appendChild(img);
            g.appendChild(txt);

            // Pins
            const comp = this.library.find(c => c.id === inst.compId);
            if (comp && comp.pins) {
                comp.pins.forEach(p => {
                    const c = Utils.svg('circle', {
                        cx: p.x, cy: p.y, r: 6, // Larger hit target
                        class: 'pin-spot',
                        stroke: 'white' // Explicit default
                    });
                    // Metadata for direct event access if needed
                    c.dataset.pin = p.name;
                    c.dataset.inst = inst.id;

                    // DIRECT EVENT HANDLING (Robustness Fix)
                    c.onmousedown = (e) => {
                        e.stopPropagation(); // Don't trigger canvas pan/select
                        this.onPinDown(e, inst.id, p.name, inst.x + p.x, inst.y + p.y);
                    };
                    c.onmouseup = (e) => {
                        e.stopPropagation();
                        // Need abs coords for robust end
                        this.onPinUp(e, inst.id, p.name);
                    };
                    // Hover highlight handled via CSS/JS mix, but events are key
                    c.onmouseenter = () => { c.style.fill = '#ffff00'; c.style.r = 8; };
                    c.onmouseleave = () => { c.style.fill = '#ff0000'; c.style.r = 6; };

                    g.appendChild(c);
                });
            }
            this.layers.components.appendChild(g);
        }
        g.setAttribute('transform', `translate(${inst.x}, ${inst.y}) rotate(${inst.rotation})`);
    }

    drawTempWire() {
        const layer = this.layers.temp;
        layer.innerHTML = '';
        if (this.state.wiring && this.state.wiring.pts) {
            const pts = this.state.wiring.pts;
            if (!pts || pts.length < 2) return;
            const line = Utils.svg('polyline', {
                points: pts.map(p => `${p.x},${p.y}`).join(' '),
                class: 'wire-drag'
            });
            layer.appendChild(line);
        }
    }

    drawGhost(pos) {
        const layer = this.layers.temp;
        layer.innerHTML = '';
        if (this.state.mode === 'place' && this.state.placeType) {
            const img = Utils.svg('image', {
                href: `/components_static/${this.state.placeType.id}/symbol.svg`,
                x: pos.x, y: pos.y,
                width: 60, height: 40,
                opacity: 0.5
            });
            layer.appendChild(img);
        }
    }

    renderProperties() {
        const div = document.getElementById('property-content');
        div.innerHTML = '';
        if (!this.state.selected || this.state.selected.type !== 'instance') {
            div.innerHTML = '<p style="color:#666; font-size:12px">Select a component to edit properties</p>';
            return;
        }
        const inst = this.state.selected;
        const comp = this.library.find(c => c.id === inst.compId);
        div.innerHTML = `<h4 style="margin-top:0">${inst.id} (${comp.name})</h4>`;
        for (let paramKey in inst.params) {
            const def = comp.parameters[paramKey] || {};
            const group = document.createElement('div');
            group.className = 'form-group';
            group.innerHTML = `
                <label>${def.name || paramKey} ${def.unit ? '(' + def.unit + ')' : ''}</label>
                <input type="text" value="${inst.params[paramKey]}" data-key="${paramKey}">
            `;
            group.querySelector('input').onchange = (e) => {
                inst.params[paramKey] = e.target.value;
            };
            div.appendChild(group);
        }
    }

    setStatus(msg, error = false) {
        const bar = document.getElementById('status-bar');
        bar.textContent = msg;
        bar.className = error ? 'status-error' : 'status-ok';
    }

    // --- Simulation (Kept same) ---
    async runSimulation() {
        this.setStatus("Running simulation...");
        document.getElementById('plot-container').innerHTML = '';
        try {
            const nets = this.resolveNets();
            const payload = {
                instances: this.instances.map(inst => {
                    const comp = this.library.find(c => c.id === inst.compId);
                    const connections = {};
                    comp.ports.forEach(port => {
                        connections[port] = nets.getNet(inst.id, port);
                    });
                    return {
                        id: inst.id,
                        component_id: inst.compId,
                        parameters: inst.params,
                        connections: connections
                    };
                })
            };
            const res = await fetch('/api/simulate', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.setStatus("Simulation Complete.", false);
                this.plotResults(data.results);
            } else {
                this.setStatus("Error: " + data.message, true);
            }
        } catch (e) {
            console.error(e);
            this.setStatus("Simulation Failed: " + e.message, true);
        }
    }
    resolveNets() {
        const parent = {};
        const getRoot = (i) => {
            if (!parent[i]) parent[i] = i;
            if (parent[i] === i) return i;
            return getRoot(parent[i]);
        };
        const union = (i, j) => {
            const rootI = getRoot(i);
            const rootJ = getRoot(j);
            if (rootI !== rootJ) parent[rootI] = rootJ;
        };
        this.wires.forEach(w => {
            const p1 = `${w.start.instId}:${w.start.pinName}`;
            const p2 = `${w.end.instId}:${w.end.pinName}`;
            union(p1, p2);
        });
        const nets = {};
        let netIdx = 1;
        return {
            getNet: (instId, pinName) => {
                const id = `${instId}:${pinName}`;
                const root = getRoot(id);
                if (!nets[root]) {
                    const isGnd = this.instances.filter(i => i.compId === 'ground').some(g => getRoot(`${g.id}:G`) === root);
                    nets[root] = isGnd ? '0' : `N${netIdx++}`;
                }
                return nets[root];
            }
        };
    }
    plotResults(data) {
        const container = document.getElementById('plot-container');
        container.innerHTML = '<canvas id="plotCanvas" width="800" height="200"></canvas>';
        const cvs = document.getElementById('plotCanvas');
        const ctx = cvs.getContext('2d');
        const keys = Object.keys(data).filter(k => k !== 'time' && k !== 'acfrequency' && k !== 'frequency');
        const xKey = Object.keys(data).find(k => k === 'time' || k === 'acfrequency') || Object.keys(data)[0];
        if (!xKey || keys.length === 0) {
            ctx.fillStyle = "#fff"; ctx.fillText("No data", 10, 20); return;
        }
        const X = data[xKey];
        let minY = Infinity, maxY = -Infinity;
        keys.forEach(k => { const arr = data[k]; minY = Math.min(minY, ...arr); maxY = Math.max(maxY, ...arr); });
        if (minY === maxY) { minY -= 1; maxY += 1; }
        const pad = 20; const w = cvs.width; const h = cvs.height;
        const minX = Math.min(...X); const maxX = Math.max(...X);
        const mapX = v => pad + (v - minX) / (maxX - minX) * (w - 2 * pad);
        const mapY = v => h - pad - (v - minY) / (maxY - minY) * (h - 2 * pad);
        keys.forEach((k, idx) => {
            const col = ['#00ff00', '#ff0000', '#00ffff'][idx % 3];
            ctx.strokeStyle = col; ctx.beginPath();
            data[k].forEach((val, i) => { const x = mapX(X[i]); const y = mapY(val); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
            ctx.stroke(); ctx.fillStyle = col; ctx.fillText(k, 10, 20 + idx * 15);
        });
    }
}
window.app = new SchematicEditor();
