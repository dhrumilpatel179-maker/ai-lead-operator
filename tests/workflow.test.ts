import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSafeDraft,
  calculateLeadMetrics,
  classifyInquiry,
  extractVehicle,
  matchExistingLead,
  processInquiry,
  type AuthorityLevel,
  type DuplicateCandidate,
  type InquiryInput,
} from "../lib/workflow.ts";

const classificationScenarios: Array<{
  id: number;
  message: string;
  authority: AuthorityLevel;
  reason?: RegExp;
}> = [
  { id: 1, message: "Need an oil change for my 2019 Honda CR-V, when can I come in?", authority: "green" },
  { id: 2, message: "Brakes are squeaking, how much would that run me?", authority: "yellow", reason: /price estimate/i },
  { id: 3, message: "Check engine light just came on, is it safe to drive?", authority: "red", reason: /safety question/i },
  { id: 4, message: "Do you work on Fords?", authority: "green" },
  { id: 5, message: "Can you guarantee it’s done by Friday?", authority: "red", reason: /completion-date guarantee/i },
  { id: 6, message: "I got quoted $400 elsewhere for a brake job, can you beat it?", authority: "red", reason: /competitive price commitment/i },
  { id: 7, message: "What are your Saturday hours?", authority: "green" },
  { id: 8, message: "Car’s making a weird noise, not sure what it is.", authority: "yellow", reason: /ambiguous symptoms/i },
  { id: 9, message: "Left my car with you last week, same problem’s back, I want my money back.", authority: "red", reason: /refund request/i },
  { id: 10, message: "Can I move my Tuesday 2pm to Thursday?", authority: "yellow", reason: /appointment change/i },
  { id: 11, message: "Third time I’ve had this issue with your shop. I’m furious.", authority: "red", reason: /manager review/i },
  { id: 12, message: "Do you take Visa?", authority: "green" },
  { id: 13, message: "We run 3 company trucks, can we set up a fleet account?", authority: "yellow", reason: /fleet or commercial/i },
  { id: 14, message: "Car won’t start, I’m stuck at [location], can someone come now?", authority: "red", reason: /stranded customer/i },
  { id: 17, message: "Following up — haven’t heard back in 5 days, still open?", authority: "green" },
  { id: 19, message: "I’ll leave you a 1-star review if you don’t respond.", authority: "red", reason: /review threat/i },
  { id: 20, message: "Just wanted to say the last service was great, thanks!", authority: "green" },
];

for (const scenario of classificationScenarios) {
  test(`Claude scenario ${scenario.id}: classification and reason`, () => {
    const result = classifyInquiry(scenario.message);
    assert.equal(result.authority, scenario.authority);
    if (scenario.reason) assert.match(result.escalationReasons.join(" "), scenario.reason);
    if (scenario.authority === "green") assert.deepEqual(result.escalationReasons, []);
  });
}

test("Claude scenario 14: stranded request receives immediate Red escalation", () => {
  const lead = processInquiry({
    name: "Roadside Customer",
    email: "roadside@example.com",
    message: "Car won’t start, I’m stuck at [location], can someone come now?",
  }, new Date("2026-07-22T12:00:00.000Z"));
  assert.equal(lead.authority, "red");
  assert.equal(lead.immediateEscalation, true);
  assert.equal(lead.nextAction, "Immediate human escalation");
  assert.equal(lead.nextFollowUp, lead.createdAt);
});

test("Claude scenario 15: non-English inquiry is flagged without assuming language capability", () => {
  const lead = processInquiry({
    name: "Cliente",
    email: "cliente@example.com",
    message: "No hablo mucho inglés, necesito un cambio de aceite.",
  });
  assert.equal(lead.authority, "yellow");
  assert.equal(lead.disposition, "language_review");
  assert.match(lead.escalationReasons.join(" "), /has not been confirmed/i);
  assert.match(lead.draft, /confirm what language assistance is available/i);
  assert.doesNotMatch(lead.draft, /hablamos español|spanish support is available/i);
});

