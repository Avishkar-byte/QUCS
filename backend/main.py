import os
import json
import shutil
import subprocess
import uuid
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from jinja2 import Template

from fastapi.staticfiles import StaticFiles

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent.parent
COMPONENTS_DIR = BASE_DIR / "components"
TEMP_DIR = BASE_DIR / "temp"
TEMP_DIR.mkdir(exist_ok=True)

# Mount Static Files
STATIC_DIR = Path(__file__).parent / "static"
# We mount it at the end to avoid conflicts with API routes? 
# Best practice: Mount internal API args first.
# Here we will do it after API definitions or use a catch-all route.


# --- Models ---

class ComponentParam(BaseModel):
    type: str
    default: Any
    unit: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None

class ComponentConfig(BaseModel):
    id: str
    name: str
    category: str
    ports: List[str]
    parameters: Dict[str, ComponentParam]
    flags: Optional[Dict[str, Any]] = {}
    simulation: Dict[str, str]

class ComponentInstance(BaseModel):
    id: str  # Unique instance ID, e.g., "R1"
    component_id: str # e.g., "resistor"
    parameters: Dict[str, Any]
    connections: Dict[str, str] # port_name -> node_id (e.g., "A" -> "n1")

class CircuitRequest(BaseModel):
    instances: List[ComponentInstance]

# --- Registry ---

def load_components() -> Dict[str, ComponentConfig]:
    components = {}
    if not COMPONENTS_DIR.exists():
        return components
        
    for item in COMPONENTS_DIR.iterdir():
        if item.is_dir():
            config_path = item / "component.json"
            if config_path.exists():
                try:
                    with open(config_path, "r") as f:
                        data = json.load(f)
                        # Ensure 'simulation' dict exists
                        if "simulation" not in data:
                            data["simulation"] = {"engine": "qucs", "netlist": "model.net"}
                        comp = ComponentConfig(**data)
                        components[comp.id] = comp
                except Exception as e:
                    print(f"Error loading {item.name}: {e}")
    return components

COMPONENTS_CACHE = load_components()

# --- Netlist Builder ---

def build_netlist(circuit: CircuitRequest, run_id: str) -> str:
    lines = []
    lines.append(f"# Qucs-Web Netlist {run_id}")
    
    # Reload components to ensure fresh config
    registry = load_components()
    
    for inst in circuit.instances:
        if inst.component_id not in registry:
            continue
            
        comp = registry[inst.component_id]
        
        # Prepare context for template
        context = {
            "id": inst.id,
            **inst.parameters
        }
        
        # Handle Ports / Nodes
        # If component is "Ground" (checked via flags usually, or just named gnd), 
        # we might handle it. But per design, we map ports to node names.
        # Use component config ports to map connections to context
        
        # Flatten connections: config port "A" -> context["A"] = node_name
        for port in comp.ports:
            node = inst.connections.get(port, "0") # Default to 0? Or user must connect?
            # Special case: if default logic needed
            context[port] = node
            
        # Helper: If this component is Ground, user should have connected it to a node.
        # But Qucs netlisting is text based.
        
        # Load Template
        model_file = COMPONENTS_DIR / comp.id / comp.simulation.get("netlist", "model.net")
        if model_file.exists():
            with open(model_file, "r") as f:
                tmpl_str = f.read().strip()
                if tmpl_str:
                    template = Template(tmpl_str)
                    rendered = template.render(**context)
                    lines.append(rendered)
    
    return "\n".join(lines)

# --- Parser ---

def parse_qucs_dat(file_path: Path) -> Dict[str, Any]:
    # Simple Qucs .dat parser
    # Structure:
    # <indep time 100>
    # ... values ...
    # </indep>
    # <dep node1 vector>
    # ... values ...
    # </dep>
    
    if not file_path.exists():
        return {"error": "No output file found"}
        
    with open(file_path, "r") as f:
        content = f.read()

    results = {}
    
    # Regex to find blocks
    # <(indep|dep) (\w+) (\w+)>
    block_re = re.compile(r"<((?:in)?dep)\s+(\w+)\s+(\w+)>(.*?)</\1>", re.DOTALL)
    
    for match in block_re.finditer(content):
        kind, name, type_name, data = match.groups()
        # Parse numbers
        values = []
        for line in data.strip().split():
            try:
                values.append(float(line))
            except ValueError:
                pass # scientific notation should parse by float()
        results[name] = values
        
    return results

# --- API Endpoints ---

@app.get("/api/components")
def get_components():
    global COMPONENTS_CACHE
    COMPONENTS_CACHE = load_components()
    return list(COMPONENTS_CACHE.values())

@app.post("/api/simulate")
def run_simulation(circuit: CircuitRequest):
    run_id = str(uuid.uuid4())
    work_dir = TEMP_DIR / run_id
    work_dir.mkdir()
    
    try:
        # 1. Generate Netlist
        netlist_content = build_netlist(circuit, run_id)
        netlist_path = work_dir / "circuit.net"
        with open(netlist_path, "w") as f:
            f.write(netlist_content)
            
        # 2. Run Qucsator
        # qucsator -i circuit.net -o circuit.dat
        cmd = [QUCSATOR_BIN, "-i", str(netlist_path), "-o", str(work_dir / "circuit.dat")]
        
        proc = subprocess.run(
            cmd, 
            cwd=work_dir, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            timeout=5 # 5 seconds max
        )
        
        if proc.returncode != 0:
            return {
                "status": "error",
                "message": proc.stderr.decode() or "Unknown Qucsator error",
                "netlist": netlist_content
            }
            
        # 3. Parse Output
        output_data = parse_qucs_dat(work_dir / "circuit.dat")
        
        return {
            "status": "success",
            "results": output_data,
            "netlist": netlist_content
        }
        
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Simulation timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        # Cleanup
        shutil.rmtree(work_dir, ignore_errors=True)

@app.get("/health")
def health():
    return {"status": "ok"}


# Environment
# Try to find qucsator in standard path or local build
POSSIBLE_PATHS = [
    shutil.which("qucsator"),
    str(BASE_DIR / "qucsator/build/src/qucsator"), 
    "/usr/local/bin/qucsator"
]
QUCSATOR_BIN = next((p for p in POSSIBLE_PATHS if p and os.path.exists(p)), "qucsator")

# Mount Components for SVGs
if COMPONENTS_DIR.exists():
    app.mount("/components_static", StaticFiles(directory=COMPONENTS_DIR), name="components")

# Mount Static Files (Frontend)
# Serve the entire frontend directory at root. 
# This handles index.html (via html=True) and css/js folders automatically.
FRONTEND_DIR = BASE_DIR / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")
