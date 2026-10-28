import { renderMapStackChips, syncMapStackChips } from '../mapStackChips.js';
import { t } from '../i18n/index.js';

/**
 * Own Map Source presentation and selection without constructing map providers.
 * The supplied controller remains authoritative for availability and active state.
 */
export function createMapSourceControls({
  container,
  statusElement,
  presentationContainer = null,
  atcSettingsContainer = null,
  controller,
  subscribe,
  claimSelection = () => {},
  onStateChanged = () => {},
  onError = () => {},
}) {
  let destroyed = false;
  let generation = 0;
  const removers = [];
  let geographicId =
    controller.getActiveId() === 'atc'
      ? 'esri-imagery'
      : controller.getActiveId();
  const bind = (element, type, listener) => {
    element.addEventListener(type, listener);
    removers.push(() => element.removeEventListener(type, listener));
  };
  function render(state) {
    if (destroyed || !state) return;
    syncMapStackChips(container, state.activeId);
    const atc = state.activeId === 'atc';
    if (!atc) geographicId = state.activeId;
    for (const button of presentationContainer?.querySelectorAll(
      '[data-map-presentation]',
    ) || []) {
      const active = (button.dataset.mapPresentation === 'atc') === atc;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    }
    if (presentationContainer && container.closest)
      container.closest('.map-source-section').hidden = atc;
    if (atcSettingsContainer) {
      atcSettingsContainer.hidden = !atc;
      for (const input of atcSettingsContainer.querySelectorAll(
        '[data-atc-setting]',
      )) {
        const value = state.atcSettings?.[input.dataset.atcSetting];
        if (value === undefined) continue;
        if (input.type === 'checkbox') input.checked = value;
        else input.value = String(value);
      }
    }
    if (statusElement) {
      const stack = state.activeStack;
      statusElement.textContent =
        state.status === 'switching'
          ? '...'
          : stack?.shortLabel || stack?.label || t('MAP');
      statusElement.classList.toggle('warn', !!state.lastError);
    }
  }
  async function select(stackId, { syncShare = true } = {}) {
    if (destroyed) return null;
    const current = ++generation;
    if (syncShare) claimSelection();
    const before = controller.getActiveId();
    render(controller.getState('switching'));
    let state;
    try {
      state = await controller.setStack(stackId);
    } catch (error) {
      if (!destroyed && current === generation) {
        render(controller.getState());
        onError(error?.message || String(error));
      }
      throw error;
    }
    if (destroyed || current !== generation) return state;
    render(controller.getState());
    if (state?.activeId === before && stackId !== before && state?.lastError)
      onError(state.lastError);
    if (syncShare) onStateChanged();
    return state;
  }
  function refresh() {
    if (destroyed) return;
    for (const remove of removers.splice(0)) remove();
    renderMapStackChips(container, controller.getStacks(), {
      activeId: controller.getActiveId(),
      onSelect: (id) => {
        void select(id).catch(() => {});
      },
      bind,
    });
    for (const button of presentationContainer?.querySelectorAll(
      '[data-map-presentation]',
    ) || [])
      bind(button, 'click', () => {
        const id =
          button.dataset.mapPresentation === 'atc' ? 'atc' : geographicId;
        void select(id).catch(() => {});
      });
    const updateSettings = (patch) => {
      render(controller.setAtcSettings(patch));
      onStateChanged();
    };
    for (const input of atcSettingsContainer?.querySelectorAll(
      '[data-atc-setting]',
    ) || [])
      bind(input, 'input', () =>
        updateSettings({
          [input.dataset.atcSetting]:
            input.type === 'checkbox'
              ? input.checked
              : input.type === 'color'
                ? input.value
                : Number(input.value),
        }),
      );
    for (const button of atcSettingsContainer?.querySelectorAll(
      '[data-atc-color]',
    ) || [])
      bind(button, 'click', () =>
        updateSettings({ color: button.dataset.atcColor }),
      );
    render(controller.getState());
  }
  const unsubscribe = subscribe(() => {
    if (destroyed) return;
    render(controller.getState());
    onStateChanged();
  });
  refresh();
  return {
    render,
    select,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      unsubscribe?.();
      for (const remove of removers.splice(0)) remove();
    },
  };
}
