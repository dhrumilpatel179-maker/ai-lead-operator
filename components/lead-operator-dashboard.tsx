"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatTime, Lead } from "../lib/workflow";

type WorkspaceRole = "owner" | "manager" | "advisor" | "viewer";

type Modal = "intake" | "lead" | "report" | null;
type Filter = "all" | "attention" | "new" | "awaiting" | "followups" | "booked";

const Icons = {
  home: <path d="M3 11.5 12 4l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  chat: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></>,
};

function Icon({ name, size = 24 }: { name: keyof typeof Icons; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{Icons[name]}</svg>;
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function statusTone(lead: Lead) { return lead.authority === "red" ? "red" : lead.status === "Awaiting Customer" ? "yellow" : lead.status === "Booked" ? "blue" : "green"; }

export function LeadOperatorDashboard({ currentUser }: { currentUser: { displayName: string; email: string } }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [workspace, setWorkspace] = useState<{ name: string; role: WorkspaceRole } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const selected = leads.find((lead) => lead.id === selectedId) ?? null;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;
    fetch("/api/inquiries").then(async (response) => {
      const payload = await response.json() as { leads?: Lead[]; workspace?: { name: string; role: WorkspaceRole }; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Workspace data is unavailable.");
      if (!active) return;
      setLeads(payload.leads ?? []);
      setWorkspace(payload.workspace ?? null);
      setLoadError(null);
    }).catch((error: unknown) => {
      if (!active) return;
      setLoadError(error instanceof Error ? error.message : "Workspace data is unavailable.");
    });
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    new: leads.filter((lead) => lead.status === "New").length,
    awaiting: leads.filter((lead) => lead.status === "Awaiting Customer").length,
    followups: leads.filter((lead) => lead.status !== "Booked" && lead.status !== "Closed").length,
    booked: leads.filter((lead) => lead.status === "Booked").length,
    drafts: leads.filter((lead) => lead.status === "New" && lead.authority !== "red").length,
  }), [leads]);

  const visibleLeads = useMemo(() => leads.filter((lead) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [lead.name, lead.vehicle, lead.service, lead.status].join(" ").toLowerCase().includes(query);
    const matchesFilter = filter === "all"
      || (filter === "attention" && (lead.authority !== "green" || lead.status === "Awaiting Customer"))
      || (filter === "new" && lead.status === "New")
      || (filter === "awaiting" && lead.status === "Awaiting Customer")
      || (filter === "followups" && lead.status !== "Booked" && lead.status !== "Closed")
      || (filter === "booked" && lead.status === "Booked");
    return matchesSearch && matchesFilter;
  }), [leads, search, filter]);

  const activities = useMemo(() => leads.flatMap((lead) => lead.activities.map((activity) => ({ ...activity, leadName: lead.name }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4), [leads]);

  function openLead(lead: Lead) { setSelectedId(lead.id); setDraftText(lead.draft); setModal("lead"); }
  function openDrafts() {
    const target = leads.find((lead) => lead.status === "New" && lead.authority !== "red") ?? leads[0];
    if (target) openLead(target);
  }

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), phone: String(form.get("phone") ?? ""),
      message: String(form.get("message") ?? ""), source: String(form.get("source") ?? "Website form"),
    };
    try {
      const response = await fetch("/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json() as { lead?: Lead; message?: string };
      if (!response.ok || !payload.lead) throw new Error(payload.message ?? "The inquiry was not stored.");
      const lead = payload.lead;
      setLeads((current) => [lead, ...current]);
      setSelectedId(lead.id);
      setDraftText(lead.draft);
      setModal("lead");
      setToast(lead.authority === "red" ? "Inquiry stored and escalated for human review." : "Inquiry stored and a safe draft is ready.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The inquiry was not stored.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateSelected(updater: (lead: Lead) => Lead) {
    if (!selectedId) return;
    setLeads((current) => current.map((lead) => lead.id === selectedId ? updater(lead) : lead));
  }

  async function approveAndSend() {
    if (!selected) return;
    if (selected.authority === "red") { setToast("Red actions cannot be sent by AI. Human review remains required."); return; }
    if (!selected.draftId) { setToast("This draft is not persisted and cannot be sent."); return; }
    setIsLoading(true);
    try {
      const response = await fetch("/api/draft-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve_send",
          draftId: selected.draftId,
          body: draftText,
          idempotencyKey: `approve_${selected.draftId}`,
        }),
      });
      const payload = await response.json() as { receipt?: { sentAt: string }; message?: string };
      if (!response.ok || !payload.receipt) throw new Error(payload.message ?? "The response was not sent.");
      const now = payload.receipt.sentAt;
      updateSelected((lead) => ({
        ...lead,
        draft: draftText,
        draftState: "sent",
        status: "Contacted",
        nextAction: "Await customer reply",
        activities: [...lead.activities,
          { label: "Draft approved and simulated send committed", at: now },
          { label: "24-hour follow-up scheduled", at: now },
        ],
      }));
      setModal(null);
      setToast("Approval, simulated send, audit event, and follow-up were committed.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The response was not sent.");
    } finally {
      setIsLoading(false);
    }
  }

  async function escalateSelected() {
    if (!selected?.draftId) { setToast("This draft is not persisted and cannot be escalated."); return; }
    setIsLoading(true);
    try {
      const response = await fetch("/api/draft-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "escalate",
          draftId: selected.draftId,
          idempotencyKey: `escalate_${selected.draftId}`,
        }),
      });
      const payload = await response.json() as { receipt?: { occurredAt: string }; message?: string };
      if (!response.ok || !payload.receipt) throw new Error(payload.message ?? "The escalation was not stored.");
      updateSelected((lead) => ({
        ...lead,
        authority: "red",
        draftState: "blocked",
        status: "Escalated",
        nextAction: "Human review",
        activities: [...lead.activities, { label: "Draft escalated to human", at: payload.receipt!.occurredAt, kind: "alert" }],
      }));
      setModal(null);
      setToast("Escalation and audit event were committed.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The escalation was not stored.");
    } finally {
      setIsLoading(false);
    }
  }

  const report = useMemo(() => ({
    received: leads.length,
    responded: leads.filter((lead) => ["Contacted", "Awaiting Customer", "Booked"].includes(lead.status)).length,
    booked: counts.booked,
    unresolved: leads.filter((lead) => lead.status === "Escalated" || lead.status === "New").length,
  }), [leads, counts.booked]);

  return <div className="app-shell">
    <aside className="side-rail" aria-label="Primary navigation">
      <div className="brand-mark" aria-label="Northstar Auto Care">N</div>
      <nav className="rail-nav">
        <button className="rail-button active" aria-label="Dashboard"><Icon name="home" /></button>
        <button className="rail-button" aria-label="Leads" onClick={() => setFilter("all")}><Icon name="users" /></button>
        <button className="rail-button" aria-label="Conversations" onClick={openDrafts}><Icon name="chat" /></button>
        <button className="rail-button" aria-label="Calendar" onClick={() => setFilter("booked")}><Icon name="calendar" /></button>
        <button className="rail-button" aria-label="Reports" onClick={() => setModal("report")}><Icon name="chart" /></button>
        <button className="rail-button" aria-label="Settings"><Icon name="settings" /></button>
      </nav>
      <div className="rail-spacer" />
      <button className="rail-button" aria-label="Help">?</button>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="workspace-name">{workspace?.name ?? "Workspace"}</div>
        <div className="search-wrap"><Icon name="search" size={20} /><input aria-label="Search leads" placeholder="Search leads, customers, or vehicles…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="top-actions"><button className="icon-button" aria-label="Notifications"><Icon name="bell" size={19} /></button><div className="avatar">{initials(currentUser.displayName)}</div><span className="user-name">{currentUser.displayName}</span></div>
      </header>

      <main className="content">
        <section className="hero">
          <div><p className="eyebrow">Authenticated workspace · {workspace?.role ?? "verifying role"}</p><h1>Lead follow-up</h1><p>Consequential actions are authorized and persisted by the server.</p></div>
          <div className="hero-actions"><button className="button secondary" onClick={() => setModal("report")}><Icon name="file" size={18} />Daily report</button><button className="button primary" onClick={openDrafts} disabled={workspace?.role === "viewer"}>Review {counts.drafts} {counts.drafts === 1 ? "draft" : "drafts"}</button></div>
        </section>

        {loadError && <div className="notice yellow" role="alert"><strong>Fail-closed:</strong> {loadError} No local fallback data or success state was created.</div>}

        <section className="metrics" aria-label="Lead metrics">
          <Metric label="New leads" value={counts.new} icon="users" selected={filter === "new"} onClick={() => setFilter(filter === "new" ? "all" : "new")} />
          <Metric label="Awaiting reply" value={counts.awaiting} icon="chat" tone="amber" selected={filter === "awaiting"} onClick={() => setFilter(filter === "awaiting" ? "all" : "awaiting")} />
          <Metric label="Follow-ups due" value={counts.followups} icon="calendar" tone="amber" selected={filter === "followups"} onClick={() => setFilter(filter === "followups" ? "all" : "followups")} />
          <Metric label="Booked this week" value={counts.booked} icon="calendar" tone="green" selected={filter === "booked"} onClick={() => setFilter(filter === "booked" ? "all" : "booked")} />
        </section>

        <section className="dashboard-grid">
          <div className="card">
            <div className="card-header"><h2>Lead queue</h2><div className="segmented"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All leads</button><button className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")}>Needs attention</button></div></div>
            <div className="table-scroll"><table className="lead-table"><thead><tr><th>Customer</th><th>Vehicle</th><th>Service</th><th>Status</th><th>Next action</th></tr></thead><tbody>
              {visibleLeads.map((lead, index) => <tr key={lead.id} data-clickable="true" onClick={() => openLead(lead)}><td><div className="customer-cell"><span className={`avatar ${index % 3 === 1 ? "amber" : index % 3 === 2 ? "violet" : ""}`}>{initials(lead.name)}</span>{lead.name}</div></td><td className="vehicle">{lead.vehicle}</td><td className="service">{lead.service}</td><td><span className={`status ${statusTone(lead)}`}>{lead.status === "New" ? "Draft ready" : lead.status}</span></td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); openLead(lead); }}>{lead.nextAction} →</button></td></tr>)}
            </tbody></table>{visibleLeads.length === 0 && <div className="empty">No leads match this view.</div>}</div>
            <div className="card-footer"><button className="text-button" onClick={() => setModal("intake")} disabled={workspace?.role === "viewer"}>+ Simulate new inquiry</button></div>
          </div>

          <div className="side-stack">
            <div className="card side-card"><h2>AI authority</h2><Authority level="green" name="Green" copy="Auto-send permitted" /><Authority level="yellow" name="Yellow" copy="Approval required" /><Authority level="red" name="Red" copy="Human controlled" /></div>
            <div className="card side-card"><h2>Recent AI activity</h2><div className="activity-list">{activities.map((activity, index) => <div className="activity" key={`${activity.leadName}-${activity.at}-${index}`}><span className={`activity-icon ${activity.kind === "alert" ? "red" : ""}`}>{activity.kind === "alert" ? "!" : "✎"}</span><p>{activity.label.replace("AI extracted lead details and created a", `Drafted a`)}<br/><strong>{activity.leadName}</strong></p><time>{formatTime(activity.at)}</time></div>)}</div><div className="card-footer"><button className="text-button" onClick={() => setModal("report")}>View daily report →</button></div></div>
          </div>
        </section>
      </main>
    </div>

    {modal === "intake" && <IntakeModal onClose={() => setModal(null)} onSubmit={submitInquiry} loading={isLoading} />}
    {modal === "lead" && selected && <LeadModal lead={selected} draft={draftText} setDraft={setDraftText} onClose={() => setModal(null)} onApprove={approveAndSend} onEscalate={escalateSelected} canWrite={workspace?.role !== "viewer" && !isLoading} />}
    {modal === "report" && <ReportModal report={report} leads={leads} onClose={() => setModal(null)} />}
    {toast && <div role="status" className="toast">{toast}</div>}
  </div>;
}