test("Claude scenario 16: attachment without text requires review and never visual diagnosis", () => {
  const input: InquiryInput = {
    name: "Photo Customer",
    email: "photo@example.com",
    message: "",
    attachments: [{ name: "warning-light.jpg", mimeType: "image/jpeg" }],
  };
  const lead = processInquiry(input);
  assert.equal(lead.authority, "yellow");
  assert.equal(lead.disposition, "attachment_review");
  assert.match(lead.escalationReasons.join(" "), /attachment requires staff review/i);
  assert.match(lead.draft, /cannot diagnose.*image alone/i);
});

const existing: DuplicateCandidate = {
  id: "lead_existing",
  email: "customer@example.com",
  phone: "612-555-0100",
  symptoms: "Need an oil change for my 2019 Honda CR-V",
  status: "Awaiting Customer",
  createdAt: "2026-07-20T12:00:00.000Z",
};

test("Claude scenario 17: delayed follow-up links to the existing open lead", () => {
  const match = matchExistingLead({
    name: "Customer",
    email: "customer@example.com",
    message: "Following up — haven’t heard back in 5 days, still open?",
  }, [existing], new Date("2026-07-22T12:00:00.000Z"));
  assert.deepEqual(match, { leadId: "lead_existing", reason: "follow_up" });
});

test("Claude scenario 18: same request across web and manual channels is one lead", () => {
  const match = matchExistingLead({
    name: "Customer",
    email: "CUSTOMER@example.com",
    phone: "(612) 555-0100",
    message: "Need an oil change for my 2019 Honda CR-V",
    source: "Manual entry",
  }, [existing], new Date("2026-07-22T12:00:00.000Z"));
  assert.deepEqual(match, { leadId: "lead_existing", reason: "cross_channel_duplicate" });
});

test("Claude scenario 20: positive feedback is Green/no-action with no booking reply", () => {
  const lead = processInquiry({
    name: "Happy Customer",
    email: "happy@example.com",
    message: "Just wanted to say the last service was great, thanks!",
  });
  assert.equal(lead.authority, "green");
  assert.equal(lead.disposition, "no_action");
  assert.equal(lead.status, "Closed");
  assert.equal(lead.nextAction, "No reply needed");
  assert.equal(lead.draft, "");
});

test("vehicle and mileage extraction remains deterministic", () => {
  const vehicle = extractVehicle("2019 Toyota RAV4 with 62,000 miles needs brakes");
  assert.equal(vehicle.vehicle, "2019 Toyota RAV4");
  assert.equal(vehicle.mileage, "62,000");
});

test("missing vehicle information is requested for a Green inquiry", () => {
  const lead = processInquiry({ name: "Cara", email: "c@example.com", message: "I need an oil change" });
  assert.match(lead.draft, /year, make, model, and approximate mileage/i);
});

test("Red draft never promises a repair, price, or completion", () => {
  const draft = buildSafeDraft(
    { name: "Frank", email: "f@example.com", message: "fire" },
    { service: "General service inquiry", authority: "red", vehicle: "Vehicle details needed", urgency: "urgent", disposition: "reply" },
  );
  assert.doesNotMatch(draft, /guarantee|diagnos|fixed by|ready by|will cost/i);
});

test("source is preserved for audit activity", () => {
  const lead = processInquiry({ name: "Gita", email: "g@example.com", message: "2022 Mazda CX-5 oil change", source: "Email" });
  assert.equal(lead.source, "Email");
  assert.match(lead.activities[0].label, /Email/);
});

test("dashboard metrics reconcile to the exact lead set and only count due follow-ups", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const due = processInquiry({ name: "Due", email: "due@example.com", message: "Need an oil change" }, new Date("2026-07-20T12:00:00.000Z"));
  const future = processInquiry({ name: "Future", email: "future@example.com", message: "Need an oil change" }, new Date("2026-07-22T11:30:00.000Z"));
  const noAction = processInquiry({ name: "Happy", email: "happy2@example.com", message: "The last service was great, thanks!" }, now);
  const metrics = calculateLeadMetrics([
    { ...due, draftState: "pending" },
    { ...future, draftState: "pending" },
    noAction,
  ], now);
  assert.deepEqual(metrics, { total: 3, new: 2, awaiting: 0, followups: 1, booked: 0, drafts: 2 });
});
