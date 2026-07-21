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

export type Lead = {
  id: string;
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
  summary: string;
  draft: string;
  nextAction: string;
  nextFollowUp: string;
  createdAt: string;
  activities: { label: string; at: string; kind?: "normal" | "alert" }[];
};

export type InquiryInput = {
  name: string;
  email: string;
  phone?: string;
  message: string;
  source?: string;
};

const YEAR = /\b(19\d{2}|20\d{2})\b/;
const MILEAGE = /\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,3}k)\s*(?:miles?|mi)?\b/i;
const MAKES = ["Honda", "Toyota", "Ford", "Chevrolet", "Subaru", "Nissan", "Hyundai", "Kia", "BMW", "Audi", "Jeep", "Ram", "Mazda", "Volkswagen", "Lexus"];

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function classifyInquiry(message: string) {
  const text = message.toLowerCase();
  const guaranteedPrice = /(guarantee|exact|final)\s+(price|cost)|price guarantee/.test(text);
  const angry = /(furious|angry|lawsuit|lawyer|terrible service|rip.?off|refund)/.test(text);
  const safety = /(brake.*fail|no brakes|smoke|fire|fuel leak|overheat|steering.*fail|unsafe to drive)/.test(text);
  const unsupported = /(body work|collision|windshield|transmission rebuild)/.test(text);
  const checkEngine = /(check engine|engine light|cel)/.test(text);
  const service = /oil/.test(text)
    ? "Oil change"
    : /brake/.test(text)
      ? "Brake service"
      : checkEngine
        ? "Check engine light"
        : /tire/.test(text)
          ? "Tire service"
          : /battery/.test(text)
            ? "Battery service"
            : unsupported
              ? "Unsupported service"
              : "General service inquiry";

  const authority: AuthorityLevel = safety || angry ? "red" : guaranteedPrice || checkEngine || unsupported ? "yellow" : "green";
  const urgency = safety ? "urgent" : /today|asap|tomorrow|soon/.test(text) ? "soon" : "routine";
  return { authority, urgency: urgency as Lead["urgency"], service, safety, angry, guaranteedPrice, unsupported };
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

export function buildSafeDraft(input: InquiryInput, lead: Pick<Lead, "service" | "authority" | "vehicle" | "urgency">) {
  const firstName = input.name.trim().split(/\s+/)[0] || "there";
  if (lead.authority === "red") {
    return `Hi ${firstName}, thanks for reaching out. We’ve flagged your message for a team member to review right away. If the vehicle may be unsafe to drive, please stop driving it and contact roadside assistance. We’ll follow up as soon as possible during business hours.`;
  }
  if (lead.authority === "yellow" && lead.service === "Unsupported service") {
    return `Hi ${firstName}, thanks for contacting Northstar Auto Care. That service may be outside our current offering, so I’m asking a team member to confirm before we advise you. If you share your vehicle year, make, and model, we’ll make sure the response is accurate.`;
  }
  const missingVehicle = lead.vehicle === "Vehicle details needed";
  return missingVehicle
    ? `Hi ${firstName}, thanks for contacting Northstar Auto Care. We can help with your ${lead.service.toLowerCase()} inquiry. Could you send the vehicle year, make, model, and approximate mileage? Once we have those details, we can suggest the next available appointment windows.`
    : `Hi ${firstName}, thanks for contacting Northstar Auto Care about your ${lead.vehicle}. We received your ${lead.service.toLowerCase()} inquiry. A team member will review the details and we can suggest the next available appointment windows. Is there a day or time that works best for you?`;
}

export function processInquiry(input: InquiryInput, now = new Date()): Lead {
  const classification = classifyInquiry(input.message);
  const vehicle = extractVehicle(input.message);
  const id = `lead_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
  const status: LeadStatus = classification.authority === "red" ? "Escalated" : "New";
  const nextFollowUp = new Date(now.getTime() + (classification.authority === "red" ? 30 : 24 * 60) * 60 * 1000).toISOString();
  const leadBase = {
    service: classification.service,
    authority: classification.authority,
    vehicle: vehicle.vehicle,
    urgency: classification.urgency,
  };
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
    summary: `${classification.urgency === "urgent" ? "Urgent" : titleCase(classification.urgency)} ${classification.service.toLowerCase()} inquiry for ${vehicle.vehicle}.`,
    draft: buildSafeDraft(input, leadBase),
    nextAction: classification.authority === "red" ? "Human review" : "Review response",
    nextFollowUp,
    createdAt: now.toISOString(),
    activities: [
      { label: `Inquiry received via ${input.source ?? "Website form"}`, at: now.toISOString() },
      { label: `AI extracted lead details and created a ${classification.authority} draft`, at: now.toISOString(), kind: classification.authority === "red" ? "alert" : "normal" },
    ],
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
