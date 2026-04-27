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
type NationalityFilter = "all" | "estonian" | "russian" | "ukrainian" | "other";
type EducationFilter = "all" | "basic" | "secondary" | "higher";

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

const THEME = {
  brand: "#16c6a3",
  brandDark: "#062b2f",
  brandSoft: "#e9fbf7",
  text: "#0c1f21",
  textMuted: "#5e7374",
  border: "#cfe5df",
  card: "#ffffff",
  page: "#f4fbf9",
  warningBg: "#fff7e8",
  warningBorder: "#f2d28a",
  dangerBg: "#fff2f2",
  dangerBorder: "#f2b8b8",
};

const geographyConflictDims = ["region", "tallinn_districts"];
const cityOnlyConflictDims = ["education", "birth_country", "citizenship_country", "settlement_type"];

function isTallinnCounty(value: string) {
  return value === "Tallinna linn";
}

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
  const [year, setYear] = useState(2025);
  const [ageFrom, setAgeFrom] = useState(16);
  const [ageTo, setAgeTo] = useState(74);
  const [ageFromInput, setAgeFromInput] = useState("16");
  const [ageToInput, setAgeToInput] = useState("74");
  const [sampleN, setSampleN] = useState(1000);
  const [step, setStep] = useState(10);

  const [sexFilter, setSexFilter] = useState<"total" | "men" | "women">("total");
  const [countyFilter, setCountyFilter] = useState("");
  const [nationalityFilter, setNationalityFilter] = useState<NationalityFilter>("all");
  const [educationFilter, setEducationFilter] = useState<EducationFilter>("all");
  const [countyOptions, setCountyOptions] = useState<CountyOption[]>([]);

  const [useCustomAgeGroups, setUseCustomAgeGroups] = useState(false);
  const [customAgeGroups, setCustomAgeGroups] = useState<AgeBandInput[]>([
    { from: 16, to: 24 },
    { from: 25, to: 34 },
    { from: 35, to: 44 },
    { from: 45, to: 54 },
    { from: 55, to: 64 },
    { from: 65, to: 74 },
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

  const countyConflictDims = useMemo(() => {
    return dims.filter((dim) => {
      if (!geographyConflictDims.includes(dim)) {
        return false;
      }
      if (dim === "tallinn_districts" && isTallinnCounty(countyFilter)) {
        return false;
      }
      return true;
    });
  }, [dims, countyFilter]);
  const cityCountySelected = countyFilter === "Tallinna linn" || countyFilter === "Tartu linn";
  const cityCountyConflictDims = useMemo(
    () => dims.filter((dim) => cityOnlyConflictDims.includes(dim)),
    [dims]
  );
  const countyConflictMessage = useMemo(() => {
    if (!countyFilter) {
      return null;
    }
    const parts: string[] = [];
    if (countyConflictDims.length > 0) {
      parts.push(
        `${countyConflictDims.map(prettyDim).join(", ")} use the same geography as a breakdown`
      );
    }
    if (cityCountySelected && cityCountyConflictDims.length > 0) {
      parts.push(
        `${cityCountyConflictDims.map(prettyDim).join(", ")} support county-level filters only`
      );
    }
    if (parts.length === 0) {
      return null;
    }
    return `${countyFilter} does not work with ${parts.join("; ")}.`;
  }, [countyFilter, countyConflictDims, cityCountySelected, cityCountyConflictDims]);

  const sourceFilterMessage = useMemo(() => {
    if (nationalityFilter !== "all" && educationFilter !== "all") {
      return "Nationality Filter and Education Filter cannot be used together.";
    }
    if (nationalityFilter !== "all") {
      const unsupported = dims.filter((dim) => dim !== "nationality");
      if (!dims.includes("nationality")) {
        return "Nationality Filter works only with the Nationality dimension.";
      }
      if (unsupported.length > 0) {
        return `Nationality Filter works only with the Nationality dimension. Remove ${unsupported
          .map(prettyDim)
          .join(", ")} to continue.`;
      }
    }
    if (educationFilter !== "all") {
      const unsupported = dims.filter((dim) => dim !== "education");
      if (!dims.includes("education")) {
        return "Education Filter works only with the Education dimension.";
      }
      if (unsupported.length > 0) {
        return `Education Filter works only with the Education dimension. Remove ${unsupported
          .map(prettyDim)
          .join(", ")} to continue.`;
      }
    }
    return null;
  }, [dims, educationFilter, nationalityFilter]);

  const formWarningMessage = useMemo(() => {
    const parts = [countyConflictMessage, sourceFilterMessage].filter(Boolean);
    if (!parts.length) {
      return null;
    }
    return parts.join(" ");
  }, [countyConflictMessage, sourceFilterMessage]);

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
      nationality_filter: nationalityFilter,
      education_filter: educationFilter,
      custom_age_groups: useCustomAgeGroups ? customAgeGroups : [],
    }),
    [
      year,
      effectiveAgeBand,
      sampleN,
      step,
      dims,
      sexFilter,
      countyFilter,
      nationalityFilter,
      educationFilter,
      useCustomAgeGroups,
      customAgeGroups,
    ]
  );

  useEffect(() => {
    if (!useCustomAgeGroups || !customAgeGroups.length) {
      return;
    }
    const sorted = [...customAgeGroups].sort((a, b) => a.from - b.from || a.to - b.to);
    const nextFrom = sorted[0].from;
    const nextTo = sorted[sorted.length - 1].to;
    if (ageFrom !== nextFrom) {
      setAgeFrom(nextFrom);
      setAgeFromInput(String(nextFrom));
    }
    if (ageTo !== nextTo) {
      setAgeTo(nextTo);
      setAgeToInput(String(nextTo));
    }
  }, [customAgeGroups, useCustomAgeGroups, ageFrom, ageTo]);

  useEffect(() => {
    if (!useCustomAgeGroups) {
      setAgeFromInput(String(ageFrom));
    }
  }, [ageFrom, useCustomAgeGroups]);

  useEffect(() => {
    if (!useCustomAgeGroups) {
      setAgeToInput(String(ageTo));
    }
  }, [ageTo, useCustomAgeGroups]);

  function handleAgeInputChange(value: string, setter: (value: string) => void, numberSetter: (value: number) => void) {
    if (!/^\d*$/.test(value)) {
      return;
    }
    setter(value);
    if (value !== "") {
      numberSetter(Number(value));
    }
  }

  function handleAgeInputBlur(value: string, setter: (value: string) => void, numberValue: number) {
    if (value === "") {
      setter(String(numberValue));
    }
  }

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

    if (formWarningMessage) {
      setErr(formWarningMessage);
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
    <main style={{ padding: 24, maxWidth: 1180, margin: "0 auto", fontFamily: "system-ui", color: THEME.text }}>
      <div
        style={{
          marginBottom: 18,
          padding: "18px 22px",
          borderRadius: 18,
          background: `linear-gradient(135deg, ${THEME.brand} 0%, #10b89a 100%)`,
          color: "#fff",
          boxShadow: "0 12px 36px rgba(6, 43, 47, 0.16)",
        }}
      >
        <div style={{ fontSize: 54, lineHeight: 0.9, fontWeight: 900, letterSpacing: -3, textTransform: "lowercase" }}>norstat</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, letterSpacing: 0.4 }}>Quota Builder for Estonia</div>
      </div>

      <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 18, padding: 18, marginBottom: 16, background: THEME.card, boxShadow: "0 10px 28px rgba(6, 43, 47, 0.08)" }}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Year</div>
            <input type="number" value={year} onChange={(e) => setYear(+e.target.value)} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Age From</div>
            <input
              type="text"
              inputMode="numeric"
              value={useCustomAgeGroups ? String(effectiveAgeBand.from) : ageFromInput}
              onChange={(e) => handleAgeInputChange(e.target.value, setAgeFromInput, setAgeFrom)}
              onBlur={() => handleAgeInputBlur(ageFromInput, setAgeFromInput, ageFrom)}
              style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}
              disabled={useCustomAgeGroups}
            />
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Age To</div>
            <input
              type="text"
              inputMode="numeric"
              value={useCustomAgeGroups ? String(effectiveAgeBand.to) : ageToInput}
              onChange={(e) => handleAgeInputChange(e.target.value, setAgeToInput, setAgeTo)}
              onBlur={() => handleAgeInputBlur(ageToInput, setAgeToInput, ageTo)}
              style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}
              disabled={useCustomAgeGroups}
            />
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Sample N</div>
            <input type="number" value={sampleN} onChange={(e) => setSampleN(+e.target.value)} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }} />
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Age Grouping</div>
            <select value={step} onChange={(e) => setStep(+e.target.value)} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }} disabled={useCustomAgeGroups}>
              <option value={1}>1 (every age)</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Sex Filter</div>
            <select value={sexFilter} onChange={(e) => setSexFilter(e.target.value as "total" | "men" | "women")} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}>
              <option value="total">Total</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>County Filter</div>
            <select value={countyFilter} onChange={(e) => setCountyFilter(e.target.value)} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}>
              <option value="">All counties</option>
              {countyOptions.map((option) => (
                <option key={option.code} value={option.label}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Nationality Filter</div>
            <select value={nationalityFilter} onChange={(e) => setNationalityFilter(e.target.value as NationalityFilter)} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}>
              <option value="all">All nationalities</option>
              <option value="estonian">Estonians</option>
              <option value="russian">Russians</option>
              <option value="ukrainian">Ukrainians</option>
              <option value="other">Other nationalities</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize: 12, color: THEME.textMuted }}>Education Filter</div>
            <select value={educationFilter} onChange={(e) => setEducationFilter(e.target.value as EducationFilter)} style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}>
              <option value="all">All education levels</option>
              <option value="basic">Basic / lower</option>
              <option value="secondary">Secondary</option>
              <option value="higher">Higher</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 16, border: `1px solid ${THEME.border}`, borderRadius: 14, padding: 14, background: THEME.brandSoft }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={useCustomAgeGroups} onChange={(e) => setUseCustomAgeGroups(e.target.checked)} />
            Use custom age groups
          </label>

          <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
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
                      <div style={{ fontSize: 12, color: THEME.textMuted }}>From</div>
                      <input
                        type="number"
                        value={band.from}
                        onChange={(e) => updateCustomAgeGroup(index, "from", +e.target.value)}
                        style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}
                      />
                    </label>

                    <label>
                      <div style={{ fontSize: 12, color: THEME.textMuted }}>To</div>
                      <input
                        type="number"
                        value={band.to}
                        onChange={(e) => updateCustomAgeGroup(index, "to", +e.target.value)}
                        style={{ width: "100%", border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px" }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => removeCustomAgeGroup(index)}
                      disabled={customAgeGroups.length === 1}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${THEME.border}`,
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
                  style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${THEME.brandDark}`, background: "#fff", color: THEME.brandDark, cursor: "pointer", fontWeight: 700 }}
                >
                  Add age group
                </button>
                <span style={{ fontSize: 12, color: THEME.textMuted }}>
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
          <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 6 }}>Dimensions</div>
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
                    border: `1px solid ${on ? THEME.brandDark : THEME.border}`,
                    background: on ? THEME.brandDark : "#fff",
                    color: on ? "#fff" : THEME.brandDark,
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
          {formWarningMessage ? (
            <div style={{ fontSize: 13, padding: 10, borderRadius: 10, background: THEME.warningBg, border: `1px solid ${THEME.warningBorder}` }}>
              {formWarningMessage}
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
              border: `1px solid ${THEME.brandDark}`,
              background: loading ? "#5d7c7d" : THEME.brandDark,
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
                border: `1px solid ${THEME.brandDark}`,
                background: "#fff",
                color: THEME.brandDark,
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Download Excel
            </button>
          ) : null}

        </div>

        {err ? (
          <pre style={{ marginTop: 12, background: THEME.dangerBg, border: `1px solid ${THEME.dangerBorder}`, padding: 12, borderRadius: 10, overflow: "auto" }}>
            {err}
          </pre>
        ) : null}
      </div>

      {data ? (
        <>
          <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 14, padding: 16, marginBottom: 16, background: THEME.brandSoft }}>
            <div style={{ fontWeight: 800 }}>Population total: {data.population_total.toLocaleString()}</div>
            <div style={{ fontSize: 13, color: THEME.textMuted }}>Sample N: {data.sample_n.toLocaleString()}</div>
          </div>

          {Object.entries(data.results).map(([dim, res]) => (
            <div key={dim} style={{ border: `1px solid ${THEME.border}`, borderRadius: 14, padding: 16, marginBottom: 16, background: "#fff" }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: THEME.brandDark }}>{prettyDim(dim)}</div>

              {res.notes?.length ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 6 }}>Notes / warnings</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {res.notes.map((note, index) => (
                      <li key={index} style={{ fontSize: 13, marginBottom: 4 }}>
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 8 }}>Base: {res.base.toLocaleString()}</div>

              <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: `1px solid ${THEME.border}`, padding: "6px 8px", color: THEME.textMuted }}>Label</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${THEME.border}`, padding: "6px 8px", color: THEME.textMuted }}>Population</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${THEME.border}`, padding: "6px 8px", color: THEME.textMuted }}>Share %</th>
                      <th style={{ textAlign: "right", borderBottom: `1px solid ${THEME.border}`, padding: "6px 8px", color: THEME.textMuted }}>Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.cells.map((cell) => (
                      <tr key={cell.id}>
                        <td style={{ borderBottom: `1px solid ${THEME.brandSoft}`, padding: "6px 8px" }}>{cell.label}</td>
                        <td style={{ borderBottom: `1px solid ${THEME.brandSoft}`, padding: "6px 8px", textAlign: "right" }}>
                          {cell.pop.toLocaleString()}
                        </td>
                        <td style={{ borderBottom: `1px solid ${THEME.brandSoft}`, padding: "6px 8px", textAlign: "right" }}>
                          {(cell.share * 100).toFixed(2)}
                        </td>
                        <td style={{ borderBottom: `1px solid ${THEME.brandSoft}`, padding: "6px 8px", textAlign: "right", fontWeight: 800, color: THEME.brandDark }}>
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
            <div style={{ border: `1px solid ${THEME.dangerBorder}`, borderRadius: 14, padding: 16, background: THEME.dangerBg }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Some dimensions failed</div>
              <pre style={{ margin: 0, overflow: "auto" }}>{JSON.stringify(visibleMetaErrors, null, 2)}</pre>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
