const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status} ${res.statusText} — ${path}`);
  }
  return res.json();
}

export function getRuns() {
  return apiFetch('/runs');
}

export function getRun(id) {
  return apiFetch(`/runs/${id}`);
}

export function getInterceptions() {
  return apiFetch('/interceptions');
}

export function getInterception(id) {
  return apiFetch(`/interceptions/${id}`);
}

export function getExtractorBrowsers() {
  return apiFetch('/extractor/browsers');
}

export function getExtractorDiff(a, b) {
  return apiFetch(`/extractor/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
}

export function getExtractorFunctions(q) {
  return apiFetch(`/extractor/functions?q=${encodeURIComponent(q)}`);
}
