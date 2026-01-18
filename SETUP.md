# Qucs-Web Setup

## Prerequisites

You must install `gperf` and `python3-venv` manually as sudo is required:

```bash
sudo apt update
sudo apt install -y gperf python3-venv flex bison build-essential cmake qt5-default libqt5svg5-dev
```

## Running the App

1.  Run the setup/start script:

```bash
./run.sh
```

This will:
1.  Build `qucsator` from source (if not already built).
2.  Start the Python Backend on `http://localhost:8000`.

## Access

Open `http://localhost:8000` in your browser.
