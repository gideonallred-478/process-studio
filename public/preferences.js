export const preferenceKey = 'process-studio-preferences-v1';
export function normalizePreferences(value, local = false) {
  return { aiMode: ['local','chatgpt','hosted'].includes(value?.aiMode) ? value.aiMode : local ? 'local' : 'hosted', spaceAware: typeof value?.spaceAware === 'boolean' ? value.spaceAware : true, showExample: typeof value?.showExample === 'boolean' ? value.showExample : false };
}
export function cameraTarget(spots, current, spaceAware) { return spots[spaceAware ? current : 0]; }
const local = typeof location !== 'undefined' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
let current;
try { current = normalizePreferences(JSON.parse(localStorage.getItem(preferenceKey)), local); } catch { current = normalizePreferences(null, local); }
export function getPreferences() { return { ...current }; }
export function savePreferences(value) {
  current = normalizePreferences({ ...current, ...value }, local);
  try { localStorage.setItem(preferenceKey, JSON.stringify(current)); } catch {}
  return getPreferences();
}
