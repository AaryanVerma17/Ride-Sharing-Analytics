const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];


const FILTERS = [
  'city',
  'vehicle',
  'payment',
  'start',
  'end'
];

const DAYS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun'
];

const SEGMENTS = [
  '1 trip',
  '2-4 trips',
  '5-9 trips',
  '10+ trips'
];


const TAB_CHARTS = {

  overview: [
    ['ch-city-rev', 'Revenue by city', '6'],
    ['ch-month', 'Monthly revenue & growth', '6'],
    ['ch-vehicle', 'Revenue by vehicle', '6'],
    ['ch-payment', 'Payment mix', '6'],
    ['ch-city-cancel', 'Cancellation rate by city', '6']
  ],

  drivers: [
    ['ch-top-drivers', 'Top drivers by revenue', '6'],
    ['ch-cancel-drivers', 'Driver cancellation risk', '6'],
    ['ch-fpk', 'Fare per km by vehicle', '6'],
    ['ch-city-top', 'Top earner by city', '6']
  ],

  riders: [
    ['ch-top-riders', 'Most active riders', '6'],
    ['ch-segments', 'Riders by trip frequency', '6']
  ],

  demand: [
    ['ch-hour', 'Trips by hour', '6'],
    ['ch-heat', 'Weekday × hour demand', '6'],
    ['ch-routes', 'Top routes by revenue', '6'],
    ['ch-pickups', 'Top pickup points', '6']
  ]

};


let controller = null;
let maxDate = null;
let latest = null;


/* =========================================================
   FORMATTING
========================================================= */

const fmt = {

  num: value =>
    value == null
      ? '—'
      : Math.round(value).toLocaleString('en-IN'),

  pct: value =>
    value == null
      ? '—'
      : `${Number(value).toFixed(1)}%`,

  inr: value => {

    if (value == null) {
      return '—';
    }

    if (value >= 1e7) {
      return `₹${(value / 1e7).toFixed(2)} Cr`;
    }

    if (value >= 1e5) {
      return `₹${(value / 1e5).toFixed(2)} L`;
    }

    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }

};


const col = (rows, key) =>
  rows.map(row => row[key]);


const palette = [
  '#11130f',
  '#315cff',
  '#d8ff45',
  '#ef5b4d',
  '#7c7d76',
  '#b7b8af'
];


const plotConfig = {
  responsive: true,
  displayModeBar: false
};


/* =========================================================
   CHART SLOTS
========================================================= */

function buildChartSlots() {

  Object.entries(TAB_CHARTS).forEach(
    ([tab, charts]) => {

      $(`#tab-${tab}`).innerHTML =
        charts
          .map(
            ([id, title, span]) => `
              <figure
                class="chart-card"
                style="grid-column:span ${span}"
              >

                <div class="chart-head">

                  <h3>
                    ${title}
                  </h3>

                  <span>
                    Interactive view
                  </span>

                </div>

                <div
                  class="chart"
                  id="${id}"
                ></div>

              </figure>
            `
          )
          .join('');

    }
  );

}


/* =========================================================
   PLOTLY
========================================================= */

function layout(title, extra = {}) {

  const axis = {
    gridcolor: '#e0dfd7',
    zerolinecolor: '#e0dfd7',
    automargin: true
  };

  return {

    title: {
      text: title,
      font: {
        size: 15,
        family: 'Space Grotesk',
        color: '#11130f'
      },
      x: .03
    },

    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',

    font: {
      family: 'DM Sans',
      color: '#11130f',
      size: 11
    },

    margin: {
      t: 48,
      r: 16,
      b: 44,
      l: 56
    },

    hoverlabel: {
      bgcolor: '#11130f',
      font: {
        color: '#fff'
      }
    },

    ...extra,

    xaxis: {
      ...axis,
      ...(extra.xaxis || {})
    },

    yaxis: {
      ...axis,
      ...(extra.yaxis || {})
    }

  };

}


