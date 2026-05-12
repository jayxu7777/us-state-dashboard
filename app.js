// US State Dashboard - vanilla JS + Plotly.
// Loads pre-baked JSON from ./data/*.json and renders an interactive choropleth
// with a per-state time series panel.

const METRICS = [
  { id: 'zhvi',         file: 'data/zhvi.json',         colorscale: 'Viridis' },
  { id: 'zori',         file: 'data/zori.json',         colorscale: 'Viridis' },
  { id: 'wages',        file: 'data/wages.json',        colorscale: 'Cividis' },
  { id: 'unemployment', file: 'data/unemployment.json', colorscale: 'Reds'    },
  { id: 'permits',      file: 'data/permits.json',      colorscale: 'Greens'  },
  { id: 'electricity',  file: 'data/electricity.json',  colorscale: 'YlOrRd'  },
  { id: 'natgas',       file: 'data/natgas.json',       colorscale: 'YlOrRd'  },
  { id: 'gasoline',     file: 'data/gasoline.json',     colorscale: 'Oranges' },
  { id: 'gdp',          file: 'data/gdp.json',          colorscale: 'Blues'   },
];

const datasets = {};   // id -> payload
let currentMetric = METRICS[0].id;
let currentDateIdx = -1;  // -1 = latest
let currentState = null;

