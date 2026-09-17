/*
 author: @jiangwen5945 & EvanNotFound
*/

const instances = new Map();
const initTokens = new Map();

const normalizeSubtitleText = (subtitleText) => {
  if (Array.isArray(subtitleText)) {
    return subtitleText.filter((entry) => typeof entry === "string" && entry);
  }

  if (typeof subtitleText === "string" && subtitleText) {
    return [subtitleText];
  }

  return [];
};

const destroyInstance = (id) => {
  const instance = instances.get(id);
  if (instance && typeof instance.destroy === "function") {
    try {
      instance.destroy();
    } catch (error) {
      console.error("Failed to destroy Typed instance:", error);
    }
  }

  instances.delete(id);

  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = "";
  }
};

const createTyped = (id, strings, options) => {
  if (typeof window.Typed === "undefined") {
    return;
  }

  if (!document.getElementById(id)) {
    return;
  }

  destroyInstance(id);

  const instance = new window.Typed(`#${id}`, {
    strings,
    typeSpeed: options.typeSpeed,
    smartBackspace: options.smartBackspace,
    backSpeed: options.backSpeed,
    backDelay: options.backDelay,
    loop: options.loop,
    startDelay: options.startDelay,
  });

  instances.set(id, instance);
};

const subtitleConfig = theme?.home_banner?.subtitle || {};
const hitokotoConfig = subtitleConfig.hitokoto || {};

export const config = {
  usrTypeSpeed: subtitleConfig.typing_speed,
  usrBackSpeed: subtitleConfig.backing_speed,
  usrBackDelay: subtitleConfig.backing_delay,
  usrStartDelay: subtitleConfig.starting_delay,
  usrLoop: subtitleConfig.loop,
  usrSmartBackspace: subtitleConfig.smart_backspace,
  usrHitokotoAPI: hitokotoConfig.api,
};

export default function initTyped(id) {
  if (!document.getElementById(id)) return;
  const currentToken = (initTokens.get(id) || 0) + 1;
  initTokens.set(id, currentToken);

  const {
    usrTypeSpeed,
    usrBackSpeed,
    usrBackDelay,
    usrStartDelay,
    usrLoop,
    usrSmartBackspace,
    usrHitokotoAPI,
  } = config;

  const options = {
    typeSpeed: usrTypeSpeed ?? 100,
    smartBackspace: usrSmartBackspace ?? false,
    backSpeed: usrBackSpeed ?? 80,
    backDelay: usrBackDelay ?? 1500,
    loop: usrLoop ?? false,
    startDelay: usrStartDelay ?? 500,
  };

  const hitokotoEnabled = Boolean(hitokotoConfig.enable);

  if (hitokotoEnabled) {
    if (!usrHitokotoAPI) {
      return;
    }

    createTyped(id, normalizeSubtitleText(subtitleConfig.text), options);
    const quoteRequest = new AbortController();
    const quoteTimeout = setTimeout(() => quoteRequest.abort(), 8000);
    fetch(usrHitokotoAPI, { signal: quoteRequest.signal })
      .then((response) => response.json())
      .then((data) => {
        if (initTokens.get(id) !== currentToken) {
          return;
        }

        const quote = typeof data?.hitokoto === "string" ? data.hitokoto : "";
        if (!quote) {
          return;
        }

        const author =
          typeof data?.from_who === "string" && hitokotoConfig.show_author
            ? data.from_who
            : "";
        const text = author ? `${quote}——${author}` : quote;

        createTyped(id, [text], options);
      })
      .catch((error) => {
        console.error("Failed to fetch hitokoto:", error);
      }).finally(() => clearTimeout(quoteTimeout));

    return;
  }

  const subtitleEntries = normalizeSubtitleText(subtitleConfig.text);
  if (subtitleEntries.length === 0) {
    return;
  }

  createTyped(id, subtitleEntries, options);
}
