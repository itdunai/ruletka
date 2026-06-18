import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPanel } from "./AdminPanel";
import { Modal } from "./Modal";

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
  reminderSent?: boolean;
};

type AppStateResponse = {
  canSpin: boolean;
  isSubscribed?: boolean;
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
    prizeType?: string;
    status: "active" | "expired" | "claimed" | "received" | "cancelled";
    expiresAt: string;
    createdAt: string;
  }>;
};
type ContentTexts = {
  promoTerms: string;
  prizeTerms: string;
};
type AppModal = {
  title: string;
  message: string;
};

type SpinErrorResponse = {
  message?: string;
  code?: string;
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
        expand?: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        isExpanded?: boolean;
        isFullscreen?: boolean;
        platform?: string;
        viewportHeight?: number;
        viewportStableHeight?: number;
        showAlert?: (message: string, callback?: () => void) => void;
        BackButton?: {
          show?: () => void;
          hide?: () => void;
          onClick?: (handler: () => void) => void;
          offClick?: (handler: () => void) => void;
          isVisible?: boolean;
        };
      };
    };
  }
}

function detectTelegramFullscreen() {
  const params = new URLSearchParams(window.location.search);
  const explicitMode = params.get("mode")?.toLowerCase();
  if (explicitMode === "mainapp" || explicitMode === "main" || explicitMode === "fullscreen" || params.get("fullscreen") === "1") {
    return true;
  }

  const webApp = window.Telegram?.WebApp;
  if (webApp?.isFullscreen) return true;

  try {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const inset = probe.getBoundingClientRect().height;
    probe.remove();
    if (inset > 0) return true;
  } catch {
    // Probe may fail in some embedded browsers; ignore.
  }

  if (webApp?.viewportStableHeight && Math.abs(webApp.viewportStableHeight - window.innerHeight) < 2) {
    return true;
  }
  return false;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
if (!API_BASE_URL) {
  throw new Error("Требуется VITE_API_BASE_URL");
}
const APP_TIME_ZONE = (import.meta.env.VITE_APP_TIME_ZONE ?? "Asia/Irkutsk").trim();
const CARD_WIDTH = 340;
const CARD_GAP = 56;
const STEP = CARD_WIDTH + CARD_GAP;
const REPS = 14;

type Screen = "main" | "result" | "terms" | "prizeTerms" | "myPrizes";

function winStatusLabel(status: "active" | "expired" | "claimed" | "received" | "cancelled") {
  switch (status) {
    case "active":
      return "Активен";
    case "expired":
      return "Сгорел";
    case "claimed":
      return "Использован";
    case "received":
      return "Получен";
    case "cancelled":
      return "Отменен";
    default:
      return status;
  }
}

function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: APP_TIME_ZONE });
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
  const [modal, setModal] = useState<AppModal | null>(null);
  const [offset, setOffset] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [nextSpinCountdown, setNextSpinCountdown] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [contentTexts, setContentTexts] = useState<ContentTexts>({
    promoTerms:
      "<h3>Правила</h3><ul><li>Подпишитесь на каналы магазина</li><li>Нажмите \"Крутить\"</li><li>Приз действует 3 дня</li><li>Покажите сообщение оператору</li><li>1 попытка в неделю</li></ul>",
    prizeTerms:
      "<h3>Как получить</h3><ul><li>Отправьте приз оператору до заказа</li><li>Срок действия: 3 дня</li><li>Только для владельца аккаунта</li></ul>"
  });
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slotOuterRef = useRef<HTMLDivElement | null>(null);
  const idleRunIdRef = useRef(0);
  const spinningRef = useRef(false);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const [viewportCenter, setViewportCenter] = useState(225);

  const wheelBusy = loading || spinning;

  function stopIdleAnimation() {
    idleRunIdRef.current += 1;
  }

  function applyOffset(value: number) {
    offsetRef.current = value;
    setOffset(value);
  }

  function notifyUser(title: string, message: string) {
    setModal({ title, message });
  }

  function openModal(title: string, message: string) {
    notifyUser(title, message);
  }

  function closeModal() {
    setModal(null);
  }

  function showSpinError(response: Response, data: SpinErrorResponse) {
    if (response.status === 403 || data.code === "subscription_required") {
      openModal(
        "Нужна подписка",
        [
          "Чтобы крутить колесо, подпишитесь на все каналы магазина.",
          "",
          "1. Подпишитесь на каналы из списка",
          "2. Откройте чат с ботом и нажмите /check",
          "3. Снова откройте колесо и нажмите «Крутить»",
          "",
          "Подробная инструкция с ссылками на каналы отправлена вам в чат с ботом."
        ].join("\n")
      );
      return;
    }

    if (response.status === 429) {
      openModal("Уже крутили", data.message ?? "Крутить можно только один раз в неделю. Дождитесь следующей попытки.");
      return;
    }

    if (response.status === 503) {
      openModal(
        "Не удалось проверить подписку",
        `${data.message ?? "Сервис временно недоступен."}\n\nПопробуйте ещё раз через минуту.`
      );
      return;
    }

    openModal("Не удалось крутить", data.message ?? "Попробуйте ещё раз чуть позже.");
  }

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

  function formatCountdown(targetIso: string) {
    const targetMs = new Date(targetIso).getTime();
    const diffMs = targetMs - Date.now();
    if (diffMs <= 0) return "Доступно";

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days} дн ${hours} ч ${minutes} мин ${seconds} сек`;
  }

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
    return globalIndex * STEP - viewportCenter + CARD_WIDTH / 2;
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
      notifyUser("Ошибка", message);
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
    try {
      webApp?.expand?.();
      webApp?.setHeaderColor?.("#1a1c18");
      webApp?.setBackgroundColor?.("#0e100d");
    } catch {
      // Older Telegram clients may not support these methods.
    }
    const applyFullscreenAttr = () => {
      const detected = detectTelegramFullscreen();
      if (detected) {
        document.body.dataset.tgFullscreen = "1";
      } else {
        delete document.body.dataset.tgFullscreen;
      }
      setIsFullscreen(detected);
    };
    applyFullscreenAttr();
    const recheckTimer = window.setTimeout(applyFullscreenAttr, 250);
    window.addEventListener("resize", applyFullscreenAttr);
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
    } else if (import.meta.env.DEV && window.location.hostname === "localhost") {
      // Local browser demo without Telegram WebApp context.
      setTelegramId("700000001");
      setUsername("demo_user");
      setFirstName("Demo");
      setLastName("User");
    }
    setInitData(webApp?.initData || decodedInitData || "");
    setAuthReady(true);
    return () => {
      window.clearTimeout(recheckTimer);
      window.removeEventListener("resize", applyFullscreenAttr);
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;

    async function authAndLoad() {
      if (!initData && !telegramId) {
        notifyUser(
          "Нет данных Telegram",
          "Откройте колесо через кнопку в боте и попробуйте снова."
        );
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
      notifyUser("Ошибка авторизации", message);
    });
  }, [authReady, telegramId, username, firstName, lastName, initData]);

  useEffect(() => {
    if (!accessToken) return;
    void fetchState();
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || screen !== "main") return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void fetchState();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [accessToken, screen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton?.show || !backButton.hide) return;

    const backTargets: Partial<Record<Screen, Screen>> = {
      myPrizes: "main",
      terms: "main",
      prizeTerms: "result",
      result: "main"
    };
    const target = backTargets[screen];

    if (!target) {
      try { backButton.hide(); } catch { /* noop */ }
      return;
    }

    const handler = () => setScreen(target);
    try {
      backButton.onClick?.(handler);
      backButton.show();
    } catch {
      // Older Telegram clients may not support BackButton.
    }

    return () => {
      try {
        backButton.offClick?.(handler);
        backButton.hide?.();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, [screen, isFullscreen]);

  useEffect(() => {
    if (!appState?.nextSpinAt) {
      setNextSpinCountdown("");
      return;
    }

    const update = () => {
      setNextSpinCountdown(formatCountdown(appState.nextSpinAt!));
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [appState?.nextSpinAt]);

  useEffect(() => {
    const slot = slotOuterRef.current;
    if (!slot) return;
    const updateViewport = () => setViewportCenter(slot.clientWidth / 2);
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [screen]);

  useEffect(() => {
    offsetRef.current = offset;
    if (!trackRef.current) return;
    trackRef.current.style.transform = `translateX(${-offset}px)`;
  }, [offset]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    spinningRef.current = spinning;
  }, [spinning]);

  useEffect(() => {
    if (!prizePool.length || wheelBusy) return;
    setOffset((prev) => {
      let bestOffset = cardOffset(prizePool.length * 2);
      let bestDistance = Infinity;
      const totalCards = prizePool.length * REPS;
      for (let index = 0; index < totalCards; index += 1) {
        const candidate = cardOffset(index);
        const distance = Math.abs(candidate - prev);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestOffset = candidate;
        }
      }
      return bestOffset;
    });
  }, [viewportCenter, prizePool.length, wheelBusy]);

  useEffect(() => {
    if (!prizePool.length || screen !== "main" || wheelBusy) return;

    const poolLen = prizePool.length;
    const bandStart = poolLen * 2;
    const runId = ++idleRunIdRef.current;
    const cancelled = () =>
      idleRunIdRef.current !== runId || spinningRef.current || loadingRef.current || screen !== "main";

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), ms);
      });

    const animateOffset = (from: number, to: number, duration: number) =>
      new Promise<void>((resolve) => {
        if (cancelled()) {
          resolve();
          return;
        }
        if (duration <= 0) {
          applyOffset(to);
          resolve();
          return;
        }
        let startTs = 0;
        const frame = (ts: number) => {
          if (cancelled()) {
            resolve();
            return;
          }
          if (!startTs) startTs = ts;
          const t = Math.min((ts - startTs) / duration, 1);
          const eased = 1 - (1 - t) * (1 - t);
          applyOffset(from + (to - from) * eased);
          if (t < 1) {
            requestAnimationFrame(frame);
            return;
          }
          resolve();
        };
        requestAnimationFrame(frame);
      });

    let step = 0;

    const loop = async () => {
      while (!cancelled()) {
        const globalIndex = bandStart + (step % poolLen);
        const nextGlobalIndex = bandStart + ((step + 1) % poolLen);
        const baseOffset = cardOffset(globalIndex);
        const nextOffset = cardOffset(nextGlobalIndex);
        const nudgeOffset = baseOffset - STEP * 0.05;

        applyOffset(baseOffset);
        await sleep(1000);
        if (cancelled()) break;

        await animateOffset(baseOffset, nudgeOffset, 120);
        if (cancelled()) break;

        await animateOffset(nudgeOffset, nextOffset, 320);
        if (cancelled()) break;

        await sleep(2000);
        if (cancelled()) break;

        step += 1;
      }
    };

    void loop();

    return () => {
      idleRunIdRef.current += 1;
    };
  }, [prizePool.length, screen, wheelBusy, viewportCenter]);

  function animateSpinToPrize(prizeId: string) {
    if (!prizePool.length) return Promise.resolve();
    stopIdleAnimation();
    setSpinning(true);
    spinningRef.current = true;

    const prizeIndex = Math.max(0, prizePool.findIndex((prize) => prize.id === prizeId));
    const rounds = 7;
    const targetGlobalIndex = rounds * prizePool.length + prizeIndex;
    const startOffset = offsetRef.current;
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
        applyOffset(startOffset + distance * eased);
        if (t < 1) {
          requestAnimationFrame(frame);
          return;
        }
        applyOffset(startOffset + distance);
        setSpinning(false);
        spinningRef.current = false;
        resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  function spinButtonLabel() {
    if (loading || spinning) return "Крутим...";
    if (appState?.canSpin) return "Крутить";
    return "Уже крутили";
  }

  async function spinOnce() {
    if (loading || spinning || !appState?.canSpin) return;
    stopIdleAnimation();
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
      const data = (await response.json().catch(() => ({}))) as SpinResponse & SpinErrorResponse;
      if (!response.ok) {
        showSpinError(response, data);
        return;
      }
      const result = data as SpinResponse;
      await animateSpinToPrize(result.prize.id);
      setSpinResult(result);
      setScreen("result");
      void fetchState();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ошибка запроса";
      openModal("Ошибка", message);
    } finally {
      setLoading(false);
    }
  }

  async function resendWinReminder(winId: string) {
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
        throw new Error(data?.message ?? "Не удалось отправить сообщение");
      }
      alert("Сообщение с призом отправлено в чат с ботом.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ошибка отправки";
      notifyUser("Ошибка", message);
    } finally {
      setLoading(false);
    }
  }

  async function markOrderReceived(winId: string) {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/wins/${winId}/order-received`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({})
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data?.message ?? "Не удалось подтвердить получение");
      }
      await fetchState();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ошибка запроса";
      notifyUser("Ошибка", message);
    } finally {
      setLoading(false);
    }
  }

  if (adminMode) {
    return <AdminPanel apiBaseUrl={API_BASE_URL} />;
  }

  return (
    <main className="pageWrap">
      <div className="app">
        {(screen === "main" || screen === "result") && (
          <div className={`screen ${screen === "main" ? "active" : ""}`}>
            <div className="glowC" aria-hidden="true" />
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
                <div className="tpill">{nextSpinCountdown || "Доступно"}</div>
              </div>
              <div className="slotOuter" ref={slotOuterRef}>
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
              <div className="spinDock">
                <img className="spinTriangle" src="/images/triangle.png" alt="" aria-hidden="true" />
                <button
                  className={`spinBtn ${!appState?.canSpin ? "used" : ""}`}
                  disabled={loading || stateLoading || spinning || !appState?.canSpin}
                  onClick={spinOnce}
                >
                  {spinButtonLabel()}
                </button>
              </div>
            </div>
            <div className="tnote">
              Нажимая на кнопку, вы соглашаетесь с{" "}
              <button className="textLink" onClick={() => setScreen("terms")}>
                Условиями акции
              </button>
              <br />
              <a className="textLink" href="https://t.me/smarket_sup" target="_blank" rel="noreferrer">
                Поддержка
              </a>
            </div>
          </div>
        )}

        {screen === "result" && spinResult && (
          <div className="screen active">
            <div className="glowC" aria-hidden="true" />
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
                <div>Сегодня: <span>{formatDateTime(spinResult.createdAt)}</span></div>
                <div>Забрать до: <span>{formatDateTime(spinResult.expiresAt)}</span></div>
                <div style={{ marginTop: 6 }}>Сообщение с призом отправлено вам в чат с ботом</div>
              </div>
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
            <div className="glowC" aria-hidden="true" />
            <div className="phdr phdrMyPrizes">
              <button type="button" className="prizesBtn prizesBtnBack" onClick={() => setScreen("main")}>
                ← Назад
              </button>
              <div className="pttl pttlMyPrizes">Условия акции</div>
            </div>
            <div className="pbody" dangerouslySetInnerHTML={{ __html: contentTexts.promoTerms }} />
          </div>
        )}

        {screen === "prizeTerms" && (
          <div className="screen active">
            <div className="glowC" aria-hidden="true" />
            <div className="phdr phdrMyPrizes">
              <button type="button" className="prizesBtn prizesBtnBack" onClick={() => setScreen("result")}>
                ← Назад
              </button>
              <div className="pttl pttlMyPrizes">Условия получения</div>
            </div>
            <div className="pbody" dangerouslySetInnerHTML={{ __html: contentTexts.prizeTerms }} />
          </div>
        )}

        {screen === "myPrizes" && (
          <div className="screen active">
            <div className="glowC" aria-hidden="true" />
            <div className="phdr phdrMyPrizes">
              <button type="button" className="prizesBtn prizesBtnBack" onClick={() => setScreen("main")}>
                ← Назад
              </button>
              <div className="pttl pttlMyPrizes">Мои призы</div>
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
                        <div className="pcdate">{formatDateTime(win.createdAt)}</div>
                        <div className="pcname">{win.prizeTitle}</div>
                        <div className="pcexp">
                          <span className="pcexpLabel">Срок до </span>
                          <span className="pcexpDate">{formatDateTime(win.expiresAt)}</span>
                        </div>
                      </div>
                      <div className="pcmeta">
                        <div className="pcval">{winStatusLabel(win.status)}</div>
                        {win.status === "active" && (win.prizeType ?? prizePool.find((p) => p.id === win.prizeId)?.type) !== "none" ? (
                          <>
                            <button className="pcOrderBtn" onClick={() => void markOrderReceived(win.id)} disabled={loading}>
                              Заказ получен
                            </button>
                            <button className="pcResendBtn" onClick={() => void resendWinReminder(win.id)} disabled={loading}>
                              Отправить повторно
                            </button>
                          </>
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
      {modal ? <Modal title={modal.title} message={modal.message} onClose={closeModal} /> : null}
    </main>
  );
}
