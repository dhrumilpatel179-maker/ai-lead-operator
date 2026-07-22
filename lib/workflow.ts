export type AuthorityLevel = "green" | "yellow" | "red";
export type LeadStatus =
  | "New"
  | "Contacted"
  | "Awaiting Customer"
  | "Qualified"
  | "Appointment Requested"
  | "Booked"
  | "Escalated"
  | "Lost"
  | "Closed";

export type InquiryDisposition = "reply" | "no_action" | "language_review" | "attachment_review";

export type Lead = {
  id: string;
  draftId?: string;
  name: string;
  email: string;
  phone?: string;
  vehicle: string;
  year?: string;
  make?: string;
  model?: string;
  mileage?: string;
  service: string;
  symptoms: string;
  urgency: "routine" | "soon" | "urgent";
  source: string;
  status: LeadStatus;
  authority: AuthorityLevel;
  escalationReasons: string[];
  immediateEscalation: boolean;
  disposition: InquiryDisposition;
  summary: string;
  draft: string;
  draftState?: "pending" | "approved" | "rejected" | "sent" | "blocked";
  nextAction: string;
  nextFollowUp: string;
  createdAt: string;
  activities: { label: string; at: string; kind?: "normal" | "alert" }[];
};

export type InquiryAttachment = {
  name?: string;
  mimeType?: string;
};

export type InquiryInput = {
  name: string;
  email: string;
  phone?: string;
  message: string;
  source?: string;
  attachments?: InquiryAttachment[];
};

export type DuplicateCandidate = Pick<Lead, "id" | "email" | "symptoms" | "createdAt"> & { phone?: string | null; status: string };

const YEAR = /\b(19\d{2}|20\d{2})\b/;
const MILEAGE = /\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,3}k)\s*(?:miles?|mi)?\b/i;
const MAKES = ["Honda", "Toyota", "Ford", "Chevrolet", "Subaru", "Nissan", "Hyundai", "Kia", "BMW", "Audi", "Jeep", "Ram", "Mazda", "Volkswagen", "Lexus"];

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function addReason(reasons: string[], condition: boolean, reason: string) {
  if (condition && !reasons.includes(reason)) reasons.push(reason);
}