function Metric({ label, value, icon, tone = "", selected, onClick }: { label: string; value: number; icon: keyof typeof Icons; tone?: string; selected?: boolean; onClick(): void }) {
  return <button className={`metric-card ${selected ? "selected" : ""}`} onClick={onClick}><span className={`metric-icon ${tone}`}><Icon name={icon} /></span><span><span className="metric-label">{label}</span><span className="metric-value">{value}</span></span></button>;
}
function Authority({ level, name, copy }: { level: "green" | "yellow" | "red"; name: string; copy: string }) { return <div className="authority-row"><div className="authority-name"><span className={`authority-dot ${level}`} />{name}</div><div className="authority-copy">{copy}</div></div>; }

function IntakeModal({ onClose, onSubmit, loading }: { onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void; loading: boolean }) {
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal" onSubmit={onSubmit}><div className="modal-header"><div><h2>Simulate a new inquiry</h2><p>Run the complete intake and safe-draft workflow.</p></div><button type="button" className="button secondary icon-only" aria-label="Close" onClick={onClose}>×</button></div><div className="modal-body"><div className="form-grid"><div className="field"><label htmlFor="name">Customer name</label><input id="name" name="name" required defaultValue="Alex Morgan" /></div><div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required defaultValue="alex@example.com" /></div><div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" defaultValue="612-555-0184" /></div><div className="field"><label htmlFor="source">Source</label><select id="source" name="source"><option>Website form</option><option>Email</option><option>Google Business</option><option>Phone message</option></select></div><div className="field full"><label htmlFor="message">Inquiry</label><textarea id="message" name="message" required defaultValue="Hi, I have a 2020 Subaru Outback with about 74,000 miles. The brakes started squeaking this week. Can I bring it in Thursday afternoon?" /></div></div></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={loading}>{loading ? "Extracting details…" : "Process inquiry"}</button></div></form></div>;
}

