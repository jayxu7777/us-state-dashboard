// US State Dashboard — loads pre-baked JSON and renders an interactive
// choropleth + per-state time series + KPIs + ranking tables.

const METRICS = [
  { id: 'zhvi',         file: 'data/zhvi.json',         scale: 'Viridis' },
  { id: 'zori',         file: 'data/zori.json',         scale: 'Viridis' },
  { id: 'hpi',          file: 'data/hpi.json',          scale: 'Purples' },
  { id: 'wages',        file: 'data/wages.json',        scale: 'Cividis' },
  { id: 'pcpi',         file: 'data/pcpi.json',         scale: 'YlGnBu'  },
  { id: 'unemployment', file: 'data/unemployment.json', scale: 'Reds'    },
  { id: 'permits',      file: 'data/permits.json',      scale: 'Greens'  },
  { id: 'electricity',  file: 'data/electricity.json',  scale: 'YlOrRd'  },
  { id: 'natgas',       file: 'data/natgas.json',       scale: 'YlOrRd'  },
  { id: 'gasoline',     file: 'data/gasoline.json',     scale: 'Oranges' },
  { id: 'gdp',          file: 'data/gdp.json',          scale: 'Blues'   },
  { id: 'coincident',   file: 'data/coincident.json',   scale: 'Teal'    },
  { id: 'rpp',          file: 'data/rpp.json',          scale: 'RdBu'    },
];

const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',
  LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
  WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

const datasets = {};
let currentMetric = 'zhvi';
let currentDateIdx = -1;
let focusState = 'CA';

// ---------- formatting ----------

function fmt(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  if (unit === 'USD') return '$' + Math.round(v).toLocaleString();
  if (unit === 'Million USD') {
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'T';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'B';
    return '$' + Math.round(v) + 'M';
  }
  if (unit === 'USD/month' || unit === 'USD/gal' || unit === 'USD/hour' || unit === 'USD/MCF')
    return '$' + v.toFixed(2);
  if (unit === '%') return v.toFixed(1) + '%';
  if (unit === 'cents/kWh') return v.toFixed(2) + '¢';
  if (unit === 'units/month') return v.toLocaleString();
  if (unit === 'index') return v.toFixed(1);
  return v.toLocaleString();
}

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  const s = v >= 0 ? '+' : '';
  return s + v.toFixed(1) + '%';
}

// ---------- data helpers ----------

async function loadAll() {
  await Promise.all(METRICS.map(async m => {
    try {
      const r = await fetch(m.file);
      if (r.ok) datasets[m.id] = await r.json();
    } catch (e) { console.warn('load failed', m.file, e); }
  }));
}

function latestNonNullIdx(arr) {
  for (let i = arr.length - 1; i >= 0; i--)
    if (arr[i] !== null && arr[i] !== undefined) return i;
  return -1;
}

