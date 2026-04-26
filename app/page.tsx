"use client";

import { useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import * as XLSX from "xlsx";

type QuotaCell = { id: string; label: string; pop: number; share: number; quota: number };
type DimensionResult = { base: number; cells: QuotaCell[]; notes?: string[] };
type QuotaResponse = {
  population_total: number;
  sample_n: number;
  results: Record<string, DimensionResult>;
  meta?: {
    errors?: Record<string, unknown>;
  };
};
type MetaError = {
  msg?: string;
  county_filter?: string;
};
type CountyOption = { code: string; label: string };
type CountyOptionsResponse = { items: CountyOption[] };
type AgeBandInput = { from: number; to: number };

const DIMENSIONS: Array<{ key: string; label: string }> = [
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

const geographyConflictDims = ["region", "tallinn_districts", "settlement_type"];

function prettyDim(key: string) {
  const hit = DIMENSIONS.find((d) => d.key === key);
  if (hit) return hit.label;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function validateAgeBands(bands: AgeBandInput[]) {
  if (!bands.length) {
    return "Add at least one custom age group.";
  }

  const sorted = [...bands].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const band of sorted) {
    if (Number.isNaN(band.from) || Number.isNaN(band.to)) {
      return "Custom age groups must contain valid numbers.";
    }
    if (band.from > band.to) {
      return `Age group ${band.from}-${band.to} is invalid.`;
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) {
      return `Custom age groups overlap: ${sorted[i - 1].from}-${sorted[i - 1].to} and ${sorted[i].from}-${sorted[i].to}.`;
    }
  }

  return null;
}

export default function Page() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

  const [year, setYear] = useState(2025);
  const [ageFrom, setAgeFrom] = useState(18);
  const [ageTo, setAgeTo] = useState(64);
  const [sampleN, setSampleN] = useState(1000);
  const [step, setStep] = useState(10);

  const [sexFilter, setSexFilter] = useState<"total" | "men" | "women">("total");
  const [countyFilter, setCountyFilter] = useState("");
  const [countyOptions, setCountyOptions] = useState<CountyOption[]>([]);

  const [useCustomAgeGroups, setUseCustomAgeGroups] = useState(false);
  const [customAgeGroups, setCustomAgeGroups] = useState<AgeBandInput[]>([
    { from: 18, to: 24 },
    { from: 25, to: 34 },
    { from: 35, to: 44 },
    { from: 45, to: 54 },
    { from: 55, to: 64 },
  ]);

  const [dims, setDims] = useState<string[]>(["sex", "age_group", "county", "region"]);

  const [data, setData] = useState<QuotaResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadCountyOptions() {
      try {
        const js = await getJson<CountyOptionsResponse>("/v1/options/counties");
        if (active) {
          setCountyOptions(js.items);
        }
      } catch (e: any) {
        if (active) {
          setErr(e?.message ?? String(e));
        }
      }
    }

    loadCountyOptions();
    return () => {
      active = false;
    };
  }, []);

  const customAgeGroupsError = useMemo(
    () => (useCustomAgeGroups ? validateAgeBands(customAgeGroups) : null),
    [customAgeGroups, useCustomAgeGroups]
  );

  const effectiveAgeBand = useMemo(() => {
    if (!useCustomAgeGroups || !customAgeGroups.length) {
      return { from: ageFrom, to: ageTo };
    }

    const sorted = [...customAgeGroups].sort((a, b) => a.from - b.from || a.to - b.to);
    return { from: sorted[0].from, to: sorted[sorted.length - 1].to };
  }, [ageFrom, ageTo, customAgeGroups, useCustomAgeGroups]);

  const customAgeGroupsPreview = useMemo(
    () => customAgeGroups.map((band) => `${band.from}-${band.to}`).join(", "),
    [customAgeGroups]
  );

  const countyConflictDims = useMemo(
    () => dims.filter((dim) => geographyConflictDims.includes(dim)),
    [dims]
  );

  const visibleMetaErrors = useMemo(() => {
    const entries = Object.entries(data?.meta?.errors ?? {});
    return Object.fromEntries(
      entries.filter(([key, value]) => {
        const detail = value as MetaError;
        const expectedCountyConflict =
          countyFilter &&
          geographyConflictDims.includes(key) &&
          typeof detail?.msg === "string" &&
          detail.msg.includes("county_filter is not supported");
        return !expectedCountyConflict;
      })
    );
  }, [countyFilter, data]);

  const payload = useMemo(
    () => ({
      reference: { year },
      age_band: effectiveAgeBand,
      sample_n: sampleN,
      age_grouping_years: step,
      dimensions: dims,
      sex_filter: sexFilter,
      county_filter: countyFilter || undefined,
      custom_age_groups: useCustomAgeGroups ? customAgeGroups : [],
    }),
    [year, effectiveAgeBand, sampleN, step, dims, sexFilter, countyFilter, useCustomAgeGroups, customAgeGroups]
  );

  function toggleDim(d: string) {
    setDims((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function addCustomAgeGroup() {
    const last = customAgeGroups[customAgeGroups.length - 1];
    const start = last ? last.to + 1 : ageFrom;
    setCustomAgeGroups((prev) => [...prev, { from: start, to: start + 9 }]);
  }

  function updateCustomAgeGroup(index: number, key: "from" | "to", value: number) {
    setCustomAgeGroups((prev) =>
      prev.map((band, i) => (i === index ? { ...band, [key]: value } : band))
    );
  }

  function removeCustomAgeGroup(index: number) {
    setCustomAgeGroups((prev) => prev.filter((_, i) => i !== index));
  }

  async function calculate() {
    setErr(null);
    setData(null);

    if (useCustomAgeGroups && customAgeGroupsError) {
      setErr(customAgeGroupsError);
      return;
    }

    if (effectiveAgeBand.from > effectiveAgeBand.to) {
      setErr("Age From must be less than or equal to Age To.");
      return;
    }

    if (countyFilter && countyConflictDims.length > 0) {
      setErr(`County filter is not possible with ${countyConflictDims.map(prettyDim).join(", ")}. Remove those dimensions first.`);
      return;
    }

    setLoading(true);
    try {
      const effectiveDims = [...dims];
      if ((sexFilter === "men" || sexFilter === "women") && !effectiveDims.includes("sex")) {
        effectiveDims.push("sex");
      }

      const js = await postJson<QuotaResponse>("/v1/quotas/calculate", {
        ...payload,
        dimensions: effectiveDims,
      });
      setData(js);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function downloadExcel() {
    if (!data) return;

    const rows: Array<Record<string, string | number>> = [];
    for (const [dim, res] of Object.entries(data.results)) {
      for (const c of res.cells) {
        rows.push({
          Dimension: prettyDim(dim),
          Label: c.label,
          Population: c.pop,
          "Share %": Number((c.share * 100).toFixed(2)),
          Quota: c.quota,
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quotas");

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `quota_results_${stamp}.xlsx`);
  }

  return (
    <main style={{ padding: 24, maxWidth: 1180, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Quota Builder</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Year</div>
            <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age From</div>
            <input type="number" value={ageFrom} onChange={(e) => setAgeFrom(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age To</div>
            <input type="number" value={ageTo} onChange={(e) => setAgeTo(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Sample N</div>
            <input type="number" value={sampleN} onChange={(e) => setSampleN(+e.target.value)} style={{ width: "100%" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Age Grouping</div>
            <select value={step} onChange={(e) => setStep(+e.target.value)} style={{ width: "100%" }} disabled={useCustomAgeGroups}>
              <option value={1}>1 (every age)</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Sex Filter</div>
            <select value={sexFilter} onChange={(e) => setSexFilter(e.target.value as "total" | "men" | "women")} style={{ width: "100%" }}>
              <option value="total">Total</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>County Filter</div>
            <select value={countyFilter} onChange={(e) => setCountyFilter(e.target.value)} style={{ width: "100%" }}>
              <option value="">All counties</option>
              {countyOptions.map((option) => (
                <option key={option.code} value={option.label}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={useCustomAgeGroups} onChange={(e) => setUseCustomAgeGroups(e.target.checked)} />
            Use custom age groups
          </label>

          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            {useCustomAgeGroups
              ? `Active groups: ${customAgeGroupsPreview || "none"}`
              : "Turn this on if you want to define your own age buckets instead of 1/5/10/15-year grouping."}
          </div>

          {useCustomAgeGroups ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gap: 10 }}>
                {customAgeGroups.map((band, index) => (
                  <div key={`${index}-${band.from}-${band.to}`} style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
                    <label>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>From</div>
                      <input
                        type="number"
                        value={band.from}
                        onChange={(e) => updateCustomAgeGroup(index, "from", +e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </label>

                    <label>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>To</div>
                      <input
                        type="number"
                        value={band.to}
                        onChange={(e) => updateCustomAgeGroup(index, "to", +e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => removeCustomAgeGroup(index)}
                      disabled={customAgeGroups.length === 1}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        background: "#fff",
                        cursor: customAgeGroups.length === 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
                <button
                  type="button"
                  onClick={addCustomAgeGroup}
                  style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #111", background: "#fff", cursor: "pointer", fontWeight: 700 }}
                >
                  Add age group
                </button>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  Backend will use these exact buckets for the age-group table and the combined age span for grouped source tables.
                </span>
              </div>

              {customAgeGroupsError ? (
                <div style={{ marginTop: 10, color: "#9f1d1d", fontSize: 13 }}>{customAgeGroupsError}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Dimensions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DIMENSIONS.map(({ key, label }) => {
              const on = dims.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDim(key)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 999,
                    border: "1px solid #ccc",
                    background: on ? "#111" : "#fff",
                    color: on ? "#fff" : "#111",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {countyFilter && countyConflictDims.length > 0 ? (
            <div style={{ fontSize: 13, padding: 10, borderRadius: 10, background: "#fff8e8", border: "1px solid #f0d48a" }}>
              County filter does not combine with {countyConflictDims.map(prettyDim).join(", ")} because those outputs already use the same geography dimension as a breakdown.
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
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
              fontWeight: 700,
            }}
          >
            {loading ? "Calculating..." : "Calculate"}
          </button>

          {data ? (
            <button
              onClick={downloadExcel}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#fff",
                color: "#111",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Download Excel
            </button>
          ) : null}

          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Backend: <code>{API_BASE ?? "(missing NEXT_PUBLIC_API_BASE)"}</code>
          </span>
        </div>

        {err ? (
          <pre style={{ marginTop: 12, background: "#fff4f4", border: "1px solid #f0c2c2", padding: 12, borderRadius: 10, overflow: "auto" }}>
            {err}
          </pre>
        ) : null}
      </div>

      {data ? (
        <>
          <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 800 }}>Population total: {data.population_total.toLocaleString()}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>Sample N: {data.sample_n.toLocaleString()}</div>
          </div>

          {Object.entries(data.results).map(([dim, res]) => (
            <div key={dim} style={{ border: "1px solid #ddd", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{prettyDim(dim)}</div>

              {res.notes?.length ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Notes / warnings</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {res.notes.map((note, index) => (
                      <li key={index} style={{ fontSize: 13, marginBottom: 4 }}>
                        {note}
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
                      <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Population</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Share %</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 8px" }}>Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.cells.map((cell) => (
                      <tr key={cell.id}>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px" }}>{cell.label}</td>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px", textAlign: "right" }}>
                          {cell.pop.toLocaleString()}
                        </td>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px", textAlign: "right" }}>
                          {(cell.share * 100).toFixed(2)}
                        </td>
                        <td style={{ borderBottom: "1px solid #f0f0f0", padding: "6px 8px", textAlign: "right", fontWeight: 800 }}>
                          {cell.quota}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {Object.keys(visibleMetaErrors).length > 0 ? (
            <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Some dimensions failed</div>
              <pre style={{ margin: 0, overflow: "auto" }}>{JSON.stringify(visibleMetaErrors, null, 2)}</pre>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
