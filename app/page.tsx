"use client";

import { useMemo, useState } from "react";
import { postJson } from "@/lib/api";
import * as XLSX from "xlsx";

type QuotaCell = { id: string; label: string; pop: number; share: number; quota: number };
type DimensionResult = { base: number; cells: QuotaCell[]; notes?: string[] };
type QuotaResponse = {
  population_total: number;
  sample_n: number;
  results: Record<string, DimensionResult>;
  meta?: any;
};

const DIMENSIONS = [
  { key: "sex", label: "Sex" },
  { key: "age_group", label: "Age Group" },
  { key: "county", label: "County" },
  { key: "region", label: "Region" },
  { key: "tallinn_districts", label: "Tallinn Districts" },
  { key: "settlement_type", label: "Settlement Type" },
  { key: "education", label: "Education" },
  { key: "nationality", label: "Nationality" },
  { key: "birth_country", label: "Birth Country" },
  { key: "citizenship_country", label: "Citizenship Country" },
];

function prettyKey(k: string) {
  const found = DIMENSIONS.find((d) => d.key === k);
  if (found) return found.label;
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Page() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

  const [year, setYear] = useState(2025);
  const [ageFrom, setAgeFrom] = useState(18);
  const [ageTo, setAgeTo] = useState(64);
  const [sampleN, setSampleN] = useState(1000);
  const [step, setStep] = useState(10);

  const [sexFilter, setSexFilter] = useState<"total" | "men" | "women">("total");

  const [dims, setDims] = useState<string[]>(["sex", "age_group", "county", "region"]);

  const [data, setData] = useState<QuotaResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const payload = useMemo(
    () => ({
      reference: { year },
      age_band: { from: ageFrom, to: ageTo },
      sample_n: sampleN,
      age_grouping_years: step,
      dimensions: dims,
      sex_filter: sexFilter,
    }),
    [year, ageFrom, ageTo, sampleN, step, dims, sexFilter]
  );

  function toggleDim(d: string) {
    setDims((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function calculate() {
    setErr(null);
    setData(null);
    setLoading(true);
    try {
      if ((sexFilter === "men" || sexFilter === "women") && !dims.includes("sex")) {
        setDims((prev) => [...prev, "sex"]);
      }

      const js = await postJson<QuotaResponse>("/v1/quotas/calculate", payload);
      setData(js);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function downloadExcel() {
    if (!data) return;

    const rows: any[] = [];

    for (const [dim, res] of Object.entries(data.results)) {
      for (const c of res.cells) {
        rows.push({
          Dimension: prettyKey(dim),
          Label: c.label,
          Population: c.pop,
          SharePercent: Number((c.share * 100).toFixed(2)),
          Quota: c.quota,
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quotas");

    XLSX.writeFile(wb, "quota_results.xlsx");
  }

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Quota Builder</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Year</div>
            <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age From</div>
            <input type="number" value={ageFrom} onChange={(e) => setAgeFrom(+e.target.value)} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age To</div>
            <input type="number" value={ageTo} onChange={(e) => setAgeTo(+e.target.value)} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Sample N</div>
            <input type="number" value={sampleN} onChange={(e) => setSampleN(+e.target.value)} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age Grouping</div>
            <select value={step} onChange={(e) => setStep(+e.target.value)}>
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Sex Filter</div>
            <select value={sexFilter} onChange={(e) => setSexFilter(e.target.value as any)}>
              <option value="total">Total</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Dimensions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DIMENSIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => toggleDim(d.key)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ccc",
                  background: dims.includes(d.key) ? "#111" : "#fff",
                  color: dims.includes(d.key) ? "#fff" : "#111",
                  fontSize: 12,
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={calculate}>{loading ? "Calculating…" : "Calculate"}</button>

          {data && <button onClick={downloadExcel}>Download Excel</button>}

          <span style={{ fontSize: 12 }}>
            Backend: <code>{API_BASE ?? "(missing NEXT_PUBLIC_API_BASE)"}</code>
          </span>
        </div>

        {err && <pre>{err}</pre>}
      </div>

      {data &&
        Object.entries(data.results).map(([dim, res]) => (
          <div key={dim} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h2>{prettyKey(dim)}</h2>

            <div>Base: {res.base.toLocaleString()}</div>

            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Population</th>
                  <th>Share %</th>
                  <th>Quota</th>
                </tr>
              </thead>
              <tbody>
                {res.cells.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td>{c.pop.toLocaleString()}</td>
                    <td>{(c.share * 100).toFixed(2)}</td>
                    <td>{c.quota}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </main>
  );
}
