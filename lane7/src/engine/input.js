/* ===================================================================
   Input. Pointer events (mouse, touch, pen) and the keyboard collapse
   into ONE action — fire(x, y, timestamp) in design units. Nothing
   downstream knows or cares what device produced it, so a gamepad is
   one more listener here and zero changes anywhere else.

   `ev.timeStamp` is used instead of performance.now(): it is stamped
   when the OS delivered the event, a few ms before our handler runs,
   and it shares a time origin with requestAnimationFrame — which is
   what lets the Sim judge the duel on a single clock.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  class Input {
    constructor(el, canvas, W, H, onFire) {
      this.canvas = canvas; this.W = W; this.H = H;
      this.mouse = { x: W / 2, y: H * 0.5 };
      this.enabled = true;

      const toDesign = (ev) => {
        const r = canvas.getBoundingClientRect();
        return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
      };
      const stamp = (ev) => (ev.timeStamp && ev.timeStamp > 0 ? ev.timeStamp : performance.now());

      el.addEventListener("pointerdown", (ev) => {
        if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === "mouse") return;
        ev.preventDefault();
        if (!this.enabled) return;
        const p = toDesign(ev);
        onFire({ x: p.x, y: p.y, ts: stamp(ev), source: ev.pointerType || "pointer" });
      }, { passive: false });

      el.addEventListener("pointermove", (ev) => { this.mouse = toDesign(ev); }, { passive: true });
      el.addEventListener("contextmenu", (ev) => ev.preventDefault());

      document.addEventListener("keydown", (ev) => {
        if (ev.code !== "Space" && ev.code !== "Enter") return;
        ev.preventDefault();
        if (ev.repeat || !this.enabled) return;
        // Keyboard has no aim point of its own: it fires where the mouse is.
        onFire({ x: this.mouse.x, y: this.mouse.y, ts: stamp(ev), source: "key" });
      });
    }
  }
  L7.Input = Input;
})();
