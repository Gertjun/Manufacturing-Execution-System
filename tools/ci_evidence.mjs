// D115: echte uitvoeringsvolgorde; bij twijfel opnieuw testen.
export function newestValid(attempts, valid) {
  if (!attempts.length) return false;
  const timed = attempts.map(a => ({...a, start: Date.parse(a.job.started_at), end: Date.parse(a.job.completed_at)}));
  if (timed.some(a => !Number.isFinite(a.start) || !Number.isFinite(a.end) || a.end < a.start)) return false;
  timed.sort((a,b) => b.start-a.start || b.end-a.end);
  const latest = timed[0];
  return Boolean(valid(latest) && timed.slice(1).every(a => a.end < latest.start || valid(a)));
}
export function completeList(response, key) {
  if (!Array.isArray(response[key]) || !Number.isInteger(response.total_count) || response.total_count !== response[key].length) throw Error("Onvolledig CI-bewijs");
  return response[key];
}
// Geen bewijs uit herstarts: eerdere pogingen blijven wel zichtbaar als mogelijke blokkade.
export function latestAttempt(run) { return run.run_attempt === 1; }
