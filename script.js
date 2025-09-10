async function loadData() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || !Array.isArray(json.semesters) || !Array.isArray(json.links)) {
      throw new Error("data.json inválido: falta semesters[] o links[]");
    }
    return json;
  } catch (err) {
    console.warn("No se pudo cargar data.json. Motivo:", err.message);
    // Fallback mínimo para no dejar 'data' undefined
    return { semesters: [], links: [] };
  }
}

/**************************************
 * 2) RENDER: GRID + CARDS + ARROWS   *
 **************************************/
const $grid = document.getElementById("grid");
const $svg = document.getElementById("wires");
const $canvas = document.getElementById("canvas");
const $panel = document.getElementById("panel");
const $search = document.getElementById("search");
const $toggleAll = document.getElementById("toggleAll");
const $toggleTrans = document.getElementById("toggleTransitive");
const $file = document.getElementById("fileInput");
const $export = document.getElementById("btnExport");

let data;

(async function init() {
  data = await loadData();
  render();
})();

let idToEl = new Map();

function render() {
  if (!data || !Array.isArray(data.semesters)) {
    console.error('Data no cargada o mal formada:', data);
    return;
  }

  $grid.innerHTML = "";
  idToEl.clear();

  for (const col of data.semesters) {
    const $col = document.createElement("div");
    $col.className = "col";
    const $title = document.createElement("div");
    $title.className = "title";
    $title.textContent = col.name || col.key;
    $col.appendChild($title);

    for (const c of col.courses) {
      const $c = document.createElement("article");
      $c.className = "course";
      $c.tabIndex = 0;
      $c.dataset.id = c.id;
      if (c.type) { $c.dataset.type = c.type.toUpperCase(); }
      $c.innerHTML = `
          <div class="name">${c.title}</div>
          <div class="meta">
            ${c.credits ? `<span class="chip">${c.credits} cr</span>` : ""}
            ${c.type ? `<span class="chip type">${c.type.toUpperCase()}</span>` : ""}
          </div>
        `;
      $c.addEventListener("click", () => selectCourse(c.id));
      $c.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectCourse(c.id);
        }
      });
      idToEl.set(c.id, $c);
      $col.appendChild($c);
    }
    $grid.appendChild($col);
  }

  drawAllEdges();
}

function ensureDefs() {
  let defs = $svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    $svg.appendChild(defs);
    const mk = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    mk.setAttribute("viewBox", "0 0 10 10");
    mk.setAttribute("refX", "10");
    mk.setAttribute("refY", "5");
    mk.setAttribute("markerWidth", "8");
    mk.setAttribute("markerHeight", "8");
    mk.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("fill", "currentColor");
    mk.appendChild(path);
    defs.appendChild(mk);
  }
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  const rc = $canvas.getBoundingClientRect();
  return {
    x: r.left - rc.left + $canvas.scrollLeft,
    y: r.top - rc.top + $canvas.scrollTop,
    w: r.width,
    h: r.height,
  };
}

function edgePoints(fromEl, toEl) {
  const a = rectOf(fromEl);
  const b = rectOf(toEl);
  const x1 = a.x + a.w; // derecha del prereq
  const y1 = a.y + a.h / 2;
  const x2 = b.x; // izquierda del curso
  const y2 = b.y + b.h / 2;
  return { x1, y1, x2, y2 };
}

