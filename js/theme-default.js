(() => {
  const root = document.documentElement;
  const storageKey = "REDEFINE-THEME-STATUS";

  try {
    const raw = window.localStorage.getItem(storageKey);
    let status = {};

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") status = parsed;
    }

    if (typeof status.isDark !== "boolean") {
      status.isDark = true;
      window.localStorage.setItem(storageKey, JSON.stringify(status));
      root.classList.remove("light");
      root.classList.add("dark");
    }
  } catch (error) {
    root.classList.remove("light");
    root.classList.add("dark");
  }

  const syncColorScheme = () => {
    root.style.colorScheme = root.classList.contains("light") ? "light" : "dark";
  };

  syncColorScheme();

  if (!window.__adenThemeModeObserver) {
    window.__adenThemeModeObserver = new MutationObserver(syncColorScheme);
    window.__adenThemeModeObserver.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  document.addEventListener("DOMContentLoaded", syncColorScheme, { once: true });
})();
