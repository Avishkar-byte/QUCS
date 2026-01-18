# Qucs-Web

A modern, web-based interface for the **Quite Universal Circuit Simulator (Qucs)**. This project aims to bring the power of Qucs simulation to the browser with a user-friendly schematic editor and a powerful backend connection.

## 🚀 Features

*   **Web-Based Schematic Editor**: Draw and edit circuits directly in your browser.
*   **Qucsator Backend**: Utilizes the powerful `qucsator` engine for accurate circuit simulation.
*   **Real-time Simulation**: Instant feedback and plotting of simulation results.
*   **Component Library**: Extensible system for adding and configuring components (Resistors, Capacitors, Sources, etc.).

## 🛠️ Architecture

The project consists of three main parts:

1.  **Frontend**: A responsive web interface (HTML5/Canvas/JS) for schematic capture and results visualization.
2.  **Backend**: A Python-based server that handles API requests, netlist generation, and communicates with the simulator.
3.  **Simulator**: The `qucsator` binary, built from source, which performs the actual numerical analysis.

For more details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 📋 Prerequisites

To run this project locally, you need a Linux environment with the following dependencies installed:

*   Git
*   Python 3 (with `venv`)
*   C++ Build Tools (gcc, g++, make, cmake)
*   Flex & Bison
*   Gperf

**Install command (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install -y gperf python3-venv flex bison build-essential cmake qt5-default libqt5svg5-dev
```

## ⚡ Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Avishkar-byte/QUCS.git
    cd QUCS
    ```

2.  **Run the application:**
    ```bash
    ./run.sh
    ```
    This script will:
    *   Build `qucsator` (if not found).
    *   Set up the Python virtual environment.
    *   Start the server on `http://localhost:8000`.

3.  **Open in Browser:**
    Navigate to [http://localhost:8000](http://localhost:8000) to start simulating.

## 📂 Project Structure

*   `components/`: Library of circuit components (definitions + models).
*   `frontend/`: Web application source code.
*   `backend/`: Server-side logic and API.
*   `qucsator/`: Source code for the Qucs simulator engine.
*   `bin/`: Compiled binaries.

## 📄 License

This project is built upon Qucs. Please refer to the specific license files for details on `qucsator`.
