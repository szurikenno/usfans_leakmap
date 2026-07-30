const GEO_DATA = [...GEO_DATA_P1, ...GEO_DATA_P2, ...GEO_DATA_P3];

let map;
let markers;
let tileLayerHigh, tileLayerLow;
let markerCache = [];
let metadata = null;
let packagesSlider = null;
let dateSlider = null;
let __searchReportTimeout = null;
let lastFilters = {}; /* store last applied filters for zoom handling */

function filterPanel() {
  return {
    search: "",
    packagesRange: [1, 100],
    dateRange: [],
    dateRangeText: "",
    minimized: true,
    filteredCount: 0,
    totalCount: 0,
    totalWeight: 0,
    downloadOpen: false,
    position: { x: 24, y: 24 },
    dragging: false,
    offset: { x: 0, y: 0 },

    init() {
      if (typeof GEO_DATA === "undefined" || !GEO_DATA.length) {
        this.showError("Błąd ładowania danych");
        return;
      }

      metadata = calculateMetadata(GEO_DATA);
      this.totalCount = GEO_DATA.length;
      this.packagesRange = [1, metadata.maxPackages];
      this.dateRange = [metadata.minDate, metadata.maxDate];
      this.updateDateText();

      this.$nextTick(() => {
        initSliders.call(this);
        initMap();
        buildMarkerCache();
        updateMarkers({});
        hideLoading();

        // report a pageview to the tracking endpoint (keeps webhook secret on server)
        try {
          fetch('/track/pageview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: window.location.pathname }),
            keepalive: true,
          });
        } catch (e) {
          // ignore
        }
      });

      this.$watch("search", () => this.applyFilters());
    },

    startDrag(event) {
      // normalize event for mouse and touch
      const ev = event && event.touches && event.touches.length ? event.touches[0] : event;
      // if user clicked on a control inside panel, don't start dragging
      if (ev.target && ev.target.closest && ev.target.closest("button, input, .slider-container")) return;

      this.dragging = true;
      this.offset = {
        x: (ev.clientX || 0) - this.position.x,
        y: (ev.clientY || 0) - this.position.y,
      };

      document.body.style.userSelect = "none";

      const moveHandler = (e) => {
        if (!this.dragging) return;
        const pe = e && e.touches && e.touches.length ? e.touches[0] : e;
        const panel = document.getElementById("filter-panel");
        const maxX = window.innerWidth - panel.offsetWidth - 20;
        const maxY = window.innerHeight - panel.offsetHeight - 20;
        const clientX = pe.clientX || 0;
        const clientY = pe.clientY || 0;
        this.position = {
          x: Math.max(20, Math.min(maxX, clientX - this.offset.x)),
          y: Math.max(20, Math.min(maxY, clientY - this.offset.y)),
        };
      };

      const upHandler = () => {
        this.dragging = false;
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", moveHandler);
        document.removeEventListener("mouseup", upHandler);
        document.removeEventListener("touchmove", moveHandler);
        document.removeEventListener("touchend", upHandler);
      };

      document.addEventListener("mousemove", moveHandler);
      document.addEventListener("mouseup", upHandler);
      document.addEventListener("touchmove", moveHandler, { passive: false });
      document.addEventListener("touchend", upHandler);
    },


    applyFilters() {
      const filters = {
        search: String(this.search ?? "").toLowerCase().trim(),
        packagesMin: this.packagesRange[0],
        packagesMax: this.packagesRange[1],
        dateMin: this.dateRange[0],
        dateMax: this.dateRange[1],
      };

      updateMarkers(filters);
      // report search (debounced)
      if (filters.search) {
        if (__searchReportTimeout) clearTimeout(__searchReportTimeout);
        __searchReportTimeout = setTimeout(() => {
          try {
            fetch('/track/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ search: filters.search }),
              keepalive: true,
            });
          } catch (e) {}
        }, 800);
      }
    },

    resetFilters() {
      this.search = '';
      this.packagesRange = [1, metadata.maxPackages];
      this.dateRange = [metadata.minDate, metadata.maxDate];
      this.updateDateText();

      if (packagesSlider) {
        packagesSlider.set([1, metadata.maxPackages]);
      }
      if (dateSlider) {
        const minTs = new Date(metadata.minDate).getTime();
        const maxTs = new Date(metadata.maxDate).getTime();
        dateSlider.set([minTs, maxTs]);
      }

      this.applyFilters();
    },

    updateDateText() {
      if (this.dateRange.length === 2) {
        this.dateRangeText = `${formatDate(this.dateRange[0])} - ${formatDate(this.dateRange[1])}`;
      }
    },

    showError(msg) {
      const loading = document.getElementById("loading");
      const text = document.querySelector(".loading-text");
      if (text) text.textContent = msg;
      if (text) text.style.color = "#ef4444";
    },
  };
}

