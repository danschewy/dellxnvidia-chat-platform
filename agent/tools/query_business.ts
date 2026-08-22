import { defineTool } from "eve/tools";
import { z } from "zod";
import { getCollection } from "../lib/mongo";
import { requireTenantScope } from "../lib/tenant";

interface BusinessFact {
  readonly accession: string;
  readonly company: string;
  readonly filedAt: Date;
  readonly fiscalPeriod?: string;
  readonly fiscalYear?: number;
  readonly form: string;
  readonly metric: string;
  readonly periodEnd: Date;
  readonly sourceUrl: string;
  readonly tenantId: string;
  readonly ticker: string;
  readonly unit: string;
  readonly value: number;
  readonly workspaceId: string;
}

function safeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu");
}

export default defineTool({
  description:
    "Query exact, offline business facts stored in MongoDB from real SEC EDGAR filings. Use this before web search for Dell, NVIDIA, or MongoDB financial questions. Return and cite sourceUrl.",
  inputSchema: z.object({
    company: z.string().min(1).max(120).optional(),
    fiscalYear: z.number().int().min(1990).max(2100).optional(),
    form: z.enum(["10-K", "10-Q"]).optional(),
    limit: z.number().int().min(1).max(30).default(12),
    metric: z.string().min(1).max(120).optional(),
  }),
  async execute({ company, fiscalYear, form, limit, metric }, ctx) {
    const scope = requireTenantScope(ctx);
    const facts = await getCollection<BusinessFact>("business_facts");
    const results = await facts
      .find(
        {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          ...(company
            ? {
                $or: [
                  { company: safeRegex(company) },
                  { ticker: safeRegex(company) },
                ],
              }
            : {}),
          ...(fiscalYear ? { fiscalYear } : {}),
          ...(form ? { form } : {}),
          ...(metric ? { metric: safeRegex(metric) } : {}),
        },
        { projection: { _id: 0, tenantId: 0, workspaceId: 0 } },
      )
      .sort({ periodEnd: -1, filedAt: -1 })
      .limit(limit)
      .toArray();
    return results.map((fact) => ({
      accession: fact.accession,
      company: fact.company,
      filedAt: fact.filedAt.toISOString(),
      fiscalPeriod: fact.fiscalPeriod ?? null,
      fiscalYear: fact.fiscalYear ?? null,
      form: fact.form,
      metric: fact.metric,
      periodEnd: fact.periodEnd.toISOString(),
      sourceUrl: fact.sourceUrl,
      ticker: fact.ticker,
      unit: fact.unit,
      value: fact.value,
    }));
  },
});
