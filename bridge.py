"""
bridge.py — STM32 → WebSocket bridge
Air Pollution Intervention Grid

Reads one UART line per second from the STM32, parses it, and
broadcasts JSON to every connected browser over WebSocket.

Expected STM32 line format (NO trailing spaces, \n terminated):
  NO2:182.50,MQ1:1.23,MQ2:0.87,TEMP:28.4,HUM:58.0,UV:1

Install once:
  pip install pyserial websockets

Run:
  python bridge.py                        # auto-detect COM port
  python bridge.py --port COM3            # Windows
  python bridge.py --port /dev/ttyUSB0   # Linux / Mac
"""

import asyncio
import json
import re
import sys
import time
import argparse
import serial
import serial.tools.list_ports
import websockets

# ── Config ────────────────────────────────────────────────────────────────────

WS_HOST = "localhost"
WS_PORT = 8765          # ws://localhost:8765  — must match script.js
BAUD    = 115200
TIMEOUT = 2             # serial read timeout seconds

# ── Globals ───────────────────────────────────────────────────────────────────

connected_clients: set = set()

# Last good reading (sent to newly-connecting clients immediately)
last_payload: dict = {
    "NO2":  0.0,
    "MQ1":  0.0,
    "MQ2":  0.0,
    "TEMP": 0.0,
    "HUM":  0.0,
    "UV":   0,
    "ts":   0,
    "raw":  "",
}

# ── Serial port auto-detection ────────────────────────────────────────────────

def find_stm32_port() -> str | None:
    """Return the first port that looks like an STM32 Virtual COM Port."""
    for p in serial.tools.list_ports.comports():
        desc = (p.description or "").lower()
        mfr  = (p.manufacturer or "").lower()
        if any(k in desc or k in mfr for k in ("stm", "st link", "stlink", "virtual com")):
            print(f"[bridge] Auto-detected STM32 on {p.device} ({p.description})")
            return p.device
    return None

# ── UART line parser ──────────────────────────────────────────────────────────

def parse_line(line: str) -> dict | None:
    """
    Parse a line like:
      NO2:182.50,MQ1:1.23,MQ2:0.87,TEMP:28.4,HUM:58.0,UV:1

    Returns a dict or None if the line doesn't match.
    """
    line = line.strip()
    if not line:
        return None

    # Accept any order of keys, ignore unknown keys
    pattern = r'([A-Z0-9]+):([-\d.]+)'
    pairs = re.findall(pattern, line)
    if not pairs:
        return None

    d = {k: v for k, v in pairs}
    required = {"NO2", "MQ1", "MQ2", "TEMP", "HUM", "UV"}
    if not required.issubset(d.keys()):
        print(f"[bridge] Incomplete line (missing keys): {line}")
        return None

    try:
        return {
            "NO2":  round(float(d["NO2"]),  2),
            "MQ1":  round(float(d["MQ1"]),  2),
            "MQ2":  round(float(d["MQ2"]),  2),
            "TEMP": round(float(d["TEMP"]), 1),
            "HUM":  round(float(d["HUM"]),  1),
            "UV":   int(float(d["UV"])),
            "ts":   int(time.time() * 1000),   # ms epoch for JS
            "raw":  line,
        }
    except ValueError as e:
        print(f"[bridge] Parse error: {e} — line: {line}")
        return None

# ── WebSocket handler ─────────────────────────────────────────────────────────

async def ws_handler(websocket):
    """Handle one browser connection."""
    addr = websocket.remote_address
    print(f"[ws] Client connected: {addr}")
    connected_clients.add(websocket)

    # Send the last known reading immediately so the dashboard isn't blank
    try:
        await websocket.send(json.dumps(last_payload))
    except Exception:
        pass

    try:
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print(f"[ws] Client disconnected: {addr}")

async def broadcast(payload: dict):
    """Send JSON payload to all connected browsers."""
    if not connected_clients:
        return
    msg = json.dumps(payload)
    # asyncio.gather ignores errors from individual sends
    await asyncio.gather(
        *[c.send(msg) for c in list(connected_clients)],
        return_exceptions=True,
    )

# ── Serial reader (runs in a thread) ─────────────────────────────────────────

def read_serial_forever(port: str, loop: asyncio.AbstractEventLoop):
    """
    Blocking serial reader — runs in a background thread.
    Parses lines and schedules broadcast on the asyncio event loop.
    """
    global last_payload

    while True:
        try:
            print(f"[serial] Opening {port} @ {BAUD} baud …")
            with serial.Serial(port, BAUD, timeout=TIMEOUT) as ser:
                print(f"[serial] Connected. Waiting for data …")
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue  # timeout, try again
                    line = raw.decode("utf-8", errors="replace")
                    payload = parse_line(line)
                    if payload:
                        last_payload = payload
                        print(f"[serial] {payload}")
                        asyncio.run_coroutine_threadsafe(broadcast(payload), loop)

        except serial.SerialException as e:
            print(f"[serial] Error: {e}. Retrying in 3 s …")
            time.sleep(3)

# ── Entry point ───────────────────────────────────────────────────────────────

async def main(port: str):
    import threading

    loop = asyncio.get_running_loop()

    # Start serial reader in background thread
    t = threading.Thread(
        target=read_serial_forever,
        args=(port, loop),
        daemon=True,
    )
    t.start()

    # Start WebSocket server
    print(f"[ws] Listening on ws://{WS_HOST}:{WS_PORT}")
    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        await asyncio.Future()   # run forever

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="STM32 → WebSocket bridge")
    parser.add_argument("--port", default=None,
                        help="Serial port, e.g. COM3 or /dev/ttyUSB0")
    args = parser.parse_args()

    port = args.port or find_stm32_port()
    if not port:
        # Last resort: list available ports and ask user
        ports = [p.device for p in serial.tools.list_ports.comports()]
        if ports:
            print("Available serial ports:")
            for i, p in enumerate(ports):
                print(f"  [{i}] {p}")
            choice = input("Enter port number or full name: ").strip()
            port = ports[int(choice)] if choice.isdigit() else choice
        else:
            print("ERROR: No serial ports found. Is the STM32 plugged in?")
            sys.exit(1)

    try:
        asyncio.run(main(port))
    except KeyboardInterrupt:
        print("\n[bridge] Stopped.")