function bar(
  x,
  y,
  color = palette[1],
  hover = '%{y:,.0f}'
) {

  return {

    type: 'bar',

    x,
    y,

    marker: {
      color,
      line: {
        color: '#11130f',
        width: 1
      }
    },

    hovertemplate:
      `%{x}<br>${hover}<extra></extra>`

  };

}


function hbar(
  rows,
  key,
  color = palette[1],
  hover = '%{x:,.0f}'
) {

  return {

    type: 'bar',

    orientation: 'h',

    y: col(rows, 'label'),

    x: col(rows, key),

    marker: {
      color,

      line: {
        color: '#11130f',
        width: 1
      }
    },

    hovertemplate:
      `%{y}<br>${hover}<extra></extra>`

  };

}


function draw(
  id,
  traces,
  title,
  extra = {}
) {

  Plotly.react(
    id,
    traces,
    layout(title, extra),
    plotConfig
  );

}


/* =========================================================
   METRICS
========================================================= */

function renderMetrics(k, data) {

  const segments =
    Object.fromEntries(
      data.rider_segments.map(
        r => [r.segment, r.riders]
      )
    );

  const totalRiders =
    Object.values(segments)
      .reduce((a, b) => a + b, 0);

  const repeat =
    totalRiders
      ? 100 *
        (
          totalRiders -
          (segments['1 trip'] || 0)
        ) /
        totalRiders
      : null;


  const metrics = [

    [
      'Total trips',
      k.total_trips,
      fmt.num
    ],

    [
      'Revenue',
      k.revenue,
      fmt.inr
    ],

    [
      'Cancellation rate',
      k.cancellation_rate,
      fmt.pct
    ],

    [
      'Lost fares',
      k.lost_revenue,
      fmt.inr
    ],

    [
      'Avg fare',
      k.avg_fare,
      fmt.inr
    ],

    [
      'Fare / km',
      k.fare_per_km,
      value => `₹${Number(value).toFixed(2)}`
    ],

    [
      'Active riders',
      k.active_riders,
      fmt.num
    ],

    [
      'Active drivers',
      k.active_drivers,
      fmt.num
    ]

  ];


  $('#metrics').innerHTML =
    metrics
      .map(
        ([label, value, formatter]) => `
          <article class="metric">

            <div class="accent"></div>

            <div class="value">
              ${formatter(value)}
            </div>

            <div class="label">
              ${label}
            </div>

          </article>
        `
      )
      .join('');


  const peak =
    data.by_hour.reduce(
      (a, b) =>
        b.trips > a.trips
          ? b
          : a
    );

  const topCity =
    data.by_city[0];


  $('#heroTrips').textContent =
    fmt.num(k.total_trips);

  $('#heroRevenue').textContent =
    fmt.inr(k.revenue);

  $('#heroPeak').textContent =
    peak
      ? `${String(peak.hour).padStart(2, '0')}:00`
      : '—';

  $('#heroCity').textContent =
    topCity?.city || '—';

  $('#heroCancel').textContent =
    fmt.pct(k.cancellation_rate);

  $('#snapshotDate').textContent =
    maxDate || 'LIVE';


  $('#ticker').innerHTML = [

    [
      'TRIPS',
      fmt.num(k.total_trips)
    ],

    [
      'REVENUE',
      fmt.inr(k.revenue)
    ],

    [
      'AVG FARE',
      fmt.inr(k.avg_fare)
    ],

    [
      'CANCEL RATE',
      fmt.pct(k.cancellation_rate)
    ],

    [
      'ACTIVE RIDERS',
      fmt.num(k.active_riders)
    ],

    [
      'ACTIVE DRIVERS',
      fmt.num(k.active_drivers)
    ],

    [
      'REPEAT RIDERS',
      fmt.pct(repeat)
    ]

  ]

  .concat([
    [
      'TRIPS',
      fmt.num(k.total_trips)
    ],

    [
      'REVENUE',
      fmt.inr(k.revenue)
    ]
  ])

  .map(
    ([label, value]) => `
      <div class="ticker-item">

        <span>
          ${label}
        </span>

        <strong>
          ${value}
        </strong>

      </div>
    `
  )
  .join('');

}


