import { MongoClient } from "mongodb";

const SEC_ORIGIN = "https://data.sec.gov";
const DATABASE = process.env.MONGODB_DATABASE ?? "eve_hub";
const MONGODB_URI =
  process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/?directConnection=true";
const TENANT_ID = process.env.EVE_DEMO_TENANT_ID ?? "builderbase-demo";
const WORKSPACE_ID =
  process.env.EVE_DEMO_WORKSPACE_ID ?? "dell-nvidia-hackathon";
const OWNER_ID = "system:sec-edgar";
const USER_AGENT = process.env.SEC_USER_AGENT;

if (!USER_AGENT) {
  throw new Error(
    "SEC_USER_AGENT is required. Set it to an application name and contact email, as required by SEC.gov.",
  );
}

const COMPANIES = [
  { cik: "0001571996", ticker: "DELL" },
  { cik: "0001045810", ticker: "NVDA" },
  { cik: "0001441816", ticker: "MDB" },
];

const METRICS = [
  {
    label: "Revenue",
    tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"],
  },
  { label: "Net income", tags: ["NetIncomeLoss"] },
  { label: "Total assets", tags: ["Assets"] },
  {
    label: "Cash and equivalents",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
  },
  { label: "Research and development", tags: ["ResearchAndDevelopmentExpense"] },
  { label: "Operating income", tags: ["OperatingIncomeLoss"] },
  { label: "Employees", tags: ["EntityNumberOfEmployees"] },
];

function filingUrl(cik, accession) {
  const compactCik = String(Number(cik));
  const directory = accession.replaceAll("-", "");
  return `https://www.sec.gov/Archives/edgar/data/${compactCik}/${directory}/${accession}-index.html`;
}

function latestFacts(companyFacts, metric) {
  for (const tag of metric.tags) {
    const fact = companyFacts.facts?.["us-gaap"]?.[tag];
    if (!fact) continue;
    const candidates = Object.entries(fact.units ?? {})
      .flatMap(([unit, facts]) =>
        facts.map((item) => ({ ...item, tag, unit })),
      )
      .filter(
        (item) =>
          (item.form === "10-K" || item.form === "10-Q") &&
          typeof item.accn === "string" &&
          typeof item.end === "string" &&
          typeof item.filed === "string" &&
          typeof item.val === "number",
      )
      .sort((a, b) =>
        `${b.filed}:${b.end}:${b.accn}`.localeCompare(`${a.filed}:${a.end}:${a.accn}`),
      );

    const uniquePeriods = new Map();
    for (const item of candidates) {
      const key = `${item.form}:${item.fp ?? ""}:${item.end}`;
      if (!uniquePeriods.has(key)) uniquePeriods.set(key, item);
      if (uniquePeriods.size >= 4) break;
    }
    if (uniquePeriods.size > 0) {
      return { description: fact.description, facts: [...uniquePeriods.values()], tag };
    }
  }
  return null;
}

function formatValue(value, unit) {
  if (unit === "USD") {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 0,
      notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
      style: "currency",
    }).format(value);
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

async function embed(content) {
  const baseUrl = (process.env.EMBEDDING_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(
    /\/$/u,
    "",
  );
  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      body: JSON.stringify({
        input: content,
        model: process.env.EMBEDDING_MODEL_ID ?? "nomic-embed-text:latest",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return undefined;
    const payload = await response.json();
    return payload.data?.[0]?.embedding;
  } catch {
    return undefined;
  }
}

async function fetchCompanyFacts(company) {
  const url = `${SEC_ORIGIN}/api/xbrl/companyfacts/CIK${company.cik}.json`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`SEC company facts request for ${company.ticker} returned ${response.status}.`);
  }
  return { payload: await response.json(), sourceUrl: url };
}

const client = new MongoClient(MONGODB_URI, {
  appName: "eve-hub-sec-ingestion",
  serverSelectionTimeoutMS: 10_000,
});

try {
  await client.connect();
  const db = client.db(DATABASE);
  const businessFacts = db.collection("business_facts");
  const knowledge = db.collection("knowledge_chunks");
  let written = 0;

  for (const company of COMPANIES) {
    const { payload, sourceUrl } = await fetchCompanyFacts(company);
    console.log(`Fetched ${payload.entityName} (${company.ticker}) from SEC EDGAR.`);

    for (const metric of METRICS) {
      const selected = latestFacts(payload, metric);
      if (!selected) continue;
      for (const fact of selected.facts) {
        const now = new Date();
        const recordKey = `${company.cik}:${selected.tag}:${fact.accn}:${fact.end}:${fact.fp ?? ""}`;
        const directSourceUrl = filingUrl(company.cik, fact.accn);
        const content = [
          `Company: ${payload.entityName} (${company.ticker})`,
          `Metric: ${metric.label}`,
          `Value: ${formatValue(fact.val, fact.unit)}`,
          `Raw value: ${fact.val} ${fact.unit}`,
          `Period end: ${fact.end}`,
          `Fiscal year/period: ${fact.fy ?? "unknown"} ${fact.fp ?? "unknown"}`,
          `SEC form: ${fact.form}`,
          `Filed: ${fact.filed}`,
          `Accession: ${fact.accn}`,
        ].join("\n");

        await businessFacts.updateOne(
          { recordKey, tenantId: TENANT_ID, workspaceId: WORKSPACE_ID },
          {
            $set: {
              accession: fact.accn,
              cik: company.cik,
              company: payload.entityName,
              description: selected.description,
              filedAt: new Date(`${fact.filed}T00:00:00.000Z`),
              fiscalPeriod: fact.fp,
              fiscalYear: fact.fy,
              form: fact.form,
              metric: metric.label,
              ownerId: OWNER_ID,
              periodEnd: new Date(`${fact.end}T00:00:00.000Z`),
              sourceUrl: directSourceUrl,
              sourceDatasetUrl: sourceUrl,
              tag: selected.tag,
              tenantId: TENANT_ID,
              ticker: company.ticker,
              unit: fact.unit,
              updatedAt: now,
              value: fact.val,
              workspaceId: WORKSPACE_ID,
            },
            $setOnInsert: { createdAt: now, recordKey },
          },
          { upsert: true },
        );

        const sourceId = `sec:${recordKey}`;
        const embedding = await embed(content);
        await knowledge.updateOne(
          {
            chunkIndex: 0,
            ownerId: OWNER_ID,
            sourceId,
            tenantId: TENANT_ID,
            workspaceId: WORKSPACE_ID,
          },
          {
            $set: {
              approved: true,
              content,
              embedding,
              kind: "business",
              metadata: {
                accession: fact.accn,
                form: fact.form,
                periodEnd: fact.end,
                ticker: company.ticker,
              },
              sourceUrl: directSourceUrl,
              title: `${payload.entityName}: ${metric.label} (${fact.fp ?? fact.form} ${fact.fy ?? fact.end})`,
              triggers: [company.ticker, payload.entityName, metric.label, selected.tag],
              updatedAt: now,
            },
            $setOnInsert: {
              chunkIndex: 0,
              createdAt: now,
              ownerId: OWNER_ID,
              sourceId,
              tenantId: TENANT_ID,
              workspaceId: WORKSPACE_ID,
            },
          },
          { upsert: true },
        );
        written += 1;
      }
    }
  }

  console.log(`Stored ${written} real SEC filing facts and retrieval passages in MongoDB.`);
} finally {
  await client.close();
}