const fmt = (v, unit) => {
  if (v === null || v === undefined) return 'n/a';
  if (unit === 'USD' || unit === 'Million USD') {
    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (unit === 'USD/month' || unit === 'USD/gal' || unit === 'USD/hour' || unit === 'USD/MCF') {
    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (unit === '%' || unit === 'cents/kWh') {
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (unit === '%' ? '%' : '¢');
  }
  return v.toLocaleString();
};

async function loadAll() {
  await Promise.all(METRICS.map(async m => {
    const r = await fetch(m.file);
    if (!r.ok) {
      console.warn('missing', m.file);
      return;
    }
    datasets[m.id] = await r.json();
  }));
}

function populateMetricSelect() {
  const sel = document.getElementById('metric');
  sel.innerHTML = '';
  METRICS.forEach(m => {
    if (!datasets[m.id]) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = datasets[m.id].label;
    sel.appendChild(opt);
  });
  sel.value = currentMetric;
  sel.addEventListener('change', e => {
    currentMetric = e.target.value;
    currentDateIdx = -1;
    populateMonthSelect();
    drawMap();
    if (currentState) drawTimeSeries(currentState);
  });
}

function populateMonthSelect() {
  const sel = document.getElementById('month');
  const dates = datasets[currentMetric].dates;
  sel.innerHTML = '';
  // Newest first
  for (let i = dates.length - 1; i >= 0; i--) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = dates[i] + (i === dates.length - 1 ? ' (latest)' : '');
    sel.appendChild(opt);
  }
  sel.value = dates.length - 1;
  sel.onchange = e => {
    currentDateIdx = parseInt(e.target.value, 10);
    drawMap();
  };
}

function drawMap() {
  const d = datasets[currentMetric];
  const dates = d.dates;
  const idx = currentDateIdx < 0 ? dates.length - 1 : currentDateIdx;
  const locs = [];
  const vals = [];
  const text = [];
  Object.keys(d.states).forEach(st => {
    const v = d.states[st][idx];
    if (v === null || v === undefined) return;
    locs.push(st);
    vals.push(v);
    text.push(`${st}: ${fmt(v, d.unit)}`);
  });

  const trace = {
    type: 'choropleth',
    locationmode: 'USA-states',
    locations: locs,
    z: vals,
    text: text,
    hovertemplate: '%{text}<extra></extra>',
    colorscale: METRICS.find(m => m.id === currentMetric).colorscale,
    showscale: true,
    colorbar: { title: d.unit, thickness: 12, len: 0.85 },
    marker: { line: { color: '#0f1115', width: 0.5 } },
  };

  const layout = {
    geo: {
      scope: 'usa',
      showlakes: true,
      lakecolor: '#0f1115',
      bgcolor: '#161a22',
      subunitcolor: '#3a4255',
      showframe: false,
    },
    paper_bgcolor: '#161a22',
    font: { color: '#e6e8ee' },
    margin: { t: 8, b: 8, l: 8, r: 8 },
    title: { text: `${d.label} — ${dates[idx]}`, font: { size: 14 }, x: 0.5 },
  };

  Plotly.react('map', [trace], layout, { displayModeBar: false, responsive: true });

  document.getElementById('meta').textContent =
    `${d.coverage_note ? '⚠ ' + d.coverage_note : ''}  src: ${d.source}`;

  // Wire click handler once
  const mapDiv = document.getElementById('map');
  if (!mapDiv._clickBound) {
    mapDiv.on('plotly_click', (ev) => {
      const pt = ev.points && ev.points[0];
      if (!pt) return;
      currentState = pt.location;
      drawTimeSeries(currentState);
    });
    mapDiv._clickBound = true;
  }
}

function drawTimeSeries(state) {
  const d = datasets[currentMetric];
  const traces = [
    {
      x: d.dates,
      y: d.states[state] || [],
      mode: 'lines+markers',
      name: state,
      line: { color: '#5b8def', width: 2 },
      marker: { size: 4 },
      hovertemplate: '%{x}: ' + (d.unit === 'USD' ? '$%{y:,.0f}' : '%{y:.2f}') + '<extra></extra>',
    },
  ];

  // Add US/national or peer median for comparison
  const allStates = Object.keys(d.states);
  const usAvg = d.dates.map((_, i) => {
    const xs = allStates
      .map(s => d.states[s][i])
      .filter(v => v !== null && v !== undefined);
    if (!xs.length) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  });
  traces.push({
    x: d.dates,
    y: usAvg,
    mode: 'lines',
    name: 'US avg (all states)',
    line: { color: '#8b93a7', width: 1, dash: 'dot' },
    hovertemplate: '%{x}: US avg ' + (d.unit === 'USD' ? '$%{y:,.0f}' : '%{y:.2f}') + '<extra></extra>',
  });

  const repMetro = d.representative_metro && d.representative_metro[state];
  document.getElementById('panel-title').textContent =
    `${state} — ${d.label}${repMetro ? ' (' + repMetro + ')' : ''}`;

  const layout = {
    paper_bgcolor: '#161a22',
    plot_bgcolor: '#161a22',
    font: { color: '#e6e8ee', size: 11 },
    margin: { t: 8, b: 36, l: 50, r: 8 },
    xaxis: { gridcolor: '#242a36', tickfont: { size: 10 } },
    yaxis: { gridcolor: '#242a36', title: d.unit, tickfont: { size: 10 } },
    showlegend: true,
    legend: { x: 0, y: 1.1, orientation: 'h', font: { size: 10 } },
  };
  Plotly.react('ts', traces, layout, { displayModeBar: false, responsive: true });

  // Bottom mini: all metrics for this state, normalized to first value = 100
  drawMultiMetric(state);
}

function drawMultiMetric(state) {
  // Show indexed trajectories of multiple key metrics for the state
  const palette = ['#5b8def','#f5a623','#7ed321','#d0021b','#9013fe','#50e3c2','#f8e71c','#bd10e0'];
  const traces = [];
  let colorI = 0;
  ['zhvi','zori','wages','electricity','natgas','permits'].forEach(mid => {
    const d = datasets[mid];
    if (!d || !d.states[state]) return;
    const vals = d.states[state];
    let base = null;
    for (const v of vals) { if (v !== null && v !== undefined) { base = v; break; } }
    if (!base) return;
    const indexed = vals.map(v => v === null || v === undefined ? null : (v / base) * 100);
    traces.push({
      x: d.dates,
      y: indexed,
      mode: 'lines',
      name: d.label.split(' (')[0],
      line: { width: 1.5, color: palette[colorI++ % palette.length] },
      hovertemplate: '%{x}: %{y:.1f}<extra>' + d.label.split(' (')[0] + '</extra>',
    });
  });
  const layout = {
    paper_bgcolor: '#161a22',
    plot_bgcolor: '#161a22',
    font: { color: '#e6e8ee', size: 10 },
    margin: { t: 28, b: 30, l: 38, r: 8 },
    xaxis: { gridcolor: '#242a36', tickfont: { size: 9 } },
    yaxis: { gridcolor: '#242a36', title: 'index (start=100)', tickfont: { size: 9 } },
    title: { text: 'All metrics, indexed to start of window', font: { size: 11 }, x: 0.02 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.2, font: { size: 9 } },
  };
  Plotly.react('ts-multi', traces, layout, { displayModeBar: false, responsive: true });
}

(async function main() {
  await loadAll();
  document.getElementById('updated').textContent = new Date().toISOString().slice(0, 10);
  populateMetricSelect();
  populateMonthSelect();
  drawMap();
})();