/* =========================================================
   FINDINGS
========================================================= */

function renderFindings(data) {

  const k = data.kpis;


  if (!k.total_trips) {

    $('#findingsGrid').innerHTML = `
      <article class="finding">
        <p>
          No trips match the selected filters.
        </p>
      </article>
    `;

    return;
  }


  const peak =
    data.by_hour.reduce(
      (a, b) =>
        b.trips > a.trips
          ? b
          : a
    );


  const city =
    data.by_city[0];


  const worstCity =
    [...data.by_city]
      .sort(
        (a, b) =>
          b.cancellation_rate -
          a.cancellation_rate
      )[0];


  const payment =
    data.by_payment[0];


  const driver =
    data.cancel_drivers[0];


  const findings = [

    [
      '01',
      '◷',
      `Demand peaks at
      <b>${String(peak.hour).padStart(2, '0')}:00</b>,
      representing
      ${(100 * peak.trips / k.total_trips).toFixed(1)}%
      of trips.`
    ],

    [
      '02',
      '↗',
      `<b>${city.city}</b>
      leads revenue with
      <b>${fmt.inr(city.revenue)}</b>,
      or
      ${
        k.revenue
          ? (100 * city.revenue / k.revenue).toFixed(0)
          : 0
      }%
      of total.`
    ],

    [
      '03',
      '!',
      `<b>${worstCity.city}</b>
      has the highest cancellation rate at
      <b>${fmt.pct(worstCity.cancellation_rate)}</b>.`
    ],

    [
      '04',
      '◈',
      `<b>${payment.method}</b>
      is the dominant payment method
      across the current selection.`
    ],

    [
      '05',
      '×',
      driver
        ? `<b>${driver.label}</b>
           has the highest cancellation rate
           among drivers with 30+ trips.`
        : 'No driver cancellation signal is available.'
    ],

    [
      '06',
      '₹',
      `Cancellations represent
      <b>${fmt.inr(k.lost_revenue)}</b>
      in unrealised fares.`
    ]

  ];


  $('#findingsGrid').innerHTML =
    findings
      .map(
        ([number, icon, text]) => `
          <article class="finding">

            <div class="finding-index">
              ${number}
            </div>

            <div class="finding-icon">
              ${icon}
            </div>

            <p>
              ${text}
            </p>

          </article>
        `
      )
      .join('');

}


/* =========================================================
   CHARTS
========================================================= */

