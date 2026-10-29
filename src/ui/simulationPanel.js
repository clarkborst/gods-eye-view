import { t } from '../i18n/index.js';
import { createSlider } from './slider.js';

/** Fixed-count UTC labels keep long scenarios legible without widening the UI. */
export function formatSimulationTick(milliseconds, durationSeconds) {
  const iso = new Date(milliseconds).toISOString();
  if (durationSeconds >= 365 * 86400) return iso.slice(0, 10);
  if (durationSeconds >= 86400)
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  return iso.slice(11, 19);
}

/** A continuous-time transport; categories are discovered from scenario metadata. */
export function createSimulationPanel({ container, controller }) {
  const categoryLabel = (id) =>
    ({
      aircraft: t('Aircraft'),
      uas: t('UAS'),
      'ground-robot': t('Ground robots'),
    })[id] || id;
  const document = container.ownerDocument;
  const root = document.createElement('section');
  root.className = 'simulation-panel';
  root.setAttribute('aria-label', t('Simulated Traffic'));
  const removers = [];
  const bind = (node, event, fn) => {
    node.addEventListener(event, fn);
    removers.push(() => node.removeEventListener(event, fn));
  };
  const make = (tag, parent = root, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  make('strong', root, t('Simulated Traffic'));
  make(
    'p',
    root,
    t(
      'Synthetic movements for testing. Not real traffic or approved flight routes. Live movement is suspended until this layer is off.',
    ),
  );
  const scenarioLabel = make('label', root, t('Scenario'));
  const scenario = make('select', scenarioLabel);
  scenario.setAttribute('aria-label', t('Simulation scenario'));
  const status = make('p');
  status.setAttribute('role', 'status');
  const playback = make('section', document.body);
  playback.className = 'simulation-playback';
  playback.id = 'simulation-playback';
  playback.setAttribute('aria-label', t('Simulation playback'));
  const sizeToggle = make('button', playback);
  sizeToggle.type = 'button';
  sizeToggle.className = 'simulation-size-toggle';
  sizeToggle.setAttribute(
    'aria-controls',
    'simulation-clock simulation-timeline',
  );
  let compact = false;
  const updateSize = () => {
    playback.classList.toggle('is-compact', compact);
    sizeToggle.textContent = compact ? '□' : '−';
    sizeToggle.title = compact ? t('Expand panel') : t('Collapse panel');
    sizeToggle.setAttribute('aria-label', sizeToggle.title);
    sizeToggle.setAttribute('aria-expanded', String(!compact));
  };
  bind(sizeToggle, 'click', () => {
    compact = !compact;
    updateSize();
  });
  updateSize();
  const dial = make('div', playback);
  dial.className = 'simulation-clock';
  dial.id = 'simulation-clock';
  const rateReadout = make('output', dial);
  rateReadout.className = 'simulation-rate';
  const readout = make('output', dial);
  readout.className = 'simulation-clock-time';
  const primaryTransport = make('div', dial);
  primaryTransport.className = 'simulation-primary-transport';
  const timeline = make('div', playback);
  timeline.className = 'simulation-timeline';
  timeline.id = 'simulation-timeline';
  const heading = make('div', timeline);
  heading.className = 'simulation-timeline-heading';
  const scenarioName = make('strong', heading);
  const date = make('span', heading);
  const ruler = make('div', timeline);
  ruler.className = 'simulation-ruler';
  const ticks = Array.from({ length: 5 }, () => make('span', ruler));
  ticks.forEach((tick, index) => {
    tick.style.left = `${(100 * index) / (ticks.length - 1)}%`;
  });
  ruler.setAttribute('aria-hidden', 'true');
  const slider = createSlider({
    documentRef: document,
    min: '0',
    max: '1',
    step: '0.1',
    value: '0',
    ariaLabel: t('Simulation time'),
  });
  timeline.appendChild(slider);
  let dragging = false;
  let resume = false;
  let snapshot = controller.getState();
  const footer = make('div', timeline);
  footer.className = 'simulation-playback-footer';
  const transport = make('div', footer);
  transport.className = 'simulation-transport';
  const buttons = [];
  const button = (label, title, action) => {
    const primary = ['◀◀', t('Play'), '▶▶'].includes(label);
    const node = make('button', primary ? primaryTransport : transport, label);
    node.type = 'button';
    node.className = 'data-toggle-chip';
    node.title = title;
    node.setAttribute('aria-label', title);
    bind(node, 'click', action);
    buttons.push(node);
    return node;
  };
  button('|◀', t('Restart simulation'), () => {
    controller.pause();
    controller.seek(0);
  });
  button('−10s', t('Step backward ten seconds'), () =>
    controller.seek(snapshot.elapsed - 10),
  );
  button('◀◀', t('Rewind simulation'), () => {
    controller.setRate(-Math.abs(snapshot.rate));
    controller.play();
  });
  const play = button(t('Play'), t('Play or pause simulation'), () =>
    snapshot.playing ? controller.pause() : controller.play(),
  );
  button('▶▶', t('Fast forward simulation'), () => {
    controller.setRate(Math.min(64, Math.max(1, Math.abs(snapshot.rate) * 2)));
    controller.play();
  });
  button('+10s', t('Step forward ten seconds'), () =>
    controller.seek(snapshot.elapsed + 10),
  );
  button('▶|', t('Seek to simulation end'), () => {
    controller.pause();
    controller.seek(snapshot.duration);
  });
  const speedLabel = make('label', footer, t('Speed'));
  const speed = make('select', speedLabel);
  speed.setAttribute('aria-label', t('Simulation speed'));
  for (const rate of [
    -64, -32, -16, -8, -4, -2, -1, -0.5, 0.5, 1, 2, 4, 8, 16, 32, 64,
  ]) {
    const option = make('option', speed, `${rate}×`);
    option.value = String(rate);
  }
  const checkbox = (parent, label, change) => {
    const wrap = make('label', parent);
    const input = make('input', wrap);
    input.type = 'checkbox';
    wrap.appendChild(document.createTextNode(` ${label}`));
    bind(input, 'change', () => change(input.checked));
    return input;
  };
  const loop = checkbox(footer, t('Loop'), (value) =>
    controller.setLoop(value),
  );
  const trails = checkbox(root, t('Trails'), (value) =>
    controller.setTrails(value),
  );
  const labels = checkbox(root, t('Vehicle labels'), (value) =>
    controller.setParams({ labels: value }),
  );
  const sizeLabel = make('label', root, t('Vehicle model size'));
  const iconSize = make('select', sizeLabel);
  iconSize.setAttribute('aria-label', t('Vehicle model size'));
  for (const scale of [0.5, 1, 1.5, 2, 3]) {
    const option = make('option', iconSize, `${scale}×`);
    option.value = String(scale);
  }
  bind(iconSize, 'change', () =>
    controller.setParams({ modelScale: Number(iconSize.value) }),
  );
  const categories = make('div');
  categories.className = 'simulation-categories';
  const categoryInputs = new Map();
  const trackLabel = make('label', root, t('Follow vehicle'));
  const track = make('select', trackLabel);
  track.setAttribute('aria-label', t('Follow simulated vehicle'));
  const overview = make('button', root, t('View scenario overview'));
  overview.type = 'button';
  overview.className = 'data-toggle-chip';
  bind(overview, 'click', () => controller.overview());
  bind(track, 'change', () => controller.track(track.value));
  bind(scenario, 'change', () => {
    void controller.loadScenario(scenario.value).catch(() => {});
  });
  bind(speed, 'change', () => controller.setRate(Number(speed.value)));
  bind(slider, 'input', () => {
    if (!dragging) {
      dragging = true;
      resume = snapshot.playing;
      controller.pause();
    }
    controller.seek(Number(slider.value));
  });
  const finishScrub = () => {
    if (!dragging) return;
    dragging = false;
    if (resume) controller.play();
    resume = false;
  };
  bind(slider, 'change', finishScrub);
  bind(slider, 'blur', finishScrub);
  let scenarioKey = '';
  let categoryKey = '';
  let vehicleKey = '';
  const unsubscribe = controller.subscribe((state) => {
    snapshot = state;
    root.hidden = !state.enabled;
    playback.hidden = !state.enabled;
    if (!state.enabled || state.loading) {
      dragging = false;
      resume = false;
    }
    const nextScenarios = JSON.stringify(
      state.scenarios.map((s) => [s.id, s.name]),
    );
    if (scenarioKey !== nextScenarios) {
      scenario.replaceChildren();
      for (const s of state.scenarios) {
        const option = make('option', scenario, s.name);
        option.value = s.id;
      }
      scenarioKey = nextScenarios;
    }
    scenario.value = state.scenario;
    status.textContent = state.loading
      ? t('Loading scenario…')
      : state.error
        ? t(state.error)
        : t('Scenario ready · times shown in UTC');
    const blocked = state.loading || !state.active || !state.enabled;
    for (const node of [
      ...buttons,
      speed,
      slider,
      loop,
      trails,
      labels,
      iconSize,
      track,
      overview,
    ])
      node.disabled = blocked;
    scenario.disabled = state.loading;
    rateReadout.textContent = `${state.rate}×`;
    // i18n-ignore: UTC is a standard time-zone abbreviation.
    readout.textContent = state.current
      ? state.current.slice(11, 19) + ' UTC'
      : '—';
    date.textContent = state.current ? state.current.slice(0, 10) : '';
    readout.title = state.current || '';
    slider.title =
      state.start && state.stop ? `${state.start} → ${state.stop}` : '';
    scenarioName.textContent =
      state.scenarios.find((item) => item.id === state.scenario)?.name ||
      t('Simulation playback');
    const start = state.start ? Date.parse(state.start) : 0;
    for (let i = 0; i < ticks.length; i++) {
      ticks[i].textContent = state.start
        ? formatSimulationTick(
            start + (state.duration * 1000 * i) / (ticks.length - 1),
            state.duration,
          )
        : '—';
    }
    slider.max = String(state.duration || 1);
    if (!dragging) slider.value = String(state.elapsed || 0);
    slider.setAttribute(
      'aria-valuetext',
      state.current || t('No scenario loaded'),
    );
    play.textContent = state.playing ? 'Ⅱ' : '▶';
    play.title = state.playing ? t('Pause') : t('Play');
    play.setAttribute('aria-pressed', String(state.playing));
    speed.value = String(state.rate);
    loop.checked = state.loop;
    trails.checked = state.trails;
    labels.checked = state.labels;
    iconSize.value = String(state.modelScale);
    const nextCategories = state.categories
      .map((c) => `${c.id}:${c.count}`)
      .join(',');
    if (nextCategories !== categoryKey) {
      categories.replaceChildren();
      categoryInputs.clear();
      for (const c of state.categories) {
        // These listeners belong to the replaced category nodes and are GC-owned.
        const label = make('label', categories);
        const input = make('input', label);
        input.type = 'checkbox';
        label.appendChild(
          document.createTextNode(` ${categoryLabel(c.id)} (${c.count})`),
        );
        input.addEventListener('change', () =>
          controller.setCategoryVisible(c.id, input.checked),
        );
        categoryInputs.set(c.id, input);
      }
      categoryKey = nextCategories;
    }
    for (const c of state.categories) {
      const input = categoryInputs.get(c.id);
      input.checked = c.visible;
      input.disabled = blocked;
    }
    const nextVehicles = state.vehicles
      .map((v) => `${v.id}:${v.visible}`)
      .join(',');
    if (vehicleKey !== nextVehicles) {
      const previous = track.value;
      track.replaceChildren();
      const none = make('option', track, t('None'));
      none.value = '';
      for (const vehicle of state.vehicles.filter((v) => v.visible)) {
        const option = make(
          'option',
          track,
          `${vehicle.name} · ${vehicle.category}`,
        );
        option.value = vehicle.id;
      }
      track.value = [...track.options].some((o) => o.value === previous)
        ? previous
        : '';
      vehicleKey = nextVehicles;
    }
    track.value = state.trackedId || '';
  });
  container.appendChild(root);
  return {
    destroy() {
      unsubscribe();
      for (const remove of removers) remove();
      root.remove();
      playback.remove();
    },
  };
}
