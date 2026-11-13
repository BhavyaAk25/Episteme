/**
 * AI generation benchmark (opt-in, uses real AI calls):
 *   BENCHMARK=1 npm run benchmark            (dev server on :3123)
 * Generates ~10 varied systems and scores each: coverage of what the
 * description asks for, design errors/warnings after the safe fixes, and
 * Postgres test results. Writes a JSON report to BENCH_OUT if set.
 */
import { describe, expect, it } from "vitest";
import type { ERD } from "@/types/erd";
import { importErd } from "@/lib/erd/model";
import { applyOps } from "@/lib/erd/applyOps";
import { autoFixErd, lintErd } from "@/lib/verify/linter";
import { runVerification } from "@/lib/verify/runner";

const BASE = process.env.BENCH_URL ?? "http://localhost:3123";

interface Case {
  id: string;
  prompt: string;
  /** Each concept must appear as a table or column name (regex). */
  expect: Record<string, RegExp>;
}

export const CASES: Case[] = [
  {
    id: "vet",
    prompt:
      "A veterinary clinic chain with several clinics. Pet owners can have multiple pets, and each pet has a species, breed, birth date and microchip number (unique). Vets work at one or more clinics, and each vet can have a supervising vet. Owners book appointments for a pet with a vet at a specific clinic; an appointment has a status (requested, confirmed, completed, cancelled, no-show) and a start and end time. Each completed appointment has exactly one visit record with notes, weight and diagnoses (a visit can have many diagnoses from a standard diagnosis catalog). Vets can prescribe medications during a visit with dose, frequency and duration. Clinics stock medications with a quantity on hand. Every visit produces one invoice with line items for services and medications; invoices can be paid in several partial payments. Deleting an owner should delete their pets, but invoices must never be deleted.",
    expect: { clinic: /clinic/, owner: /owner/, pet: /pet/, vet: /vet/, supervisor: /supervis/, appointment: /appointment/, visit: /visit/, diagnosis: /diagnos/, medication: /medication/, prescription: /prescri/, stock: /stock|inventory|quantity_on_hand/, invoice: /invoice/, line_item: /item|line/, payment: /payment/, microchip: /microchip/ },
  },
  {
    id: "rides",
    prompt: "A ride-sharing app with riders, drivers, vehicles, trips with fare breakdowns, ratings both ways, and promo codes.",
    expect: { rider: /rider/, driver: /driver/, vehicle: /vehicle/, trip: /trip|ride/, fare: /fare|amount|price/, rating: /rating/, promo: /promo|coupon|discount/ },
  },
  {
    id: "university",
    prompt:
      "University course registration: students enroll in course sections taught by instructors each term. Courses can have prerequisite courses. Each enrollment gets a final grade. Sections meet in rooms at scheduled times and have a seat limit.",
    expect: { student: /student/, course: /course/, section: /section/, instructor: /instructor|professor|teacher/, term: /term|semester/, prerequisite: /prereq/, enrollment: /enroll/, grade: /grade/, room: /room/, capacity: /seat|capacity|limit/ },
  },
  {
    id: "hotel",
    prompt: "A hotel booking system: hotels have room types and rooms; guests make reservations for date ranges; reservations are paid; guests can leave a review after their stay.",
    expect: { hotel: /hotel/, room_type: /room_type|type/, room: /room/, guest: /guest/, reservation: /reserv|booking/, dates: /check_in|start|arriv/, payment: /payment/, review: /review/ },
  },
  {
    id: "projects",
    prompt:
      "Project management: workspaces contain projects; projects have tasks that can have subtasks; tasks can be assigned to several members; tasks have labels, comments and time entries logged by members.",
    expect: { workspace: /workspace/, project: /project/, task: /task/, subtask: /parent|subtask/, member: /member|user/, assignment: /assign/, label: /label|tag/, comment: /comment/, time_entry: /time/ },
  },
  {
    id: "restaurant",
    prompt: "Restaurant ordering: menus with categories and items, items have optional modifiers, customers order at tables, orders have items with chosen modifiers, and the kitchen tracks ticket status.",
    expect: { menu: /menu/, category: /categor/, item: /item/, modifier: /modifier|option/, table: /table/, order: /order/, status: /status/ },
  },
  {
    id: "library",
    prompt: "A library where members borrow book copies; each loan has a due date and return date; members can place holds on books; overdue loans create fines.",
    expect: { member: /member|patron/, book: /book/, copy: /cop/, loan: /loan|borrow|checkout/, due: /due/, returned: /return/, hold: /hold|reserv/, fine: /fine|fee|penalt/ },
  },
  {
    id: "gym",
    prompt: "Gym membership: members subscribe to plans, trainers run classes, class sessions have a capacity, members book sessions and check in at the front desk.",
    expect: { member: /member/, plan: /plan/, subscription: /subscri|membership/, trainer: /trainer|instructor|coach/, class: /class/, session: /session|schedule/, capacity: /capacity/, booking: /booking|reserv/, check_in: /check/ },
  },
  {
    id: "tickets",
    prompt: "Event ticketing with venues, events, ticket tiers with limited quantities, orders, attendees, check-in scans at the door, and refunds.",
    expect: { venue: /venue/, event: /event/, tier: /tier|ticket_type/, quantity: /quantity|capacity|limit/, order: /order/, attendee: /attendee/, check_in: /check|scan/, refund: /refund/ },
  },
  {
    id: "todo",
    prompt: "A simple to-do app: users have lists, lists have todos with a due date and done flag.",
    expect: { user: /user/, list: /list/, todo: /todo|task/, due: /due/, done: /done|complet/ },
  },
];