function medianOf(arr) {
  const xs = arr.filter(x => x !== null && x !== undefined).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

// ---------- UI builders ----------

function populateMetricSelect() {
  const sel = document.getElementById('metric');
  sel.innerHTML = '';
  const groups = {
    'Housing': ['zhvi', 'hpi', 'zori', 'permits'],
    'Labor & income': ['wages', 'pcpi', 'unemployment'],
    'Energy': ['electricity', 'natgas', 'gasoline'],
    'Macro': ['gdp', 'coincident', 'rpp'],
  };
  for (const [gname, ids] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = gname;
    for (const id of ids) {
      if (!datasets[id]) continue;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = datasets[id].label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  sel.value = currentMetric;
  sel.addEventListener('change', e => {
    currentMetric = e.target.value;
    currentDateIdx = -1;
    populateMonthSelect();
    renderAll();
  });
}

function populateStateSelect() {
  const sel = document.getElementById('state');
  sel.innerHTML = '';
  Object.keys(STATE_NAMES).sort().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s} — ${STATE_NAMES[s]}`;
    sel.appendChild(opt);
  });
  sel.value = focusState;
  sel.addEventListener('change', e => {
    focusState = e.target.value;
    renderAll();
  });
}

function populateMonthSelect() {
  const sel = document.getElementById('month');
  const dates = datasets[currentMetric].dates;
  sel.innerHTML = '';
  for (let i = dates.length - 1; i >= 0; i--) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = dates[i] + (i === dates.length - 1 ? '  (latest)' : '');
    sel.appendChild(opt);
  }
  sel.value = dates.length - 1;
  sel.onchange = e => {
    currentDateIdx = parseInt(e.target.value, 10);
    renderAll();
  };
}

// ---------- KPI tiles ----------

function renderKPIs() {
  const d = datasets[currentMetric];
  const idx = currentDateIdx < 0 ? d.dates.length - 1 : currentDateIdx;
  const period = d.dates[idx];
  // National median across states with data
  const allVals = Object.values(d.states).map(v => v[idx]).filter(v => v !== null && v !== undefined);
  const med = medianOf(allVals);
  document.getElementById('kpi-national-val').textContent = fmt(med, d.unit);
  document.getElementById('kpi-national-sub').textContent = `${d.label} · ${period}`;

  const focusVals = (d.states[focusState] || []);
  const fv = focusVals[idx];
  document.getElementById('kpi-focus-label').textContent = `${focusState} · ${STATE_NAMES[focusState] || ''}`;
  document.getElementById('kpi-focus-val').textContent = fmt(fv, d.unit);
  const repMetro = d.representative_metro && d.representative_metro[focusState];
  document.getElementById('kpi-focus-sub').textContent = repMetro ? `proxy: ${repMetro}` : `${d.label}`;

  // YoY change for focus state.  Monthly = 12 periods; quarterly = 4; annual = 1.
  const step = d.frequency === 'monthly' ? 12 : d.frequency === 'quarterly' ? 4 : 1;
  const yoyEl = document.getElementById('kpi-yoy-val');
  const yoySub = document.getElementById('kpi-yoy-sub');
  const prevIdx = idx - step;
  if (fv !== null && fv !== undefined && prevIdx >= 0 && focusVals[prevIdx] !== null && focusVals[prevIdx] !== undefined) {
    const pct = ((fv - focusVals[prevIdx]) / focusVals[prevIdx]) * 100;
    yoyEl.textContent = fmtPct(pct);
    yoyEl.style.color = pct >= 0 ? 'var(--accent-2)' : 'var(--accent-red)';
    yoySub.textContent = `vs. ${d.dates[prevIdx]} (${fmt(focusVals[prevIdx], d.unit)})`;
  } else {
    yoyEl.textContent = 'n/a';
    yoyEl.style.color = '';
    yoySub.textContent = '';
  }

  // Rank for focus
  const entries = Object.entries(d.states)
    .map(([st, v]) => [st, v[idx]])
    .filter(([_, v]) => v !== null && v !== undefined)
    .sort((a, b) => b[1] - a[1]);
  const rank = entries.findIndex(([st]) => st === focusState);
  const rankEl = document.getElementById('kpi-rank-val');
  const rankSub = document.getElementById('kpi-rank-sub');
  if (rank >= 0) {
    rankEl.textContent = `#${rank + 1}`;
    rankSub.textContent = `of ${entries.length} states (1 = highest)`;
  } else {
    rankEl.textContent = 'n/a';
    rankSub.textContent = `${focusState} not in coverage for this metric`;
  }
}

// ---------- map ----------

function renderMap() {
  const d = datasets[currentMetric];
  const idx = currentDateIdx < 0 ? d.dates.length - 1 : currentDateIdx;
  const locs = [], vals = [], text = [];
  Object.keys(d.states).forEach(st => {
    const v = d.states[st][idx];
    if (v === null || v === undefined) return;
    locs.push(st);
    vals.push(v);
    text.push(`<b>${st} — ${STATE_NAMES[st] || ''}</b><br>${d.label}: ${fmt(v, d.unit)}<br>${d.dates[idx]}`);
  });

  // RPP centers on 100 (US average) — use diverging mid
  const isDiverging = currentMetric === 'rpp';
  const trace = {
    type: 'choropleth',
    locationmode: 'USA-states',
    locations: locs,
    z: vals,
    text: text,
    hovertemplate: '%{text}<extra></extra>',
    colorscale: METRICS.find(m => m.id === currentMetric).scale,
    reversescale: currentMetric === 'unemployment',  // red=bad, but want low=green
    zmid: isDiverging ? 100 : undefined,
    showscale: true,
    colorbar: {
      title: { text: d.unit, font: { size: 11 } },
      thickness: 10, len: 0.8, x: 0.98, y: 0.5,
      tickfont: { size: 10 }, outlinewidth: 0,
    },
    marker: { line: { color: '#0b0d12', width: 0.6 } },
  };

  const layout = {
    geo: {
      scope: 'usa',
      showlakes: true, lakecolor: '#0b0d12',
      bgcolor: '#141821',
      subunitcolor: '#3a4255',
      countrycolor: '#3a4255',
      showframe: false,
      landcolor: '#1f2533',  // for states with no data
      showland: true,
    },
    paper_bgcolor: '#141821',
    font: { color: '#e8ebf2', family: 'Inter' },
    margin: { t: 4, b: 4, l: 4, r: 4 },
  };

  Plotly.react('map', [trace], layout, { displayModeBar: false, responsive: true });
  document.getElementById('map-title').textContent = `${d.label} — ${d.dates[idx]}`;
  document.getElementById('meta').textContent =
    (d.coverage_note ? '⚠ ' + d.coverage_note : '') + ' source: ' + d.source;

  const mapDiv = document.getElementById('map');
  if (!mapDiv._clickBound) {
    mapDiv.on('plotly_click', ev => {
      const pt = ev.points && ev.points[0];
      if (!pt) return;
      focusState = pt.location;
      document.getElementById('state').value = focusState;
      renderAll();
    });
    mapDiv._clickBound = true;
  }
}

// ---------- time series + ranking ----------

function renderPanel() {
  const d = datasets[currentMetric];

  document.getElementById('panel-title').textContent =
    `${focusState} — ${STATE_NAMES[focusState] || ''}`;
  document.getElementById('panel-sub').textContent =
    `${d.label} · ${d.frequency} · ${d.unit}`;

  const focusVals = d.states[focusState] || [];
  const allStates = Object.keys(d.states);
  const usAvg = d.dates.map((_, i) => {
    const xs = allStates.map(s => d.states[s][i]).filter(v => v !== null && v !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });

  const traces = [
    {
      x: d.dates, y: usAvg,
      mode: 'lines', name: 'US average',
      line: { color: '#8b93a7', width: 1.5, dash: 'dot' },
      hovertemplate: '%{x}<br>US avg: %{y:.2f}<extra></extra>',
    },
    {
      x: d.dates, y: focusVals,
      mode: 'lines+markers', name: focusState,
      line: { color: '#6aa1ff', width: 2.5 },
      marker: { size: 4, color: '#6aa1ff' },
      fill: 'tonexty', fillcolor: 'rgba(106,161,255,0.08)',
      hovertemplate: '%{x}<br>' + focusState + ': %{y:.2f}<extra></extra>',
    },
  ];

  const layout = {
    paper_bgcolor: '#141821', plot_bgcolor: '#141821',
    font: { color: '#e8ebf2', family: 'Inter', size: 11 },
    margin: { t: 8, b: 36, l: 56, r: 12 },
    xaxis: { gridcolor: '#232838', zeroline: false, tickfont: { size: 10 } },
    yaxis: { gridcolor: '#232838', zeroline: false, title: { text: d.unit, font: { size: 11 } }, tickfont: { size: 10 } },
    showlegend: true,
    legend: { orientation: 'h', y: 1.12, x: 0, font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
  };
  Plotly.react('ts', traces, layout, { displayModeBar: false, responsive: true });

  renderRankTable();
}

function renderRankTable() {
  const d = datasets[currentMetric];
  const idx = currentDateIdx < 0 ? d.dates.length - 1 : currentDateIdx;
  const entries = Object.entries(d.states)
    .map(([st, v]) => [st, v[idx]])
    .filter(([_, v]) => v !== null && v !== undefined)
    .sort((a, b) => b[1] - a[1]);

  const renderTable = (rows, headerLabel, rankStart = 0) => {
    let html = `<thead><tr><th>${headerLabel}</th><th>State</th><th class="val">Value</th></tr></thead><tbody>`;
    rows.forEach(([st, v], i) => {
      const cls = st === focusState ? 'focus' : '';
      html += `<tr class="${cls}"><td>${rankStart + i + 1}</td><td class="st">${st}</td><td class="val">${fmt(v, d.unit)}</td></tr>`;
    });
    html += '</tbody>';
    return html;
  };

  // If we have <= 10 states with data, show a single full table in the left
  // table slot and clear the right one. Otherwise: top5 / bottom5.
  if (entries.length <= 10) {
    document.getElementById('rank-top').innerHTML = renderTable(entries, 'Rank');
    document.getElementById('rank-bot').innerHTML = '';
  } else {
    const top5 = entries.slice(0, 5);
    const bot5 = entries.slice(-5).reverse();
    const botRankStart = entries.length - 5;
    document.getElementById('rank-top').innerHTML = renderTable(top5, 'Top');
    document.getElementById('rank-bot').innerHTML = renderTable(bot5, 'Bot', botRankStart);
  }
}

// ---------- multi-metric deviation chart ----------

function renderMultiMetric() {
  // For every metric we have, compute the focus state's % deviation from the
  // national median at the latest available period.  Horizontal bars are
  // far easier to read than overlapping line charts.
  // GDP and permits are stock/count variables that scale with state size, so
  // their median-deviation is dominated by the size-mismatch and would dwarf
  // the price/rate metrics. Keep only intensive (per-unit) metrics here.
  const order = ['rpp', 'zhvi', 'hpi', 'zori', 'wages', 'pcpi',
                 'coincident', 'unemployment',
                 'electricity', 'natgas', 'gasoline'];
  const rows = [];
  for (const id of order) {
    const d = datasets[id];
    if (!d) continue;
    const idx = latestNonNullIdx(d.states[focusState] || []);
    if (idx < 0) continue;
    const fv = d.states[focusState][idx];
    const allVals = Object.values(d.states).map(v => v[idx]).filter(v => v !== null && v !== undefined);
    const med = medianOf(allVals);
    if (med === null || med === 0) continue;
    const pct = ((fv - med) / med) * 100;
    rows.push({
      id, label: d.label.split(' (')[0],
      pct, focus: fv, median: med, unit: d.unit, period: d.dates[idx],
    });
  }
  // Sort by deviation ascending (so largest positive deviation is at top)
  rows.sort((a, b) => a.pct - b.pct);

  const y = rows.map(r => r.label);
  const x = rows.map(r => r.pct);
  const colors = rows.map(r => r.pct >= 0 ? '#4cd0a3' : '#ff6a78');
  const text = rows.map(r =>
    `${focusState} ${fmt(r.focus, r.unit)} · US median ${fmt(r.median, r.unit)} · ${r.period}`);

  // Plot bars with no in-bar text; show a small annotated label with the
  // signed pct, then put full detail in the hover tooltip.
  const trace = {
    type: 'bar', orientation: 'h',
    x, y,
    customdata: text,
    marker: { color: colors, line: { width: 0 } },
    text: rows.map(r => (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%'),
    textposition: 'outside',
    textfont: { size: 11, color: '#e8ebf2' },
    cliponaxis: false,
    hovertemplate: '<b>%{y}</b><br>%{x:+.1f}% vs US median<br>%{customdata}<extra></extra>',
  };

  const layout = {
    paper_bgcolor: '#141821', plot_bgcolor: '#141821',
    font: { color: '#e8ebf2', family: 'Inter', size: 11 },
    margin: { t: 8, b: 32, l: 200, r: 24 },
    xaxis: {
      gridcolor: '#232838', zeroline: true, zerolinecolor: '#3a4255', zerolinewidth: 1.5,
      tickfont: { size: 10 },
      title: { text: '% deviation from US median (latest period for each metric)', font: { size: 11 } },
      ticksuffix: '%',
    },
    yaxis: { gridcolor: '#232838', tickfont: { size: 11 }, automargin: true },
    showlegend: false,
  };

  document.getElementById('multi-title').textContent =
    `${focusState} vs. US median — across all metrics`;
  Plotly.react('ts-multi', [trace], layout, { displayModeBar: false, responsive: true });
}

// ---------- orchestration ----------

function renderAll() {
  renderKPIs();
  renderMap();
  renderPanel();
  renderMultiMetric();
}

(async function main() {
  await loadAll();
  document.getElementById('updated').textContent = new Date().toISOString().slice(0, 10);
  populateStateSelect();
  populateMetricSelect();
  populateMonthSelect();
  renderAll();
})();
