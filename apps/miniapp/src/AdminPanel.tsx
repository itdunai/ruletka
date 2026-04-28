import { FormEvent, useEffect, useMemo, useState } from "react";

type PrizeItem = {
  id: string;
  title: string;
  type: "discount" | "delivery" | "gift" | "deposit" | "none";
  value: string | null;
  weight: number;
  imageUrl: string | null;
  isActive: boolean;
  stock: number | null;
};

type AdminPanelProps = {
  apiBaseUrl: string;
};

type CreatePrizePayload = {
  title: string;
  type: PrizeItem["type"];
  value: string | null;
  weight: number;
  isActive: boolean;
};

const initialCreatePrize: CreatePrizePayload = {
  title: "",
  type: "discount",
  value: "",
  weight: 1,
  isActive: true
};

export function AdminPanel({ apiBaseUrl }: AdminPanelProps) {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<PrizeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createForm, setCreateForm] = useState<CreatePrizePayload>(initialCreatePrize);
  const [uploadPrizeId, setUploadPrizeId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [promoTerms, setPromoTerms] = useState("");
  const [prizeTerms, setPrizeTerms] = useState("");

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-admin-token": token
    }),
    [token]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadPrizes() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${apiBaseUrl}/admin/prizes`, { headers: { "x-admin-token": token } });
      const data = (await response.json()) as { items?: PrizeItem[]; message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось получить призы");
      }
      setItems(data.items ?? []);
      const textResponse = await fetch(`${apiBaseUrl}/admin/content/texts`, { headers: { "x-admin-token": token } });
      const textData = (await textResponse.json()) as { promoTerms?: string; prizeTerms?: string; message?: string };
      if (!textResponse.ok) {
        throw new Error(textData?.message ?? "Не удалось получить тексты условий");
      }
      setPromoTerms(textData.promoTerms ?? "");
      setPrizeTerms(textData.prizeTerms ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function saveTerms() {
    if (!token) return;
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${apiBaseUrl}/admin/content/texts`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ promoTerms, prizeTerms })
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось сохранить тексты условий");
      }
      setSuccess("Тексты условий сохранены");
      setToast({ type: "success", text: "Тексты условий сохранены" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка сохранения");
      setToast({ type: "error", text: caught instanceof Error ? caught.message : "Ошибка сохранения" });
    }
  }

  async function createPrize(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${apiBaseUrl}/admin/prizes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...createForm,
          value: createForm.value || null
        })
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось создать приз");
      }
      setSuccess("Приз создан");
      setToast({ type: "success", text: "Приз создан" });
      setCreateForm(initialCreatePrize);
      await loadPrizes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка создания");
      setToast({ type: "error", text: caught instanceof Error ? caught.message : "Ошибка создания" });
    } finally {
      setLoading(false);
    }
  }

  async function updatePrizeField(prizeId: string, payload: Partial<PrizeItem>) {
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${apiBaseUrl}/admin/prizes/${prizeId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload)
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось обновить приз");
      }
      setSuccess("Изменения сохранены");
      setToast({ type: "success", text: "Изменения сохранены" });
      await loadPrizes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка обновления");
      setToast({ type: "error", text: caught instanceof Error ? caught.message : "Ошибка обновления" });
    }
  }

  async function savePrize(prize: PrizeItem) {
    await updatePrizeField(prize.id, {
      title: prize.title,
      type: prize.type,
      value: prize.value || null,
      weight: prize.weight,
      stock: prize.stock,
      isActive: prize.isActive
    });
  }

  async function removePrize(prizeId: string) {
    if (!window.confirm("Удалить приз?")) return;
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${apiBaseUrl}/admin/prizes/${prizeId}`, {
        method: "DELETE",
        headers: { "x-admin-token": token }
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось удалить приз");
      }
      setSuccess("Приз удален");
      setToast({ type: "success", text: "Приз удален" });
      await loadPrizes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка удаления");
      setToast({ type: "error", text: caught instanceof Error ? caught.message : "Ошибка удаления" });
    }
  }

  async function uploadImage(event: FormEvent) {
    event.preventDefault();
    if (!uploadPrizeId || !uploadFile) return;
    setError("");
    setSuccess("");
    const form = new FormData();
    form.append("file", uploadFile);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/prizes/${uploadPrizeId}/image-upload`, {
        method: "POST",
        headers: { "x-admin-token": token },
        body: form
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось загрузить картинку");
      }
      setSuccess("Картинка загружена");
      setToast({ type: "success", text: "Картинка загружена" });
      setUploadFile(null);
      setUploadPrizeId("");
      setUploadInputKey((prev) => prev + 1);
      await loadPrizes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка загрузки");
      setToast({ type: "error", text: caught instanceof Error ? caught.message : "Ошибка загрузки" });
    }
  }

  async function removeImage(prizeId: string) {
    if (!window.confirm("Удалить картинку у этого приза?")) return;
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${apiBaseUrl}/admin/prizes/${prizeId}/image`, {
        method: "DELETE",
        headers: { "x-admin-token": token }
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось удалить картинку");
      }
      setSuccess("Картинка удалена");
      setToast({ type: "success", text: "Картинка удалена" });
      await loadPrizes();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка удаления картинки");
      setToast({ type: "error", text: caught instanceof Error ? caught.message : "Ошибка удаления картинки" });
    }
  }

  return (
    <main className="adminPage">
      <section className="adminCard">
        <h1>Админка призов</h1>
        <p className="adminMuted">Для доступа введите `ADMIN_TOKEN` и нажмите "Загрузить призы".</p>
        <div className="adminTokenRow">
          <input
            type="password"
            placeholder="ADMIN_TOKEN"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button onClick={loadPrizes} disabled={!token || loading}>
            {loading ? "Загрузка..." : "Загрузить призы"}
          </button>
        </div>
        {error ? <div className="adminError">{error}</div> : null}
        {success ? <div className="adminSuccess">{success}</div> : null}
      </section>

      <section className="adminCard">
        <h2>Добавить приз</h2>
        <form className="adminForm" onSubmit={createPrize}>
          <input
            placeholder="Название (например: Скидка 20%)"
            value={createForm.title}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
          <div className="adminGrid">
            <select
              value={createForm.type}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, type: event.target.value as PrizeItem["type"] }))}
            >
              <option value="discount">Скидка</option>
              <option value="delivery">Доставка</option>
              <option value="gift">Подарок</option>
              <option value="deposit">Депозит</option>
              <option value="none">Без выигрыша</option>
            </select>
            <input
              placeholder="Значение (например 20 или free)"
              value={createForm.value ?? ""}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, value: event.target.value }))}
            />
            <input
              type="number"
              min={0.01}
              step={0.01}
              placeholder="Вес"
              value={createForm.weight}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, weight: Number(event.target.value) }))}
              required
            />
          </div>
          <label className="adminCheckbox">
            <input
              type="checkbox"
              checked={createForm.isActive}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, isActive: event.target.checked }))}
            />
            Активный приз
          </label>
          <button type="submit" disabled={!token || loading}>
            Создать приз
          </button>
        </form>
      </section>

      <section className="adminCard">
        <h2>Загрузка картинки</h2>
        <form className="adminFormInline" onSubmit={uploadImage}>
          <select value={uploadPrizeId} onChange={(event) => setUploadPrizeId(event.target.value)} required>
            <option value="">Выберите приз</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <input
            key={uploadInputKey}
            type="file"
            accept="image/*"
            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            required
          />
          <button type="submit" disabled={!token || !uploadFile || !uploadPrizeId}>
            Загрузить
          </button>
        </form>
      </section>

      <section className="adminCard">
        <h2>Тексты условий</h2>
        <div className="adminForm">
          <label>
            Условия акции (HTML)
            <textarea value={promoTerms} onChange={(event) => setPromoTerms(event.target.value)} rows={6} />
          </label>
          <label>
            Условия получения приза (HTML)
            <textarea value={prizeTerms} onChange={(event) => setPrizeTerms(event.target.value)} rows={5} />
          </label>
          <p className="adminMuted">
            Можно использовать теги: `&lt;h3&gt;`, `&lt;ul&gt;`, `&lt;li&gt;`, `&lt;p&gt;`, `&lt;br&gt;`.
          </p>
          <button onClick={saveTerms} disabled={!token || loading}>
            Сохранить тексты
          </button>
        </div>
      </section>

      <section className="adminCard">
        <h2>Текущие призы</h2>
        <div className="adminList">
          {items.map((item) => (
            <div className="adminPrizeRow" key={item.id}>
              <div className="adminPrizeHeader">
                <input
                  className="adminTitleInput"
                  value={item.title}
                  onChange={(event) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, title: event.target.value } : p)))}
                />
                <div className="adminRowActions">
                  <button className="saveBtn" onClick={() => void savePrize(item)}>
                    Сохранить
                  </button>
                  <button className="dangerBtn" onClick={() => removePrize(item.id)}>
                    Удалить
                  </button>
                </div>
              </div>
              <div className="adminGrid">
                <label>
                  Вес
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={item.weight}
                    onChange={(event) =>
                      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, weight: Number(event.target.value) } : p)))
                    }
                  />
                </label>
                <label>
                  Тип
                  <select
                    value={item.type}
                    onChange={(event) => {
                      const nextType = event.target.value as PrizeItem["type"];
                      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, type: nextType } : p)));
                    }}
                  >
                    <option value="discount">Скидка</option>
                    <option value="delivery">Доставка</option>
                    <option value="gift">Подарок</option>
                    <option value="deposit">Депозит</option>
                    <option value="none">Без выигрыша</option>
                  </select>
                </label>
                <label>
                  Значение
                  <input
                    value={item.value ?? ""}
                    onChange={(event) =>
                      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, value: event.target.value } : p)))
                    }
                  />
                </label>
                <label>
                  <span className="adminMuted">Остаток: {item.stock ?? "без лимита"}</span>
                </label>
              </div>
              <label className="adminCheckbox">
                <input
                  type="checkbox"
                  checked={item.isActive}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, isActive: next } : p)));
                  }}
                />
                Активен
              </label>
              {item.imageUrl ? (
                <div className="adminImageRow">
                  <p className="adminMuted">Картинка: {item.imageUrl}</p>
                  <button
                    className="iconTrashBtn"
                    title="Удалить картинку"
                    aria-label="Удалить картинку"
                    onClick={() => void removeImage(item.id)}
                  >
                    🗑️
                  </button>
                </div>
              ) : (
                <p className="adminMuted">Картинка не загружена</p>
              )}
            </div>
          ))}
          {!items.length ? <p className="adminMuted">Пока нет загруженных призов.</p> : null}
        </div>
      </section>
      {toast ? <div className={`adminToast ${toast.type}`}>{toast.text}</div> : null}
    </main>
  );
}
