

import { fmtTs } from "./utils.js";

const API_BASE = "https://ab-board-api.azurewebsites.net/api";

export async function applyLastUpdated(filePath, elementId = "lastUpdated", label = "更新") {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/last-updated?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.date) return;
    el.textContent = `${label}: ${fmtTs(data.date)}`;
  } catch (e) {

  }
}