function bezier({ x1, y1, x2, y2 }) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.35);
  const c1x = x1 + dx,
    c1y = y1;
  const c2x = x2 - dx,
    c2y = y2;
  return `M ${x1},${y1} C ${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
}

function drawAllEdges() {
  ensureDefs();
  const W = $canvas.scrollWidth;
  const H = $canvas.scrollHeight;
  $svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  $svg.setAttribute("width", W);
  $svg.setAttribute("height", H);

  // Clear
  $svg.querySelectorAll("path.edge").forEach((p) => p.remove());

  // Draw base edges
  for (const link of data.links) {
    const fromEl = idToEl.get(link.from);
    const toEl = idToEl.get(link.to);
    if (!fromEl || !toEl) continue; // data mismatch
    const P = edgePoints(fromEl, toEl);
    const $p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    $p.setAttribute("d", bezier(P));
    $p.setAttribute("class", "edge");
    $p.dataset.from = link.from;
    $p.dataset.to = link.to;
    $p.dataset.type = link.type || "prereq";
    $p.setAttribute("fill", "none");
    $p.setAttribute("stroke", "currentColor");
    $p.setAttribute("stroke-width", "2");
    $p.style.color =
      link.type === "coreq"
        ? "var(--coreq)"
        : $toggleAll.checked
        ? "var(--edge)"
        : "transparent";
    $svg.appendChild($p);
  }
}

// Selection + highlight
function upLinks(toId) {
  // devuelve prerequisitos directos
  return data.links.filter((l) => l.to === toId);
}

function upLinksTransitive(toId, acc = new Set(), edges = []) {
  for (const l of data.links) {
    if (l.to === toId && !acc.has(l.from)) {
      acc.add(l.from);
      edges.push(l);
      upLinksTransitive(l.from, acc, edges);
    }
  }
  return { nodes: acc, edges };
}

function clearState() {
  document.querySelectorAll(".course").forEach((el) => {
    el.classList.remove("selected", "prereq", "coreq");
    el.style.opacity = "";
  });
  $svg.querySelectorAll("path.edge").forEach((p) => {
    p.style.color =
      p.dataset.type === "coreq"
        ? "var(--coreq)"
        : $toggleAll.checked
        ? "var(--edge)"
        : "transparent";
    p.style.strokeWidth = 2;
    p.style.opacity = 1;
  });
  $panel.innerHTML = "";
}

function selectCourse(id) {
  clearState();
  const selected = idToEl.get(id);
  if (!selected) {
    return;
  }
  selected.classList.add("selected");

  const edgesDirect = upLinks(id);
  const trans = $toggleTrans.checked
    ? upLinksTransitive(id)
    : { nodes: new Set(edgesDirect.map((e) => e.from)), edges: edgesDirect };

  // Mark courses
  for (const nid of trans.nodes) {
    const el = idToEl.get(nid);
    if (el) {
      el.classList.add("prereq");
    }
  }

  // Highlight edges
  const setActive = new Set();
  for (const e of trans.edges) {
    setActive.add(`${e.from}->${e.to}`);
  }

  $svg.querySelectorAll("path.edge").forEach((p) => {
    const key = `${p.dataset.from}->${p.dataset.to}`;
    if (setActive.has(key)) {
      p.style.color = "var(--edge-active)";
      p.style.strokeWidth = 3.5;
    } else if (!$toggleAll.checked) {
      p.style.opacity = 0.15;
    }
  });

  // Info side panel
  const list = [...trans.nodes]
    .map((nid) => {
      const card = findCourse(nid);
      const type =
        data.links.find((l) => l.from === nid && l.to === id)?.type || "prereq";
      return { id: nid, title: card?.title || nid, type };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function findCourse(id) {
  for (const s of data.semesters) {
    const c = s.courses.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

// Search filter
$search.addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    document
      .querySelectorAll(".course")
      .forEach((el) => (el.style.opacity = 1));
    return;
  }
  document.querySelectorAll(".course").forEach((el) => {
    const ok = el.textContent.toLowerCase().includes(q);
    el.style.opacity = ok ? 1 : 0.15;
  });
});

// Toggles
$toggleAll.addEventListener("change", () => {
  drawAllEdges();
});
$toggleTrans.addEventListener("change", () => {
  const sel = document.querySelector(".course.selected");
  if (sel) selectCourse(sel.dataset.id);
});

// Export JSON
$export.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pensum.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

// Import JSON/CSV
$file.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    if (file.name.endsWith(".json")) {
      const obj = JSON.parse(text);
      if (!obj.semesters || !obj.links)
        throw new Error("JSON sin {semesters, links}");
      data = obj;
    } else {
      // CSV sencillo: detecta si es courses.csv o links.csv por columnas
      const rows = parseCSV(text);
      const header = rows[0].map((x) => x.toLowerCase());
      if (
        header.includes("semester") &&
        header.includes("id") &&
        header.includes("title")
      ) {
        // build semesters dynamically from CSV
        const bySem = new Map();
        for (let i = 1; i < rows.length; i++) {
          const r = objFrom(header, rows[i]);
          const key = (r.semester || "").toString();
          if (!bySem.has(key))
            bySem.set(key, { key, name: `Semestre ${key}`, courses: [] });
          bySem.get(key).courses.push({
            id: r.id,
            title: r.title,
            credits: r.credits ? Number(r.credits) : undefined,
          });
        }
        data.semesters = [...bySem.values()].sort((a, b) =>
          a.key.localeCompare(b.key)
        );
      } else if (header.includes("from") && header.includes("to")) {
        const links = [];
        for (let i = 1; i < rows.length; i++) {
          const r = objFrom(header, rows[i]);
          links.push({
            from: r.from,
            to: r.to,
            type: (r.type || "prereq").toLowerCase(),
          });
        }
        data.links = links;
      } else {
        alert(
          "CSV no reconocido. Usa courses.csv (semester,id,title,credits) o links.csv (from,to,type)"
        );
        return;
      }
    }
    render();
    clearState();
  } catch (err) {
    console.error(err);
    alert("Error leyendo archivo: " + err.message);
  } finally {
    e.target.value = "";
  }
});

// CSV tiny parser
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else cell += ch;
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        pushCell();
      } else if (ch === "\n") {
        pushCell();
        rows.push(row);
        row = [];
      } else if (ch === "\r") {
        /* skip */
      } else cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    pushCell();
    rows.push(row);
  }
  return rows.filter((r) => r.length && r.some((x) => x !== ""));
}
function objFrom(header, row) {
  const o = {};
  for (let i = 0; i < header.length; i++) {
    o[header[i]] = row[i];
  }
  return o;
}

// Redraw on resize / scroll
const redraw = () => {
  drawAllEdges();
  const sel = document.querySelector(".course.selected");
  if (sel) selectCourse(sel.dataset.id);
};
window.addEventListener("resize", () => requestAnimationFrame(redraw));
$canvas.addEventListener("scroll", () => requestAnimationFrame(redraw));


// Tip inicial: seleccionar algo por defecto
setTimeout(() => {
  if (idToEl.has("AERODINAMICA")) selectCourse("AERODINAMICA");
}, 300);