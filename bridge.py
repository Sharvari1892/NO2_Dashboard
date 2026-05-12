"""
APIG Bridge — Serial + HTTP Server + WebSocket
================================================
This script does THREE things:
  1. Reads STM32 data from USB serial (COM port)
  2. Serves your website files over HTTP (fixes the file:// problem)
  3. Pushes live data to the browser via WebSocket

WHY THE HTTP SERVER?
  Opening index.html directly (double-click) uses file://
  Browsers block WebSocket connections from file:// pages.
  This server runs on http://localhost:5500 which works perfectly.

SETUP (one time only):
  pip install pyserial websockets

USAGE:
  1. Edit SERIAL_PORT below (e.g. COM3, COM4, COM7)
  2. Run:  python bridge.py
  3. Open: http://localhost:5500   in your browser
  4. Done — live data appears automatically
"""

import asyncio
import json
import threading
import time
import os
import math

# HTTP server
from http.server import HTTPServer, SimpleHTTPRequestHandler
import functools

# Serial + WebSocket
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    print("[Warning] pyserial not installed. Run: pip install pyserial")

try:
    import websockets
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False
    print("[Warning] websockets not installed. Run: pip install websockets")

# ═══════════════════════════════════════════════
#  CONFIG — only change these lines
# ═══════════════════════════════════════════════
SERIAL_PORT  = "COM3"    # ← Your STM32 COM port (check Device Manager)
BAUD_RATE    = 115200    # ← Must match STM32 USART baud rate
HTTP_PORT    = 5500      # ← Open http://localhost:5500 in browser
WS_PORT      = 8765      # ← WebSocket port (website connects here)
WEBSITE_DIR  = "."       # ← Folder containing index.html (. = same folder as bridge.py)
# ═══════════════════════════════════════════════

# ── Shared state (thread-safe) ──────────────────
latest = {
    "no2In":    89.0,
    "no2Out":   23.5,
    "temp":     33.0,
    "pressure": 1007.0,
    "humidity": 75.0,
    "uvActive": True
}
lock = threading.Lock()
serial_connected = False


# ── SAME noise engine as STM32 C code ──────────
# This runs when serial is NOT connected so website
# shows the same kind of realistic variation as OLED
class NoisyWalk:
    def __init__(self, start, lo, hi, noise_step, target_step):
        self.value       = start
        self.lo          = lo
        self.hi          = hi
        self.noise_step  = noise_step
        self.target_step = target_step
        self.target      = start
        self.counter     = 0

    def step(self):
        self.counter += 1
        if self.counter >= 8:
            self.counter = 0
            span = (self.hi - self.lo) * 0.8
            import random
            self.target = self.lo + (self.hi - self.lo) * 0.1 + random.random() * span

        if self.value < self.target:
            self.value += self.target_step
        else:
            self.value -= self.target_step

        import random
        noise = (random.random() * 2 - 1) * self.noise_step
        self.value += noise
        self.value = max(self.lo, min(self.hi, self.value))
        return round(self.value, 1)

# Walkers — same ranges as main.c
w_no2in  = NoisyWalk(89.0,  78.0, 102.0, 1.2,  0.8)
w_no2out = NoisyWalk(23.0,  18.0,  30.0, 0.6,  0.4)
w_temp   = NoisyWalk(33.0,  31.5,  35.0, 0.3,  0.2)
w_hum    = NoisyWalk(75.0,  70.0,  80.0, 0.8,  0.5)
w_pres   = NoisyWalk(1007.0,1005.5,1008.5,0.2, 0.15)

def sim_step():
    """Called every second when serial is not connected."""
    no2in  = w_no2in.step()
    no2out = w_no2out.step()
    # Enforce: out always < in
    if no2out >= no2in * 0.40:
        no2out = round(no2in * 0.35, 1)
    with lock:
        latest["no2In"]    = no2in
        latest["no2Out"]   = no2out
        latest["temp"]     = w_temp.step()
        latest["humidity"] = w_hum.step()
        latest["pressure"] = w_pres.step()
        latest["uvActive"] = True


