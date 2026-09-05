import { CLASSIFICATIONS, findClassification } from "./utils.js";
function applyApprovalFlags(entries) {
  const approvedIds = new Set(
    entries.filter((e) => e.type === "approval").map((e) => e.approvesId)
  );
  entries.forEach((e) => {
    if (e.proposeFor !== "takashi") return;
    e.approved = approvedIds.has(e.id);
    e.pendingApproval = !e.approved;
  });
}
export function groupThreads(items) {
  const byThread = new Map();
  items.forEach((it) => {
    if (!byThread.has(it.threadId)) byThread.set(it.threadId, []);
    byThread.get(it.threadId).push(it);
  });
  const threads = [];
  byThread.forEach((entries, threadId) => {
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    applyApprovalFlags(entries);
    const root = entries.find((e) => e.id === threadId) || entries[0];
    const children = entries.filter((e) => e.id !== threadId);
    const voidView = {};
    const reactByLane = {};
    let status = "open";
    let displayTitle = root.title;
    let titleCorrected = false;
    let gist = null;
    const linkValueBySeq = new Map();
    entries.forEach((e) => {
      if (e.type === "void" && e.by) voidView[e.by.startsWith("claude") ? "claude" : "takashi"] = !!e.value;
      if (e.type === "react" && e.by) reactByLane[e.by] = !!e.value;
      if (e.type === "status" && e.status) status = e.status;
      if (e.type === "correction" && e.title) { displayTitle = e.title; titleCorrected = true; }
      if (e.type === "gist" && e.text) gist = e.text;
      if (e.type === "link" && Number.isInteger(e.relSeq)) linkValueBySeq.set(e.relSeq, e.value !== false);
    });
    const forwardRelSeqs = [...linkValueBySeq.entries()].filter(([, v]) => v).map(([seq]) => seq);
    let cls = null;
    let clsVia = null;
    entries.forEach((e) => {
      if (e.type !== "new" && e.type !== "note") return;
      const found = findClassification(e.tags);
      if (found) { cls = found; clsVia = e.type; }
    });
    const isRootless = root.type !== "new";
    const hiddenVoid = isRootless || (voidView.claude === true && voidView.takashi === true);
    threads.push({ threadId, root, children, entries, voidView, reactByLane, status, displayTitle, titleCorrected, gist, hiddenVoid, cls, clsVia, forwardRelSeqs });
  });
  const seqTitle = {};
  threads.forEach((t) => {
    if (Number.isInteger(t.root.seq)) seqTitle[t.root.seq] = (t.displayTitle || "").slice(0, 10);
  });
  const relatedBySeq = new Map();
  const addRelated = (seq, other) => {
    if (!relatedBySeq.has(seq)) relatedBySeq.set(seq, new Set());
    relatedBySeq.get(seq).add(other);
  };
  threads.forEach((t) => {
    if (!Number.isInteger(t.root.seq)) return;
    t.forwardRelSeqs.forEach((target) => {
      addRelated(t.root.seq, target);
      addRelated(target, t.root.seq);
    });
  });
  threads.forEach((t) => {
    const set = Number.isInteger(t.root.seq) ? relatedBySeq.get(t.root.seq) : null;
    t.relatedSeqs = set ? [...set].sort((a, b) => a - b) : [];
    delete t.forwardRelSeqs;
  });
  threads.sort((a, b) => b.root.createdAt.localeCompare(a.root.createdAt));
  threads.seqTitle = seqTitle;
  return threads;
}
export function entryTypeLabel(e) {
  if (e.type === "void") return `void = ${e.value ? "true" : "false"}`;
  if (e.type === "status") return `status → ${e.status || ""}`;
  if (e.type === "gist") return `gist → ${e.text || ""}`;
  if (e.type === "priority") return `priority`;
  if (e.type === "verified_on_device") return `verified on device`;
  if (e.type === "approval") return `approval`;
  return e.type;
}