const names = (erd: ERD) => erd.tables.flatMap((t) => [t.name, ...t.columns.map((c) => `${t.name}.${c.name}`)]).join(" ");

async function generate(prompt: string): Promise<{ erd: ERD | null; mode: string; ms: number; error?: string }> {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
  const body = (await response.json()) as { erd?: ERD; generationMode?: string; error?: string };
  return { erd: response.ok && body.erd ? body.erd : null, mode: body.generationMode ?? "error", ms: Date.now() - started, error: body.error };
}

describe.skipIf(!process.env.BENCHMARK)("AI generation benchmark", () => {
  it("scores every case", async () => {
    const only = process.env.BENCH_ONLY?.split(",");
    const rows = [];
    for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
      const result = await generate(c.prompt);
      if (!result.erd) {
        rows.push({ id: c.id, ok: false, error: result.error, ms: result.ms });
        continue;
      }
      const { erd } = autoFixErd(importErd(result.erd), (b, ops) => applyOps(b, ops).erd);
      const text = names(erd);
      const missing = Object.entries(c.expect).filter(([, re]) => !re.test(text)).map(([k]) => k);
      const issues = lintErd(erd);
      const run = await runVerification(erd);
      rows.push({
        id: c.id,
        ok: true,
        ms: result.ms,
        tables: erd.tables.length,
        rels: erd.relationships.length,
        coverage: Math.round((100 * (Object.keys(c.expect).length - missing.length)) / Object.keys(c.expect).length),
        missing,
        errors: issues.filter((i) => i.severity === "error").map((i) => i.title),
        warnings: issues.filter((i) => i.severity === "warning").map((i) => i.title),
        pgFailed: run.tests.filter((t) => t.status === "fail").map((t) => `${t.title}: ${t.detail}`),
        ddlProblems: run.ddlProblems.map((p) => p.error),
        pgPassed: run.tests.filter((t) => t.status === "pass").length,
        // Context for failures: the CHECKs of tables that failed.
        failingChecks: erd.tables
          .filter((t) => run.tests.some((x) => x.status === "fail" && x.table === t.name))
          .map((t) => `${t.name}: ${t.columns.map((c) => `${c.name} ${c.dataType}${c.nullable ? "" : " NN"}`).join(", ")} | ${t.constraints.filter((k) => k.type === "CHECK").map((k) => k.expression).join(" ; ")}`),
      });
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(JSON.stringify(rows, null, 2));
    if (process.env.BENCH_OUT) (await import("node:fs")).writeFileSync(process.env.BENCH_OUT, JSON.stringify(rows, null, 2));
    expect(rows.length).toBeGreaterThan(0);
  }, 1_200_000);
});