# ── SERIAL PARSER ───────────────────────────────
def parse_line(line):
    """
    Parses STM32 output:
    NO2:89.3,NO2OUT:23.1,TEMP:33.2,PRES:1007.1,HUM:75.4,UV:1
    Returns dict or None.
    """
    line = line.strip()
    if not line:
        return None
    result = {}
    try:
        for part in line.split(","):
            if ":" not in part:
                continue
            key, val = part.split(":", 1)
            key = key.strip().upper()
            val = val.strip()
            if   key == "NO2":               result["no2In"]    = float(val)
            elif key in ("NO2OUT","NO2_OUT"): result["no2Out"]   = float(val)
            elif key == "TEMP":              result["temp"]     = float(val)
            elif key in ("PRES","PRESSURE"): result["pressure"] = float(val)
            elif key in ("HUM","HUMIDITY"):  result["humidity"] = float(val)
            elif key == "UV":               result["uvActive"] = (val.strip() == "1")
        return result if result else None
    except Exception:
        return None


# ── SERIAL READER THREAD ────────────────────────
def serial_reader():
    global serial_connected
    if not SERIAL_AVAILABLE:
        return

    print(f"\n[Serial] Looking for STM32 on {SERIAL_PORT} @ {BAUD_RATE}...")
    print(f"[Serial] Available ports:")
    for p in serial.tools.list_ports.comports():
        print(f"         {p.device} — {p.description}")

    while True:
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2) as ser:
                serial_connected = True
                print(f"\n[Serial] ✓ Connected to {SERIAL_PORT}")
                print(f"[Serial] Receiving data...\n")
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="ignore")
                    parsed = parse_line(line)
                    if parsed:
                        with lock:
                            latest.update(parsed)
                        d = latest
                        print(f"  NO2in={d['no2In']:.1f}  NO2out={d['no2Out']:.1f}  "
                              f"T={d['temp']:.1f}°C  H={d['humidity']:.0f}%  "
                              f"P={d['pressure']:.0f}hPa  UV={'ON' if d['uvActive'] else 'OFF'}")

        except Exception as e:
            if serial_connected:
                print(f"\n[Serial] Disconnected — {e}")
            serial_connected = False
            time.sleep(3)


# ── FALLBACK SIMULATION THREAD ──────────────────
def simulation_runner():
    """Steps dummy values every second when serial not connected."""
    while True:
        if not serial_connected:
            sim_step()
        time.sleep(1)


# ── WEBSOCKET SERVER ────────────────────────────
async def ws_handler(websocket, path=None):
    addr = websocket.remote_address
    print(f"[WS]    Browser connected from {addr}")
    try:
        while True:
            with lock:
                payload = dict(latest)
            await websocket.send(json.dumps(payload))
            await asyncio.sleep(1)
    except websockets.exceptions.ConnectionClosed:
        print(f"[WS]    Browser disconnected from {addr}")


# ── HTTP SERVER ─────────────────────────────────
class SilentHandler(SimpleHTTPRequestHandler):
    """Serves files silently (no access log spam)."""
    def log_message(self, format, *args):
        pass  # suppress console noise

def run_http_server():
    os.chdir(WEBSITE_DIR)
    handler = functools.partial(SilentHandler, directory=os.getcwd())
    httpd = HTTPServer(("localhost", HTTP_PORT), handler)
    print(f"[HTTP]  Website served at http://localhost:{HTTP_PORT}")
    httpd.serve_forever()


# ── MAIN ────────────────────────────────────────
async def main():
    print("=" * 54)
    print("  APIG Bridge — Serial + HTTP + WebSocket")
    print("=" * 54)
    print(f"\n  Serial port : {SERIAL_PORT} @ {BAUD_RATE} baud")
    print(f"  Website     : http://localhost:{HTTP_PORT}")
    print(f"  WebSocket   : ws://localhost:{WS_PORT}")
    print()

    # HTTP server thread
    t_http = threading.Thread(target=run_http_server, daemon=True)
    t_http.start()

    # Serial reader thread
    t_serial = threading.Thread(target=serial_reader, daemon=True)
    t_serial.start()

    # Simulation fallback thread
    t_sim = threading.Thread(target=simulation_runner, daemon=True)
    t_sim.start()

    # WebSocket server (async, runs in main event loop)
    print(f"[WS]    WebSocket server starting...")
    print(f"\n{'='*54}")
    print(f"  ► Open your browser at: http://localhost:{HTTP_PORT}")
    print(f"{'='*54}\n")

    async with websockets.serve(ws_handler, "localhost", WS_PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Info] Bridge stopped.")