function LeadModal({ lead, draft, setDraft, onClose, onApprove, onEscalate, canWrite }: { lead: Lead; draft: string; setDraft(value: string): void; onClose(): void; onApprove(): void; onEscalate(): void; canWrite: boolean }) {
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal wide" role="dialog" aria-modal="true" aria-label={`Lead details for ${lead.name}`}><div className="modal-header"><div><h2>{lead.name}</h2><p>{lead.source} · Received {formatTime(lead.createdAt)}</p></div><button className="button secondary icon-only" aria-label="Close" onClick={onClose}>×</button></div><div className="modal-body">
    {lead.authority === "red" ? <div className="notice yellow"><strong>Human control required.</strong> This inquiry contains a safety-sensitive or unusual issue. The AI can summarize it but cannot diagnose, promise, or send a consequential response.</div> : <div className="notice green"><strong>{lead.authority === "green" ? "Routine response" : "Approval required"}.</strong> Review and edit the draft before sending in this demonstration.</div>}
    <div className="summary-grid"><div className="summary-item"><span>Vehicle</span><strong>{lead.vehicle}</strong></div><div className="summary-item"><span>Service</span><strong>{lead.service}</strong></div><div className="summary-item"><span>Urgency</span><strong>{lead.urgency}</strong></div><div className="summary-item"><span>Mileage</span><strong>{lead.mileage ? `${lead.mileage} mi` : "Not provided"}</strong></div><div className="summary-item"><span>Status</span><strong>{lead.status}</strong></div><div className="summary-item"><span>Follow-up</span><strong>{formatTime(lead.nextFollowUp)}</strong></div></div>
    <div className="draft-box"><label><span>AI response draft</span><span>{lead.authority.toUpperCase()} authority</span></label><textarea value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="AI response draft" readOnly={!canWrite} /></div>
    <div className="timeline"><strong>Audit trail</strong>{lead.activities.map((activity, index) => <div className="timeline-item" key={`${activity.at}-${index}`}><div>{activity.label} · {formatTime(activity.at)}</div></div>)}</div>
  </div><div className="modal-actions"><button className="button secondary" onClick={onEscalate} disabled={!canWrite}>Escalate to human</button><button className="button primary" onClick={onApprove} disabled={!canWrite || lead.authority === "red" || lead.draftState === "sent"}>{lead.authority === "red" ? "Send blocked" : lead.draftState === "sent" ? "Already sent" : "Approve & send (simulated)"}</button></div></div></div>;
}