function renderCharts(d) {

  draw(
    'ch-city-rev',

    [
      bar(
        col(d.by_city, 'city'),
        col(d.by_city, 'revenue'),
        palette[1],
        '₹%{y:,.0f}'
      )
    ],

    'Revenue by city (₹)'
  );


  draw(
    'ch-month',

    [

      {
        type: 'bar',

        x: col(d.monthly, 'month'),

        y: col(d.monthly, 'revenue'),

        name: 'Revenue',

        marker: {
          color: palette[0]
        },

        hovertemplate:
          '%{x}<br>₹%{y:,.0f}<extra></extra>'
      },

      {
        type: 'scatter',

        mode: 'lines+markers',

        x: col(d.monthly, 'month'),

        y: col(
          d.monthly,
          'revenue_growth_pct'
        ),

        name: 'MoM growth',

        yaxis: 'y2',

        line: {
          color: palette[1],
          width: 3
        },

        marker: {
          size: 7
        }
      }

    ],

    'Monthly revenue & growth',

    {
      yaxis2: {
        overlaying: 'y',
        side: 'right',
        ticksuffix: '%',
        showgrid: false
      },

      legend: {
        orientation: 'h',
        y: -.22
      }
    }
  );


  draw(
    'ch-vehicle',

    [
      bar(
        col(d.by_vehicle, 'vehicle'),
        col(d.by_vehicle, 'revenue'),
        palette[2],
        '₹%{y:,.0f}'
      )
    ],

    'Revenue by vehicle type (₹)'
  );


  draw(
    'ch-payment',

    [

      {
        type: 'pie',

        hole: .62,

        labels:
          col(d.by_payment, 'method'),

        values:
          col(d.by_payment, 'trips'),

        marker: {
          colors: [
            palette[0],
            palette[1],
            palette[3],
            palette[4]
          ],

          line: {
            color: '#fbfaf6',
            width: 3
          }
        },

        textinfo: 'label+percent'
      }

    ],

    'Payment mix',

    {
      showlegend: false
    }
  );


  const cities =
    [...d.by_city]
      .sort(
        (a, b) =>
          b.cancellation_rate -
          a.cancellation_rate
      );


  draw(
    'ch-city-cancel',

    [
      bar(
        col(cities, 'city'),
        col(cities, 'cancellation_rate'),
        palette[3],
        '%{y:.1f}%'
      )
    ],

    'Cancellation rate by city (%)'
  );


  draw(
    'ch-top-drivers',

    [
      hbar(
        d.top_drivers,
        'revenue',
        palette[1],
        '₹%{x:,.0f}'
      )
    ],

    'Top drivers by revenue (₹)',

    {
      yaxis: {
        autorange: 'reversed'
      },

      margin: {
        l: 150,
        t: 48,
        r: 16,
        b: 40
      }
    }
  );


  draw(
    'ch-cancel-drivers',

    [
      hbar(
        d.cancel_drivers,
        'cancel_rate',
        palette[3],
        '%{x:.1f}% cancelled'
      )
    ],

    'Driver cancellation risk',

    {
      yaxis: {
        autorange: 'reversed'
      },

      margin: {
        l: 150,
        t: 48,
        r: 16,
        b: 40
      }
    }
  );


  draw(
    'ch-fpk',

    [
      bar(
        col(d.by_vehicle, 'vehicle'),
        col(d.by_vehicle, 'fare_per_km'),
        palette[0],
        '₹%{y:.2f} per km'
      )
    ],

    'Fare per km by vehicle'
  );


  draw(
    'ch-city-top',

    [

      {
        ...bar(
          col(
            d.top_driver_per_city,
            'city'
          ),

          col(
            d.top_driver_per_city,
            'revenue'
          ),

          palette[4],

          '₹%{y:,.0f}'
        ),

        text:
          col(
            d.top_driver_per_city,
            'label'
          ),

        textposition: 'outside',

        cliponaxis: false
      }

    ],

    'Top earner in each city'
  );


  draw(
    'ch-top-riders',

    [
      hbar(
        d.top_riders,
        'trips',
        palette[1],
        '%{x} trips'
      )
    ],

    'Most active riders',

    {
      yaxis: {
        autorange: 'reversed'
      },

      margin: {
        l: 150,
        t: 48,
        r: 16,
        b: 40
      }
    }
  );


  const segmentMap =
    Object.fromEntries(
      d.rider_segments.map(
        r => [r.segment, r.riders]
      )
    );


  draw(
    'ch-segments',

    [
      bar(
        SEGMENTS,

        SEGMENTS.map(
          segment =>
            segmentMap[segment] || 0
        ),

        palette[2],

        '%{y:,.0f} riders'
      )
    ],

    'Riders by trip frequency'
  );


  const trips =
    col(d.by_hour, 'trips');


  const cut =
    [...trips]
      .sort((a, b) => b - a)[2] ?? 0;


  draw(
    'ch-hour',

    [

      {
        type: 'bar',

        x:
          col(d.by_hour, 'hour'),

        y: trips,

        marker: {
          color:
            trips.map(
              value =>
                value >= cut
                  ? palette[3]
                  : palette[0]
            )
        },

        hovertemplate:
          '%{x}:00<br>%{y:,.0f} trips<extra></extra>'
      }

    ],

    'Trips by hour',

    {
      xaxis: {
        dtick: 2
      }
    }
  );


  const z =
    DAYS.map(
      () => Array(24).fill(0)
    );


  d.heatmap.forEach(
    row => {
      z[row.d][row.h] = row.trips;
    }
  );


  draw(
    'ch-heat',

    [

      {
        type: 'heatmap',

        z,

        x: [
          ...Array(24).keys()
        ],

        y: DAYS,

        colorscale: [
          [0, '#fbfaf6'],
          [.5, palette[2]],
          [1, palette[1]]
        ],

        hovertemplate:
          '%{y} %{x}:00<br>%{z} trips<extra></extra>'
      }

    ],

    'Weekday × hour demand',

    {
      yaxis: {
        autorange: 'reversed'
      }
    }
  );


  draw(
    'ch-routes',

    [
      hbar(
        d.top_routes,
        'revenue',
        palette[0],
        '₹%{x:,.0f}'
      )
    ],

    'Top routes by revenue',

    {
      yaxis: {
        autorange: 'reversed'
      },

      margin: {
        l: 220,
        t: 48,
        r: 16,
        b: 40
      }
    }
  );


  draw(
    'ch-pickups',

    [
      hbar(
        d.top_pickups,
        'trips',
        palette[4],
        '%{x} trips'
      )
    ],

    'Top pickup points',

    {
      yaxis: {
        autorange: 'reversed'
      },

      margin: {
        l: 190,
        t: 48,
        r: 16,
        b: 40
      }
    }
  );

}


