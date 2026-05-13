"""
APIG Bridge — Serial + HTTP + WebSocket
========================================
Single source of truth: STM32 UART → bridge → website.
OLED and website show identical values because both
read from the same STM32 noisy_walk output.

When STM32 is NOT connected, bridge uses its own
NoisyWalk (same parameters as main.c) as fallback.

SETUP:
  pip install pyserial websockets

USAGE:
  1. Set SERIAL_PORT below (e.g. COM3)
  2. python bridge.py
  3. Open http://localhost:5500 in browser
"""

import asyncio, json, threading, time, os, random, functools
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    import serial, serial.tools.list_ports
    SERIAL_OK = True
except ImportError:
    SERIAL_OK = False
    print("[!] pip install pyserial")

try:
    import websockets
    WS_OK = True
except ImportError:
    WS_OK = False
    print("[!] pip install websockets")

# ── CONFIG ────────────────────────────────────────────────
SERIAL_PORT = "COM3"      # ← change to your port
BAUD_RATE   = 115200
HTTP_PORT   = 5500
WS_PORT     = 8765
# ─────────────────────────────────────────────────────────

# Shared latest reading — this is what the website gets
latest = {
    "no2In":    89.0,
    "no2Out":   23.0,
    "temp":     33.0,
    "pressure": 1007.0,
    "humidity": 75.0,
    "uvActive": True,
}
lock = threading.Lock()
serial_connected = False   # True only when STM32 is actively sending


# ── FALLBACK NOISE WALKER ─────────────────────────────────
# Identical parameters to main.c noisy_walk()
# Only runs when serial is disconnected
class NoisyWalk:
    def __init__(self, start, lo, hi, noise_step, target_step):
        self.v   = start
        self.lo  = lo
        self.hi  = hi
        self.ns  = noise_step
        self.ts  = target_step
        self.tgt = start
        self.cnt = 0

    def step(self):
        self.cnt += 1
        if self.cnt >= 8:
            self.cnt = 0
            span = (self.hi - self.lo) * 0.8
            self.tgt = self.lo + (self.hi - self.lo) * 0.1 + random.random() * span
        self.v += self.ts if self.v < self.tgt else -self.ts
        self.v += (random.random() * 2 - 1) * self.ns
        self.v  = max(self.lo, min(self.hi, self.v))
        return round(self.v, 1)

w_no2in  = NoisyWalk(89.0,   78.0,   102.0,  1.2,  0.8)
w_no2out = NoisyWalk(23.0,   18.0,    30.0,  0.6,  0.4)
w_temp   = NoisyWalk(33.0,   31.5,    35.0,  0.3,  0.2)
w_hum    = NoisyWalk(75.0,   70.0,    80.0,  0.8,  0.5)
w_pres   = NoisyWalk(1007.0, 1005.5, 1008.5, 0.2,  0.15)

def fallback_step():
    """Only called when STM32 is not connected."""
    no2in  = w_no2in.step()
    no2out = w_no2out.step()
    if no2out >= no2in * 0.40:
        no2out = round(no2in * 0.35, 1)
    with lock:
        latest["no2In"]    = no2in
        latest["no2Out"]   = no2out
        latest["temp"]     = w_temp.step()
        latest["humidity"] = w_hum.step()
        latest["pressure"] = w_pres.step()
        latest["uvActive"] = True


# ── SERIAL LINE PARSER ────────────────────────────────────
# Parses: NO2:89.3,NO2OUT:23.1,TEMP:33.2,PRES:1007.1,HUM:75.4,UV:1
def parse_line(line):
    line = line.strip()
    if not line:
        return None
    result = {}
    try:
        for part in line.split(","):
            if ":" not in part:
                continue
            k, v = part.split(":", 1)
            k = k.strip().upper()
            v = v.strip()
            if   k == "NO2":                 result["no2In"]    = float(v)
            elif k in ("NO2OUT", "NO2_OUT"): result["no2Out"]   = float(v)
            elif k == "TEMP":                result["temp"]     = float(v)
            elif k in ("PRES", "PRESSURE"):  result["pressure"] = float(v)
            elif k in ("HUM", "HUMIDITY"):   result["humidity"] = float(v)
            elif k == "UV":                  result["uvActive"] = (v == "1")
        return result if result else None
    except Exception:
        return None


# ── SERIAL READER THREAD ──────────────────────────────────
def serial_reader():
    global serial_connected

    if not SERIAL_OK:
        print("[Serial] pyserial not installed — running on fallback only")
        return

    print(f"\n[Serial] Ports available:")
    for p in serial.tools.list_ports.comports():
        print(f"         {p.device}  {p.description}")
    print(f"[Serial] Connecting to {SERIAL_PORT} @ {BAUD_RATE}...\n")

    while True:
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2) as ser:
                serial_connected = True
                print(f"[Serial] Connected — receiving live STM32 data\n")
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="ignore")
                    parsed = parse_line(line)
                    if parsed:
                        # ONLY place latest gets updated when serial is live.
                        # These are the exact same numbers the OLED shows.
                        with lock:
                            latest.update(parsed)
                        d = latest
                        print(f"  STM32 → "
                              f"NO2in={d['no2In']:.1f}  "
                              f"NO2out={d['no2Out']:.1f}  "
                              f"T={d['temp']:.1f}C  "
                              f"H={d['humidity']:.0f}%  "
                              f"P={d['pressure']:.0f}hPa  "
                              f"UV={'ON' if d['uvActive'] else 'OFF'}")

        except Exception as e:
            if serial_connected:
                print(f"\n[Serial] Lost connection — {e}")
                print("[Serial] Switching to fallback...\n")
            serial_connected = False
            time.sleep(3)


# ── FALLBACK THREAD ───────────────────────────────────────
def fallback_runner():
    while True:
        if not serial_connected:
            fallback_step()
        time.sleep(1)


# ── WEBSOCKET ─────────────────────────────────────────────
connected_browsers = set()

async def ws_handler(websocket, path=None):
    connected_browsers.add(websocket)
    print(f"[WS]    Browser connected  (total: {len(connected_browsers)})")
    try:
        # Send immediately on connect so dashboard isn't blank
        with lock:
            await websocket.send(json.dumps(dict(latest)))
        while True:
            await asyncio.sleep(1)
            with lock:
                payload = json.dumps(dict(latest))
            await websocket.send(payload)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_browsers.discard(websocket)
        print(f"[WS]    Browser disconnected (total: {len(connected_browsers)})")


# ── HTTP SERVER ───────────────────────────────────────────
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def run_http():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(QuietHandler, directory=os.getcwd())
    httpd   = HTTPServer(("localhost", HTTP_PORT), handler)
    print(f"[HTTP]  http://localhost:{HTTP_PORT}")
    httpd.serve_forever()


# ── MAIN ──────────────────────────────────────────────────
async def main():
    print("=" * 52)
    print("  APIG Bridge")
    print("=" * 52)
    print(f"  Serial  : {SERIAL_PORT} @ {BAUD_RATE}")
    print(f"  Website : http://localhost:{HTTP_PORT}")
    print(f"  WS      : ws://localhost:{WS_PORT}")
    print()

    threading.Thread(target=run_http,        daemon=True).start()
    threading.Thread(target=serial_reader,   daemon=True).start()
    threading.Thread(target=fallback_runner, daemon=True).start()

    print(f"[WS]    Starting WebSocket...")
    print(f"\n{'='*52}")
    print(f"  Open:  http://localhost:{HTTP_PORT}")
    print(f"{'='*52}\n")

    async with websockets.serve(ws_handler, "localhost", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Bridge] Stopped.")