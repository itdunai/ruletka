import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./AdminPanel";

type SpinResponse = {
  winId: string;
  prize: {
    id: string;
    title: string;
    type: string;
    value: string | null;
    imageUrl?: string | null;
  };
  createdAt: string;
  expiresAt: string;
  nextSpinAt: string | null;
};

type AppStateResponse = {
  canSpin: boolean;
  nextSpinAt: string | null;
  prizesPreview: Array<{
    id: string;
    title: string;
    type: string;
    value: string | null;
    imageUrl: string | null;
  }>;
  wins: Array<{
    id: string;
    prizeId: string;
    prizeTitle: string;
    status: "active" | "expired" | "claimed" | "cancelled";
    expiresAt: string;
    createdAt: string;
  }>;
};
type ContentTexts = {
  promoTerms: string;
  prizeTerms: string;
};
type AuthResponse = {
  accessToken: string;
  user: {
    telegramId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
  };
  canSpin: boolean;
  nextSpinAt: string | null;
};

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: TelegramUser;
        };
        ready?: () => void;
      };
    };
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
if (!API_BASE_URL) {
  throw new Error("VITE_API_BASE_URL is required");
}
const CARD_WIDTH = 130;
const CARD_GAP = 12;
const STEP = CARD_WIDTH + CARD_GAP;
const REPS = 14;
const VIEWPORT_CENTER = 180;

type Screen = "main" | "result" | "terms" | "prizeTerms" | "myPrizes";

function winStatusLabel(status: "active" | "expired" | "claimed" | "cancelled") {
  switch (status) {
    case "active":
      return "Активен";
    case "expired":
      return "Сгорел";
    case "claimed":
      return "Использован";
    case "cancelled":
      return "Отменен";
    default:
      return status;
  }
}

