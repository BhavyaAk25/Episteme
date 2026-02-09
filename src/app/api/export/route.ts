import { NextResponse } from "next/server";
import JSZip from "jszip";
import { z } from "zod";

const ExportRequestSchema = z.object({
  schemaSql: z.string().min(1),
  ontology: z.unknown(),
  prompt: z.string().optional(),
  simulationResults: z
    .object({
      totalTests: z.number(),
      passedCount: z.number(),
      failedCount: z.number(),
      startedAt: z.number(),
      completedAt: z.number().nullable(),
      incidents: z.array(
        z.object({
          id: z.string(),
          status: z.string(),
          rootCause: z.string().nullable(),
          suggestedFix: z.string().nullable(),
          testResult: z.object({
            testName: z.string(),
            category: z.string(),
            error: z.string().nullable(),
          }),
        })
      ),
    })
    .nullable()
    .optional(),
  includeSql: z.boolean().optional().default(true),
  includeOntology: z.boolean().optional().default(true),
  includeReport: z.boolean().optional().default(true),
});

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "N/A";
  return new Date(timestamp).toISOString();
}

function generateVerificationReportHtml(data: {
  prompt?: string;
  schemaSql: string;
  simulationResults?: {
    totalTests: number;
    passedCount: number;
    failedCount: number;
    startedAt: number;
    completedAt: number | null;
    incidents: Array<{
      id: string;
      status: string;
      rootCause: string | null;
      suggestedFix: string | null;
      testResult: {
        testName: string;
        category: string;
        error: string | null;
      };
    }>;
  } | null;
}): string {
  const simulation = data.simulationResults;
  const incidentsHtml =
    simulation && simulation.incidents.length > 0
      ? simulation.incidents
          .map(
            (incident) => `
        <tr>
          <td>${incident.id}</td>
          <td>${incident.status}</td>
          <td>${incident.testResult.testName}</td>
          <td>${incident.testResult.category}</td>
          <td>${incident.testResult.error ?? "N/A"}</td>
          <td>${incident.rootCause ?? "N/A"}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="6">No incidents recorded.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Episteme Verification Report</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0f1115; color: #e8ebf2; margin: 0; padding: 24px; }
    h1, h2 { margin: 0 0 12px; }
    .card { background: #171a21; border: 1px solid #2a3140; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .meta { color: #aab3c2; font-size: 14px; }
    .metrics { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .metric { background: #11141b; border: 1px solid #2a3140; border-radius: 8px; padding: 8px 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #2a3140; padding: 8px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #1d2431; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Episteme Verification Report</h1>
    <p class="meta">Generated at ${new Date().toISOString()}</p>
    <p class="meta">Prompt: ${data.prompt ?? "N/A"}</p>
  </div>

  <div class="card">
    <h2>Simulation Summary</h2>
    ${
      simulation
        ? `
      <div class="metrics">
        <div class="metric">Total Tests: ${simulation.totalTests}</div>
        <div class="metric">Passed: ${simulation.passedCount}</div>
        <div class="metric">Failed: ${simulation.failedCount}</div>
        <div class="metric">Started: ${formatDate(simulation.startedAt)}</div>
        <div class="metric">Completed: ${formatDate(simulation.completedAt)}</div>
      </div>`
        : `<p class="meta">Simulation has not been run yet.</p>`
    }
  </div>

  <div class="card">
    <h2>Incident Timeline</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Status</th>
          <th>Test</th>
          <th>Category</th>
          <th>Error</th>
          <th>Root Cause</th>
        </tr>
      </thead>
      <tbody>
        ${incidentsHtml}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Schema Snapshot</h2>
    <pre>${data.schemaSql.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  </div>
</body>
</html>`;
}

export async function POST(request: Request) {
  try {
    const jsonBody = await request.json();
    const parsed = ExportRequestSchema.safeParse(jsonBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid export payload", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const {
      schemaSql,
      ontology,
      prompt,
      simulationResults,
      includeSql,
      includeOntology,
      includeReport,
    } = parsed.data;

    const zip = new JSZip();

    if (includeSql) {
      zip.file("schema.sql", `${schemaSql.trim()}\n`);
    }

    if (includeOntology) {
      zip.file("ontology.json", `${JSON.stringify(ontology, null, 2)}\n`);
    }

    if (includeReport) {
      zip.file(
        "verification_report.html",
        generateVerificationReportHtml({
          prompt,
          schemaSql,
          simulationResults: simulationResults ?? null,
        })
      );
    }

    zip.file(
      "manifest.json",
      `${JSON.stringify(
        {
          project: "Episteme",
          exportedAt: new Date().toISOString(),
          files: {
            schemaSql: includeSql,
            ontologyJson: includeOntology,
            verificationReport: includeReport,
          },
        },
        null,
        2
      )}\n`
    );

    const zipBuffer = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    const zipData = new Uint8Array(zipBuffer.length);
    zipData.set(zipBuffer);

    return new NextResponse(zipData, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="episteme_export_${Date.now()}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
