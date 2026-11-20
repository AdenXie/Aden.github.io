/* Site terminal: press ~ (or pick it in the dock's settings) to browse the blog as a small
   file system, read the home cards' data and ask the site's chat. Loaded on first open by
   site-runtime.js together with css/terminal.css; the post list is /terminal-index.json. */
(() => {
  "use strict";
  if (window.AdenTerminal) return;

  const english = () => document.documentElement.lang.startsWith("en");
  const t = (zh, en) => (english() ? en : zh);
  const PREFIX = () => (english() ? "/en" : "");

  // ---------------------------------------------------------------------------------------
  // Shell core: commands over the post index. It writes through `out` and touches the page
  // only through `env`, so tests can run it without a browser.
  // ---------------------------------------------------------------------------------------
  const ROOT_ENTRIES = [
    { name: "posts/", zh: "文章", en: "articles" },
    { name: "daily/", zh: "每日简报", en: "daily briefs" },
    { name: "tags/", zh: "标签", en: "tags" },
    { name: "categories/", zh: "分类", en: "categories" },
    { name: "about", zh: "关于", en: "about", url: "/about/" },
    { name: "world-time", zh: "世界时间", en: "world time", url: "/world-time/" }
  ];
  const PAGE_SIZE = 15;
  const slug = name => name.trim().replace(/\s+/g, "-");

  const COMMANDS = {
    help: ["查看命令", "list commands"],
    ls: ["列出目录，-a 显示全部", "list a directory; -a shows all"],
    cd: ["进入目录", "change directory"],
    pwd: ["当前目录", "print directory"],
    cat: ["查看文章摘要", "show a post's summary"],
    open: ["打开文章或页面", "open a post or page"],
    find: ["按关键词找文章", "search posts"],
    recent: ["最近的文章", "latest posts"],
    tags: ["常用标签", "popular tags"],
    weather: ["你那里的天气", "weather where you are"],
    fx: ["澳元兑人民币，可加 7d / 30d / 90d", "AUD/CNY; add 7d, 30d or 90d"],
    sky: ["此刻头顶的行星", "planets overhead now"],
    ask: ["问站内 AI", "ask the site's AI"],
    whoami: ["你是谁（按 IP 估算）", "who you are (by IP)"],
    date: ["几个城市的时间", "time in a few cities"],
    theme: ["切换深浅色 light / dark", "switch light / dark"],
    lang: ["切换语言 zh / en", "switch language zh / en"],
    history: ["命令历史", "command history"],
    clear: ["清屏（Ctrl+L）", "clear the screen (Ctrl+L)"],
    exit: ["关闭终端（Esc）", "close the terminal (Esc)"]
  };
  const EXTRA = ["man", "neofetch", "sudo", "rm", "echo", "hello", "hi"];

  function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  }

  // Split a command line, honouring "double" and 'single' quotes.
  function tokenize(line) {
    const tokens = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = pattern.exec(line))) tokens.push(match[1] ?? match[2] ?? match[3]);
    return tokens;
  }

  function createShell(env) {
    const posts = env.index.filter(post => !post.b);
    const briefs = env.index.filter(post => post.b);
    const count = list => list.reduce((map, name) => map.set(name, (map.get(name) || 0) + 1), new Map());
    const tagCounts = count(env.index.flatMap(post => post.g || []));
    const categoryCounts = count(env.index.flatMap(post => post.c || []));
    const state = { cwd: [], last: [], asking: null };

    // Paths are arrays of segments under ~: [], ["posts"], ["tags", "Gemini"].
    function resolve(input = "") {
      let parts = input.startsWith("~") || input.startsWith("/") ? [] : [...state.cwd];
      for (const piece of input.replace(/^~\/?|^\//, "").split("/")) {
        if (!piece || piece === ".") continue;
        if (piece === "..") parts.pop();
        else parts.push(piece);
      }
      return parts;
    }
    const pathText = parts => (parts.length ? `~/${parts.join("/")}` : "~");
    const findName = (map, name) => [...map.keys()].find(key => key.toLowerCase() === name.toLowerCase());

    // A directory's posts, or null when the path is not a directory.
    function directory(parts) {
      if (!parts.length) return { root: true };
      const [head, name, ...rest] = parts;
      if (rest.length) return null;
      if (head === "posts" && !name) return { posts };
      if (head === "daily" && !name) return { posts: briefs };
      if (head === "tags" || head === "categories") {
        const map = head === "tags" ? tagCounts : categoryCounts;
        if (!name) return { names: map, kind: head };
        const key = findName(map, name);
        if (!key) return null;
        return { posts: env.index.filter(post => (head === "tags" ? post.g : post.c)?.includes(key)), key, kind: head };
      }
      return null;
    }

    function pageOf(parts) {
      if (!parts.length) return "/";
      const [head, name] = parts;
      const root = ROOT_ENTRIES.find(entry => entry.url && entry.name === head);
      if (root && !name) return root.url;
      if (head === "posts" && !name) return "/archives/";
      if (head === "daily" && !name) return "/daily/";
      const dir = directory(parts);
      if (dir?.key && head === "categories" && dir.posts.every(post => post.b)) return "/daily/";
      if (dir?.key) return `/${head}/${slug(dir.key)}/`;
      if (head === "tags" || head === "categories") return `/${head}/`;
      return null;
    }

    // A post named by its number in the last listing, its path or a unique title match.
    function postOf(arg) {
      if (!arg) return null;
      if (/^\d+$/.test(arg)) return state.last[Number(arg) - 1] || null;
      const bySlug = env.index.find(post => post.u.replace(/\/$/, "").split("/").pop() === arg.replace(/\/$/, ""));
      if (bySlug) return bySlug;
      const matches = env.index.filter(post => post.t.toLowerCase().includes(arg.toLowerCase()));
      return matches.length === 1 ? matches[0] : null;
    }

    function listPosts(out, list, all) {
      const shown = all ? list : list.slice(0, PAGE_SIZE);
      state.last = shown;
      shown.forEach((post, i) => out.line([
        { text: String(i + 1).padStart(3, " "), cls: "dim" }, "  ",
        { text: post.d, cls: "dim" }, "  ",
        { text: post.t.length > 64 ? post.t.slice(0, 63) + "…" : post.t, href: post.u, cls: post.b ? "" : "title", tip: post.t }
      ], "item"));
      if (!shown.length) out.line([{ text: t("（空）", "(empty)"), cls: "dim" }]);
      if (shown.length < list.length) out.line([{ text: t(`…还有 ${list.length - shown.length} 篇，ls -a 显示全部`, `…${list.length - shown.length} more; ls -a shows all`), cls: "dim" }]);
      if (shown.length) out.line([{ text: t("cat <编号> 看摘要，open <编号> 打开", "cat <n> for a summary, open <n> to read"), cls: "dim" }]);
    }

    function listNames(out, map, kind, all) {
      const names = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const shown = all ? names : names.slice(0, 30);
      out.line(shown.flatMap(([name, n], i) => [i ? "   " : "", { text: name.includes(" ") ? `"${name}"` : name, cls: "dir" }, { text: ` ${n}`, cls: "dim" }]));
      if (shown.length < names.length) out.line([{ text: t(`…共 ${names.length} 个，ls -a 显示全部`, `…${names.length} in all; ls -a shows all`), cls: "dim" }]);
      out.line([{ text: t(`cd ${kind}/<名称> 进入`, `cd ${kind}/<name> to enter`), cls: "dim" }]);
    }

    const commands = {
      help(out, args) {
        if (args[0]) return commands.man(out, args);
        out.line([{ text: t("可用命令", "Commands"), cls: "head" }]);
        for (const [name, [zh, en]] of Object.entries(COMMANDS)) out.line([{ text: name, cls: "cmd key" }, { text: t(zh, en), cls: "dim" }]);
        out.line([{ text: t("Tab 补全 · ↑↓ 翻历史 · Ctrl+C 中断 · 还有几个没写在这里的命令", "Tab completes · ↑↓ history · Ctrl+C interrupts · a few commands are not listed"), cls: "dim" }]);
      },
      man(out, args) {
        const name = args[0];
        const entry = COMMANDS[name];
        if (!entry) { out.line([{ text: t(`没有 ${name || ""} 的手册`, `No manual entry for ${name || ""}`), cls: "err" }]); return; }
        out.line([{ text: name, cls: "cmd" }, "  ", t(entry[0], entry[1])]);
      },
      pwd(out) { out.line([pathText(state.cwd)]); },
      ls(out, args) {
        const all = args.includes("-a") || args.includes("-la") || args.includes("-al");
        const target = args.find(arg => !arg.startsWith("-"));
        const parts = resolve(target);
        const dir = directory(parts);
        if (!dir) {
          const post = postOf(target);
          if (post) { listPosts(out, [post], true); return; }
          out.line([{ text: t(`ls: 找不到 ${target}`, `ls: cannot access ${target}`), cls: "err" }]);
          return;
        }
        if (dir.root) {
          out.line(ROOT_ENTRIES.flatMap((entry, i) => [i ? "   " : "", { text: entry.name, cls: entry.name.endsWith("/") ? "dir" : "file", href: entry.url }]));
          return;
        }
        if (dir.names) { listNames(out, dir.names, dir.kind, all); return; }
        listPosts(out, dir.posts, all);
      },
      cd(out, args) {
        const parts = resolve(args[0] || "~");
        const dir = directory(parts);
        if (!dir) { out.line([{ text: t(`cd: 没有这个目录：${args[0]}`, `cd: no such directory: ${args[0]}`), cls: "err" }]); return; }
        // Directory names keep the index's spelling, whatever case was typed.
        if (dir.key) parts[1] = dir.key;
        state.cwd = parts;
        env.setPrompt(pathText(parts));
      },
      cat(out, args) {
        const post = postOf(args.join(" "));
        if (!post) { out.line([{ text: t("cat: 先用 ls 或 find 列出文章，再写编号", "cat: list posts with ls or find first, then give a number"), cls: "err" }]); return; }
        out.line([{ text: post.t, cls: "title", href: post.u }]);
        out.line([{ text: [post.d, ...(post.c || []), ...(post.g || []).map(tag => `#${tag}`)].join("  ·  "), cls: "dim" }]);
        if (post.s) out.line([post.s]);
        out.line([{ text: t("open 打开全文", "open to read it"), cls: "dim" }]);
        state.last = [post];
      },
      open(out, args) {
        const arg = args.join(" ");
        const post = postOf(arg) || (!arg && state.last.length === 1 ? state.last[0] : null);
        const url = post ? post.u : pageOf(resolve(arg || "."));
        if (!url) { out.line([{ text: t(`open: 打不开 ${arg}`, `open: cannot open ${arg}`), cls: "err" }]); return; }
        const full = post ? url : PREFIX() + url;
        out.line([{ text: t("→ 正在打开 ", "→ opening "), cls: "dim" }, { text: post ? post.t : full, href: full }]);
        env.navigate(full);
      },
      find(out, args) {
        const words = args.map(word => word.toLowerCase()).filter(Boolean);
        if (!words.length) { out.line([{ text: t("find: 要找什么？例如 find 英伟达", "find: what for? e.g. find nvidia"), cls: "err" }]); return; }
        const text = post => [post.t, post.s, ...(post.g || []), ...(post.c || [])].join(" ").toLowerCase();
        const matches = env.index.filter(post => words.every(word => text(post).includes(word)));
        // Articles first, then briefs, each newest first.
        matches.sort((a, b) => Number(Boolean(a.b)) - Number(Boolean(b.b)) || b.d.localeCompare(a.d));
        out.line([{ text: t(`找到 ${matches.length} 篇`, `${matches.length} found`), cls: "dim" }]);
        listPosts(out, matches, args.includes("-a"));
      },
      recent(out, args) {
        const n = Math.max(1, Math.min(30, Number(args[0]) || 5));
        listPosts(out, posts.slice(0, n), true);
      },
      tags(out, args) { listNames(out, tagCounts, "tags", args.includes("-a")); },
      history(out) {
        env.history().forEach((line, i) => out.line([{ text: String(i + 1).padStart(4, " "), cls: "dim" }, "  ", line]));
      },
      clear() { env.clear(); },
      exit() { env.close(); },
      whoami(out) {
        const place = env.place();
        out.line([t("访客", "visitor"), { text: place ? t(` · 来自 ${place}（按 IP 估算）`, ` · from ${place} (estimated from IP)`) : t(" · 位置未知，首页天气卡读到后才知道", " · location unknown until the home weather card reads it"), cls: "dim" }]);
      },
      date(out) {
        const now = env.now();
        const zones = [[t("本地", "Local"), undefined], [t("北京", "Beijing"), "Asia/Shanghai"], [t("悉尼", "Sydney"), "Australia/Sydney"], [t("纽约", "New York"), "America/New_York"], [t("伦敦", "London"), "Europe/London"]];
        for (const [label, timeZone] of zones) {
          const text = new Intl.DateTimeFormat(english() ? "en-GB" : "zh-CN", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
          out.line([{ text: label, cls: "dim key" }, text]);
        }
      },
      theme(out, args) {
        const want = args[0];
        if (want && want !== "light" && want !== "dark") { out.line([{ text: "theme: light | dark", cls: "err" }]); return; }
        const now = env.setTheme(want);
        out.line([{ text: t(`当前是${now === "dark" ? "深色" : "浅色"}`, `now ${now}`), cls: "dim" }]);
      },
      lang(out, args) {
        const want = args[0] || (english() ? "zh" : "en");
        if (want !== "zh" && want !== "en") { out.line([{ text: "lang: zh | en", cls: "err" }]); return; }
        if ((want === "en") === english()) { out.line([{ text: t("已经是中文了", "already in English"), cls: "dim" }]); return; }
        out.line([{ text: want === "en" ? "→ English" : "→ 中文", cls: "dim" }]);
        env.switchLanguage(want);
      },
      echo(out, args) { out.line([args.join(" ")]); },
      hello(out) { out.line([t("你好，夜之城的访客。输入 help 看看能做什么。", "Hello, night-city visitor. Type help to see what you can do.")]); },
      neofetch(out) {
        const first = env.index[env.index.length - 1]?.d;
        const rows = [
          ["aden@space", ""],
          ["OS", "Hexo 7.3 · Redefine 2.9"],
          ["Host", "GitHub Actions → Vercel → Alibaba ESA"],
          [t("文章", "Posts"), `${posts.length}`],
          [t("简报", "Briefs"), `${briefs.length}`],
          [t("标签", "Tags"), `${tagCounts.size}`],
          [t("开站", "Since"), first || "-"],
          ["Shell", "aden-sh 1.0"],
          [t("主题", "Theme"), "night city"]
        ];
        rows.forEach(([key, value], i) => out.line(i ? [{ text: key, cls: "cmd key" }, value] : [{ text: key, cls: "title" }]));
        out.line([{ text: "███", cls: "swatch-cyan" }, { text: "███", cls: "swatch-signal" }, { text: "███", cls: "swatch-amber" }, { text: "███", cls: "swatch-alert" }]);
      },
      sudo(out) { out.line([{ text: t("visitor 不在 sudoers 名单里。这次就当没看见。", "visitor is not in the sudoers file. We'll let it slide this time."), cls: "err" }]); },
      rm(out) { out.line([{ text: t("rm: 这是一座静态博客，删不掉的。", "rm: this is a static blog; nothing here can be deleted."), cls: "err" }]); },
      weather: (out, args, signal) => env.weather(out, signal),
      fx: (out, args, signal) => env.fx(out, args[0], signal),
      sky: (out, args, signal) => env.sky(out, signal),
      ask: (out, args, signal) => env.ask(out, args.join(" "), signal)
    };
    commands.hi = commands.hello;
    commands.ll = (out, args) => commands.ls(out, ["-a", ...args]);
    commands.dir = commands.ls;

    async function run(line, out, signal) {
      const trimmed = line.trim();
      if (!trimmed) return;
      // "ask" keeps its question as typed, quotes and all.
      const askMatch = /^ask\s+([\s\S]+)$/i.exec(trimmed);
      const tokens = tokenize(trimmed);
      const name = tokens[0].toLowerCase();
      const args = askMatch ? [askMatch[1]] : tokens.slice(1);
      if (name === "ask" && !askMatch) { out.line([{ text: t("ask: 写下你的问题，例如 ask 这个博客用什么搭的？", "ask: add a question, e.g. ask what is this blog built with?"), cls: "err" }]); return; }
      const command = commands[name];
      if (!command) {
        const guess = [...Object.keys(COMMANDS), ...EXTRA].map(known => [known, distance(name, known)]).sort((a, b) => a[1] - b[1])[0];
        out.line([{ text: t(`找不到命令：${name}`, `command not found: ${name}`), cls: "err" }, guess && guess[1] <= 2 ? { text: t(`，是不是想输入 ${guess[0]}？`, `; did you mean ${guess[0]}?`), cls: "dim" } : { text: t("，输入 help 查看命令", "; type help for commands"), cls: "dim" }]);
        return;
      }
      await command(out, args, signal);
    }

    // Completion candidates for the line as typed (the last word is completed).
    function complete(line) {
      const tokens = line.match(/\S+|\s+$/g) || [];
      const typingFirst = tokens.length <= 1 && !/\s$/.test(line);
      const word = /\s$/.test(line) ? "" : (line.match(/\S+$/) || [""])[0];
      if (typingFirst) return [...Object.keys(COMMANDS)].filter(name => name.startsWith(word.toLowerCase())).sort();
      const command = tokenize(line)[0]?.toLowerCase();
      if (command === "theme") return ["light", "dark"].filter(value => value.startsWith(word));
      if (command === "lang") return ["zh", "en"].filter(value => value.startsWith(word));
      if (command === "fx") return ["7d", "30d", "90d"].filter(value => value.startsWith(word));
      if (command === "man" || command === "help") return Object.keys(COMMANDS).filter(name => name.startsWith(word));
      if (!["cd", "ls", "open", "cat"].includes(command)) return [];
      const slash = word.lastIndexOf("/");
      const base = slash >= 0 ? word.slice(0, slash + 1) : "";
      const partial = word.slice(slash + 1).toLowerCase();
      const dir = directory(resolve(base || "."));
      if (!dir) return [];
      let names = [];
      if (dir.root) names = ROOT_ENTRIES.filter(entry => command !== "cd" || entry.name.endsWith("/")).map(entry => entry.name);
      else if (dir.names) names = [...dir.names.keys()].map(name => (name.includes(" ") ? `"${name}"` : name) + "/");
      else if (command !== "cd") names = dir.posts.slice(0, 400).map(post => post.u.replace(/\/$/, "").split("/").pop());
      return names.filter(name => name.replace(/^"/, "").toLowerCase().startsWith(partial)).map(name => base + name);
    }

    return { run, complete, prompt: () => pathText(state.cwd), state };
  }

  // ---------------------------------------------------------------------------------------
  // Data commands: the same sources the home cards and the chat use.
  // ---------------------------------------------------------------------------------------
  const WEATHER_KEY = "aden-visitor-weather-v2";
  const WEATHER_URL = location.hostname === "blog.adenxie.com.cn" ? "https://geo.adenxie.com.cn/api/visitor-weather" : "/api/visitor-weather";
  const WEATHER = {
    0: ["晴朗", "Clear"], 1: ["大致晴朗", "Mainly clear"], 2: ["局部多云", "Partly cloudy"], 3: ["阴天", "Overcast"],
    45: ["有雾", "Fog"], 48: ["雾凇", "Rime fog"], 51: ["小毛毛雨", "Light drizzle"], 53: ["毛毛雨", "Drizzle"], 55: ["较强毛毛雨", "Heavy drizzle"],
    56: ["冻毛毛雨", "Freezing drizzle"], 57: ["较强冻毛毛雨", "Heavy freezing drizzle"], 61: ["小雨", "Light rain"], 63: ["中雨", "Rain"], 65: ["大雨", "Heavy rain"],
    66: ["冻雨", "Freezing rain"], 67: ["较强冻雨", "Heavy freezing rain"], 71: ["小雪", "Light snow"], 73: ["中雪", "Snow"], 75: ["大雪", "Heavy snow"],
    77: ["米雪", "Snow grains"], 80: ["局部阵雨", "Light showers"], 81: ["阵雨", "Showers"], 82: ["强阵雨", "Heavy showers"], 85: ["阵雪", "Snow showers"],
    86: ["强阵雪", "Heavy snow showers"], 95: ["雷暴", "Thunderstorm"], 96: ["雷暴伴冰雹", "Thunderstorm with hail"], 99: ["强雷暴伴冰雹", "Severe thunderstorm with hail"]
  };
  const readJSON = (storage, key) => { try { return JSON.parse(storage.getItem(key)); } catch (_) { return null; } };

  async function fetchJSON(url, signal, options = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: "application/json", ...(options.headers || {}) } });
      if (!response.ok) throw new Error(String(response.status));
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  function cachedWeather() {
    const cached = readJSON(sessionStorage, WEATHER_KEY);
    return cached?.payload?.current && Date.now() - cached.savedAt < 30 * 60 * 1000 ? cached.payload : null;
  }

  async function weather(out, signal) {
    let payload = cachedWeather();
    if (!payload) {
      const status = out.line([{ text: t("正在读取天气…", "Reading the weather…"), cls: "dim" }]);
      try {
        payload = await fetchJSON(WEATHER_URL, signal);
        try { sessionStorage.setItem(WEATHER_KEY, JSON.stringify({ savedAt: Date.now(), payload })); } catch (_) { /* optional */ }
      } catch (error) {
        status.remove();
        if (signal.aborted) return;
        out.line([{ text: t("天气服务暂时连不上，稍后再试", "The weather service is unreachable for now; try again later"), cls: "err" }]);
        return;
      }
      status.remove();
    }
    const { location: place, current, daily } = payload;
    const [zh, en] = WEATHER[current.weather_code] || ["天气未知", "Unknown"];
    const clock = value => (typeof value === "string" ? value.slice(11, 16) : "--:--");
    out.line([{ text: place?.label || t("你所在的地方", "Your area"), cls: "title" }, { text: t("（按 IP 估算）", " (estimated from IP)"), cls: "dim" }]);
    out.line([{ text: `${Math.round(current.temperature_2m)}°C`, cls: "big" }, "  ", t(zh, en), { text: t(`  体感 ${Math.round(current.apparent_temperature)}°`, `  feels ${Math.round(current.apparent_temperature)}°`), cls: "dim" }]);
    out.line([{ text: t(`湿度 ${current.relative_humidity_2m}%  ·  风速 ${Math.round(current.wind_speed_10m)} km/h  ·  日出 ${clock(daily?.sunrise?.[0])}  ·  日落 ${clock(daily?.sunset?.[0])}`, `Humidity ${current.relative_humidity_2m}%  ·  wind ${Math.round(current.wind_speed_10m)} km/h  ·  sunrise ${clock(daily?.sunrise?.[0])}  ·  sunset ${clock(daily?.sunset?.[0])}`), cls: "dim" }]);
  }

  const SPARK = "▁▂▃▄▅▆▇█";
  function sparkline(values, width) {
    const step = values.length / width;
    const sampled = values.length <= width ? values : Array.from({ length: width }, (_, i) => values[Math.min(values.length - 1, Math.round(i * step))]);
    const low = Math.min(...sampled), high = Math.max(...sampled);
    return sampled.map(v => SPARK[high === low ? 3 : Math.round(((v - low) / (high - low)) * 7)]).join("");
  }

  async function fx(out, range, signal) {
    const days = Number(String(range || "30d").replace(/d$/i, ""));
    if (![7, 30, 90].includes(days)) { out.line([{ text: "fx: 7d | 30d | 90d", cls: "err" }]); return; }
    const status = out.line([{ text: t("正在读取中行牌价…", "Reading Bank of China rates…"), cls: "dim" }]);
    let quote, history;
    try {
      [quote, history] = await Promise.all([
        fetchJSON("/api/aud-cny?v=4", signal),
        fetchJSON("/api/aud-cny-history?v=1", signal).catch(() => null)
      ]);
    } catch (_) {
      status.remove();
      if (!signal.aborted) out.line([{ text: t("汇率服务暂时连不上，稍后再试", "The exchange service is unreachable for now; try again later"), cls: "err" }]);
      return;
    }
    status.remove();
    out.line([{ text: "AUD / CNY", cls: "title" }, { text: t("  中国银行现汇 · 人民币 / 100 澳元", "  Bank of China spot · CNY per 100 AUD"), cls: "dim" }]);
    out.line([{ text: t("买入 ", "buy  "), cls: "dim" }, { text: `¥${quote.spotBuy.toFixed(2)}`, cls: "cyan" }, { text: t("   卖出 ", "   sell "), cls: "dim" }, { text: `¥${quote.spotSell.toFixed(2)}`, cls: "signal" }]);
    const list = Array.isArray(history?.days) ? history.days : [];
    if (list.length > 1) {
      const end = Date.parse(`${list[list.length - 1][0]}T00:00:00Z`);
      const shown = list.filter(day => end - Date.parse(`${day[0]}T00:00:00Z`) <= days * 86400000);
      const sells = shown.map(day => day[2]);
      const delta = sells[sells.length - 1] - sells[0];
      const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
      out.line([{ text: sparkline(sells, 40), cls: "signal spark" }]);
      out.line([{ text: `${shown[0][0]} → ${shown[shown.length - 1][0]}  `, cls: "dim" }, t("卖出价 ", "sell "), `${sign}${Math.abs(delta).toFixed(2)} (${sign}${Math.abs((delta / sells[0]) * 100).toFixed(2)}%)`, { text: t(`  最高 ${Math.max(...sells).toFixed(2)} · 最低 ${Math.min(...sells).toFixed(2)}`, `  high ${Math.max(...sells).toFixed(2)} · low ${Math.min(...sells).toFixed(2)}`), cls: "dim" }]);
    }
    out.line([{ text: t(`中行发布 ${String(quote.publishedAt).slice(0, 16)} 北京时间${quote.stale ? " · 可能不是最新" : ""}`, `BOC published ${String(quote.publishedAt).slice(0, 16)} Beijing time${quote.stale ? " · may be out of date" : ""}`), cls: "dim" }]);
  }

  const PLANETS = { mercury: ["水星", "Mercury"], venus: ["金星", "Venus"], mars: ["火星", "Mars"], jupiter: ["木星", "Jupiter"], saturn: ["土星", "Saturn"] };
  const COMPASS = [["北", "N"], ["东北", "NE"], ["东", "E"], ["东南", "SE"], ["南", "S"], ["西南", "SW"], ["西", "W"], ["西北", "NW"]];
  function country() {
    try {
      const own = sessionStorage.getItem("aden-sky-country");
      if (own) return own;
    } catch (_) { /* optional */ }
    const code = readJSON(sessionStorage, WEATHER_KEY)?.payload?.location?.country;
    return typeof code === "string" && /^[A-Z]{2}$/i.test(code) ? code.toUpperCase() : null;
  }

  async function sky(out) {
    let math;
    try {
      math = await import("/js/scenes/sky-math.js");
    } catch (_) {
      out.line([{ text: t("星空计算没有加载成功", "The sky maths did not load"), cls: "err" }]);
      return;
    }
    const code = country();
    const [lat, lon] = math.placeOf(code);
    const now = Date.now();
    const basis = math.horizonBasis(lat, lon, now);
    const up = math.planets(now).map(planet => {
      const [alt, az] = math.altAz(math.toHorizon(basis, math.equatorial(planet.ra, planet.dec)));
      return { ...planet, alt, az };
    }).filter(planet => planet.alt > 0).sort((a, b) => a.mag - b.mag);
    out.line([{ text: t("此刻头顶", "Overhead now"), cls: "title" }, { text: t(`  ${code || "CN"} 的大致中心 · 纬度 ${lat.toFixed(0)}° 经度 ${lon.toFixed(0)}°`, `  near the middle of ${code || "CN"} · ${lat.toFixed(0)}°, ${lon.toFixed(0)}°`), cls: "dim" }]);
    if (!up.length) { out.line([t("五颗亮行星此刻都在地平线以下。", "All five bright planets are below the horizon right now.")]); return; }
    for (const planet of up) {
      const [zh, en] = COMPASS[Math.round(planet.az / 45) % 8];
      out.line([{ text: t(PLANETS[planet.name][0], PLANETS[planet.name][1]), cls: "signal key" }, t(`${zh}方 ${planet.az.toFixed(0)}°，高 ${planet.alt.toFixed(0)}°`, `${en} ${planet.az.toFixed(0)}°, ${planet.alt.toFixed(0)}° up`), { text: t(`  亮度 ${planet.mag.toFixed(1)} 等`, `  mag ${planet.mag.toFixed(1)}`), cls: "dim" }]);
    }
    out.line([{ text: t("白天也会列出，阳光下看不见。首页的星空画的就是这片天。", "Listed by day too, when sunlight hides them. The home banner draws this same sky."), cls: "dim" }]);
  }

  // The chat panel's API: same request, same stream. The terminal keeps its own short history.
  const askHistory = [];
  let askedOnce = false;
  function localWeather() {
    const payload = cachedWeather();
    if (!payload?.location?.label) return undefined;
    const { location: place, current, daily } = payload;
    return { label: place.label, city: place.city || undefined, region: place.region || undefined, country: place.country || undefined, timezone: place.timezone, savedAt: Date.now(),
      current: { time: current.time, temperature: current.temperature_2m, apparentTemperature: current.apparent_temperature, humidity: current.relative_humidity_2m, weatherCode: current.weather_code, windSpeed: current.wind_speed_10m, isDay: current.is_day === undefined ? undefined : Boolean(current.is_day) },
      sunrise: daily?.sunrise?.[0], sunset: daily?.sunset?.[0] };
  }

  async function ask(out, question, signal) {
    if (!askedOnce) {
      askedOnce = true;
      out.line([{ text: t("对话不保存，问题会发送给 Google Gemini；AI 可能出错。", "Conversations are not saved; questions go to Google Gemini. AI can make mistakes."), cls: "dim" }]);
    }
    const status = out.line([{ text: t("思考中…", "Thinking…"), cls: "dim pulse" }]);
    const answer = out.block("answer");
    let text = "";
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
        body: JSON.stringify({ messages: [...askHistory.slice(-8), { role: "user", content: question.slice(0, 4000) }], ...(localWeather() && { local: localWeather() }) }) });
      if (response.status === 429) throw new Error("rate_limited");
      if (!response.ok || !response.body) throw new Error("unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", done = false;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (!raw.startsWith("data: ")) continue;
          const data = JSON.parse(raw.slice(6));
          if (data.error) throw new Error(data.error);
          if (data.status === "searching") status.firstChild.textContent = t("联网搜索中…", "Searching the web…");
          if (data.status === "rate") status.firstChild.textContent = t("读取汇率中…", "Reading the rate…");
          if (data.status === "weather") status.firstChild.textContent = t("读取天气中…", "Reading the weather…");
          if (typeof data.text === "string") {
            text += data.text;
            if (text.trim()) status.remove();
            answer.textContent = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
            out.scroll();
          }
          if (data.done) { done = true; break; }
        }
      }
      if (!text.trim()) throw new Error("interrupted");
      askHistory.push({ role: "user", content: question }, { role: "assistant", content: text });
    } catch (error) {
      status.remove();
      if (signal.aborted) { out.line([{ text: "^C", cls: "dim" }]); return; }
      const messages = {
        rate_limited: t("问得有点快了，过一会儿再问", "Too many questions; wait a moment"),
        unavailable: t("AI 服务暂时不可用，稍后再试", "The AI service is unavailable for now; try later")
      };
      out.line([{ text: messages[error.message] || t("回答中断了，可以再问一次", "The answer was interrupted; ask again"), cls: "err" }]);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Window: a console that drops from the top (full screen on phones).
  // ---------------------------------------------------------------------------------------
  const HISTORY_KEY = "aden-terminal-history";
  const MAX_LINES = 600;
  let ui = null;

  function navigate(url) {
    close();
    if (window.swup?.navigate) window.swup.navigate(url);
    else location.assign(url);
  }

  function setTheme(want) {
    const dark = () => !document.documentElement.classList.contains("light");
    const current = dark() ? "dark" : "light";
    const target = want || (current === "dark" ? "light" : "dark");
    if (target !== current) document.querySelector(".tool-dark-light-toggle")?.click();
    return dark() ? "dark" : "light";
  }

  function switchLanguage(want) {
    const link = [...document.querySelectorAll(".aden-language-switch a[lang]")].find(a => (want === "en" ? a.lang === "en" : a.lang.startsWith("zh")));
    close();
    if (link) { link.click(); return; }
    location.assign(want === "en" ? `/en${location.pathname}` : location.pathname.replace(/^\/en(?=\/)/, "") || "/");
  }

  function build(index) {
    const root = document.createElement("div");
    root.className = "aden-term";
    root.hidden = true;
    root.innerHTML = `
      <div class="aden-term-backdrop"></div>
      <section class="aden-term-panel" role="dialog" aria-modal="true" aria-labelledby="aden-term-title">
        <header class="aden-term-bar">
          <span class="aden-term-lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <h2 id="aden-term-title" class="aden-term-title">aden@space: <span data-term="path">~</span></h2>
          <span class="aden-term-keys" aria-hidden="true"><kbd>Tab</kbd> ${t("补全", "complete")} <kbd>↑</kbd> ${t("历史", "history")} <kbd>Esc</kbd> ${t("关闭", "close")}</span>
          <button type="button" class="aden-term-close" aria-label="${t("关闭终端", "Close terminal")}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </header>
        <div class="aden-term-screen">
          <div class="aden-term-output" role="log" aria-live="polite" aria-relevant="additions"></div>
          <form class="aden-term-line" autocomplete="off">
            <label for="aden-term-input" class="aden-term-prompt"><span class="aden-term-user">visitor@aden</span>:<span data-term="prompt">~</span>$</label>
            <input id="aden-term-input" name="command" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-describedby="aden-term-suggest">
          </form>
        </div>
        <div class="aden-term-suggest" id="aden-term-suggest" aria-live="polite"></div>
      </section>`;
    document.body.append(root);
    const panel = root.querySelector(".aden-term-panel");
    const screen = root.querySelector(".aden-term-screen");
    const output = root.querySelector(".aden-term-output");
    const input = root.querySelector("input");
    const suggest = root.querySelector(".aden-term-suggest");
    const form = root.querySelector("form");

    let history = [];
    try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY)) || []; } catch (_) { history = []; }
    let cursor = history.length, draft = "", running = null;

    const scroll = () => { screen.scrollTop = screen.scrollHeight; };
    const trim = () => { while (output.childElementCount > MAX_LINES) output.firstElementChild.remove(); };
    const out = {
      line(segments, kind) {
        const row = document.createElement("div");
        row.className = kind ? `aden-term-row is-${kind}` : "aden-term-row";
        for (const segment of segments) {
          if (!segment) continue;
          if (typeof segment === "string") { row.append(segment); continue; }
          const node = document.createElement(segment.href ? "a" : "span");
          node.textContent = segment.text;
          if (segment.tip && segment.tip !== segment.text) node.title = segment.tip;
          if (segment.cls) node.className = segment.cls.split(" ").map(c => `is-${c}`).join(" ");
          if (segment.href) {
            node.href = segment.href;
            node.addEventListener("click", event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || /^https?:/.test(segment.href)) return;
              event.preventDefault();
              navigate(segment.href);
            });
          }
          row.append(node);
        }
        output.append(row);
        trim();
        scroll();
        return row;
      },
      block(kind) {
        const node = document.createElement("div");
        node.className = `aden-term-row is-${kind}`;
        output.append(node);
        scroll();
        return node;
      },
      scroll
    };

    const shell = createShell({
      index,
      now: () => new Date(),
      place: () => readJSON(sessionStorage, WEATHER_KEY)?.payload?.location?.label || null,
      history: () => history,
      setPrompt(path) {
        root.querySelector('[data-term="prompt"]').textContent = path;
        root.querySelector('[data-term="path"]').textContent = path;
      },
      clear() { output.replaceChildren(); },
      close,
      navigate,
      setTheme,
      switchLanguage,
      weather, fx, sky, ask
    });

    function echo(line) {
      out.line([{ text: "visitor@aden", cls: "user" }, { text: `:${shell.prompt()}$ `, cls: "dim" }, line]);
    }

    function showSuggestions(list) {
      suggest.replaceChildren(...list.slice(0, 12).map(name => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.tabIndex = -1;
        chip.textContent = name;
        chip.addEventListener("click", () => { input.value = replaceLast(input.value, name); input.focus(); refresh(); });
        return chip;
      }));
      if (list.length > 12) suggest.append(Object.assign(document.createElement("span"), { textContent: `+${list.length - 12}` }));
    }
    const replaceLast = (line, word) => line.replace(/\S*$/, word) + (word.endsWith("/") ? "" : " ");
    function refresh() {
      const value = input.value;
      if (!value.trim()) { showSuggestions([]); return; }
      const list = shell.complete(value);
      showSuggestions(list.length === 1 && list[0] === value.trim() ? [] : list);
    }

    async function submit(line) {
      echo(line);
      if (line.trim()) {
        if (history[history.length - 1] !== line) history.push(line);
        history = history.slice(-100);
        try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (_) { /* optional */ }
      }
      cursor = history.length;
      draft = "";
      input.value = "";
      showSuggestions([]);
      const controller = new AbortController();
      running = controller;
      form.classList.add("is-busy");
      try {
        await shell.run(line, out, controller.signal);
      } catch (error) {
        out.line([{ text: t("命令出错了：", "Command failed: ") + (error?.message || error), cls: "err" }]);
      } finally {
        if (running === controller) running = null;
        form.classList.remove("is-busy");
        if (!root.hidden) { input.focus({ preventScroll: true }); scroll(); }
      }
    }

    form.addEventListener("submit", event => {
      event.preventDefault();
      if (running) return;
      submit(input.value);
    });
    input.addEventListener("input", refresh);
    input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        const list = shell.complete(input.value);
        if (list.length === 1) { input.value = replaceLast(input.value, list[0]); refresh(); return; }
        if (list.length > 1) {
          // Fill the longest shared start, then show the choices.
          const word = (input.value.match(/\S*$/) || [""])[0];
          let common = list[0];
          for (const name of list) while (!name.startsWith(common)) common = common.slice(0, -1);
          if (common.length > word.length) input.value = input.value.replace(/\S*$/, common);
          showSuggestions(list);
        }
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!history.length) return;
        event.preventDefault();
        if (cursor === history.length) draft = input.value;
        cursor = Math.max(0, Math.min(history.length, cursor + (event.key === "ArrowUp" ? -1 : 1)));
        input.value = cursor === history.length ? draft : history[cursor];
        input.setSelectionRange(input.value.length, input.value.length);
        refresh();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "l") { event.preventDefault(); output.replaceChildren(); return; }
      // Ctrl+C with no selection interrupts; with a selection it still copies.
      if (event.ctrlKey && event.key.toLowerCase() === "c" && input.selectionStart === input.selectionEnd) {
        event.preventDefault();
        if (running) { running.abort(); return; }
        echo(input.value + "^C");
        input.value = "";
        refresh();
      }
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (running) running.abort(); close(); return; }
      if (event.key !== "Tab") return;
      // Focus stays in the dialog: the field and the close button.
      const closeButton = root.querySelector(".aden-term-close");
      if (event.shiftKey && document.activeElement === input) { event.preventDefault(); closeButton.focus(); }
      else if (document.activeElement === closeButton) { event.preventDefault(); input.focus(); }
    });
    root.querySelector(".aden-term-close").addEventListener("click", () => close());
    root.querySelector(".aden-term-backdrop").addEventListener("click", () => close());
    // A click on the screen (not a link or a selection) returns focus to the field.
    screen.addEventListener("mouseup", event => {
      if (event.target.closest("a") || String(window.getSelection?.() || "")) return;
      input.focus({ preventScroll: true });
    });

    const place = readJSON(sessionStorage, WEATHER_KEY)?.payload?.location?.label;
    out.line([{ text: "aden-space terminal", cls: "title" }, { text: " v1.0", cls: "dim" }]);
    out.line([{ text: t(`上次登录：${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}${place ? `，来自 ${place}` : ""}`, `Last login: ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}${place ? ` from ${place}` : ""}`), cls: "dim" }]);
    out.line([t("输入 ", "Type "), { text: "help", cls: "cmd" }, t(" 查看命令，试试 ", " for commands, or try "), { text: "recent", cls: "cmd" }, " · ", { text: "fx", cls: "cmd" }, " · ", { text: "sky", cls: "cmd" }, " · ", { text: "neofetch", cls: "cmd" }]);

    return { root, panel, input, abort: () => running?.abort() };
  }

  let opener = null, loading = null, closeTimer = null;
  async function loadIndex() {
    const data = await fetchJSON(`${PREFIX()}/terminal-index.json`);
    return Array.isArray(data?.posts) ? data.posts : [];
  }

  async function open(from) {
    if (ui && !ui.root.hidden) { ui.input.focus(); return; }
    opener = from || document.activeElement;
    if (!ui) {
      loading ||= loadIndex().catch(() => []);
      ui = build(await loading);
    }
    clearTimeout(closeTimer);
    ui.root.hidden = false;
    document.documentElement.classList.add("aden-term-open");
    requestAnimationFrame(() => ui.root.classList.add("is-open"));
    ui.input.focus({ preventScroll: true });
  }

  function close() {
    if (!ui || ui.root.hidden) return;
    ui.abort();
    ui.root.classList.remove("is-open");
    document.documentElement.classList.remove("aden-term-open");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    closeTimer = setTimeout(() => { ui.root.hidden = true; }, reduce ? 0 : 200);
    if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    opener = null;
  }

  window.AdenTerminal = { open, close, createShell, tokenize, sparkline };
})();
