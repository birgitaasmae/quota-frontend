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

const ALL_DIMS = [
  "sex",
  "age_group",
  "county",
  "region",
  "tallinn_districts",
  "settlement_type",
  "education",
  "nationality",
  "birth_country",
  "citizenship_country",
] as const;

export default function Page() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

  const [year, setYear] = useState(2025);
  const [ageFrom, setAgeFrom] = useState(18);
  const [ageTo, setAgeTo] = useState(74);
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
      // If user filters by men/women and "sex" isn't selected, auto-add it so they can see it.
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

    const rows: Array<Record<string, any>> = [];

    for (const [dim, res] of Object.entries(data.results)) {
      for (const c of res.cells) {
        rows.push({
          Dimension: dim,
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

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `quota_results_${stamp}.xlsx`);
  }

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Quota Builder</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Year</div>
            <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age from</div>
            <input type="number" value={ageFrom} onChange={(e) => setAgeFrom(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age to</div>
            <input type="number" value={ageTo} onChange={(e) => setAgeTo(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Sample N</div>
            <input type="number" value={sampleN} onChange={(e) => setSampleN(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age grouping</div>
            <select value={step} onChange={(e) => setStep(+e.target.value)} style={{ width: "100%" }}>
              <option value={1}>1 (every age)</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Sex filter</div>
            <select value={sexFilter} onChange={(e) => setSexFilter(e.target.value as any)} style={{ width: "100%" }}>
              <option value="total">Total</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Dimensions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ALL_DIMS.map((d) => (
              <button
                key={d}
                onClick={() => toggleDim(d)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ccc",
                  background: dims.includes(d) ? "#111" : "#fff",
                  color: dims.includes(d) ? "#fff" : "#111",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
          <button
            onClick={calculate}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: loading ? "#666" : "#111",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Calculating..." : "Calculate"}
          </button>

          {data && (
            <button
              onClick={downloadExcel}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#fff",
                color: "#111",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Download Excel
            </button>
          )}

          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Backend: <code>{API_BASE ?? "(missing NEXT_PUBLIC_API_BASE)"}</code>
          </span>
        </div>

        {err && (
          <pre
            style={{
              marginTop: 12,
              background: "#fff4f4",
              border: "1px solid #f0c2c2",
              padding: 12,
              borderRadius: 10,
              overflow: "auto",
            }}
          >
            {err}
          </pre>
        )}
      </div>

      {data && (
        <>
          <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700 }}>Population total: {data.population_total.toLocaleString()}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>Sample N: {data.sample_n.toLocaleString()}</div>
          </div>

          {Object.entries(data.results).map(([dim, res]) => (
            <div key={dim} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{dim}</div>

              {res.notes?.length ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Notes / warnings</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {res.notes.map((n, i) => (
                      <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>Base: {res.base.toLocaleString()}</div>

              <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Label</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Pop</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Share</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.cells.map((c) => (
                      <tr key={c.id}>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px" }}>{c.label}</td>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px", textAlign: "right" }}>{c.pop.toLocaleString()}</td>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px", textAlign: "right" }}>{(c.share * 100).toFixed(2)}%</td>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{c.quota}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {data.meta?.errors && Object.keys(data.meta.errors).length > 0 && (
            <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Some dimensions failed</div>
              <pre style={{ margin: 0, overflow: "auto" }}>{JSON.stringify(data.meta.errors, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </main>
  );
}
