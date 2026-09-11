/* ===================================================================
   Target geometry, in card-local units with the origin at the card's
   centre of rotation. ONE polygon serves both drawing and hit-testing,
   so what the player sees and what the game checks can never disagree.
   The curves of the silhouette's shoulders are flattened once here so
   the hit test is pure math with no canvas dependency — which is what
   lets the Sim run headless in Node for tests.
   =================================================================== */
var L7 = (typeof globalThis.L7 === "object") ? globalThis.L7 : (globalThis.L7 = {});

(function () {
  function quad(p0, p1, p2, steps, out) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
  }

  // Shoulders, torso, base — the classic silhouette card.
  const body = [[-20, -74], [20, -74]];
  quad([20, -74], [84, -62], [92, 4], 8, body);
  body.push([78, 126], [-78, 126], [-92, 4]);
  quad([-92, 4], [-84, -62], [-20, -74], 8, body);

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  L7.Shapes = {
    bodyPolygon: body,

    // Returns "head" | "body" | "card" | "miss" for a point in card-local units.
    zoneLocal(lx, ly, t) {
      const dx = lx, dy = ly - t.headY;
      if (dx * dx + dy * dy <= t.headR * t.headR) return "head";
      if (pointInPolygon(lx, ly, body)) return "body";
      if (Math.abs(lx) <= t.cardW / 2 && ly >= t.cardTop && ly <= t.cardTop + t.cardH) return "card";
      return "miss";
    },
    pointInPolygon
  };
})();

if (typeof module !== "undefined") module.exports = L7.Shapes;