function initSliders() {
  const packagesEl = document.getElementById("packages-slider");
  if (packagesEl && metadata) {
    packagesSlider = packagesEl.noUiSlider;
    if (!packagesSlider) {
      packagesSlider = noUiSlider.create(packagesEl, {
        start: [1, metadata.maxPackages],
        connect: true,
        step: 1,
        range: {
          min: 1,
          max: metadata.maxPackages,
        },
        tooltips: [true, true],
        format: {
          to: (v) => Math.round(v),
          from: (v) => parseInt(v),
        },
      });

      packagesSlider.on("change", (values) => {
        this.packagesRange = values;
        this.applyFilters();
      });
    }
  }

  const dateEl = document.getElementById("date-slider");
  if (dateEl && metadata) {
    const minTs = new Date(metadata.minDate).getTime();
    const maxTs = new Date(metadata.maxDate).getTime();

    dateSlider = dateEl.noUiSlider;
    if (!dateSlider) {
      dateSlider = noUiSlider.create(dateEl, {
        start: [minTs, maxTs],
        connect: true,
        range: {
          min: minTs,
          max: maxTs,
        },
        tooltips: {
          to: (v) =>
            formatDate(new Date(parseInt(v)).toISOString().split("T")[0]),
        },
      });

      dateSlider.on("change", (values) => {
        this.dateRange = values.map(
          (v) => new Date(parseInt(v)).toISOString().split("T")[0],
        );
        this.updateDateText();
        this.applyFilters();
      });
    }
  }
}

function initMap() {
  map = L.map("map", {
    center: [52.0, 19.0],
    zoom: 6,
    minZoom: 4,
    maxZoom: 18,
  });

  const tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  tileLayerHigh = L.tileLayer(tileUrl, {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  });
  tileLayerHigh.addTo(map);

  // Low-res tile layer that requests tiles one zoom level lower (less detail) to reduce rendering cost
  const TileLayerLowRes = L.TileLayer.extend({
    getTileUrl: function(coords) {
      const z = this._getZoomForUrl();
      const lowZ = Math.max(0, z - 1);
      return L.Util.template(this._url, L.extend({ s: this._getSubdomain(coords), z: lowZ, x: coords.x, y: coords.y }, this.options));
    }
  });
  tileLayerLow = new TileLayerLowRes(tileUrl, { attribution: "© OpenStreetMap", maxZoom: 19 });

  // helper to switch tile quality based on zoom level
  function applyTileQuality(zoom) {
    const threshold = 13; // at or above this zoom use lower-quality tiles to keep everything loaded but lighter-weight
    try {
      if (zoom >= threshold) {
        if (map.hasLayer(tileLayerHigh)) map.removeLayer(tileLayerHigh);
        if (!map.hasLayer(tileLayerLow)) map.addLayer(tileLayerLow);
      } else {
        if (map.hasLayer(tileLayerLow)) map.removeLayer(tileLayerLow);
        if (!map.hasLayer(tileLayerHigh)) map.addLayer(tileLayerHigh);
      }
    } catch (e) {
      // ignore errors switching layers
    }
  }

  // apply initial quality and switch on zoom changes
  applyTileQuality(map.getZoom());
  map.on('zoomend', () => applyTileQuality(map.getZoom()));

  markers = L.markerClusterGroup({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    chunkedLoading: true,
    /* restored chunkInterval to previous, more stable value */
    chunkInterval: 100,
  });

  map.addLayer(markers);

  // Zoom handler removed — rely on default cluster behavior. UpdateMarkers will switch icons to a lower-quality variant when zoomed in to keep all markers loaded but lighter-weight.
}