function ReportModal({ report, leads, onClose }: { report: { received: number; responded: number; booked: number; unresolved: number }; leads: Lead[]; onClose(): void }) {
  const urgent = leads.filter((lead) => lead.authority === "red");
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal wide" role="dialog" aria-modal="true" aria-label="Daily owner report"><div className="modal-header"><div><h2>Daily owner report</h2><p>Northstar Auto Care · Monday, July 20</p></div><button className="button secondary icon-only" aria-label="Close" onClick={onClose}>×</button></div><div className="modal-body"><div className="report-grid"><div className="report-stat"><strong>{report.received}</strong><span>Inquiries received</span></div><div className="report-stat"><strong>{report.responded}</strong><span>Responses sent</span></div><div className="report-stat"><strong>{report.booked}</strong><span>Booked this week</span></div><div className="report-stat"><strong>{report.unresolved}</strong><span>Need attention</span></div></div><div className="notice yellow"><strong>{urgent.length} escalated lead{urgent.length === 1 ? "" : "s"}:</strong> {urgent.map((lead) => lead.name).join(", ") || "None"}. No diagnosis, guaranteed pricing, or scheduling commitment was sent automatically.</div><h3>Opportunity summary</h3><p style={{color: "#536174", lineHeight: 1.6}}>The operator responded to routine inquiries, prepared approval-ready drafts, scheduled follow-ups, and kept safety-sensitive messages under human control. Estimated opportunity value is intentionally omitted until the shop supplies approved average-ticket assumptions.</p></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>Close</button><button className="button primary" onClick={() => window.print()}>Print report</button></div></div></div>;
}