/* =========================================================
   URL STATE
========================================================= */

function setQuery() {

  const query =
    new URLSearchParams();


  FILTERS.forEach(
    key => {

      const value =
        $(`#${key}`).value;

      if (value) {
        query.set(key, value);
      }

    }
  );


  const tab =
    $('.tab-nav button.active')
      ?.dataset.tab;


  if (tab && tab !== 'overview') {
    query.set('tab', tab);
  }


  history.replaceState(
    null,
    '',
    query.toString()
      ? `?${query}`
      : location.pathname
  );

}


/* =========================================================
   API LOAD
========================================================= */

async function load() {

  if (controller) {
    controller.abort();
  }


  controller =
    new AbortController();


  const params =
    new URLSearchParams();


  FILTERS.forEach(
    key => {

      const value =
        $(`#${key}`).value;

      if (value) {
        params.set(key, value);
      }

    }
  );


  setQuery();


  document.body.classList.add(
    'loading'
  );

  $('#error').hidden = true;


  try {

    const response =
      await fetch(
        `/api/dashboard?${params}`,
        {
          signal:
            controller.signal
        }
      );


    const data =
      await response.json();


    if (!response.ok) {
      throw new Error(
        data.error ||
        'Request failed'
      );
    }


    latest = data;


    renderMetrics(
      data.kpis,
      data
    );


    renderFindings(data);


    renderCharts(data);

  }

  catch (error) {

    if (
      error.name !==
      'AbortError'
    ) {

      $('#error').textContent =
        `Could not load analytics: ${error.message}`;

      $('#error').hidden = false;

    }

  }

  finally {

    document.body.classList.remove(
      'loading'
    );

  }

}


/* =========================================================
   TABS
========================================================= */

function activateTab(button) {

  $$('.tab-nav button')
    .forEach(
      current =>
        current.classList.toggle(
          'active',
          current === button
        )
    );


  $$('.tab-panel')
    .forEach(
      panel =>
        panel.classList.toggle(
          'active',
          panel.id ===
            `tab-${button.dataset.tab}`
        )
    );


  setQuery();


  requestAnimationFrame(
    () =>
      $(`#tab-${button.dataset.tab}`)
        .querySelectorAll('.chart')
        .forEach(
          element =>
            Plotly.Plots.resize(element)
        )
  );

}