function calculateMetadata(data) {
  let minDate = Infinity;
  let maxDate = -Infinity;
  let maxPackages = 0;

  data.forEach((item) => {
    if (!item.people) return;
    item.people.forEach((p) => {
      maxPackages = Math.max(maxPackages, p.total_packages || 0);
      if (p.shipments) {
        p.shipments.forEach((s) => {
          if (s.created_at) {
            const d = new Date(s.created_at).getTime();
            if (!isNaN(d)) {
              minDate = Math.min(minDate, d);
              maxDate = Math.max(maxDate, d);
            }
          }
        });
      }
    });
  });

  return {
    minDate: new Date(minDate).toISOString().split("T")[0],
    maxDate: new Date(maxDate).toISOString().split("T")[0],
    maxPackages: maxPackages,
  };
}

const markerIcon = L.icon({
  // use absolute path on the VPS where image is stored under /var/www/mojastrona/assets/images/
  // served URL (from site root): /assets/images/usfans.png
  iconUrl: "/assets/images/usfans.png",
  // optional retina version (place usfans@2x.png next to usfans.png on the VPS)
  iconRetinaUrl: "/assets/images/usfans@2x.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -30],
});


function buildMarkerCache() {
  GEO_DATA.forEach((item) => {
    if (!item.lat || !item.lon) return;

    const peopleCount = (item.people || []).length || 0;

    // If there's exactly one person at this location, use a lightweight green div icon showing '1'
    let m;
    if (peopleCount === 1) {
      const singleIcon = L.divIcon({
        className: 'single-marker',
        html: `<div class="single-marker-inner">${peopleCount}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16],
      });
      m = L.marker([item.lat, item.lon], { icon: singleIcon });
    } else {
      // fallback to default icon for other locations (keeps cluster behavior)
      m = L.marker([item.lat, item.lon], { icon: markerIcon });
    }

    m.bindPopup(() => buildPopupContent(item), {
      maxWidth: 360,
      minWidth: 280,
    });

    markerCache.push({ marker: m, data: item });
  });
}

function buildPopupContent(item) {
  const header = `
    <div class="popup-header">
      <div class="popup-address">${escapeHtml(item.address || "Adres nieznany")}</div>
      <div class="popup-location">${escapeHtml(item.postal_code || "")} ${escapeHtml(item.city || "")}${item.province ? `, ${escapeHtml(item.province)}` : ""}</div>
    </div>
  `;

  const people = (item.people || [])
    .map((person) => {
      const phone = person.phone || person.mobile || "";
      const shipmentsList = (person.shipments || [])
        .map(
          (s) => `
      <div class="popup-shipment">
        <div class="popup-shipment-order">${escapeHtml(s.order)}${s.tracking2 ? ` <span style="color:#888;font-weight:normal">(${escapeHtml(s.tracking2)})</span>` : ""}</div>
        <div class="popup-shipment-meta">${s.created_at ? escapeHtml(s.created_at.split(" ")[0]) : ""} | ${s.weight_kg} kg | ${s.package_count} ${s.package_count === 1 ? "paczka" : "paczek"}</div>
        ${s.products ? `<div style="font-size:10px;color:#999;margin-top:2px">${escapeHtml(s.products)}</div>` : ""}
      </div>
    `,
        )
        .join("");

      return `
      <div class="popup-person">
        <div class="popup-person-name">${escapeHtml(person.name)}</div>
        <div class="popup-person-meta">${phone ? `📞 ${escapeHtml(phone)} | ` : ""}${person.total_packages} ${person.total_packages === 1 ? "przesyłka" : "przesyłek"} | ${person.total_weight} kg</div>
        <div class="popup-shipments">${shipmentsList}</div>
      </div>
    `;
    })
    .join("");

  return `<div class="popup-content">${header}${people}</div>`;
}

function updateMarkers(filters) {
  // remember filters to allow re-applying on zoom changes
  lastFilters = filters || lastFilters || {};
  const search = lastFilters?.search?.toLowerCase().trim() || '';
  const postalRegex = search && isPostalPattern(search) ? buildPostalRegex(search) : null;

  const filtered = markerCache.filter(({ data }) => {
    if (search) {
      if (postalRegex && data.postal_code && postalRegex.test(data.postal_code)) {
        return true;
      }
      
      const matchSearch =
        (data.address && data.address.toLowerCase().includes(search)) ||
        (data.city && data.city.toLowerCase().includes(search)) ||
        (data.postal_code && data.postal_code.toLowerCase().includes(search)) ||
        (data.people && data.people.some((p) => p.name.toLowerCase().includes(search))) ||
        (data.people && data.people.some((p) =>
          p.shipments && p.shipments.some((sh) =>
            sh.order.toLowerCase().includes(search) ||
            (sh.tracking2 && sh.tracking2.toLowerCase().includes(search))
          )
        ));
      if (!matchSearch) return false;
    }

    if (
      filters?.packagesMin > 1 ||
      filters?.packagesMax < (metadata?.maxPackages || 100)
    ) {
      if (
        data.total_packages < filters.packagesMin ||
        data.total_packages > filters.packagesMax
      ) {
        return false;
      }
    }

    if (filters?.dateMin || filters?.dateMax) {
      const hasDateInRange = data.people?.some((p) =>
        p.shipments?.some((s) => {
          if (!s.created_at) return false;
          const d = s.created_at.split(" ")[0];
          if (filters.dateMin && d < filters.dateMin) return false;
          if (filters.dateMax && d > filters.dateMax) return false;
          return true;
        })
      );
      if (!hasDateInRange) return false;
    }

    return true;
  });

  markers.clearLayers();
  markers.addLayers(filtered.map((m) => m.marker));

  updateStats(filtered);
}

function isPostalPattern(str) {
  const cleaned = str.replace(/[^0-9\-*]/g, "");
  return /^\d{2}[\-*]?\d{0,3}$/.test(cleaned);
}

function buildPostalRegex(input) {
  const cleaned = input.replace(/[^0-9\-]/g, "");
  if (/^\d{2}-\d{3}$/.test(cleaned)) {
    return new RegExp("^" + cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  }
  if (/^\d{2}$/.test(cleaned)) {
    return new RegExp("^" + cleaned + "-\\d{3}$");
  }
  if (/^\d{2}\*/.test(cleaned)) {
    return new RegExp("^" + cleaned.charAt(0) + cleaned.charAt(1) + "-\\d{3}$");
  }
  return null;
}

function updateStats(filtered) {
  const panel = document.getElementById("filter-panel");
  if (panel && panel._x_dataStack) {
    const vm = panel._x_dataStack[0];
    vm.filteredCount = filtered.length;
    vm.totalWeight = filtered.reduce(
      (sum, m) => sum + (m.data.total_weight || 0),
      0,
    );
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = dateStr.split("-");
  return `${d[2]}.${d[1]}.${d[0].slice(2)}`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function hideLoading() {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.classList.add("hidden");
    setTimeout(() => (loading.style.display = "none"), 400);
  }
}

window.filterPanel = filterPanel;
