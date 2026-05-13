"""
APIG Bridge — The single source of truth
=========================================
STM32 UART  →  bridge.py  →  WebSocket  →  website

OLED shows values computed in main.c noisy_walk().
Bridge reads those EXACT same bytes over UART and
sends them to the website — so both always match.

When STM32 is NOT connected, bridge sends its own
noisy_walk (same parameters as main.c) so the website
still looks live. But the moment STM32 reconnects,
bridge immediately switches back to real STM32 values.

SETUP (run once in Command Prompt):
    pip install pyserial websockets

USAGE:
    1. Edit SERIAL_PORT below  (e.g. COM3, COM4, COM7)
    2. python bridge.py
    3. Open http://localhost:5500 in Chrome/Edge
"""

import asyncio
import json
import threading
import time
import os
import random
import functools
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    import serial
    import serial.tools.list_ports
    SERIAL_OK = True
except ImportError:
    SERIAL_OK = False

try:
    import websockets
    WS_OK = True
except ImportError:
    WS_OK = False

# ═══════════════════════════════════════════
#  ← ONLY CHANGE THIS ONE LINE
# ═══════════════════════════════════════════
SERIAL_PORT = "COM3"
# ═══════════════════════════════════════════
BAUD_RATE = 115200
HTTP_PORT = 5500
WS_PORT   = 8765

# ── Single shared state ──────────────────────────────────────────────
# This dict is what BOTH the OLED and website show.
# When STM32 is connected → updated by serial_reader() from UART bytes.
# When STM32 is offline   → updated by fallback_runner() (same math as main.c).
latest = {
    "no2In":    89.0,
    "no2Out":   23.0,
    "temp":     33.0,
    "pressure": 1007.0,
    "humidity": 75.0,
    "uvActive": True,
}
lock = threading.Lock()
serial_connected = False   # flips to True only when UART bytes arrive

# ── Fallback noise walker (same parameters as main.c noisy_walk) ─────
class NoisyWalk:
    def __init__(self, start, lo, hi, noise_step, target_step):
        self.v   = float(start)
        self.lo  = lo;  self.hi = hi
        self.ns  = noise_step
        self.ts  = target_step
        self.tgt = float(start)
        self.cnt = 0

    def step(self):
        self.cnt += 1
        if self.cnt >= 8:
            self.cnt = 0
            span     = (self.hi - self.lo) * 0.8
            self.tgt = self.lo + (self.hi - self.lo) * 0.1 + random.random() * span
        self.v  += self.ts if self.v < self.tgt else -self.ts
        self.v  += (random.random() * 2 - 1) * self.ns
        self.v   = max(self.lo, min(self.hi, self.v))
        return round(self.v, 1)

# Identical ranges to main.c
_w_no2in  = NoisyWalk(89.0,   78.0,  102.0,  1.2, 0.8)
_w_no2out = NoisyWalk(23.0,   18.0,   30.0,  0.6, 0.4)
_w_temp   = NoisyWalk(33.0,   31.5,   35.0,  0.3, 0.2)
_w_hum    = NoisyWalk(75.0,   70.0,   80.0,  0.8, 0.5)
_w_pres   = NoisyWalk(1007.0, 1005.5, 1008.5, 0.2, 0.15)

def _fallback_step():
    no2in  = _w_no2in.step()
    no2out = _w_no2out.step()
    if no2out >= no2in * 0.40:
        no2out = round(no2in * 0.35, 1)
    with lock:
        latest["no2In"]    = no2in
        latest["no2Out"]   = no2out
        latest["temp"]     = _w_temp.step()
        latest["humidity"] = _w_hum.step()
        latest["pressure"] = _w_pres.step()
        latest["uvActive"] = True

