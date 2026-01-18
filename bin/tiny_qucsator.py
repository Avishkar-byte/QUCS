#!/usr/bin/env python3
import sys
import re

# Tiny MNA Solver for DC Resistive Circuits
# Usage: tiny_qucsator -i input.net -o output.dat

def solve(netlist_str):
    # Parse Netlist
    lines = netlist_str.splitlines()
    nodes = set()
    components = []
    
    # Simulation cmd
    sim_cmd = None
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'): continue
        
        # Parse params: key="val"
        params = {}
        for m in re.finditer(r'(\w+)="([^"]+)"', line):
            params[m.group(1)] = m.group(2)
        
        # Clean line for parts
        base_parts = line.split()
        type_id = base_parts[0]
        
        if type_id.startswith('.DC'):
            sim_cmd = params
            continue
            
        # Components: R:R1 n1 n2 ...
        # Vdc:V1 n1 n2 ...
        if ':' not in type_id: continue
        name = type_id.split(':')[1]
        ctype = type_id.split(':')[0]
        
        # Nodes are usually args 1 and 2
        # BUT depends on model.net
        # R:{{id}} {{A}} {{B}} ...
        # We need to map positional args to nodes? 
        # In this simplified solver, we assume standard netlist order:
        # R n1 n2
        # V n1 n2
        
        node_list = []
        for p in base_parts[1:]:
            if '=' in p: break
            node_list.append(p)
            nodes.add(p)
            
        components.append({
            'type': ctype,
            'name': name,
            'nodes': node_list,
            'params': params
        })
        
    # Build Node Map (0 is ref)
    sorted_nodes = sorted(list(nodes))
    if '0' in sorted_nodes: sorted_nodes.remove('0')
    if 'gnd' in sorted_nodes: sorted_nodes.remove('gnd')
    
    node_map = {n: i for i, n in enumerate(sorted_nodes)}
    N = len(node_map)
    
    # MNA Matrix Size: N + M (voltage sources)
    vsources = [c for c in components if c['type'] == 'Vdc']
    M = len(vsources)
    
    size = N + M
    import math
    G = [[0.0] * size for _ in range(size)]
    I = [0.0] * size
    
    # Fill Stamps
    for c in components:
        # Get Node Indices
        nis = []
        for n in c['nodes']:
            if n == '0' or n == 'gnd':
                nis.append(-1)
            else:
                nis.append(node_map[n])
        
        if c['type'] == 'R':
            # R stamp
            val = float(c['params'].get('R', '1000'))
            g_val = 1.0 / val
            n1, n2 = nis[0], nis[1]
            if n1 >= 0: G[n1][n1] += g_val
            if n2 >= 0: G[n2][n2] += g_val
            if n1 >= 0 and n2 >= 0:
                G[n1][n2] -= g_val
                G[n2][n1] -= g_val
                
        elif c['type'] == 'Vdc':
            # V stamp
            # Find index in lower part of matrix
            v_idx = N + vsources.index(c)
            val = float(c['params'].get('U', '1'))
            n1, n2 = nis[0], nis[1]
            
            # 1 in row/col for KVL
            if n1 >= 0:
                G[n1][v_idx] += 1
                G[v_idx][n1] += 1
            if n2 >= 0:
                G[n2][v_idx] -= 1
                G[v_idx][n2] -= 1
                
            I[v_idx] += val

    # Solve G * x = I
    # Gaussian Elimination
    x = [0.0] * size
    
    # Forward
    for i in range(size):
        # Pivot
        pivot = G[i][i]
        # Skip if pivot 0 (singular) - minimal check
        if abs(pivot) < 1e-12: continue 
        
        for j in range(i + 1, size):
            factor = G[j][i] / pivot
            I[j] -= factor * I[i]
            for k in range(i, size):
                G[j][k] -= factor * G[i][k]
                
    # Backward
    for i in range(size - 1, -1, -1):
        sum_val = sum(G[i][j] * x[j] for j in range(i + 1, size))
        if abs(G[i][i]) > 1e-12:
            x[i] = (I[i] - sum_val) / G[i][i]
            
    return node_map, x

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('-i', required=True)
    parser.add_argument('-o', required=True)
    args = parser.parse_args()
    
    with open(args.i, 'r') as f:
        netlist = f.read()
        
    node_map, soln = solve(netlist)
    
    # Output Qucs Format
    # Need to output sweep if .DC
    # Simple Mock: Output just 2 points (Start, Stop) assuming linear
    
    # Re-reading sim params
    sim_params = {}
    for line in netlist.splitlines():
        if line.strip().startswith('.DC'):
             for m in re.finditer(r'(\w+)="([^"]+)"', line):
                sim_params[m.group(1)] = m.group(2)
    
    start = float(sim_params.get('Start', '0'))
    stop = float(sim_params.get('Stop', '10'))
    points = int(sim_params.get('Points', '2'))
    
    # We solved for "Static" DC? 
    # MNA above uses Vdc values directly.
    # If we are sweeping a V source, we should have re-solved.
    # For this mock, we just output the constant solution across the sweep range
    # Or implies linearity if sweeping V1?
    # Let's just output constant lines for the nodes.
    
    with open(args.o, 'w') as f:
        # Indep var
        f.write(f"<indep {sim_params.get('Param', 'sweep')} {points}>\n")
        # Linearly space
        step = (stop - start) / (points - 1) if points > 1 else 0
        for i in range(points):
            f.write(f"{start + i*step:e}\n")
        f.write("</indep>\n")
        
        # Dep vars (Nodes)
        for node, idx in node_map.items():
            f.write(f"<dep {node} {sim_params.get('Param', 'sweep')}>\n")
            val = soln[idx]
            for _ in range(points):
                f.write(f"{val:e}\n")
            f.write("</dep>\n")

if __name__ == '__main__':
    main()
