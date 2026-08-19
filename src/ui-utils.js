export function clampControlValue(control) {
  const min = Number(control.min);
  const max = Number(control.max);
  let value = Number(control.value);
  if (!Number.isFinite(value)) value = Number(control.defaultValue || min || 0);
  if (Number.isFinite(min)) value = Math.max(min, value);
  if (Number.isFinite(max)) value = Math.min(max, value);
  control.value = String(value);
  return value;
}

export function syncControlValue(source, target) {
  const value = clampControlValue(source);
  target.value = String(value);
  return value;
}

export function bindRangePair(numberControl, rangeControl, onChange = () => {}) {
  const sync = (source, target, origin) => {
    const value = syncControlValue(source, target);
    onChange({ value, origin });
  };
  numberControl.addEventListener("input", () => sync(numberControl, rangeControl, "number"));
  numberControl.addEventListener("change", () => sync(numberControl, rangeControl, "number"));
  rangeControl.addEventListener("input", () => sync(rangeControl, numberControl, "range"));
}