export function App() {
  const adminMode = useMemo(() => new URLSearchParams(window.location.search).get("admin") === "1", []);
  const [screen, setScreen] = useState<Screen>("main");
  const [telegramId, setTelegramId] = useState("");
  const [loading, setLoading] = useState(false);
  const [stateLoading, setStateLoading] = useState(false);
  const [spinResult, setSpinResult] = useState<SpinResponse | null>(null);
  const [appState, setAppState] = useState<AppStateResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [initData, setInitData] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [contentTexts, setContentTexts] = useState<ContentTexts>({
    promoTerms:
      "<h3>Правила</h3><ul><li>Подпишитесь на каналы магазина</li><li>Нажмите \"Крутить\"</li><li>Приз действует 3 дня</li><li>Покажите сообщение оператору</li><li>1 попытка в неделю</li></ul>",
    prizeTerms:
      "<h3>Как получить</h3><ul><li>Отправьте приз оператору до заказа</li><li>Срок действия: 3 дня</li><li>Только для владельца аккаунта</li></ul>"
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const idleRafRef = useRef<number | null>(null);

  const displayName = username ? `@${username}` : firstName || "Пользователь";
  const prizePool = appState?.prizesPreview?.length ? appState.prizesPreview : [];
  const repeatedPrizes = useMemo(() => {
    const source = prizePool.length > 0 ? prizePool : [{ id: "stub", title: "Скоро призы", type: "none", value: null, imageUrl: null }];
    return Array.from({ length: REPS }).flatMap(() => source);
  }, [prizePool]);
  const selectedPrize = useMemo(
    () => (spinResult ? prizePool.find((prize) => prize.id === spinResult.prize.id) ?? null : null),
    [spinResult, prizePool]
  );

  function prizeToken(title: string) {
    const percent = title.match(/\d+%/);
    if (percent) return { main: percent[0], small: false, tag: "скидка", icon: "" };
    const rub = title.match(/\d+/);
    if (rub) return { main: rub[0], small: rub[0].length >= 4, tag: "депозит", icon: "" };
    if (title.toLowerCase().includes("доставка")) return { main: "", small: false, tag: "бесплатная доставка", icon: "🚀" };
    if (title.toLowerCase().includes("другой")) return { main: "", small: false, tag: "в другой раз", icon: "😔" };
    return { main: "", small: false, tag: title.toLowerCase(), icon: "🎁" };
  }

  function cardOffset(globalIndex: number) {
    return globalIndex * STEP - VIEWPORT_CENTER + CARD_WIDTH / 2;
  }

  function resolveImageUrl(imageUrl: string | null | undefined) {
    if (!imageUrl) return null;
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) return imageUrl;
    return `${API_BASE_URL}${imageUrl}`;
  }

  async function fetchState() {
    setStateLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/state`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const data = (await response.json()) as AppStateResponse;
      if (!response.ok) {
        throw new Error("Не удалось загрузить состояние приложения");
      }
      setAppState(data);
      if (data.prizesPreview.length > 0) {
        setOffset(cardOffset(data.prizesPreview.length * 2));
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ошибка загрузки состояния";
      setError(message);
    } finally {
      setStateLoading(false);
    }
  }

  async function fetchContentTexts() {
    try {
      const response = await fetch(`${API_BASE_URL}/content/texts`);
      const data = (await response.json()) as Partial<ContentTexts>;
      if (!response.ok) return;
      setContentTexts({
        promoTerms: data.promoTerms ?? "",
        prizeTerms: data.prizeTerms ?? ""
      });
    } catch {
      // Keep defaults if content endpoint unavailable.
    }
  }

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready?.();
    const tgUser = webApp?.initDataUnsafe?.user;
    // Fallback: Telegram can pass tgWebAppData in URL when SDK object is delayed/unavailable.
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
    const tgWebAppDataRaw = searchParams.get("tgWebAppData") ?? hashParams.get("tgWebAppData") ?? "";
    const decodedInitData = tgWebAppDataRaw ? decodeURIComponent(tgWebAppDataRaw) : "";
    let parsedUserFromInitData: TelegramUser | null = null;
    if (decodedInitData) {
      const initDataParams = new URLSearchParams(decodedInitData);
      const rawUser = initDataParams.get("user");
      if (rawUser) {
        try {
          parsedUserFromInitData = JSON.parse(rawUser) as TelegramUser;
        } catch {
          parsedUserFromInitData = null;
        }
      }
    }
    const effectiveUser = tgUser ?? parsedUserFromInitData;
    if (effectiveUser?.id) {
      setTelegramId(String(effectiveUser.id));
      setUsername(effectiveUser.username ?? "");
      setFirstName(effectiveUser.first_name ?? "");
      setLastName(effectiveUser.last_name ?? "");
    }
    setInitData(webApp?.initData || decodedInitData || "");
    setAuthReady(true);
  }, []);

  useEffect(() => {
    if (!authReady) return;

    async function authAndLoad() {
      setError("");
      if (!initData && !telegramId) {
        setError("Не удалось получить данные Telegram. Откройте mini app через кнопку бота и обновите экран.");
        return;
      }
      const response = await fetch(`${API_BASE_URL}/auth/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId: Number(telegramId),
          username,
          firstName,
          lastName,
          initData
        })
      });
      const data = (await response.json()) as Partial<AuthResponse> & { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось авторизоваться");
      }
      if (!data.accessToken) {
        throw new Error("Не получен access token");
      }
      setAccessToken(data.accessToken);
      await fetchContentTexts();
    }

    authAndLoad().catch((caught) => {
      const message = caught instanceof Error ? caught.message : "Ошибка авторизации";
      setError(message);
    });
  }, [authReady, telegramId, username, firstName, lastName, initData]);

  useEffect(() => {
    if (!accessToken) return;
    void fetchState();
  }, [accessToken]);

  useEffect(() => {
    if (!trackRef.current) return;
    trackRef.current.style.transform = `translateX(${-offset}px)`;
  }, [offset]);

  useEffect(() => {
    if (!prizePool.length) return;
    const idleSpeed = 0.45;
    const run = () => {
      if (spinning) return;
      setOffset((prev) => {
        const next = prev + idleSpeed;
        const wrapThreshold = prizePool.length * STEP * (REPS - 3);
        if (next > wrapThreshold) {
          return next - prizePool.length * STEP * (REPS / 2);
        }
        return next;
      });
      idleRafRef.current = requestAnimationFrame(run);
    };
    idleRafRef.current = requestAnimationFrame(run);
    return () => {
      if (idleRafRef.current) {
        cancelAnimationFrame(idleRafRef.current);
      }
    };
  }, [prizePool.length, spinning]);

  function animateSpinToPrize(prizeId: string) {
    if (!prizePool.length) return Promise.resolve();
    setSpinning(true);
    if (idleRafRef.current) {
      cancelAnimationFrame(idleRafRef.current);
    }

    const prizeIndex = Math.max(0, prizePool.findIndex((prize) => prize.id === prizeId));
    const rounds = 7;
    const targetGlobalIndex = rounds * prizePool.length + prizeIndex;
    const startOffset = offset;
    const targetOffset = cardOffset(targetGlobalIndex);
    const fullStep = prizePool.length * STEP;
    const distance = targetOffset - startOffset + fullStep * Math.ceil((startOffset - targetOffset + fullStep * rounds) / fullStep);
    const duration = 4200;

    return new Promise<void>((resolve) => {
      let startTs = 0;
      const frame = (ts: number) => {
        if (!startTs) startTs = ts;
        const t = Math.min((ts - startTs) / duration, 1);
        const eased = t < 0.2 ? (t / 0.2) * 0.5 : 0.5 + (1 - Math.pow(1 - (t - 0.2) / 0.8, 3)) * 0.5;
        setOffset(startOffset + distance * eased);
        if (t < 1) {
          requestAnimationFrame(frame);
          return;
        }
        setOffset(startOffset + distance);
        setSpinning(false);
        resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function spinOnce() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось выполнить спин");
      }
      const result = data as SpinResponse;
      await animateSpinToPrize(result.prize.id);
      setSpinResult(result);
      await fetchState();
      setScreen("result");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ошибка запроса";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function sendWinToShop(winId: string) {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/wins/${winId}/send-to-shop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось отправить приз");
      }
      alert("Приз отправлен оператору магазина.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ошибка отправки";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function sendToShop() {
    if (!spinResult) return;
    await sendWinToShop(spinResult.winId);
  }

  if (adminMode) {
    return <AdminPanel apiBaseUrl={API_BASE_URL} />;
  }

  return (
    <main className="pageWrap">
      <div className="app">
        {(screen === "main" || screen === "result") && (
          <div className={`screen ${screen === "main" ? "active" : ""}`}>
            <div className="topbar">
              <div className="topbarLeft">
                Username: <span>{displayName}</span>
                <br />
                ID: {telegramId || "—"}
              </div>
              <button className="prizesBtn" onClick={() => setScreen("myPrizes")}>
                Мои призы
              </button>
            </div>
            <div className="slotSection">
              <div className={`timerRow ${appState?.nextSpinAt ? "show" : ""}`}>
                <div className="tlabel">До следующей попытки:</div>
                <div className="tpill">
                  {appState?.nextSpinAt ? new Date(appState.nextSpinAt).toLocaleString("ru-RU") : "Доступно"}
                </div>
              </div>
              <div className="slotOuter">
                <div className="fadeL" />
                <div className="fadeR" />
                <div className="glowC" />
                <div className="centerFrame">
                  <div className="arrT" />
                  <div className="arrB" />
                </div>
                <div className="track" ref={trackRef}>
                  {repeatedPrizes.map((prize, index) => {
                    const token = prizeToken(prize.title);
                    const img = resolveImageUrl(prize.imageUrl);
                    return (
                      <div className="scard" key={`${prize.id}-${index}`}>
                        {img ? (
                          <>
                            <img className="prizeImg" src={img} alt={prize.title} />
                            <div className="ct">{token.tag}</div>
                          </>
                        ) : token.icon ? (
                          <>
                            <div className="ci">{token.icon}</div>
                            <div className="ct">{token.tag}</div>
                          </>
                        ) : (
                          <>
                            <div className={`cn ${token.small ? "sm" : ""}`}>{token.main}</div>
                            <div className="ct">{token.tag}</div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <button
                className={`spinBtn ${!appState?.canSpin ? "used" : ""}`}
                disabled={loading || stateLoading || spinning || !appState?.canSpin}
                onClick={spinOnce}
              >
                {loading || spinning ? "Крутим..." : appState?.canSpin ? "Крутить" : "Уже крутили"}
              </button>
              {error ? <div className="errorNote">{error}</div> : null}
            </div>
            <div className="tnote">
              Нажимая на кнопку, вы соглашаетесь с{" "}
              <button className="textLink" onClick={() => setScreen("terms")}>
                Условиями акции
              </button>
            </div>
          </div>
        )}

        {screen === "result" && spinResult && (
          <div className="screen active">
            <div className="topbar">
              <div className="topbarLeft">
                Username: <span>{displayName}</span>
                <br />
                ID: {telegramId || "—"}
              </div>
              <button className="prizesBtn" onClick={() => setScreen("myPrizes")}>
                Мои призы
              </button>
            </div>
            <div className="resultType">{spinResult.prize.title}</div>
            <div className="rbody">
              <div className="rvisual">
                <div className="rglow" />
                <div className="rdeco rd1">✦</div>
                <div className="rdeco rd2">✦</div>
                <div className="rdeco rd3">✦</div>
                <div className="rdeco rd4">✦</div>
                <div className="rcard">
                  {resolveImageUrl(selectedPrize?.imageUrl ?? spinResult.prize.imageUrl) ? (
                    <img
                      className="resultPrizeImg"
                      src={resolveImageUrl(selectedPrize?.imageUrl ?? spinResult.prize.imageUrl) || ""}
                      alt={spinResult.prize.title}
                    />
                  ) : (
                    <div className="rnum">{prizeToken(spinResult.prize.title).icon || prizeToken(spinResult.prize.title).main || "🎁"}</div>
                  )}
                  <div className="rtag">{prizeToken(spinResult.prize.title).tag}</div>
                </div>
              </div>
              <div className="ibox">
                <div>Забрать приз в течение <span>3 дней</span></div>
                <div>Сегодня: <span>{new Date(spinResult.createdAt).toLocaleString("ru-RU")}</span></div>
                <div>Забрать до: <span>{new Date(spinResult.expiresAt).toLocaleString("ru-RU")}</span></div>
                <div style={{ marginTop: 6 }}>Перешлите сообщение в чат магазина</div>
              </div>
              <button className="sbtn" onClick={sendToShop} disabled={loading}>
                Отправить оператору
              </button>
              <button className="lbtn" onClick={() => setScreen("prizeTerms")}>
                Условия получения приза
              </button>
              <button className="lbtn" onClick={() => setScreen("main")}>
                Назад к рулетке
              </button>
            </div>
          </div>
        )}

        {screen === "terms" && (
          <div className="screen active">
            <div className="phdr">
              <button className="bbtn" onClick={() => setScreen("main")}>← Назад</button>
              <div className="pttl">Условия акции</div>
            </div>
            <div className="pbody" dangerouslySetInnerHTML={{ __html: contentTexts.promoTerms }} />
          </div>
        )}

        {screen === "prizeTerms" && (
          <div className="screen active">
            <div className="phdr">
              <button className="bbtn" onClick={() => setScreen("result")}>← Назад</button>
              <div className="pttl">Условия получения</div>
            </div>
            <div className="pbody" dangerouslySetInnerHTML={{ __html: contentTexts.prizeTerms }} />
          </div>
        )}

        {screen === "myPrizes" && (
          <div className="screen active">
            <div className="phdr">
              <button className="bbtn" onClick={() => setScreen("main")}>← Назад</button>
              <div className="pttl">Мои призы</div>
            </div>
            <div className="pbody">
              <div className="plist">
                {!appState?.wins?.length ? (
                  <div style={{ textAlign: "center", color: "var(--text2)", padding: "40px 0", fontSize: 14 }}>
                    Пока нет призов.
                    <br />
                    Покрутите колесо!
                  </div>
                ) : (
                  appState.wins.map((win) => (
                    <div className="pcitem" key={win.id}>
                      <div className="pcl">
                        <div className="pcdate">{new Date(win.createdAt).toLocaleString("ru-RU")}</div>
                        <div className="pcname">{win.prizeTitle}</div>
                        <div className="pcexp">До {new Date(win.expiresAt).toLocaleString("ru-RU")}</div>
                      </div>
                      <div className="pcmeta">
                        <div className="pcval">{winStatusLabel(win.status)}</div>
                        {win.status === "active" ? (
                          <button className="pcResendBtn" onClick={() => void sendWinToShop(win.id)} disabled={loading}>
                            Отправить повторно
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
