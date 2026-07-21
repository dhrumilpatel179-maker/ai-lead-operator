import assert from "node:assert/strict";
import test from "node:test";
import { buildSafeDraft, classifyInquiry, extractVehicle, processInquiry } from "../lib/workflow.ts";

test("normal oil-change inquiry is green", () => {
  const lead = processInquiry({ name: "Ava Shah", email: "ava@example.com", message: "My 2020 Honda Civic needs an oil change next week." });
  assert.equal(lead.service, "Oil change"); assert.equal(lead.authority, "green"); assert.match(lead.draft, /appointment windows/i);
});

test("brake-service inquiry extracts vehicle and mileage", () => {
  const vehicle = extractVehicle("2019 Toyota RAV4 with 62,000 miles needs brakes");
  assert.equal(vehicle.vehicle, "2019 Toyota RAV4"); assert.equal(vehicle.mileage, "62,000");
});

test("check-engine-light inquiry requires approval and gives no diagnosis", () => {
  const lead = processInquiry({ name: "Ben", email: "b@example.com", message: "Check engine light on my 2018 Ford Escape" });
  assert.equal(lead.authority, "yellow"); assert.doesNotMatch(lead.draft, /because|caused by|replace/i);
});

test("missing vehicle information is requested", () => {
  const lead = processInquiry({ name: "Cara", email: "c@example.com", message: "I need an oil change" });
  assert.match(lead.draft, /year, make, model, and approximate mileage/i);
});

test("unsupported service requires human confirmation", () => {
  const lead = processInquiry({ name: "Dan", email: "d@example.com", message: "Do you repair collision body work?" });
  assert.equal(lead.service, "Unsupported service"); assert.equal(lead.authority, "yellow");
});

test("guaranteed price request cannot be green", () => {
  assert.equal(classifyInquiry("Can you guarantee the exact price?").authority, "yellow");
});

test("urgent safety concern is red and escalated", () => {
  const lead = processInquiry({ name: "Eva", email: "e@example.com", message: "My brakes fail and there is smoke. Is it unsafe to drive?" });
  assert.equal(lead.authority, "red"); assert.equal(lead.status, "Escalated"); assert.match(lead.draft, /stop driving|roadside assistance/i);
});

test("angry or legal customer is red", () => {
  assert.equal(classifyInquiry("I am furious and my lawyer will contact you about a refund").authority, "red");
});

test("red draft never promises a repair, price, or completion", () => {
  const draft = buildSafeDraft({ name: "Frank", email: "f@example.com", message: "fire" }, { service: "General service inquiry", authority: "red", vehicle: "Vehicle details needed", urgency: "urgent" });
  assert.doesNotMatch(draft, /guarantee|diagnos|fixed by|ready by|will cost/i);
});

test("source is preserved for audit activity", () => {
  const lead = processInquiry({ name: "Gita", email: "g@example.com", message: "2022 Mazda CX-5 oil change", source: "Email" });
  assert.equal(lead.source, "Email"); assert.match(lead.activities[0].label, /Email/);
});