/* =========================================================
   INITIALISE
========================================================= */

async function init() {

  buildChartSlots();


  const response =
    await fetch('/api/filters');


  const filters =
    await response.json();


  if (
    !response.ok ||
    !filters.cities
  ) {

    throw new Error(
      filters.error ||
      'Database not reachable'
    );

  }


  const fill =
    (id, values) => {

      values.forEach(
        value => {

          $(`#${id}`)
            .insertAdjacentHTML(
              'beforeend',

              `<option value="${value}">
                ${value}
              </option>`
            );

        }
      );

    };


  fill(
    'city',
    filters.cities
  );

  fill(
    'vehicle',
    filters.vehicles
  );

  fill(
    'payment',
    filters.payments
  );


  maxDate =
    filters.max_date;


  if (filters.min_date) {

    $('#start').min =
      filters.min_date;

    $('#end').min =
      filters.min_date;

    $('#start').max =
      filters.max_date;

    $('#end').max =
      filters.max_date;

  }


  const query =
    new URLSearchParams(
      location.search
    );


  FILTERS.forEach(
    key => {

      if (query.get(key)) {

        $(`#${key}`).value =
          query.get(key);

      }

    }
  );


  const requestedTab =
    query.get('tab');


  if (requestedTab) {

    const button =
      $(
        `.tab-nav [data-tab="${requestedTab}"]`
      );

    if (button) {
      activateTab(button);
    }

  }


  const debouncedLoad =
    debounce(load, 250);


  FILTERS.forEach(
    key =>
      $(`#${key}`)
        .addEventListener(
          'change',
          debouncedLoad
        )
  );


  $$('.tab-nav button')
    .forEach(
      button =>
        button.addEventListener(
          'click',
          () =>
            activateTab(button)
        )
    );


  $$('.presets button')
    .forEach(
      button =>
        button.addEventListener(
          'click',
          () => {

            $$('.presets button')
              .forEach(
                current =>
                  current.classList.toggle(
                    'active',
                    current === button
                  )
              );


            const days =
              Number(
                button.dataset.days
              );


            if (!days) {

              $('#start').value =
                '';

              $('#end').value =
                '';

            }

            else {

              const end =
                new Date(maxDate);

              const start =
                new Date(end);


              start.setDate(
                start.getDate() -
                days
              );


              $('#start').value =
                start
                  .toISOString()
                  .slice(0, 10);


              $('#end').value =
                maxDate;

            }


            load();

          }
        )
    );


  $('#reset')
    .addEventListener(
      'click',
      () => {

        FILTERS.forEach(
          key =>
            $(`#${key}`).value = ''
        );


        $$('.presets button')
          .forEach(
            button =>
              button.classList.remove(
                'active'
              )
          );


        load();

      }
    );


  $('#share')
    .addEventListener(
      'click',
      async () => {

        try {

          await navigator
            .clipboard
            .writeText(
              location.href
            );

          showToast(
            'View link copied'
          );

        }

        catch {

          showToast(
            'Copy the URL from your address bar'
          );

        }

      }
    );


  $('#menu')
    .addEventListener(
      'click',
      () =>
        $('.main-nav')
          .classList
          .toggle(
            'mobile-open'
          )
    );


  await load();

}


/* =========================================================
   HELPERS
========================================================= */

function debounce(fn, ms) {

  let timer;

  return (...args) => {

    clearTimeout(timer);

    timer =
      setTimeout(
        () => fn(...args),
        ms
      );

  };

}


function showToast(message) {

  const toast =
    $('#toast');

  toast.textContent =
    message;

  toast.classList.add(
    'show'
  );


  setTimeout(
    () =>
      toast.classList.remove(
        'show'
      ),
    1600
  );

}


/* =========================================================
   START
========================================================= */

init()
  .catch(
    error => {

      $('#error').textContent =
        `Could not start dashboard: ${error.message}`;

      $('#error').hidden = false;

    }
  );