export function classifyInquiry(message: string, options: { hasAttachment?: boolean } = {}) {
  const text = message.trim().toLowerCase();
  const hasAttachment = options.hasAttachment === true;
  const positiveFeedback = /\b(?:great|excellent|amazing|thank(?:s| you)|appreciate)\b/.test(text)
    && /\b(?:last|recent|previous)\s+(?:service|visit|repair)\b/.test(text)
    && !/\b(?:but|however|problem|issue|refund|angry|furious)\b/.test(text);
  const languageReview = /\b(?:no hablo|hablo poco|espa[nñ]ol|necesito|cambio de aceite)\b/.test(text);
  const reviewThreat = /\b(?:one|1)[- ]star review|bad review|leave you a review/.test(text) && /\bif\b|don['’]?t respond/.test(text);
  const stranded = /\b(?:won['’]?t start|will not start|stranded|stuck at)\b/.test(text)
    && /\b(?:come now|someone come|tow|roadside|stuck|stranded)\b/.test(text);
  const safetyQuestion = /\b(?:safe|unsafe) to drive\b|\b(?:can|should) i (?:still )?drive\b/.test(text);
  const severeSafety = /\b(?:brakes? (?:fail|failed|failing)|no brakes?|smoke|fire|fuel leak|overheat(?:ing)?|steering (?:fail|failed|failing))\b/.test(text);
  const completionGuarantee = /\b(?:guarantee|promise|definitely)\b.{0,45}\b(?:done|ready|finish(?:ed)?|complete(?:d)?|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(text);
  const priceGuarantee = /\b(?:guarantee|exact|final)\b.{0,24}\b(?:price|cost|quote)\b|\bprice guarantee\b/.test(text);
  const competitivePrice = /\bquoted?\b.{0,35}(?:\$\s*\d+|elsewhere|another shop)|\b(?:beat|match) (?:that|their|the) (?:price|quote)\b/.test(text);
  const complaintOrDispute = /\b(?:furious|angry|lawsuit|lawyer|terrible service|rip.?off|refund|money back|same problem['’]?s? back|third time|warranty dispute)\b/.test(text);
  const unsupported = /\b(?:body work|collision|windshield|transmission rebuild)\b/.test(text);
  const checkEngine = /\b(?:check engine|engine light|cel)\b/.test(text);
  const priceRequest = /\b(?:how much|what would (?:that|it) run|price|cost|quote|estimate)\b|[$€£]\s*\d/.test(text);
  const reschedule = /\b(?:move|reschedule|change)\b.{0,35}\b(?:appointment|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.test(text);
  const fleet = /\b(?:fleet account|company trucks?|commercial account)\b/.test(text);
  const ambiguousSymptom = /\b(?:weird|strange|odd|unknown)\b.{0,25}\b(?:noise|sound|problem|issue)\b|\bnot sure what it is\b/.test(text);
  const followUp = /\b(?:following up|follow up|haven['’]?t heard back|still open)\b/.test(text);
  const noTextAttachment = hasAttachment && text.length === 0;

  const redReasons: string[] = [];
  addReason(redReasons, safetyQuestion || severeSafety, "Safety question requires human review.");
  addReason(redReasons, completionGuarantee, "Completion-date guarantee requested.");
  addReason(redReasons, priceGuarantee || competitivePrice, "Price guarantee or competitive price commitment requested.");
  addReason(redReasons, complaintOrDispute, "Complaint, repeat-service dispute, or refund request requires manager review.");
  addReason(redReasons, reviewThreat, "Review threat requires manager handling.");
  addReason(redReasons, stranded, "Stranded customer requested immediate assistance.");

  const yellowReasons: string[] = [];
  addReason(yellowReasons, priceRequest, "Price estimate requested.");
  addReason(yellowReasons, checkEngine, "Warning-light inquiry requires staff review.");
  addReason(yellowReasons, unsupported, "Requested service requires staff confirmation.");
  addReason(yellowReasons, reschedule, "Existing appointment change requires staff confirmation.");
  addReason(yellowReasons, fleet, "Fleet or commercial account request requires staff review.");
  addReason(yellowReasons, ambiguousSymptom, "Ambiguous symptoms require staff triage.");
  addReason(yellowReasons, languageReview, "Supported-language assistance has not been confirmed.");
  addReason(yellowReasons, noTextAttachment, "Attachment requires staff review; no visual diagnosis is performed.");

  const authority: AuthorityLevel = redReasons.length > 0 ? "red" : yellowReasons.length > 0 ? "yellow" : "green";
  const escalationReasons = authority === "red" ? redReasons : authority === "yellow" ? yellowReasons : [];
  const service = /\boil\b|cambio de aceite/.test(text)
    ? "Oil change"
    : /\bbrake/.test(text)
      ? "Brake service"
      : checkEngine
        ? "Check engine light"
        : /\btire/.test(text)
          ? "Tire service"
          : /\bbattery/.test(text)
            ? "Battery service"
            : unsupported
              ? "Unsupported service"
              : "General service inquiry";
  const immediateEscalation = stranded || severeSafety;
  const urgency = immediateEscalation ? "urgent" : /\b(?:today|asap|tomorrow|soon|come now)\b/.test(text) ? "soon" : "routine";
  const disposition: InquiryDisposition = positiveFeedback
    ? "no_action"
    : languageReview
      ? "language_review"
      : noTextAttachment
        ? "attachment_review"
        : "reply";

  return {
    authority,
    urgency: urgency as Lead["urgency"],
    service,
    safety: safetyQuestion || severeSafety,
    angry: complaintOrDispute || reviewThreat,
    guaranteedPrice: priceGuarantee || competitivePrice,
    unsupported,
    escalationReasons,
    immediateEscalation,
    disposition,
    linkToExisting: followUp,
  };
}

export function extractVehicle(message: string) {
  const year = message.match(YEAR)?.[1];
  const make = MAKES.find((item) => new RegExp(`\\b${item}\\b`, "i").test(message));
  let model: string | undefined;
  if (make) {
    const match = message.match(new RegExp(`\\b${make}\\s+([A-Za-z0-9-]+)`, "i"));
    model = match?.[1] ? titleCase(match[1]) : undefined;
  }
  const mileage = message.match(MILEAGE)?.[1];
  const vehicle = [year, make, model].filter(Boolean).join(" ") || "Vehicle details needed";
  return { year, make, model, mileage, vehicle };
}

export function buildSafeDraft(input: InquiryInput, lead: Pick<Lead, "service" | "authority" | "vehicle" | "urgency" | "disposition">) {
  const firstName = input.name.trim().split(/\s+/)[0] || "there";
  if (lead.disposition === "no_action") return "";
  if (lead.disposition === "language_review") {
    return `Hi ${firstName}, thank you for contacting Northstar Auto Care. A team member will review your message and confirm what language assistance is available before replying.`;
  }
  if (lead.disposition === "attachment_review") {
    return `Hi ${firstName}, thank you for the photo. A team member needs to review the attachment before responding. We cannot diagnose a warning light from an image alone.`;
  }
  if (lead.authority === "red") {
    return `Hi ${firstName}, thanks for reaching out. We’ve flagged your message for a team member to review right away. If the vehicle may be unsafe to drive, please stop driving it and contact roadside assistance. We’ll follow up as soon as possible during business hours.`;
  }
  if (lead.authority === "yellow") {
    return `Hi ${firstName}, thanks for contacting Northstar Auto Care. A team member needs to review your request before we provide pricing, confirm a schedule change, or advise on next steps. We’ll follow up during business hours.`;
  }
  const missingVehicle = lead.vehicle === "Vehicle details needed";
  return missingVehicle
    ? `Hi ${firstName}, thanks for contacting Northstar Auto Care. We can help with your ${lead.service.toLowerCase()} inquiry. Could you send the vehicle year, make, model, and approximate mileage? Once we have those details, we can suggest the next available appointment windows.`
    : `Hi ${firstName}, thanks for contacting Northstar Auto Care about your ${lead.vehicle}. We received your ${lead.service.toLowerCase()} inquiry. A team member will review the details and we can suggest the next available appointment windows. Is there a day or time that works best for you?`;
}

function normalizedContact(value?: string | null) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9@.]/g, "") ?? "";
}

function normalizedInquiry(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchExistingLead(input: InquiryInput, candidates: DuplicateCandidate[], now = new Date()) {
  const email = normalizedContact(input.email);
  const phone = normalizedContact(input.phone);
  const sameContact = candidates.filter((candidate) =>
    (email && normalizedContact(candidate.email) === email)
      || (phone && normalizedContact(candidate.phone) === phone),
  ).filter((candidate) => !["Closed", "Lost"].includes(candidate.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (classifyInquiry(input.message, { hasAttachment: Boolean(input.attachments?.length) }).linkToExisting && sameContact[0]) {
    return { leadId: sameContact[0].id, reason: "follow_up" as const };
  }

  const fingerprint = normalizedInquiry(input.message);
  if (fingerprint.length < 8) return null;
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const duplicate = sameContact.find((candidate) =>
    new Date(candidate.createdAt).getTime() >= cutoff
      && normalizedInquiry(candidate.symptoms) === fingerprint,
  );
  return duplicate ? { leadId: duplicate.id, reason: "cross_channel_duplicate" as const } : null;
}

export function processInquiry(input: InquiryInput, now = new Date()): Lead {
  const classification = classifyInquiry(input.message, { hasAttachment: Boolean(input.attachments?.length) });
  const vehicle = extractVehicle(input.message);
  const id = `lead_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
  const status: LeadStatus = classification.disposition === "no_action"
    ? "Closed"
    : classification.authority === "red"
      ? "Escalated"
      : "New";
  const followUpMinutes = classification.immediateEscalation ? 0 : classification.authority === "red" ? 30 : 24 * 60;
  const nextFollowUp = classification.disposition === "no_action"
    ? now.toISOString()
    : new Date(now.getTime() + followUpMinutes * 60 * 1000).toISOString();
  const leadBase = {
    service: classification.service,
    authority: classification.authority,
    vehicle: vehicle.vehicle,
    urgency: classification.urgency,
    disposition: classification.disposition,
  };
  const nextAction = classification.disposition === "no_action"
    ? "No reply needed"
    : classification.immediateEscalation
      ? "Immediate human escalation"
      : classification.authority === "red"
        ? "Human review"
        : classification.authority === "yellow"
          ? "Staff approval"
          : "Review response";
  return {
    id,
    name: input.name.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim(),
    ...vehicle,
    service: classification.service,
    symptoms: input.message.trim(),
    urgency: classification.urgency,
    source: input.source ?? "Website form",
    status,
    authority: classification.authority,
    escalationReasons: classification.escalationReasons,
    immediateEscalation: classification.immediateEscalation,
    disposition: classification.disposition,
    summary: classification.disposition === "no_action"
      ? `Positive customer feedback for ${vehicle.vehicle}; no booking reply needed.`
      : `${classification.urgency === "urgent" ? "Urgent" : titleCase(classification.urgency)} ${classification.service.toLowerCase()} inquiry for ${vehicle.vehicle}.`,
    draft: buildSafeDraft(input, leadBase),
    nextAction,
    nextFollowUp,
    createdAt: now.toISOString(),
    activities: [
      { label: `Inquiry received via ${input.source ?? "Website form"}`, at: now.toISOString() },
      { label: classification.disposition === "no_action"
        ? "Classified as positive feedback; no outbound booking reply created"
        : `Deterministic policy created a ${classification.authority} draft`, at: now.toISOString(), kind: classification.authority === "green" ? "normal" : "alert" },
    ],
  };
}

export function calculateLeadMetrics(leads: Lead[], now = new Date()) {
  const due = now.getTime();
  return {
    total: leads.length,
    new: leads.filter((lead) => lead.status === "New").length,
    awaiting: leads.filter((lead) => lead.status === "Awaiting Customer").length,
    followups: leads.filter((lead) =>
      lead.disposition !== "no_action"
        && lead.status !== "Booked"
        && lead.status !== "Closed"
        && Date.parse(lead.nextFollowUp) <= due,
    ).length,
    booked: leads.filter((lead) => lead.status === "Booked").length,
    drafts: leads.filter((lead) => lead.draftState === "pending").length,
  };
}

export const seedLeads: Lead[] = [
  processInquiry({ name: "Sarah Chen", email: "sarah@example.com", message: "My 2019 Honda CR-V needs brake service. It has about 62,000 miles. Can I bring it in this week?", source: "Website form" }, new Date("2026-07-20T13:21:00.000Z")),
  processInquiry({ name: "James Wilson", email: "james@example.com", message: "The check engine light is flashing on my 2017 Ford F-150 and it smells hot. Is it unsafe to drive?", source: "Email" }, new Date("2026-07-20T12:58:00.000Z")),
  processInquiry({ name: "Maria Lopez", email: "maria@example.com", message: "Need an oil change for a 2021 Toyota RAV4. What appointments do you have?", source: "Google Business" }, new Date("2026-07-20T13:05:00.000Z")),
];

seedLeads[2] = { ...seedLeads[2], status: "Awaiting Customer", nextAction: "Follow up today" };

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(iso));
}