# ── UART line parser ─────────────────────────────────────────────────
# Handles: NO2:89.3,NO2OUT:23.1,TEMP:33.2,PRES:1007.1,HUM:75.4,UV:1
def _parse(line):
    line = line.strip()
    if not line:
        return None
    out = {}
    try:
        for part in line.split(","):
            if ":" not in part:
                continue
            k, v = part.split(":", 1)
            k = k.strip().upper();  v = v.strip()
            if   k == "NO2":                  out["no2In"]    = float(v)
            elif k in ("NO2OUT","NO2_OUT"):   out["no2Out"]   = float(v)
            elif k == "TEMP":                 out["temp"]     = float(v)
            elif k in ("PRES","PRESSURE"):    out["pressure"] = float(v)
            elif k in ("HUM","HUMIDITY"):     out["humidity"] = float(v)
            elif k == "UV":                   out["uvActive"] = (v == "1")
    except Exception:
        return None
    return out if out else None

# ── Serial reader thread ─────────────────────────────────────────────
def serial_reader():
    global serial_connected
    if not SERIAL_OK:
        print("[Serial] pyserial missing — pip install pyserial")
        return

    print("\n[Serial] Available COM ports:")
    for p in serial.tools.list_ports.comports():
        print(f"         {p.device}  —  {p.description}")
    print(f"[Serial] Trying {SERIAL_PORT} @ {BAUD_RATE}...\n")

    while True:
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2) as ser:
                serial_connected = True
                print(f"[Serial] ✓ Connected to {SERIAL_PORT}\n")
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    parsed = _parse(raw.decode("utf-8", errors="ignore"))
                    if parsed:
                        with lock:
                            # These are the EXACT bytes the OLED just displayed
                            latest.update(parsed)
                        d = latest
                        print(f"  LIVE  NO2in={d['no2In']:.1f}  "
                              f"NO2out={d['no2Out']:.1f}  "
                              f"T={d['temp']:.1f}C  "
                              f"H={d['humidity']:.0f}%  "
                              f"P={d['pressure']:.0f}  "
                              f"UV={'ON' if d['uvActive'] else 'OFF'}")
        except Exception as e:
            if serial_connected:
                print(f"\n[Serial] Lost: {e} — fallback active\n")
            serial_connected = False
            time.sleep(3)

# ── Fallback thread (only runs when STM32 offline) ───────────────────
def fallback_runner():
    while True:
        if not serial_connected:
            _fallback_step()
        time.sleep(1)   # 1 s — same as STM32 HAL_Delay(1000)

# ── WebSocket — pushes latest to browser every second ────────────────
async def _ws_handler(websocket, path=None):
    addr = websocket.remote_address
    print(f"[WS]    Browser connected from {addr}")
    try:
        # Send immediately on connect so page isn't blank
        with lock:
            await websocket.send(json.dumps(dict(latest)))
        while True:
            await asyncio.sleep(1)
            with lock:
                msg = json.dumps(dict(latest))
            await websocket.send(msg)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[WS]    Browser disconnected from {addr}")

# ── HTTP server — serves index.html, script.js, style.css ────────────
class _QuietHTTP(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass   # suppress per-request noise

def _run_http():
    # Serve from the folder that contains bridge.py (= your repo folder)
    folder = os.path.dirname(os.path.abspath(__file__))
    os.chdir(folder)
    handler = functools.partial(_QuietHTTP, directory=folder)
    HTTPServer(("localhost", HTTP_PORT), handler).serve_forever()

# ── Entry point ───────────────────────────────────────────────────────
async def main():
    print("=" * 50)
    print("  APIG Bridge")
    print("=" * 50)
    print(f"  Serial  : {SERIAL_PORT} @ {BAUD_RATE}")
    print(f"  Website : http://localhost:{HTTP_PORT}")
    print(f"  WS      : ws://localhost:{WS_PORT}")
    print()

    threading.Thread(target=_run_http,       daemon=True).start()
    threading.Thread(target=serial_reader,   daemon=True).start()
    threading.Thread(target=fallback_runner, daemon=True).start()

    print(f"[WS]    Starting WebSocket server...")
    print(f"\n{'='*50}")
    print(f"  ► Open browser at: http://localhost:{HTTP_PORT}")
    print(f"{'='*50}\n")

    async with websockets.serve(_ws_handler, "localhost", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Bridge] Stopped.")