"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Edit3,
  Layers3,
  Loader2,
  Plus,
  Save,
  X,
} from "lucide-react";
import GeneralAffairsPageHeader from "@/components/general-affairs/GeneralAffairsPageHeader";
import AssetScopeTabs from "@/components/general-affairs/assets/AssetScopeTabs";

type Template = {
  id: string;
  code: string;
  name: string;
  category_id?: string | null;
  brand?: string | null;
  model?: string | null;
  width_cm?: number | null;
  height_cm?: number | null;
  depth_cm?: number | null;
  description?: string | null;
  is_active: boolean;
  asset_count?: number;
  site_count?: number;
  category?: { name?: string | null } | null;
};
type Category = { id: string; name: string; code: string };
type Part = {
  id: string;
  name: string;
  part_code?: string | null;
  specification?: string | null;
};
const EMPTY = {
  id: "",
  code: "",
  name: "",
  categoryId: "",
  brand: "",
  model: "",
  widthCm: "",
  heightCm: "",
  depthCm: "",
  description: "",
  isActive: true,
};

function normalizeIdentity(value?: string | null) {
  return (value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\-_./]+/g, "");
}

export default function FacilityTemplatesClient() {
  const [rows, setRows] = useState<Template[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [partSearch, setPartSearch] = useState("");
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [partsLoadError, setPartsLoadError] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const duplicateCandidates = useMemo(() => {
    if (form.id) return [];
    const code = normalizeIdentity(form.code);
    const name = normalizeIdentity(form.name);
    const brand = normalizeIdentity(form.brand);
    const model = normalizeIdentity(form.model);
    if (!code && !name && !model) return [];
    return rows
      .filter((row) => {
        const sameCode = code && normalizeIdentity(row.code) === code;
        const sameModel = model && normalizeIdentity(row.model) === model;
        const sameBrand =
          !brand || !row.brand || normalizeIdentity(row.brand) === brand;
        const sameName = name && normalizeIdentity(row.name) === name;
        return sameCode || (sameModel && sameBrand) || sameName;
      })
      .slice(0, 3);
  }, [form.brand, form.code, form.id, form.model, form.name, rows]);
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [templatesResponse, categoriesResponse, partsResponse] =
        await Promise.all([
          fetch("/api/general-affairs/facility-templates", {
            cache: "no-store",
          }),
          fetch("/api/general-affairs/categories?type=facility", {
            cache: "no-store",
          }),
          fetch(
            "/api/general-affairs/parts?pageSize=100&isActive=true&sortBy=name",
            { cache: "no-store" },
          ),
        ]);
      const [templatesBody, categoriesBody, partsBody] = await Promise.all([
        templatesResponse.json(),
        categoriesResponse.json(),
        partsResponse.json(),
      ]);
      if (!templatesResponse.ok)
        throw new Error(templatesBody.error || "公司設施架型載入失敗");
      if (!categoriesResponse.ok)
        throw new Error(categoriesBody.error || "分類載入失敗");
      setRows(templatesBody.data || []);
      setCategories(categoriesBody.data || []);
      setParts(partsResponse.ok ? partsBody.data || [] : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "資料載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("returnTo"))
      createNew();
  }, []);

  function edit(row: Template) {
    setForm({
      id: row.id,
      code: row.code,
      name: row.name,
      categoryId: row.category_id || "",
      brand: row.brand || "",
      model: row.model || "",
      widthCm: row.width_cm ? String(row.width_cm) : "",
      heightCm: row.height_cm ? String(row.height_cm) : "",
      depthCm: row.depth_cm ? String(row.depth_cm) : "",
      description: row.description || "",
      isActive: row.is_active,
    });
    setOpen(true);
    setMessage("");
    setPartSearch("");
    setSelectedPartIds([]);
    setPartsLoadError("");
    setLoadingParts(true);
    fetch(
      `/api/general-affairs/parts/target-compatibilities?targetType=FACILITY_TEMPLATE&targetId=${encodeURIComponent(row.id)}&includeInherited=false`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "適用料件載入失敗");
        return body;
      })
      .then((body) =>
        setSelectedPartIds(
          (body.data || []).map((item: { part_id: string }) => item.part_id),
        ),
      )
      .catch((error) => {
        const text =
          error instanceof Error ? error.message : "適用料件載入失敗";
        setPartsLoadError(text);
        setMessage(text);
      })
      .finally(() => setLoadingParts(false));
  }
  function createNew() {
    setForm(EMPTY);
    setPartSearch("");
    setSelectedPartIds([]);
    setLoadingParts(false);
    setPartsLoadError("");
    setOpen(true);
    setMessage("");
  }
  function useExistingTemplate(template: Template) {
    const returnTo = new URLSearchParams(window.location.search).get(
      "returnTo",
    );
    if (returnTo?.startsWith("/general-affairs/")) {
      window.location.assign(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}templateId=${encodeURIComponent(template.id)}`,
      );
      return;
    }
    edit(template);
  }
  async function save() {
    if (!form.code.trim() || !form.name.trim())
      return setMessage("請輸入設施代碼與名稱");
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/general-affairs/facility-templates", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "儲存失敗");
      const templateId = body?.data?.id || form.id;
      if (templateId) {
        try {
          const compatibilityResponse = await fetch(
            "/api/general-affairs/parts/target-compatibilities",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                targetType: "FACILITY_TEMPLATE",
                targetId: templateId,
                partIds: selectedPartIds,
              }),
            },
          );
          if (!compatibilityResponse.ok) throw new Error("適用料件設定失敗");
        } catch {
          window.alert(
            "公司設施已建立，但適用料件尚未儲存，請稍後到「適用料件設定」補充。",
          );
        }
      }
      setOpen(false);
      setForm(EMPTY);
      const returnTo =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("returnTo")
          : null;
      if (
        !form.id &&
        returnTo &&
        body?.data?.id &&
        returnTo.startsWith("/general-affairs/")
      ) {
        window.location.assign(
          `${returnTo}${returnTo.includes("?") ? "&" : "?"}templateId=${encodeURIComponent(body.data.id)}`,
        );
        return;
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }
  const input =
    "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-orange-400";
  return (
    <div>
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: "總務服務中心", href: "/general-affairs" },
          { label: "設施管理", href: "/general-affairs/facilities" },
          { label: "公司設施架型" },
        ]}
        title="公司設施架型"
        description="公司首次採用的設施種類才在這裡新增；各地點持有的數量與位置另行登錄。"
        primaryAction={
          <button
            type="button"
            onClick={createNew}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-bold text-white"
          >
            <Plus className="h-4 w-4" />
            新增公司設施架型
          </button>
        }
      />
      <AssetScopeTabs assetType="facility" current="catalog" />
      {message && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {message}
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-[120px_minmax(0,1fr)_180px_120px_100px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
          <span>架型代碼</span>
          <span>名稱／尺寸</span>
          <span>分類</span>
          <span>已登錄</span>
          <span></span>
        </div>
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[120px_minmax(0,1fr)_180px_120px_100px] items-center gap-3 border-b border-slate-100 px-4 py-3"
          >
            <span className="font-mono text-sm font-bold text-blue-700">
              {row.code}
            </span>
            <span>
              <span className="block font-bold text-slate-900">{row.name}</span>
              <span className="text-xs text-slate-500">
                {[
                  row.width_cm && `寬 ${row.width_cm}`,
                  row.height_cm && `高 ${row.height_cm}`,
                  row.depth_cm && `深 ${row.depth_cm}`,
                ]
                  .filter(Boolean)
                  .join(" × ") || "未設定尺寸"}{" "}
                cm
              </span>
            </span>
            <span className="text-sm text-slate-600">
              {row.category?.name || "-"}
            </span>
            <span className="text-sm text-slate-600">
              {(row.asset_count || 0) > 0 ? (
                <Link
                  href={`/general-affairs/facilities?templateId=${encodeURIComponent(row.id)}&templateName=${encodeURIComponent(`${row.code} ${row.name}`)}`}
                  className="block font-bold text-blue-700 underline-offset-2 hover:underline"
                >
                  {row.asset_count || 0} 座
                </Link>
              ) : (
                <span className="block font-bold text-slate-800">0 座</span>
              )}
              <span className="text-xs text-slate-500">
                {row.site_count || 0} 個據點
              </span>
            </span>
            <button
              type="button"
              onClick={() => edit(row)}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-slate-200 text-xs font-bold text-slate-700"
            >
              <Edit3 className="h-3.5 w-3.5" />
              編輯
            </button>
          </div>
        ))}
        {!loading && !rows.length && (
          <div className="p-12 text-center text-sm text-slate-500">
            <Layers3 className="mx-auto mb-2 h-6 w-6" />
            尚未建立公司設施架型
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            載入中
          </div>
        )}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/30"
          onClick={() => setOpen(false)}
        >
          <aside
            className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">
                {form.id ? "編輯公司設施架型" : "新增公司設施架型"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold">
                設施代碼 *
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="HH01"
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="text-sm font-bold">
                設施名稱 *
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="中島架 HH01款"
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="text-sm font-bold sm:col-span-2">
                設施分類
                <select
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm({ ...form, categoryId: e.target.value })
                  }
                  className={`mt-1 ${input}`}
                >
                  <option value="">未分類</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["widthCm", "寬度 cm"],
                  ["heightCm", "高度 cm"],
                  ["depthCm", "深度 cm"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-sm font-bold">
                  {label}
                  <input
                    type="number"
                    min="0.01"
                    value={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                    className={`mt-1 ${input}`}
                  />
                </label>
              ))}
              <label className="text-sm font-bold">
                品牌
                <input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="text-sm font-bold">
                型號
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className={`mt-1 ${input}`}
                />
              </label>
              <label className="text-sm font-bold sm:col-span-2">
                說明
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={3}
                  className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm"
                />
              </label>
              {!form.id && duplicateCandidates.length > 0 && (
                <section className="rounded-md border border-amber-200 bg-amber-50 p-3 sm:col-span-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                    <AlertCircle className="h-4 w-4" />
                    可能已經有這個公司設施
                  </div>
                  <div className="mt-2 space-y-2">
                    {duplicateCandidates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2"
                      >
                        <div className="min-w-0 text-sm">
                          <div className="truncate font-semibold text-slate-900">
                            {template.code}｜{template.name}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {[template.brand, template.model]
                              .filter(Boolean)
                              .join(" / ") || "未填品牌型號"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => useExistingTemplate(template)}
                          className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                        >
                          使用這筆
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {
                <section className="sm:col-span-2">
                  <div className="text-sm font-bold">適用料件</div>
                  <input
                    value={partSearch}
                    onChange={(e) => setPartSearch(e.target.value)}
                    placeholder="搜尋掛鉤、層板或其他配件"
                    className={`mt-1 ${input}`}
                  />
                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                    {parts
                      .filter((part) =>
                        [part.part_code, part.name, part.specification]
                          .filter(Boolean)
                          .join(" ")
                          .toLowerCase()
                          .includes(partSearch.trim().toLowerCase()),
                      )
                      .slice(0, 20)
                      .map((part) => (
                        <label
                          key={part.id}
                          className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPartIds.includes(part.id)}
                            onChange={() =>
                              setSelectedPartIds((current) =>
                                current.includes(part.id)
                                  ? current.filter((id) => id !== part.id)
                                  : [...current, part.id],
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-orange-600"
                          />
                          <span className="text-sm font-semibold">
                            {part.part_code ? `${part.part_code}｜` : ""}
                            {part.name}
                          </span>
                        </label>
                      ))}
                    {!parts.length && (
                      <div className="p-3 text-center text-sm text-slate-500">
                        尚未建立可選料件，可稍後補充。
                      </div>
                    )}
                  </div>
                  <div
                    className={`mt-1 text-xs ${partsLoadError ? "text-red-600" : "text-slate-500"}`}
                  >
                    {partsLoadError ||
                      (loadingParts
                        ? "載入既有設定中..."
                        : `已選 ${selectedPartIds.length} 項；未勾選的料件會在儲存後移除。`)}
                  </div>
                </section>
              }
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loadingParts || Boolean(partsLoadError)}
              className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-orange-600 text-sm font-bold text-white disabled:bg-slate-300"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              儲存公司設施架型
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
